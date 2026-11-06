import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
/**
 * src/test.ts — 单元测试（Mock 测试，无网络、无数据库）
 *
 * 运行：npx tsx src/test.ts
 * 备用：node src/test.ts   （Node 22+ 原生类型擦除）
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TemporalMemoryStore, bm25Score, buildBm25Stats, contentHash, cosine, isCurrent, lcsSimilarity, textSimilarity, tokenize } from "./memory.js";
import { GapStore } from "./gaps.js";
import { PlaybookEventLog } from "./events.js";
import { InjectionLog, TurnFeedbackTracker, classifyFeedback, extractUserText } from "./injection_log.js";
import { PersonaStore } from "./persona.js";
import { PlaybookStore } from "./playbook.js";
import { TopicStore } from "./topics.js";
import { buildDistillPrompt, parseDistillResult } from "./distill.js";
import { dataDir, expandHome, packageRoot, resolveDataFile, resolveUserPath } from "./util.js";
import { JsonStateStore } from "./persist.js";
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker, extractContradictions, } from "./reflection.js";
import { ProactiveGate } from "./proactive.js";
import { LongHorizonTaskManager } from "./task_manager.js";
/** 测试产物一律写系统临时目录：不能在插件包根/工作目录留垃圾，否则又会诱发「清理仓库时误删」。 */
const TEST_TMP = mkdtempSync(join(tmpdir(), 'dsh-cognition-test-'));
let passed = 0;
const failures = [];
async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  \u2713 ${name}`);
    }
    catch (error) {
        failures.push({ name, error });
        console.log(`  \u2717 ${name}`);
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.log(`      ${message.split('\n')[0]}`);
    }
}
function section(title) {
    console.log(`\n${title}`);
}
async function main() {
    console.log('cognition-engine 单元测试');
    /* ---------------------------------------------------------------- */
    section('[1] 记忆衰减与强化');
    await test('衰减：幂律而非指数（长尾更厚，且有下界）', () => {
        let now = 1_000_000;
        const store = new TemporalMemoryStore({ now: () => now, halfLifeMs: 60_000 });
        const fact = store.ingest({ content: '部署区域：华东', subject: '部署区域' });
        assert.equal(store.decay(fact.id, now), 1);
        // 幂律（FSRS 形式）：t=S 时 R=0.9，而不是指数衰减的 0.5。
        // 依据：Wixted & Ebbesen 1991 / Rubin & Wenzel 1996 —— 幂函数拟合更好，
        // 两者在长延迟才分叉，指数过早在"判死"一条记忆。
        now += 60_000;
        assert.ok(Math.abs(store.decay(fact.id, now) - 0.9) < 0.02, `一个半衰期后应约 0.9，实得 ${store.decay(fact.id, now)}`);
        // 两个半衰期后仍明显高于指数会给出的 0.25
        now += 60_000;
        const two = store.decay(fact.id, now);
        assert.ok(two > 0.75, `两个半衰期后不该掉太快，实得 ${two.toFixed(3)}`);
        // 很久以后仍有下界：时间久 ≠ 不可信
        now += 60_000 * 1000;
        assert.equal(store.decay(fact.id, now), 0.2, '衰减有 0.2 下界，不会归零');
    });
    await test('强化：提升激活量并重置衰减计时', () => {
        let now = 5_000_000;
        const store = new TemporalMemoryStore({ now: () => now, halfLifeMs: 60_000 });
        const fact = store.ingest({ content: '值班表：每周三更新', subject: '值班表' });
        now += 120_000;
        const before = store.decay(fact.id, now);
        assert.ok(before < 1 && before > 0.7, `幂律下 2 个半衰期约 0.83，实际 ${before.toFixed(3)}`);
        const reinforced = store.reinforce(fact.id, 0.5);
        assert.equal(reinforced.activation, 0.5);
        assert.equal(store.decay(fact.id, now), 1, '强化后衰减应重置为 1');
    });
    await test('召回会自我强化：命中后激活量上升', () => {
        const store = new TemporalMemoryStore({ now: () => 42 });
        const fact = store.ingest({ content: '发布流程：先灰度再全量', subject: '发布流程' });
        assert.equal(store.get(fact.id)?.activation, 0);
        const hits = store.recall('发布流程', { mode: 'strict' });
        assert.equal(hits.length, 1);
        assert.ok((store.get(fact.id)?.activation ?? 0) > 0, '命中后激活量应上升');
    });
    await test('无关查询不强化：相似度不足的命中不加权', () => {
        const store = new TemporalMemoryStore({ now: () => 42 });
        const fact = store.ingest({ content: '发布流程：先灰度再全量', subject: '发布流程' });
        // 毫不相关的查询仍会返回低分命中（score 里还有 decay / importance 项），
        // 但相似度低于 RECALL_REINFORCE_FLOOR，不该被强化。
        const hits = store.recall('量子纠缠退相干实验', { mode: 'strict' });
        assert.ok(hits.length >= 1, '低分命中仍应返回');
        assert.equal(store.get(fact.id)?.activation, 0, '无关命中不应强化记忆');
    });
    await test('常用记忆衰减更慢（activation 放大半衰期）', () => {
        let now = 1_000_000;
        const store = new TemporalMemoryStore({ now: () => now, halfLifeMs: 60_000 });
        const hot = store.ingest({ content: '常用规则：先测试再发版', subject: '常用' });
        const cold = store.ingest({ content: '冷门规则：某个特殊情况', subject: '冷门' });
        store.reinforce(hot.id, 4, now);
        now += 120_000;
        const hotDecay = store.decay(hot.id, now);
        const coldDecay = store.decay(cold.id, now);
        assert.ok(hotDecay > coldDecay, `常用记忆衰减更慢：hot=${hotDecay.toFixed(3)} cold=${coldDecay.toFixed(3)}`);
        assert.ok(hotDecay > 0.7, `常用记忆此时应仍较高，实际 ${hotDecay.toFixed(3)}`);
    });
    await test('强度放大有上限：高频记忆最终也会衰减', () => {
        let now = 1_000_000;
        const store = new TemporalMemoryStore({ now: () => now, halfLifeMs: 60_000 });
        const fact = store.ingest({ content: '高频记忆', subject: '高频' });
        store.reinforce(fact.id, 100, now);
        // boost 封顶为 1 + MAX_STRENGTH_BOOST = 6 倍 → 有效半衰期 360s，
        // 过 600s ≈ 1.67 个有效半衰期。幂律下约 (1+19/81*1.67)^-0.5 ≈ 0.78。
        now += 600_000;
        const value = store.decay(fact.id, now);
        assert.ok(value < 0.85 && value > 0.7, `应衰减到 0.78 附近，实际 ${value.toFixed(3)}`);
        // 无论激活多高，最终都会衰减到 0.2 下界，但不会再低
        now += 60_000 * 10_000;
        assert.equal(store.decay(fact.id, now), 0.2, '再久也停在下界，不会归零');
    });
    await test('激活量高的记忆不被归档', () => {
        let now = 1_000_000;
        const store = new TemporalMemoryStore({ now: () => now });
        const hot = store.ingest({ content: '常用', subject: 'A' });
        const cold = store.ingest({ content: '冷门', subject: 'B' });
        store.reinforce(hot.id, 2, now);
        now += 200 * 86_400_000;
        const archived = store.autoArchive({ idleDays: 180, now });
        assert.deepEqual(archived, [cold.id], '只归档冷门记忆');
    });
    /* ---------------------------------------------------------------- */
    section('[2] 双时态召回（LongMemory 语义）');
    await test('闭合区间不改变内容指纹与 id', () => {
        const JAN = 1_000;
        const MAR = 3_000;
        const store = new TemporalMemoryStore({ now: () => MAR });
        const oldFact = store.ingest({
            content: '后端语言：Python',
            subject: '后端语言',
            validFrom: JAN,
            recordedAt: JAN,
        });
        const newFact = store.ingest({
            content: '后端语言：TypeScript',
            subject: '后端语言',
            validFrom: MAR,
            recordedAt: MAR,
            supersedes: oldFact.id,
        });
        const after = store.get(oldFact.id);
        assert.ok(after !== undefined);
        assert.equal(after.hash, oldFact.hash, '被取代后 hash 必须保持不变');
        assert.equal(after.id, oldFact.id, '被取代后 id 必须保持不变');
        assert.equal(after.validTo, MAR, 'validTo 应被闭合到取代时刻');
        assert.equal(after.supersededBy, newFact.id);
        assert.equal(after.content, '后端语言：Python', '内容不可变');
    });
    await test('strict / historical / belief 三种口径给出不同答案', () => {
        const JAN = 1_000;
        const MAR = 3_000;
        let now = 5_000;
        const store = new TemporalMemoryStore({ now: () => now });
        const python = store.ingest({
            content: '后端语言：Python',
            subject: '后端语言',
            validFrom: JAN,
            recordedAt: JAN,
        });
        const typescript = store.ingest({
            content: '后端语言：TypeScript',
            subject: '后端语言',
            validFrom: MAR,
            recordedAt: MAR,
            supersedes: python.id,
        });
        const strict = store.recall('后端语言', { mode: 'strict' });
        assert.equal(strict.length, 1);
        assert.equal(strict[0]?.fact.id, typescript.id, '当前真值应为 TypeScript');
        const historical = store.recall('后端语言', { mode: 'historical', validTime: 2_000 });
        assert.equal(historical.length, 1);
        assert.equal(historical[0]?.fact.id, python.id, '二月的真值应为 Python');
        const belief = store.recall('后端语言', { mode: 'belief', recordedTime: 2_000 });
        assert.equal(belief.length, 1);
        assert.equal(belief[0]?.fact.id, python.id, '二月的信念应为 Python');
        now = 6_000;
        assert.equal(isCurrent(store.get(typescript.id), now), true);
        assert.equal(isCurrent(store.get(python.id), now), false);
    });
    await test('未生效的未来事实不进入 strict 召回', () => {
        let now = 1_000;
        const store = new TemporalMemoryStore({ now: () => now });
        store.ingest({ content: '机房搬迁：三月执行', subject: '机房搬迁', validFrom: 9_000 });
        assert.equal(store.recall('机房搬迁', { mode: 'strict' }).length, 0);
        now = 10_000;
        assert.equal(store.recall('机房搬迁', { mode: 'strict' }).length, 1);
    });
    /* ---------------------------------------------------------------- */
    section('[3] 冲突检测');
    await test('同一主题的有效区间重叠即冲突', () => {
        const store = new TemporalMemoryStore({ now: () => 10_000 });
        const a = store.ingest({ content: '发布窗口：周三', subject: '发布窗口', validFrom: 1_000 });
        const b = store.ingest({ content: '发布窗口：周五', subject: '发布窗口', validFrom: 2_000 });
        const conflicts = store.conflicts();
        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0]?.subject, '发布窗口');
        assert.deepEqual([conflicts[0]?.leftId, conflicts[0]?.rightId].sort(), [a.id, b.id].sort());
        assert.equal(store.stats().conflicts, 1);
    });
    await test('取代之后冲突消失，但历史仍留两份', () => {
        const store = new TemporalMemoryStore({ now: () => 10_000 });
        const a = store.ingest({ content: '发布窗口：周三', subject: '发布窗口', validFrom: 1_000 });
        const b = store.ingest({ content: '发布窗口：周五', subject: '发布窗口', validFrom: 2_000 });
        assert.equal(store.conflicts().length, 1);
        store.supersede(a.id, b.id, 2_000);
        assert.equal(store.conflicts().length, 0, '取代后区间不再重叠');
        assert.equal(store.history('发布窗口').length, 2, '历史时间线仍保留两条');
        assert.equal(store.stats().superseded, 1);
        assert.equal(store.stats().current, 1);
    });
    await test('删除后冲突消失：已删条目不该一直挂在 conflicts 里', () => {
        const store = new TemporalMemoryStore({ now: () => 10_000 });
        const a = store.ingest({ content: '测试条目：周三点检', subject: '测试条目', validFrom: 1_000 });
        const b = store.ingest({ content: '测试条目：周五点检', subject: '测试条目', validFrom: 2_000 });
        assert.equal(store.stats().conflicts, 1);
        store.softDelete(a.id);
        assert.equal(store.stats().conflicts, 0, '删掉一条后不该再有冲突');
        store.softDelete(b.id);
        assert.equal(store.conflicts().length, 0);
        assert.equal(store.stats().current, 0, '两条都不再是当前真值');
    });
    await test('相同内容重复写入不产生第二条事实', () => {
        const store = new TemporalMemoryStore({ now: () => 7 });
        const first = store.ingest({ content: '偏好：深色主题', subject: '偏好', validFrom: 7 });
        const second = store.ingest({ content: '偏好：深色主题', subject: '偏好', validFrom: 7 });
        assert.equal(store.size, 1);
        assert.equal(first.id, second.id);
        assert.equal(first.hash, contentHash('偏好', '偏好：深色主题', '7'));
    });
    await test('同一毫秒内取代不会把旧区间压成空集', () => {
        const T = 4_242;
        const store = new TemporalMemoryStore({ now: () => T });
        const oldFact = store.ingest({ content: '缓存策略：先读本地', subject: '缓存策略' });
        const newFact = store.ingest({
            content: '缓存策略：直连远端',
            subject: '缓存策略',
            supersedes: oldFact.id,
        });
        assert.equal(oldFact.validFrom, T);
        assert.equal(newFact.validFrom, T + 1, '新事实应严格晚于旧事实生效');
        assert.equal(store.get(oldFact.id)?.validTo, T + 1);
        assert.equal(store.conflicts().length, 0);
        const atOld = store.recall('缓存策略', { mode: 'historical', validTime: T });
        assert.equal(atOld.length, 1);
        assert.equal(atOld[0]?.fact.id, oldFact.id, 'T 时刻的历史真值应仍是旧事实');
    });
    /* ---------------------------------------------------------------- */
    /* ---------------------------------------------------------------- */
    await test('默认落盘路径在用户数据目录，不在插件包内', () => {
        const p = resolveDataFile('cognition-state.json');
        assert.ok(p.startsWith(dataDir()), '应位于用户数据目录下');
        assert.ok(!p.startsWith(packageRoot), '不应位于插件包根目录下（用户数据不能放代码目录）');
        assert.ok(!p.includes('node_modules'), '不应落到依赖目录');
    });
    await test('配置路径：~ 展开到主目录，不解析成 cwd 下的字面 ~ 目录', () => {
        assert.equal(expandHome('~/x'), join(homedir(), 'x'));
        assert.equal(expandHome('~'), homedir());
        assert.equal(expandHome('rel/x'), 'rel/x');
        assert.ok(resolveUserPath('~/x').startsWith(homedir()), '展开后的绝对路径应在主目录下');
        assert.ok(!resolveUserPath('~/x').includes('~'), '不应残留字面 ~');
    });
    await test('checksum 过期但 JSON 有效：按数据恢复，不隔离成空库', async () => {
        const file = join(TEST_TMP, 'stale-checksum.json');
        const first = new JsonStateStore({
            filePath: file,
            debounceMs: 0,
            serialize: () => ({ n: 1 }),
            restore: () => undefined,
        });
        await first.flush();
        // 模拟「rename 数据后、写 .sha256 前」崩溃：侧车还是旧值
        writeFileSync(`${file}.sha256`, 'stale-hash', 'utf8');
        let restored = { n: 0 };
        const second = new JsonStateStore({
            filePath: file,
            debounceMs: 0,
            serialize: () => restored,
            restore: (data) => {
                restored = data;
            },
        });
        assert.equal(await second.load(), true, 'JSON 有效时不应隔离成空库');
        assert.deepEqual(restored, { n: 1 }, '应按数据内容恢复');
        assert.ok(second.warning.includes('校验和'), second.warning);
        await rm(file, { force: true });
        await rm(`${file}.sha256`, { force: true });
    });
    section('[6] 辩证反思：三次串行调用');
    await test('矛盾解析支持中英文冒号', () => {
        const text = [
            'CONTRADICTION: 前提未验证',
            'EVIDENCE: 没有任何实验支撑',
            'CONTRADICTION：结论过强',
            'EVIDENCE：样本只有一次',
        ].join('\n');
        const parsed = extractContradictions(text);
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0]?.description, '前提未验证');
        assert.equal(parsed[1]?.evidence, '样本只有一次');
    });
    await test('归档后不进 strict，但历史仍可查', () => {
        const store = new TemporalMemoryStore({ now: () => 10_000 });
        const fact = store.ingest({ content: '临时约定：周五发版', subject: '发版', validFrom: 1000 });
        store.setArchived(fact.id, true);
        assert.equal(store.recall('发版', { mode: 'strict' }).length, 0, '归档后不应出现在 strict');
        assert.equal(store.recall('发版', { mode: 'historical', validTime: 5000 }).length, 1, '历史仍可查');
        assert.equal(store.stats().archived, 1);
        store.setArchived(fact.id, false);
        assert.equal(store.recall('发版', { mode: 'strict' }).length, 1, '取消归档后恢复');
    });
    await test('autoArchive 只归档长期未访问的记忆', () => {
        let now = 1_000;
        const store = new TemporalMemoryStore({ now: () => now });
        const old = store.ingest({ content: '很久以前的约定', subject: '旧' });
        now = 200 * 86_400_000; // 把时钟推到 200 天后
        const archived = store.autoArchive({ idleDays: 180 });
        assert.ok(archived.includes(old.id), '超过 180 天未访问应被归档');
        assert.equal(store.stats().archived, 1);
    });
    await test('三次调用严格按 thesis → antithesis → synthesis 串行', async () => {
        const mock = new MockDialecticalLLM();
        const engine = new DialecticalReflectionEngine(mock.call);
        const result = await engine.reflect('要不要重写遗留系统');
        assert.deepEqual([...mock.callOrder], ['thesis', 'antithesis', 'synthesis']);
        assert.equal(result.calls.length, 3);
        assert.ok(result.calls[0].finishedAt <= result.calls[1].startedAt);
        assert.ok(result.calls[1].finishedAt <= result.calls[2].startedAt);
    });
    await test('上一段输出确实被拼进下一段 prompt', async () => {
        const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
        const result = await engine.reflect('要不要重写遗留系统');
        assert.ok(result.thesis.includes('THESIS'));
        assert.ok(result.calls[1].prompt.includes(result.thesis), 'ANTITHESIS 必须带上 THESIS 原文');
        assert.ok(result.calls[2].prompt.includes(result.thesis), 'SYNTHESIS 必须带上 THESIS');
        assert.ok(result.calls[2].prompt.includes('ANTITHESIS (critique)'), 'SYNTHESIS 必须带上 ANTITHESIS');
        assert.ok(result.calls[2].prompt.includes('IDENTIFIED CONTRADICTIONS'), '必须附上矛盾清单');
        assert.equal(result.contradictions.length, 2);
        assert.ok(result.contradictions.every((item) => item.evidence.length > 0));
        assert.ok(result.synthesis.includes('SYNTHESIS'));
    });
    await test('空输出立即抛错，不污染后续阶段', async () => {
        let calls = 0;
        const engine = new DialecticalReflectionEngine(() => {
            calls += 1;
            return '   ';
        });
        await assert.rejects(() => engine.reflect('任意问题'), /空内容/);
        assert.equal(calls, 1, '第一次就失败，不应继续调用');
    });
    await test('renderTranscript 输出完整三段', async () => {
        const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
        const result = await engine.reflect('是否引入缓存层');
        const text = engine.renderTranscript(result);
        assert.ok(text.includes('## THESIS'));
        assert.ok(text.includes('## ANTITHESIS'));
        assert.ok(text.includes('## SYNTHESIS'));
        assert.ok(text.includes('矛盾（2 条）'));
    });
    /* ---------------------------------------------------------------- */
    section('[7] 工具函数');
    await test('分词：中文二元组 + 英文单词', () => {
        const tokens = tokenize('部署 region');
        assert.ok(tokens.has('部署'));
        assert.ok(tokens.has('region'));
    });
    /* ---------------------------------------------------------------- */
    section('[8] 主动发言闸门：默认不做');
    await test('冷场触发只返回 OBSERVE，不生成发言', () => {
        const gate = new ProactiveGate({ now: () => 0, idleThresholdMs: 60_000, minScore: 0.6 });
        const decision = gate.observe({
            silenceMs: 600_000,
            topic: '排期',
            addressed: true,
            listed: true,
        });
        assert.equal(decision.state, 'OBSERVE');
        assert.equal(decision.admission, 'explicit');
        assert.equal(decision.draft, undefined, '第一次判断绝不能有发言草稿');
        assert.equal(gate.pending().length, 1);
    });
    await test('二次判断才可能发言；recordOnly 默认只记录', () => {
        const gate = new ProactiveGate({ now: () => 0, idleThresholdMs: 60_000, recordOnly: true });
        const first = gate.observe({ silenceMs: 600_000, topic: '排期', addressed: true, listed: true });
        const second = gate.judge(first.observationId);
        assert.equal(second.state, 'SILENT');
        assert.ok(second.draft?.includes('排期'), '草稿应被记录下来供复盘');
        assert.ok(second.reason.includes('recordOnly'));
    });
    await test('关闭 recordOnly 后才允许 SPEAK，且受冷却约束', () => {
        const gate = new ProactiveGate({ now: () => 0, idleThresholdMs: 60_000, recordOnly: false, cooldownMs: 1_000 });
        const first = gate.observe({ silenceMs: 600_000, topic: '排期', addressed: true, listed: true });
        assert.equal(gate.judge(first.observationId).state, 'SPEAK');
        const second = gate.observe({ silenceMs: 600_000, topic: '排期二', addressed: true, listed: true });
        const decision = gate.judge(second.observationId);
        assert.equal(decision.state, 'SILENT');
        assert.ok(decision.reason.includes('冷却'));
    });
    await test('没人点名且不在名单：准入直接 ignore', () => {
        const gate = new ProactiveGate({ now: () => 0 });
        const decision = gate.observe({ silenceMs: 900_000, topic: '闲聊' });
        assert.equal(decision.state, 'SILENT');
        assert.equal(decision.admission, 'ignore');
        assert.equal(gate.pending().length, 0, 'ignore 的观察不入账');
    });
    /* ---------------------------------------------------------------- */
    section('[9] Inline & Spill 按需加载');
    await test('近期记忆 inline，久远记忆只给 ID 引用', () => {
        let now = 1_000_000;
        const store = new TemporalMemoryStore({ now: () => now });
        const oldFact = store.ingest({ content: '久远：去年迁移过机房', subject: '机房' });
        now += 48 * 60 * 60 * 1000;
        const recentFact = store.ingest({ content: '近期：今天部署到测试环境', subject: '部署' });
        const rendered = store.render('机房 部署', {
            inlineMaxAgeMs: 24 * 60 * 60 * 1000,
            inlineChars: 8,
        });
        assert.equal(rendered.inline.length, 1);
        assert.equal(rendered.inline[0]?.id, recentFact.id);
        assert.equal(rendered.inline[0]?.truncated, true, '超过 inlineChars 应截断');
        assert.ok(rendered.inline[0]?.content.endsWith('…'));
        assert.equal(rendered.spilled.length, 1);
        assert.equal(rendered.spilled[0]?.id, oldFact.id);
        assert.equal(rendered.spilled[0]?.pointer, `memory://${oldFact.id}`);
        assert.ok(rendered.text.includes(oldFact.id));
        assert.ok(!rendered.text.includes('去年迁移过机房'), '久远正文不得 inline');
        assert.ok(rendered.stats.savedChars > 0);
    });
    /* ---------------------------------------------------------------- */
    section('[10] 后台 Worker：不阻塞主线程');
    await test('reflectInBackground 会让出事件循环', async () => {
        const order = [];
        const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
        const running = engine.reflectInBackground('要不要引入缓存层').then((result) => {
            order.push('done');
            return result;
        });
        setTimeout(() => order.push('tick'), 0);
        const result = await running;
        assert.deepEqual(order, ['tick', 'done'], '主线程的定时器必须先于反思完成执行');
        assert.deepEqual(result.calls.map((call) => call.phase), ['thesis', 'antithesis', 'synthesis']);
    });
    await test('ReflectionWorker 串行排队且全部完成', async () => {
        const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
        const worker = new ReflectionWorker(engine, 1);
        const [first, second] = await Promise.all([worker.submit('问题A'), worker.submit('问题B')]);
        assert.equal(first.query, '问题A');
        assert.equal(second.query, '问题B');
        const jobs = worker.jobs();
        assert.equal(jobs.length, 2);
        assert.ok(jobs.every((job) => job.status === 'done'));
        assert.equal(worker.pending, 0);
    });
    /* ---------------------------------------------------------------- */
    section('[11] 长程任务台账');
    await test('创建 / 更新 / 待办 / 催办 / 重启恢复', async () => {
        const file = join(TEST_TMP, 'cognition-test-tasks.json');
        await rm(file, { force: true });
        let now = 1_000;
        const manager = new LongHorizonTaskManager({ filePath: file, now: () => now, heartbeatMs: 1_000 });
        await manager.load();
        const task = await manager.create_task('把记忆落盘做成可恢复的');
        assert.equal(task.status, 'PENDING');
        assert.equal(task.context.length, 0);
        now += 2_000;
        const updated = await manager.update_task_progress(task.id, 'IN_PROGRESS', ['已设计 schema', '待写迁移']);
        assert.equal(updated.status, 'IN_PROGRESS');
        assert.equal(updated.context.length, 2);
        assert.equal(manager.get_pending_tasks().length, 1);
        const due = manager.check_due_tasks(now + 2_000);
        assert.equal(due.length, 1);
        assert.ok(due[0].overdueMs >= 2_000);
        const reloaded = new LongHorizonTaskManager({ filePath: file, now: () => now, heartbeatMs: 1_000 });
        await reloaded.load();
        assert.equal(reloaded.all().length, 1, '重启后应从 tasks.json 恢复');
        assert.equal(reloaded.get(task.id)?.status, 'IN_PROGRESS');
        await manager.update_task_progress(task.id, 'COMPLETED');
        assert.equal(manager.get_pending_tasks().length, 0);
        assert.equal(manager.check_due_tasks(now + 10_000).length, 0, '已完成的任务不再催办');
        await rm(file, { force: true });
    });
    /* ---------------------------------------------------------------- */
    section('[11] 准则本：确定性合并与渲染');
    const pbFile = join(TEST_TMP, 'test-playbook.json');
    const newPlaybook = () => new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, validateSourceIds: () => [] });
    await test('套话被拒：换成任何项目都成立的不收', () => {
        const pb = newPlaybook();
        const outcome = pb.submit({ content: '认真检查代码质量，注意边界情况', section: '约定' });
        assert.equal(outcome.accepted, false);
        assert.ok(outcome.reason?.includes('套话'), outcome.reason);
    });
    await test('长度越界被拒', () => {
        const pb = newPlaybook();
        assert.equal(pb.submit({ content: '太短' }).accepted, false);
        const long = '这是一条非常非常长的准则'.repeat(10);
        assert.equal(pb.submit({ content: long }).accepted, false);
    });
    await test('高相似候选被判重复，不自动合并', () => {
        const pb = newPlaybook();
        const first = pb.submit({ content: '发版前必须先跑完整测试再打包发布', section: '约定' });
        assert.equal(first.accepted, true);
        pb.accept(first.entry.id);
        const second = pb.submit({ content: '发版前必须先跑完整测试再打包发布出去', section: '约定' });
        assert.equal(second.accepted, false);
        assert.equal(second.duplicateOf, first.entry.id, '应指出与哪条重复');
    });
    await test('来源全部无效时丢弃（防臆造出处）', () => {
        const pb = new PlaybookStore({
            filePath: pbFile,
            now: () => 1_000_000,
            validateSourceIds: () => [],
        });
        const outcome = pb.submit({ content: '模型臆造的一条准则内容在这里', sourceIds: ['mem-不存在'] });
        assert.equal(outcome.accepted, false);
        assert.ok(outcome.reason?.includes('来源'), outcome.reason);
    });
    await test('审核流转：pending → accept / reject', () => {
        const pb = newPlaybook();
        const a = pb.submit({ content: '提交前先跑 node src/test.ts 全量测试', section: '约定' });
        assert.equal(pb.pending().length, 1);
        assert.equal(pb.accept(a.entry.id), true);
        assert.equal(pb.pending().length, 0);
        assert.equal(pb.active().length, 1);
        const b = pb.submit({ content: '另一条待审的准则内容示例文本', section: '约定' });
        assert.equal(pb.reject(b.entry.id), true);
        assert.equal(pb.get(b.entry.id), undefined, 'reject 直接移除');
    });
    await test('编辑保留历史版本', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '最初的准则内容写在这里示例', section: '约定' });
        const id = a.entry.id;
        assert.equal(pb.revise(id, '修改之后的准则内容写在这里示例'), true);
        const entry = pb.get(id);
        assert.equal(entry.history.length, 1);
        assert.equal(entry.history[0]?.content, '最初的准则内容写在这里示例');
    });
    await test('有害标记达阈值自动退场', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '一条经常误导人的准则内容示例', section: '坑' });
        const id = a.entry.id;
        pb.mark(id, 'harmful');
        pb.mark(id, 'harmful');
        assert.equal(pb.get(id)?.status, 'active', '两次还不退场');
        pb.mark(id, 'harmful');
        assert.equal(pb.get(id)?.status, 'retired', '三次 harmful 自动退场');
    });
    await test('渲染格式带 id 与双向计数，空准则本返回空串', () => {
        const pb = newPlaybook();
        assert.equal(pb.render(), '', '空准则本应返回空串，交给调用方回退 digest');
        const a = pb.addManual({ content: '发版流程五步不跳步，纯文档改动不升版本号', section: '约定' });
        pb.mark(a.entry.id, 'helpful', 2);
        const text = pb.render();
        // 没挂主题的条目统一进「未归类」组（按主题分组的新渲染规则）
        assert.ok(text.includes('## 未归类'), text);
        assert.ok(text.includes('[ctxt-00001]'), text);
        assert.ok(text.includes('helpful=2'), text);
        assert.ok(text.includes('::'), '应使用 ACE 的一行式格式');
    });
    await test('渲染预算：超长时截断且至少保底一组', () => {
        const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, maxChars: 260 });
        pb.addManual({ content: '约定一：发版前跑完整流程再发布不要跳步', section: '约定' });
        pb.addManual({ content: '坑一：改 JS 一律用 Node 脚本不要 PowerShell', section: '坑' });
        pb.addManual({ content: '状态一：当前处于 v0.8 到 v0.9 的过渡阶段', section: '状态' });
        const text = pb.render();
        assert.ok(text.length <= 340, '应受预算约束，实际 ' + text.length);
        assert.ok(text.includes('## '), '至少保留一组的标题');
    });
    await test('渲染按主题分组：挂了主题就用主题名做标题', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const b = pb.addManual({ content: '文档整理一格一照每行独立标题', section: '约定' });
        pb.setTopics(a.entry.id, ['t_release']);
        pb.setTopics(b.entry.id, ['t_photo']);
        const text = pb.render(1_000_000, undefined, (id) => id === 't_release' ? '发布流程' : id === 't_photo' ? '文档整理' : undefined);
        assert.ok(text.includes('## 发布流程'), text);
        assert.ok(text.includes('## 文档整理'), text);
        assert.ok(!text.includes('## 未归类'), '都挂了主题就不该有未归类组');
    });
    await test('三道约束：自查/拦截/审计默认全关', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: 'npm 发布必须显式加 --registry 参数', section: '坑' });
        const entry = pb.get(a.entry.id);
        assert.equal(entry.guard, false);
        assert.equal(entry.enforce, false);
        assert.equal(entry.audit, false);
        assert.equal(entry.trigger, '');
        assert.equal(entry.violations, 0);
        // 没勾选时注入文本里既没有自查块，也没有拦截提示
        assert.equal(pb.renderSelfCheck().length, 0);
    });
    await test('自查：勾选后进入开工前清单', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        pb.setFlags(a.entry.id, { guard: true });
        const selfCheck = pb.renderSelfCheck();
        assert.ok(selfCheck.includes('【开工前自查】'), selfCheck);
        assert.ok(selfCheck.includes('ctxt-00001'), '应点名条目 id');
        // 整个注入段落也要带上它
        assert.ok(pb.renderSection().startsWith('【开工前自查】'), pb.renderSection().slice(0, 40));
    });
    await test('拦截判定：触发匹配且缺必需项才算违反', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: 'npm 发布必须显式加 --registry 参数', section: '坑' });
        pb.setFlags(a.entry.id, { enforce: true, trigger: 'npm\\s+publish', required: '--registry' });
        // 触发但不满足 → 违反且拦截
        const bad = pb.checkToolCall('bash {"command":"npm publish"}');
        assert.equal(bad.blocked.length, 1, '应拦截');
        assert.equal(bad.violated.length, 1);
        // 触发且满足 → 放行
        const good = pb.checkToolCall('bash {"command":"npm publish --registry=https://registry.npmjs.org"}');
        assert.equal(good.blocked.length, 0);
        // 不触发 → 放行
        const unrelated = pb.checkToolCall('bash {"command":"ls -la"}');
        assert.equal(unrelated.blocked.length, 0);
        assert.equal(unrelated.violated.length, 0);
    });
    await test('审计：只记录不拦截；未勾选则不参与判定', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '禁止修改生产环境配置文件', section: '坑' });
        pb.setFlags(a.entry.id, { audit: true, trigger: 'prod\\.json' });
        const audited = pb.checkToolCall('edit {"path":"prod.json"}');
        assert.equal(audited.violated.length, 1, '应记录');
        assert.equal(audited.blocked.length, 0, '审计不拦截');
        const b = pb.addManual({ content: '所有接口一律用 POST 提交参数', section: '约定' });
        pb.setFlags(b.entry.id, { trigger: 'api' });
        // 没勾 enforce 也没勾 audit → 即使 trigger 命中也什么都不做
        const ignored = pb.checkToolCall('fetch {"url":"api/x"}');
        assert.equal(ignored.violated.length, 0);
    });
    await test('违规计数与非法正则不炸', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: 'npm 发布必须显式加 --registry 参数', section: '坑' });
        pb.setFlags(a.entry.id, { enforce: true, trigger: '[未闭合', required: '' });
        // 非法正则按「不匹配」处理，不抛错
        const result = pb.checkToolCall('bash {"command":"npm publish"}');
        assert.equal(result.violated.length, 0);
        pb.setFlags(a.entry.id, { trigger: 'npm', required: '--registry' });
        pb.recordViolation(a.entry.id);
        pb.recordViolation(a.entry.id);
        assert.equal(pb.get(a.entry.id)?.violations, 2);
        assert.equal(pb.stats().violationsTotal, 2);
        assert.ok((pb.get(a.entry.id)?.lastViolationAt ?? 0) > 0);
    });
    await test('准则可永久删除（任意状态）', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const id = a.entry.id;
        assert.equal(pb.remove(id), true, '应删除成功');
        assert.equal(pb.get(id), undefined, '删除后应查不到');
        assert.equal(pb.active().length, 0);
        assert.equal(pb.remove(id), false, '重复删除返回 false');
        // pending 与 retired 也要能删
        const pendingOne = pb.submit({ content: '一条待审的准则内容示例文本', section: '状态' });
        assert.equal(pb.remove(pendingOne.entry.id), true, 'pending 可删');
        const retiredOne = pb.addManual({ content: '一条会被停用的准则内容示例', section: '坑' });
        pb.retire(retiredOne.entry.id, '测试');
        assert.equal(pb.remove(retiredOne.entry.id), true, 'retired 可删');
        assert.equal(pb.all().length, 0, '全部删完');
    });
    await test('条目数超限时淘汰打分最低的', () => {
        const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, maxEntries: 2 });
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        pb.mark(a.entry.id, 'helpful', 5);
        pb.addManual({ content: '改 JS 一律用 Node 脚本不要用 PowerShell', section: '坑' });
        pb.addManual({ content: '当前处于 v0.8 到 v0.9 的过渡阶段', section: '状态' });
        assert.equal(pb.active().length, 2, '不应超过上限');
        assert.equal(pb.get(a.entry.id)?.status, 'active', '高 helpful 的应留下');
    });
    /* ---------------------------------------------------------------- */
    section('[12] 准则蒸馏：提示词与解析');
    await test('提示词包含现有准则与未覆盖记忆', () => {
        const pb = newPlaybook();
        const entry = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const prompt = buildDistillPrompt({
            entries: pb.all(),
            memories: [{ id: 'mem-1', subject: '部署', content: '部署在华东机房' }],
        });
        assert.ok(prompt.includes(entry.entry.id), '应带上现有准则 id 便于打标');
        assert.ok(prompt.includes('mem-1'), '应带上未覆盖记忆的 id');
        assert.ok(prompt.includes('换成别的项目还成立吗'), '应包含私有性判断口诀');
        assert.ok(prompt.includes('不要输出任何'), '应禁止模型输出改删指令');
    });
    await test('解析标准 JSON 输出', () => {
        const text = JSON.stringify({
            reasoning: '这些记忆值得沉淀',
            error_identification: '无',
            root_cause_analysis: '长期实践中形成',
            correct_approach: '提炼成准则',
            key_insight: '发版流程要固定',
            marks: [{ id: 'ctxt-00001', mark: 'helpful' }],
            candidates: [{ section: '约定', content: '发版前必须跑完整测试再打包发布', sourceIds: ['mem-1'] }],
        });
        const result = parseDistillResult(text);
        assert.equal(result.reflection.keyInsight, '发版流程要固定');
        assert.equal(result.marks.length, 1);
        assert.equal(result.marks[0]?.mark, 'helpful');
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0]?.section, '约定');
    });
    await test('解析带 markdown 围栏的输出', () => {
        const inner = JSON.stringify({ reasoning: 'x', candidates: [] });
        const result = parseDistillResult('```json\n' + inner + '\n```');
        assert.equal(result.reflection.reasoning, 'x');
        assert.equal(result.raw, undefined, '围栏应被剥掉');
    });
    await test('非法 mark 值与空字段被过滤', () => {
        const text = JSON.stringify({
            marks: [{ id: 'ctxt-1', mark: 'maybe' }, { id: '', mark: 'helpful' }, { id: 'ctxt-2', mark: 'harmful' }],
            candidates: [{ content: '' }, { content: '这是一条正常的候选准则内容' }],
        });
        const result = parseDistillResult(text);
        assert.equal(result.marks.length, 1, '只有合法 id + 合法 mark 的保留');
        assert.equal(result.marks[0]?.id, 'ctxt-2');
        assert.equal(result.candidates.length, 1, '空内容候选被丢弃');
    });
    await test('完全解析不出时返回 raw，不抛错', () => {
        const result = parseDistillResult('模型说了一堆废话但没有 JSON');
        assert.equal(result.candidates.length, 0);
        assert.ok(result.raw !== undefined, '应保留原文供排查');
    });
    /* ---------------------------------------------------------------- */
    section('[13] 准则本：有效期与冲突检测');
    await test('validTo 过期后不再注入', () => {
        let now = 1_000_000;
        const pb = new PlaybookStore({ filePath: pbFile, now: () => now });
        const a = pb.addManual({ content: '本周先用 A 方案，下周再评估切换', section: '状态' });
        assert.equal(pb.revise(a.entry.id, '本周先用 A 方案，下周再评估切换'), false, '内容没变不该算修改');
        // 手工设一个过去的时间点
        const entry = pb.get(a.entry.id);
        assert.ok(entry !== undefined);
        pb.extend(a.entry.id, now - 1);
        assert.equal(pb.expired(now).length, 1, '应进入过期集合');
        assert.equal(pb.active(now).length, 0, '过期的不算 active');
        assert.equal(pb.render(now).includes('A 方案'), false, '过期条目不应被注入');
    });
    await test('extend 延长有效期后重新生效', () => {
        const now = 1_000_000;
        const pb = new PlaybookStore({ filePath: pbFile, now: () => now });
        const a = pb.addManual({ content: '阶段内不要改动数据库连接池配置', section: '坑' });
        pb.extend(a.entry.id, now - 1);
        assert.equal(pb.active(now).length, 0);
        pb.extend(a.entry.id, now + 86_400_000);
        assert.equal(pb.active(now).length, 1, '延长后应重新生效');
    });
    await test('冲突检测：同 section + 内容相近 + 否定差异', () => {
        const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000 });
        pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const conflict = pb.detectConflict('发版前不要跑完整测试再打包发布', '约定');
        assert.ok(conflict === undefined || typeof conflict === 'string', '应返回条目 id 或 undefined');
        // 同一措辞不算冲突
        assert.equal(pb.detectConflict('发版前必须跑完整测试再打包发布', '约定'), undefined);
        // 不同 section 不比较
        assert.equal(pb.detectConflict('发版前不要跑完整测试再打包发布', '状态'), undefined);
    });
    await test('冲突标记写入条目并计入统计', () => {
        const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000 });
        pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const outcome = pb.submit({ content: '发版前不要跑完整测试再打包发布', section: '约定' });
        assert.equal(outcome.accepted, true);
        if (outcome.entry?.conflictWith !== undefined) {
            assert.ok(pb.stats().conflicted >= 1, '冲突应计入统计');
        }
    });
    /* ---------------------------------------------------------------- */
    section('[14] 主题注册表：人定的适用范围键');
    const topicFile = join(TEST_TMP, 'test-topics.json');
    const newTopics = () => new TopicStore({ filePath: topicFile, now: () => 1_000_000 });
    await test('主题：新增 / 重名拒绝 / 空名拒绝', () => {
        const ts = newTopics();
        const a = ts.add({ name: '发布流程', description: '版本发布相关', aliases: ['发版'] });
        assert.ok(typeof a === 'object', '应返回主题对象');
        assert.equal(ts.add({ name: '发布流程' }), '主题「发布流程」已存在');
        assert.equal(ts.add({ name: '   ' }), '主题名不能为空');
    });
    await test('主题：最多两层，三层被拒', () => {
        const ts = newTopics();
        const top = ts.add({ name: '工程' });
        const sub = ts.add({ name: '发布', parentId: top.id });
        assert.ok(typeof sub === 'object');
        const third = ts.add({ name: 'npm', parentId: sub.id });
        assert.equal(third, '主题最多两层');
    });
    await test('主题：归档后不参与匹配，但仍可查到', () => {
        const ts = newTopics();
        const a = ts.add({ name: '文档整理', aliases: ['图片'] });
        assert.equal(ts.match('整理图片').length, 1);
        assert.equal(ts.archive(a.id), true);
        assert.equal(ts.match('整理图片').length, 0, '归档后不参与匹配');
        assert.ok(ts.get(a.id) !== undefined, '归档不是物理删除');
        assert.equal(ts.stats().archived, 1);
    });
    await test('主题匹配：名字 > 别名 > 描述', () => {
        const ts = newTopics();
        ts.add({ name: '发布流程', description: '版本发布与回滚', aliases: ['release'] });
        assert.equal(ts.match('发布流程要五步')[0]?.how, 'name');
        assert.equal(ts.match('走 release 分支')[0]?.how, 'alias');
        assert.equal(ts.match('这次版本回滚怎么做')[0]?.how, 'description');
        assert.equal(ts.match('完全无关的内容').length, 0);
    });
    await test('记忆与准则都能挂主题，空数组回到未归类', () => {
        const store = new TemporalMemoryStore({ now: () => 1 });
        const fact = store.ingest({ content: '发版前必须跑完整测试', subject: '发布流程' });
        assert.deepEqual([...fact.topicIds], [], '默认未归类');
        const updated = store.setTopics(fact.id, ['t_001', 't_001', 't_002']);
        assert.deepEqual([...updated.topicIds], ['t_001', 't_002'], '应去重');
        assert.deepEqual([...store.setTopics(fact.id, []).topicIds], [], '空数组移回未归类');
        const pb = newPlaybook();
        const rule = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        assert.deepEqual(pb.get(rule.entry.id)?.topicIds, []);
        assert.equal(pb.setTopics(rule.entry.id, ['t_001']), true);
        assert.deepEqual(pb.get(rule.entry.id)?.topicIds, ['t_001']);
    });
    await test('任务可挂主题，成为该主题的进行中事项', async () => {
        const file = join(TEST_TMP, 'test-task-topic.json');
        // 先清掉上一轮残留，否则 pending 数量会累积
        rmSync(file, { force: true });
        const manager = new LongHorizonTaskManager({ filePath: file, now: () => 1_000_000 });
        await manager.load();
        const task = await manager.create_task('整理 10.27 期文档整理', { topicIds: ['t_photo'] });
        assert.deepEqual(task.topicIds, ['t_photo']);
        const pending = manager.get_pending_tasks();
        assert.equal(pending.length, 1);
        // 改挂主题
        const moved = await manager.set_meta(task.id, { topicIds: ['t_other', 't_other'] });
        assert.deepEqual(moved?.topicIds, ['t_other'], '应去重');
        const cleared = await manager.set_meta(task.id, { topicIds: [] });
        assert.deepEqual(cleared?.topicIds, [], '清空回到未归类');
        await rm(file, { force: true });
    });
    await test('任务重启后保留 topicIds / 排序 / 并行（回归）', async () => {
        const file = join(TEST_TMP, 'test-task-persist.json');
        await rm(file, { force: true });
        const a = new LongHorizonTaskManager({ filePath: file, now: () => 1_000_000 });
        await a.load();
        const task = await a.create_task('重启后应保留归属', { topicIds: ['t_x'], order: 3, parallel: true });
        // 新实例重新从磁盘读
        const b = new LongHorizonTaskManager({ filePath: file, now: () => 1_000_000 });
        await b.load();
        const reloaded = b.all().find((x) => x.id === task.id);
        assert.ok(reloaded !== undefined, '任务应还在');
        assert.deepEqual(reloaded.topicIds, ['t_x'], 'topicIds 不能丢');
        assert.equal(reloaded.order, 3, '排序号不能丢');
        assert.equal(reloaded.parallel, true, '并行标记不能丢');
        await rm(file, { force: true });
    });
    await test('准则带 when 时渲染成「当 X 时」', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        pb.setFlags(a.entry.id, { when: '发布版本时' });
        const text = pb.render();
        assert.ok(text.includes('发布版本时：'), text);
        assert.ok(text.includes('功能发版前'), text);
        // 没有 when 的保持原样
        const b = pb.addManual({ content: '插件保持零外部依赖不引入数据库组件', section: '约定' });
        pb.setFlags(b.entry.id, { when: '' });
        assert.ok(pb.render().includes(':: 插件保持零外部依赖'), '无 when 时不加前缀');
    });
    await test('蒸馏候选可携带 when', () => {
        const parsed = parseDistillResult(JSON.stringify({
            candidates: [{ section: '约定', when: '发布版本时', content: '依次执行五步不可跳步' }],
        }));
        assert.equal(parsed.candidates[0]?.when, '发布版本时');
    });
    await test('来源等级：手写是 human，蒸馏是 auto，确认后升 agent', () => {
        const pb = newPlaybook();
        // 用户手写 → human
        const manual = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        assert.equal(pb.get(manual.entry.id)?.origin, 'human');
        // 蒸馏产出 → auto
        const distilled = pb.submit({ content: '改 JS 一律用 Node 脚本别用 PowerShell', section: '坑' });
        assert.equal(pb.get(distilled.entry.id)?.origin, 'auto');
        // 人工确认 → 升一级到 agent，但绝不跳到 human
        pb.accept(distilled.entry.id);
        assert.equal(pb.get(distilled.entry.id)?.origin, 'agent', 'auto 确认后只能升到 agent');
        // 再确认一次也不会变 human——human 只能用户手写
        assert.equal(pb.get(distilled.entry.id)?.origin, 'agent');
    });
    await test('agent 来源的准则在注入里标注「待核实」', () => {
        const pb = newPlaybook();
        const d = pb.submit({ content: '改 JS 一律用 Node 脚本别用 PowerShell', section: '坑' });
        pb.accept(d.entry.id);
        const text = pb.render();
        assert.ok(text.includes('（AI 记录，待核实）'), text);
        // human 条目不加标注
        const m = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        pb.accept(m.entry.id);
        assert.equal((pb.get(m.entry.id)?.origin), 'human');
    });
    await test('证据链：来源全部失效则 orphaned，恢复后自动回来', () => {
        // 用可控的 alive 集合模拟「源记忆是否活着」
        const alive = new Set(['mem-a', 'mem-b']);
        const pb = new PlaybookStore({
            filePath: pbFile,
            now: () => 1_000_000,
            isSourceAlive: (id) => alive.has(id),
        });
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        pb.setSourceIds(a.entry.id, ['mem-a']);
        // 首次重算：从「无证据状态」变成 intact，也算一次变化
        assert.ok(pb.recheckEvidence().includes(a.entry.id));
        assert.equal(pb.get(a.entry.id)?.evidence?.status, 'intact');
        // 源记忆失效 → orphaned，且不注入
        alive.delete('mem-a');
        const changed = pb.recheckEvidence();
        assert.ok(changed.includes(a.entry.id), '应报告状态变化');
        assert.equal(pb.get(a.entry.id)?.evidence?.status, 'orphaned');
        assert.equal(pb.render().includes('功能发版前'), false, 'orphaned 不注入');
        // 但条目本身还在——不是删除
        assert.ok(pb.get(a.entry.id) !== undefined, '不删除，只是不注入');
        // 源恢复 → 自动回到 intact
        alive.add('mem-a');
        pb.recheckEvidence();
        assert.equal(pb.get(a.entry.id)?.evidence?.status, 'intact');
        assert.ok(pb.render().includes('功能发版前'), '恢复后自动回到注入');
    });
    await test('证据链：部分来源失效标 weakened 并标注', () => {
        const alive = new Set(['mem-a']);
        const pb = new PlaybookStore({
            filePath: pbFile,
            now: () => 1_000_000,
            isSourceAlive: (id) => alive.has(id),
        });
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        pb.setSourceIds(a.entry.id, ['mem-a', 'mem-b']);
        pb.recheckEvidence();
        assert.equal(pb.get(a.entry.id)?.evidence?.status, 'weakened');
        assert.ok(pb.render().includes('（证据已部分失效）'), pb.render());
        // 仍会注入——只是降权提示
        assert.ok(pb.render().includes('功能发版前'));
    });
    await test('分项计数：applied / good / bad / missed 分开记', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        const id = a.entry.id;
        pb.markUsage(id, 'applied');
        pb.markUsage(id, 'appliedGood');
        pb.markUsage(id, 'appliedBad', '用户说结果不对');
        pb.markUsage(id, 'missed');
        pb.markUsage(id, 'userCorrected');
        const u = pb.get(id).usage;
        assert.equal(u.applied, 1);
        assert.equal(u.appliedGood, 1);
        assert.equal(u.appliedBad, 1);
        assert.equal(u.missed, 1);
        assert.equal(u.userCorrected, 1);
        assert.equal(u.lastTrace, '用户说结果不对');
    });
    await test('missed 不影响降级——检索问题不该算到准则头上', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        const id = a.entry.id;
        for (let i = 0; i < 10; i += 1)
            pb.markUsage(id, 'missed');
        assert.equal(pb.get(id)?.status, 'active', 'missed 再多也不该退场');
    });
    await test('好评率过低才降级，且需要 5 个样本', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        const id = a.entry.id;
        // 4 个样本：即使全差也不降级
        for (let i = 0; i < 4; i += 1)
            pb.markUsage(id, 'appliedBad');
        assert.equal(pb.get(id)?.status, 'active', '样本不足不降级');
        // 第 5 个样本，好评率 0 < 0.3 → 退场
        pb.markUsage(id, 'appliedBad');
        assert.equal(pb.get(id)?.status, 'retired', '5 样本且好评率过低应退场');
    });
    await test('effectiveScore：证据充分的好条目分数更高', () => {
        const pb = newPlaybook();
        const good = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        const bad = pb.addManual({ content: '改 JS 一律用 Node 脚本别用 PowerShell', section: '约定' });
        for (let i = 0; i < 5; i += 1)
            pb.markUsage(good.entry.id, 'appliedGood');
        for (let i = 0; i < 5; i += 1)
            pb.markUsage(bad.entry.id, 'appliedBad');
        const g = pb.effectiveScore(pb.get(good.entry.id));
        const b = pb.effectiveScore(pb.get(bad.entry.id));
        assert.ok(g > b, `好条目分应更高：good=${g.toFixed(2)} bad=${b.toFixed(2)}`);
    });
    await test('冲突裁决：证据强度差 1.2 倍以上才取代', () => {
        const pb = newPlaybook();
        // 旧条：用户手写（human = 1.0）
        const old = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        // 新条：蒸馏产出（auto = 0.4），内容否定翻转 → 判冲突
        const neu = pb.submit({ content: '发版前不要跑完整测试就直接打包发布', section: '约定' });
        assert.equal(neu.accepted, true);
        assert.equal(neu.duplicateOf, undefined, '冲突不该被当成重复');
        assert.equal(neu.entry?.conflictWith, old.entry?.id, '应识别出与谁冲突');
        // accept：旧条 1.0 ≥ 0.4×1.2 → 新条被拒
        assert.equal(pb.accept(neu.entry.id), false, '弱证据不能推翻强证据');
        assert.equal(pb.get(old.entry.id)?.status, 'active', '旧条保持生效');
        assert.equal(pb.get(neu.entry.id)?.status, 'retired');
    });
    await test('冲突裁决：势均力敌时两条都生效并挂同一组', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const b = pb.submit({ content: '发版前不要跑完整测试就直接打包发布', section: '约定' });
        // 把新条提升到 human（模拟用户手写），强度相等
        pb.entryRef(b.entry.id).origin = 'human';
        assert.equal(pb.accept(b.entry.id), true);
        const ga = pb.get(a.entry.id)?.conflictGroupId;
        const gb = pb.get(b.entry.id)?.conflictGroupId;
        assert.ok(ga !== undefined && ga === gb, '两条应挂同一冲突组');
        // 注入里要能看见未决标记
        assert.ok(pb.render().includes('未决分歧'), pb.render());
    });
    await test('人工裁决冲突：保留一条，另一条退场', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        const b = pb.submit({ content: '发版前不要跑完整测试就直接打包发布', section: '约定' });
        pb.entryRef(b.entry.id).origin = 'human';
        pb.accept(b.entry.id);
        assert.equal(pb.resolveConflict(a.entry.id, b.entry.id, '测试裁决'), true);
        assert.equal(pb.get(a.entry.id)?.status, 'active');
        assert.equal(pb.get(b.entry.id)?.status, 'retired');
        assert.equal(pb.get(a.entry.id)?.conflictGroupId, undefined, '胜出的那条应清空冲突组');
    });
    await test('墓碑：撤销与被取代分开记', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
        assert.equal(pb.revoke(a.entry.id, '这条规则本身就是错的'), true);
        const entry = pb.get(a.entry.id);
        assert.equal(entry.status, 'retired');
        assert.equal(entry.tombstone?.reason, '这条规则本身就是错的');
        assert.equal(entry.tombstone?.revokedAt !== undefined, true);
    });
    await test('SEU 准入：人类确认标「可复用」，AI 来源标「仅参考」', () => {
        const pb = newPlaybook();
        const human = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        const ai = pb.submit({ content: '改 JS 一律用 Node 脚本别用 PowerShell 拼', section: '坑' });
        pb.accept(ai.entry.id);
        const text = pb.render();
        // 人类确认的不加标记（没标记 = 可放心用）
        assert.ok(!text.includes('[仅参考]功能发版前'), text);
        assert.equal(pb.usageHint(pb.get(human.entry.id)), 'reusable');
        // AI 来源加「仅参考」
        assert.equal(pb.usageHint(pb.get(ai.entry.id)), 'reference');
        assert.ok(text.includes('[仅参考]'), text);
    });
    await test('SEU 准入：实测差评 ≥2 时标「存疑」', () => {
        const pb = newPlaybook();
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        assert.equal(pb.usageHint(pb.get(a.entry.id)), 'reusable');
        pb.markUsage(a.entry.id, 'appliedBad');
        pb.markUsage(a.entry.id, 'appliedBad');
        assert.equal(pb.usageHint(pb.get(a.entry.id)), 'doubtful');
        assert.ok(pb.render().includes('[存疑]'), pb.render());
    });
    await test('SEU 准入：证据部分失效标「存疑」', () => {
        const alive = new Set(['mem-a']);
        const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, isSourceAlive: (id) => alive.has(id) });
        const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
        pb.setSourceIds(a.entry.id, ['mem-a', 'mem-b']);
        pb.recheckEvidence();
        assert.equal(pb.usageHint(pb.get(a.entry.id)), 'doubtful');
    });
    await test('知识缺口：登记、去重、解决', () => {
        const file = join(TEST_TMP, 'gap-test.json');
        rmSync(file, { force: true });
        const store = new GapStore({ filePath: file, now: () => 1_000_000 });
        const a = store.add({ text: '不清楚 DSH 插件的 client 端 slot 有哪些', context: '做界面时卡住' });
        assert.equal(a.duplicate, false);
        assert.equal(a.gap.id, 'gap-1');
        assert.deepEqual(store.stats(), { open: 1, resolved: 0, total: 1 });
        // 同文本不重复记
        const b = store.add({ text: '不清楚 DSH 插件的 client 端 slot 有哪些' });
        assert.equal(b.duplicate, true);
        assert.equal(store.stats().open, 1);
        // 解决后不在待补里
        assert.equal(store.resolve(a.gap.id, 'mem-123'), true);
        assert.equal(store.open().length, 0);
        assert.equal(store.stats().resolved, 1);
        // 重复解决返回 false
        assert.equal(store.resolve(a.gap.id, 'again'), false);
        rmSync(file, { force: true });
    });
    await test('知识缺口：注入清单有序且超预算时截断', () => {
        const file = join(TEST_TMP, 'gap-test2.json');
        rmSync(file, { force: true });
        const store = new GapStore({ filePath: file, now: () => 1_000_000 });
        assert.equal(store.renderSection(), '', '没有缺口时不渲染');
        for (let i = 0; i < 8; i += 1)
            store.add({ text: `第 ${i} 个缺口：某个还没搞懂的技术细节` });
        const text = store.renderSection(120);
        assert.ok(text.startsWith('## 待补的知识缺口'), text);
        assert.ok(text.includes('（另有'), '超预算应有省略提示');
        rmSync(file, { force: true });
    });
    await test('蒸馏提示词包含待补缺口', () => {
        const prompt = buildDistillPrompt({
            entries: [],
            memories: [{ id: 'mem-1', subject: 'a', content: 'b' }],
            gaps: [{ id: 'gap-1', text: '不清楚插件 slot 有哪些' }],
        });
        assert.ok(prompt.includes('待补的知识缺口'), prompt);
        assert.ok(prompt.includes('不清楚插件 slot 有哪些'), prompt);
        // 没有缺口时不该出现该段
        const plain = buildDistillPrompt({ entries: [], memories: [{ id: 'mem-1', subject: 'a', content: 'b' }] });
        assert.equal(plain.includes('待补的知识缺口'), false);
    });
    await test('LCS 相似度：改写对高分，无关对低分', () => {
        // 改写（字序相同、换了个别字）——二元组余弦很低，LCS 应该很高
        const paraphrase = lcsSimilarity('发版前要跑完整测试', '发布版本之前必须先跑测试');
        assert.ok(paraphrase > 0.5, `改写对应 > 0.5，实得 ${paraphrase.toFixed(3)}`);
        // 无关
        const unrelated = lcsSimilarity('文档整理一格一照', 'npm 发布必须用官方源');
        assert.ok(unrelated < 0.2, `无关对应 < 0.2，实得 ${unrelated.toFixed(3)}`);
        // 改否定词的冲突对：高相似
        const conflict = lcsSimilarity('发版流程不可跳步', '发版流程可以跳步');
        assert.ok(conflict > 0.7, `冲突对应 > 0.7，实得 ${conflict.toFixed(3)}`);
    });
    await test('textSimilarity 取余弦与 LCS 的较大者', () => {
        const a = '插件保持零外部依赖';
        const b = '不要引入外部数据库依赖';
        const cos = cosine(tokenize(a), tokenize(b));
        const lcs = lcsSimilarity(a, b);
        const combined = textSimilarity(a, b);
        assert.equal(combined, Math.max(cos, lcs));
        assert.ok(combined >= cos);
        assert.ok(combined >= lcs);
    });
    await test('冲突检测：改写过的矛盾准则也能检出', () => {
        const pb = newPlaybook();
        // 旧条：无否定词
        const old = pb.addManual({ content: '插件保持零外部依赖只用纯 JSON 文件', section: '约定' });
        // 新条：改写 + 加了否定
        const neu = pb.submit({ content: '不要引入外部数据库依赖，只用 JSON 存数据', section: '约定' });
        assert.equal(neu.entry?.conflictWith, old.entry?.id, '改写过的矛盾对应该被检出');
    });
    await test('冲突检测：否定作用域不同不算矛盾（NegEx 思路）', () => {
        const pb = newPlaybook();
        // 旧条否定的是「跳步」，新条否定的是「检查」——否定的不是同一件事
        pb.addManual({ content: '发版前必须跑完整测试，不可省略步骤', section: '约定' });
        const free = pb.submit({ content: '发版前必须跑完整测试，不要加没必要的检查', section: '约定' });
        assert.equal(free.entry?.conflictWith, undefined, '否定不同的事不该判矛盾');
    });
    await test('冲突检测：一方否定、另一方肯定同一件事才算矛盾', () => {
        const pb = newPlaybook();
        // 旧条肯定「跑完整测试」，新条否定「跑完整测试」→ 真矛盾
        const old = pb.addManual({ content: '发版前必须跑完整测试再打包', section: '约定' });
        const neu = pb.submit({ content: '发版前不要跑完整测试就直接打包', section: '约定' });
        assert.equal(neu.entry?.conflictWith, old.entry?.id);
    });
    await test('冲突检测：两条都含「不」但否定的不是同一件事也能检出', () => {
        const pb = newPlaybook();
        // 旧条：肯定「依次执行」，另有一个无关否定「不可跳步」
        const old = pb.addManual({
            content: '功能发版前依次执行：卸载验证→兼容性检查→一键安装验证，不可跳步。',
            section: '约定',
        });
        // 新条：否定「依次执行」
        const neu = pb.submit({ content: '功能发版前不必依次执行卸载验证和兼容性检查，可以直接发布', section: '约定' });
        assert.equal(neu.entry?.conflictWith, old.entry?.id, '否定作用域比对应该检出这种矛盾');
    });
    await test('BM25：IDF 压低常见词，稀有词权重更高', () => {
        const common = tokenize('这是常见的词 处理 处理 处理');
        const rare = tokenize('这是罕见的词 registry 只有这里出现');
        const stats = buildBm25Stats([common, rare, tokenize('这是常见的词 处理 处理')]);
        // 「处理」在多数文档出现（df 高）→ IDF 低；「registry」只在一篇出现 → IDF 高
        const qCommon = tokenize('处理');
        const qRare = tokenize('registry');
        const idfCommon = Math.log(1 + (stats.N - (stats.df.get('处理') ?? 0) + 0.5) / ((stats.df.get('处理') ?? 0) + 0.5));
        const idfRare = Math.log(1 + (stats.N - (stats.df.get('registry') ?? 0) + 0.5) / ((stats.df.get('registry') ?? 0) + 0.5));
        assert.ok(idfRare > idfCommon, `稀有词 IDF 应更高：${idfRare.toFixed(2)} vs ${idfCommon.toFixed(2)}`);
        assert.ok(bm25Score(qRare, rare, stats) > 0);
        assert.equal(bm25Score(qCommon, rare, stats), 0, '不存在的词得 0 分');
    });
    await test('BM25：长文档不会因为词多而占便宜（长度归一化）', () => {
        const base = tokenize('发布流程要按顺序执行');
        const long = tokenize('发布流程要按顺序执行，另外还有很多其他无关的内容填充在这里面，让这篇文档变得很长很长，词也很多很多');
        const stats = buildBm25Stats([base, long]);
        const q = tokenize('发布流程');
        const sShort = bm25Score(q, base, stats);
        const sLong = bm25Score(q, long, stats);
        assert.ok(sShort > sLong, `同样命中，短文档应得分更高：${sShort.toFixed(2)} vs ${sLong.toFixed(2)}`);
    });
    await test('BM25 召回：真实语料上「发版流程」能正确命中', () => {
        const store = new TemporalMemoryStore({});
        store.ingest({ subject: '发布流程', content: '发布流程要先跑完整测试再发版', source: 'user', tags: [] });
        store.ingest({ subject: '发版频率', content: '发版频率每天最多一次', source: 'user', tags: [] });
        store.ingest({ subject: '文档整理', content: '文档整理一格一照', source: 'user', tags: [] });
        const hits = store.recall('发版流程要做什么', { limit: 1 });
        assert.equal(hits[0]?.fact.subject, '发布流程', `应命中发布流程，实得 ${hits[0]?.fact.subject}`);
        rmSync(join(TEST_TMP, 'bm25-test.json'), { force: true });
    });
    await test('否定识别：伪否定词不算否定（非常/未来/别人/特别）', () => {
        const pb = newPlaybook();
        const base = pb.addManual({ content: '发版前要跑完整测试再打包发布', section: '约定' });
        // 「非常」里的"非"不是否定词，不该改变极性
        const r = pb.submit({ content: '非常重要的是发版前要跑完整测试', section: '约定' });
        assert.equal(r.entry?.conflictWith, undefined, '含「非常」的句子不该判成否定而触发冲突');
        assert.ok(pb.get(base.entry.id) !== undefined);
    });
    await test('否定识别：双重否定是加强肯定（不得不/无不）', () => {
        const pb = newPlaybook();
        pb.addManual({ content: '发版前要跑完整测试再打包发布', section: '约定' });
        // 「不得不」= 必须，语义是肯定，不该与"要跑测试"构成矛盾
        const r = pb.submit({ content: '不得不发版前跑完整测试再打包', section: '约定' });
        assert.equal(r.entry?.conflictWith, undefined, '「不得不」是加强肯定，不是否定');
    });
    await test('否定识别：条件标记不算否定（除非/除了/否则）', () => {
        const pb = newPlaybook();
        pb.addManual({ content: '发版前要跑完整测试再打包发布', section: '约定' });
        const r = pb.submit({ content: '除非有特殊情况否则要跑测试再打包', section: '约定' });
        assert.equal(r.entry?.conflictWith, undefined, '「除非」是条件标记，不是否定');
    });
    await test('否定识别：真否定仍要检出冲突', () => {
        const pb = newPlaybook();
        const old = pb.addManual({ content: '发版前必须跑完整测试再打包', section: '约定' });
        const neu = pb.submit({ content: '发版前不要跑完整测试就直接打包', section: '约定' });
        assert.equal(neu.entry?.conflictWith, old.entry?.id, '「不要」是真否定，应检出冲突');
        // 「不可」对「可以」也要检出
        const pb2 = newPlaybook();
        const a = pb2.addManual({ content: '发版流程不可跳步骤必须完整执行', section: '约定' });
        const b = pb2.submit({ content: '发版流程可以跳步骤直接快速执行', section: '约定' });
        assert.equal(b.entry?.conflictWith, a.entry?.id, '「不可」对「可以」应检出冲突');
    });
    await test('排序分值：冷启动给中性分，样本多了才拉开', () => {
        const pb = newPlaybook();
        const cold = pb.addManual({ content: '这是一条全新的准则还没有任何使用记录', section: '约定' });
        const warm = pb.addManual({ content: '另一条准则用于对比数值变化的情况', section: '约定' });
        // 冷启动应给中性分（5 附近），而不是 0——
        // 否则新条目永远排最后，活跃条目满员时反而先淘汰刚加入的
        assert.ok(pb.effectiveScore(pb.get(cold.entry.id)) > 4, '冷启动不该是 0 分');
        for (let i = 0; i < 5; i += 1)
            pb.markUsage(warm.entry.id, 'appliedGood');
        assert.ok(pb.effectiveScore(pb.get(warm.entry.id)) > pb.effectiveScore(pb.get(cold.entry.id)), '好评多了应超过冷启动');
        // 老计数必须 clamp，否则 20 次 helpful 就压过 base 上限
        const legacy = pb.addManual({ content: '第三条准则用来测试老计数是否有上限', section: '约定' });
        for (let i = 0; i < 20; i += 1)
            pb.mark(legacy.entry.id, 'helpful');
        assert.ok(pb.effectiveScore(pb.get(legacy.entry.id)) < 15, '老计数应被 clamp 住，不能无界增长');
    });
    await test('反馈识别：纠正 / 确认 / 中性', () => {
        assert.equal(classifyFeedback('不对，发版流程少了一步'), 'correction');
        assert.equal(classifyFeedback('错了！'), 'correction');
        assert.equal(classifyFeedback('重新来一遍'), 'correction');
        // 用户最常给的就是这两个字，没有标点
        assert.equal(classifyFeedback('不对'), 'correction');
        assert.equal(classifyFeedback('对，就是这样'), 'confirmation');
        assert.equal(classifyFeedback('没错'), 'confirmation');
        assert.equal(classifyFeedback('继续'), 'confirmation');
        // 「好的 / 继续做 X」是同意下一步动作，不是确认「准则用对了」——
        // v1 把它们算确认，会直接抬高 appliedGood 把证据链洗白。
        assert.equal(classifyFeedback('好的，继续'), 'neutral', '「好的」不该算确认');
        assert.equal(classifyFeedback('继续做文档整理'), 'neutral', '下指令不该算确认');
        assert.equal(classifyFeedback('今天我们做文档整理'), 'neutral');
        assert.equal(classifyFeedback(''), 'neutral');
    });
    await test('用户消息取文本：只拼 text 块、坏输入不抛错', () => {
        assert.equal(extractUserText({
            role: 'user',
            content: [
                { type: 'text', text: '你好' },
                { type: 'image', attachment: { attachmentId: 'a' } },
                { type: 'text', text: '再见' },
            ],
        }), '你好\n再见');
        assert.equal(extractUserText({ role: 'user', content: '纯字符串' }), '纯字符串');
        assert.equal(extractUserText(null), '');
        assert.equal(extractUserText(undefined), '');
        assert.equal(extractUserText({ role: 'user' }), '');
    });
    await test('注入快照：记录、回写、幂等', () => {
        const file = resolve('.dsh-inj-test.jsonl');
        rmSync(file, { force: true });
        const log = new InjectionLog({ filePath: file, now: () => 1000 });
        log.record('s1', 1, ['ctxt-00001', 'ctxt-00002'], 300);
        log.record('s1', 2, ['ctxt-00003'], 200);
        assert.equal(log.statistics().pending, 2);
        // 回写第 1 轮
        const ids = log.markVerdict('s1', 1, 'correction');
        assert.deepEqual(ids, ['ctxt-00001', 'ctxt-00002']);
        assert.equal(log.statistics().corrected, 1);
        // 重复回写幂等
        assert.deepEqual(log.markVerdict('s1', 1, 'correction'), []);
        // 中性不回写，且同样幂等（否则同一轮会被反复追加中性行）
        assert.deepEqual(log.markVerdict('s1', 2, 'neutral'), []);
        assert.deepEqual(log.markVerdict('s1', 2, 'neutral'), []);
        rmSync(file, { force: true });
    });
    await test('注入快照：v1 旧行被忽略、只认 v2', () => {
        const file = resolve('.dsh-inj-legacy.jsonl');
        rmSync(file, { force: true });
        // v1（无 v 字段）是「面板轮询 + 真实轮次」混在一起的，无法区分，只能不认
        writeFileSync(file, [
            JSON.stringify({ at: 1, sessionId: 'old', turn: 1, ruleIds: ['ctxt-00001'], chars: 100, verdict: 'pending' }),
            JSON.stringify({ at: 2, sessionId: 'old', turn: 2, ruleIds: ['ctxt-00001'], chars: 100, verdict: 'pending' }),
            JSON.stringify({ v: 2, at: 3, sessionId: 's1', turn: 1, ruleIds: ['ctxt-00002'], chars: 90, verdict: 'pending' }),
        ].join('\n') + '\n', 'utf8');
        const log = new InjectionLog({ filePath: file });
        const stats = log.statistics();
        assert.equal(stats.total, 1, '只应读到 v2 那一行');
        assert.equal(stats.legacyRows, 2, '旧行数要能报出来，方便解释面板数字变小');
        assert.equal(log.latest()?.sessionId, 's1');
        rmSync(file, { force: true });
    });
    await test('轮次跟踪：用下一轮的用户反应给上一轮打分', () => {
        const file = resolve('.dsh-turn-test.jsonl');
        rmSync(file, { force: true });
        const log = new InjectionLog({ filePath: file, now: () => 1000 });
        let budget = { ruleIds: ['ctxt-00001'], chars: 400 };
        const scored = [];
        const tracker = new TurnFeedbackTracker(log, {
            injection: () => budget,
            onFeedback: (kind, ids, reaction) => scored.push({ kind, ids: [...ids], reaction }),
        });
        // 第 1 轮：没有上一轮可判，只落自己的行
        tracker.beginTurn('s1', 1);
        tracker.appendUserText('s1', '帮我整理文档整理');
        tracker.endTurn('s1');
        assert.equal(scored.length, 0, '第 1 轮没有上一轮可判');
        assert.equal(log.statistics().total, 1, '第 1 轮自身应落一行');
        // 第 2 轮：用户说「不对」→ 打第 1 轮注入的准则
        budget = { ruleIds: ['ctxt-00001', 'ctxt-00003'], chars: 420 };
        tracker.beginTurn('s1', 2);
        // 一条用户消息可能被拆成多个事件
        tracker.appendUserText('s1', '不对，');
        tracker.appendUserText('s1', '这个流程错了');
        tracker.endTurn('s1');
        assert.equal(scored.length, 1);
        assert.equal(scored[0]?.kind, 'correction');
        assert.deepEqual(scored[0]?.ids, ['ctxt-00001'], '应打第 1 轮注入的准则，不是当前轮');
        assert.equal(scored[0]?.reaction, '不对，这个流程错了');
        // 第 3 轮：中性 → 落行但不回写
        tracker.beginTurn('s1', 3);
        tracker.appendUserText('s1', '再帮我看看另一个文件夹');
        tracker.endTurn('s1');
        assert.equal(scored.length, 1, '中性不该回写');
        const stats = log.statistics();
        assert.equal(stats.total, 3, '三轮各一行');
        assert.equal(stats.corrected, 1);
        assert.equal(stats.pending, 1, '只有最后一轮还等着打');
        // 重复结束同一轮不能重复落行
        tracker.endTurn('s1');
        assert.equal(log.statistics().total, 3, '同一轮重复 end 不该多写');
        // 确认信号打第 3 轮
        tracker.beginTurn('s1', 4);
        tracker.appendUserText('s1', '没错，就是这样');
        tracker.endTurn('s1');
        assert.equal(scored.length, 2);
        assert.equal(scored[1]?.kind, 'confirmation');
        assert.deepEqual(scored[1]?.ids, ['ctxt-00001', 'ctxt-00003']);
        rmSync(file, { force: true });
    });
    await test('人格块：文件不存在就不注入，不占 token', () => {
        const store = new PersonaStore({
            filePath: join(TEST_TMP, 'no-such-persona.json'),
            proposalPath: join(TEST_TMP, 'no-such-proposals.json'),
        });
        assert.equal(store.present, false);
        assert.equal(store.render(), '');
        assert.equal(store.document, undefined);
        assert.equal(store.propose({ label: 'persona', value: '我是 X', by: 'agent' }).rejected !== undefined, true);
    });
    await test('人格块：traits 与 slots 只做审计，不进注入段', () => {
        const file = join(TEST_TMP, 'persona-render.json');
        const propFile = join(TEST_TMP, 'persona-render-props.json');
        rmSync(file, { force: true });
        rmSync(propFile, { force: true });
        writeFileSync(file, JSON.stringify({
            schema: 'cognition.persona',
            version: 1,
            revision: 3,
            updatedAt: 1,
            budget: { persona: 200, human: 200, total: 400 },
            blocks: {
                persona: {
                    label: 'persona',
                    limit: 200,
                    value: '我是小认，直接务实的协作助手。\n边界：不编造事实。',
                    traits: { directness: 0.8, warmth: 0.5 },
                    lockedPhrases: ['不编造事实'],
                    history: [],
                },
                human: {
                    label: 'human',
                    limit: 200,
                    value: '做文档整理，中文为主。',
                    slots: { preferences: { verbosity: '简短' } },
                    history: [],
                },
            },
        }), 'utf8');
        const store = new PersonaStore({ filePath: file, proposalPath: propFile, now: () => 5000 });
        assert.equal(store.present, true);
        const rendered = store.render();
        assert.ok(rendered.startsWith('## 人格'), '人格段必须在最前');
        assert.ok(rendered.includes('<persona'));
        assert.ok(rendered.includes('<human'));
        assert.ok(rendered.includes('不编造事实'), '边界要注入');
        // 关键：trait 值绝不能进上下文，否则模型会照着表演
        assert.equal(rendered.includes('directness'), false, 'traits 不能注入');
        assert.equal(rendered.includes('0.8'), false, 'traits 数值不能注入');
        assert.equal(rendered.includes('verbosity'), false, 'slots 不能注入');
        rmSync(file, { force: true });
        rmSync(propFile, { force: true });
    });
    await test('人格块：agent 不能改 human 块，lockedPhrases 不许删', () => {
        const file = join(TEST_TMP, 'persona-guard.json');
        const propFile = join(TEST_TMP, 'persona-guard-props.json');
        rmSync(file, { force: true });
        rmSync(propFile, { force: true });
        writeFileSync(file, JSON.stringify({
            schema: 'cognition.persona',
            version: 1,
            revision: 1,
            updatedAt: 1,
            budget: { persona: 200, human: 200, total: 400 },
            blocks: {
                persona: { label: 'persona', limit: 200, value: '我是小认。边界：不编造事实。', lockedPhrases: ['不编造事实'], history: [] },
                human: { label: 'human', limit: 200, value: '中文为主。', history: [] },
            },
        }), 'utf8');
        const store = new PersonaStore({ filePath: file, proposalPath: propFile, now: () => 6000 });
        store.loadSync();
        // 硬规则 3：agent 不许改用户画像
        const blocked = store.propose({ label: 'human', value: '用户喜欢吹捧', by: 'agent' });
        assert.ok(blocked.rejected !== undefined, 'agent 改 human 必须被拒');
        assert.equal(store.pending().length, 0);
        // 硬规则 2：把锁定的边界删掉 → 确认时拒绝
        const bad = store.propose({ label: 'persona', value: '我是小认，很聪明。', by: 'user' });
        assert.ok(bad.proposal !== undefined);
        const rejected = store.confirm(bad.proposal.id, 'user');
        assert.equal(rejected.ok, false);
        assert.ok((rejected.reason ?? '').includes('不编造事实'), '拒绝理由要指出被删的边界');
        assert.equal(store.document?.revision, 1, '拒绝后 revision 不能变');
        // 正常提案 → 用户确认 → 生效
        const good = store.propose({ label: 'persona', value: '我是小认，直接务实。边界：不编造事实。', by: 'agent' });
        assert.ok(good.proposal !== undefined);
        assert.equal(store.pending().length, 1, '未确认前只是提案');
        assert.equal(store.document?.blocks.persona.value.includes('直接务实'), false, '未确认不能生效');
        const ok = store.confirm(good.proposal.id, 'user');
        assert.equal(ok.ok, true);
        assert.equal(ok.revision, 2);
        assert.ok(store.document.blocks.persona.value.includes('直接务实'));
        assert.equal(store.pending().length, 0);
        assert.equal(store.document.blocks.persona.history.length, 1, '要留下改动历史');
        // 重新加载：revision 与内容都要落盘
        const reloaded = new PersonaStore({ filePath: file, proposalPath: propFile });
        assert.equal(reloaded.document?.revision, 2);
        assert.ok(reloaded.document.blocks.persona.value.includes('直接务实'));
        rmSync(file, { force: true });
        rmSync(propFile, { force: true });
    });
    await test('人格块：超预算截断，不挤爆上下文', () => {
        const file = join(TEST_TMP, 'persona-budget.json');
        const propFile = join(TEST_TMP, 'persona-budget-props.json');
        rmSync(file, { force: true });
        writeFileSync(file, JSON.stringify({
            schema: 'cognition.persona',
            version: 1,
            revision: 1,
            updatedAt: 1,
            budget: { persona: 120, human: 120, total: 240 },
            blocks: {
                persona: { label: 'persona', limit: 120, value: '甲'.repeat(400), history: [] },
                human: { label: 'human', limit: 120, value: '乙'.repeat(400), history: [] },
            },
        }), 'utf8');
        const store = new PersonaStore({ filePath: file, proposalPath: propFile });
        const rendered = store.render();
        // 头 + 两个块；每块被截到 limit 附近
        assert.ok(rendered.length < 120 + 120 + 120, `渲染总长应受控，实际 ${rendered.length}`);
        const usage = store.usage();
        assert.equal(usage.persona.limit, 120);
        assert.ok(usage.rendered > 0);
        rmSync(file, { force: true });
        rmSync(propFile, { force: true });
    });
    await test('事件日志：追加、seq 连续、重新加载续接', () => {
        const file = resolve('.dsh-events-test.jsonl');
        rmSync(file, { force: true });
        const log = new PlaybookEventLog({ filePath: file, now: () => 2000 });
        const a = log.append({ type: 'RuleProposed', ruleId: 'ctxt-00001', content: '测试准则内容要够长', by: 'distiller' });
        const b = log.append({ type: 'RuleAccepted', ruleId: 'ctxt-00001', by: 'user' });
        assert.equal(a.seq, 1);
        assert.equal(b.seq, 2);
        assert.equal(log.stats().total, 2);
        // 重新加载：seq 续接
        const log2 = new PlaybookEventLog({ filePath: file });
        assert.equal(log2.stats().total, 2);
        assert.equal(log2.append({ type: 'RuleRetired', ruleId: 'ctxt-00001', reason: '测试', by: 'user' }).seq, 3);
        // 按准则查
        assert.equal(log2.forRule('ctxt-00001').length, 3);
        rmSync(file, { force: true });
    });
    /* ---------------------------------------------------------------- */
    console.log('');
    if (failures.length === 0) {
        console.log(`All tests passed! (${passed} passed)`);
        return;
    }
    console.log(`Failed: ${failures.length} / ${passed + failures.length}`);
    for (const failure of failures) {
        console.log(`\n--- ${failure.name} ---`);
        console.log(failure.error);
    }
    process.exitCode = 1;
}
await main();
// 测试产物全部在系统临时目录，跑完即删，不在仓库留垃圾
rmSync(TEST_TMP, { recursive: true, force: true });
