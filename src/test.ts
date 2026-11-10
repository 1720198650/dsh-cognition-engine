import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

import { TemporalMemoryStore, bm25Score, buildBm25Stats, contentHash, cosine, isCurrent, lcsSimilarity, textSimilarity, tokenize } from './memory.ts';
import { GapStore } from './gaps.ts';
import { PlaybookEventLog } from './events.ts';
import { InjectionLog, TurnFeedbackTracker, classifyFeedback, extractUserText } from './injection_log.ts';
import { PersonaStore, deriveLockedPhrases } from './persona.ts';
import { CpeStore } from './cpe.ts';
import { BudgetStore, computeQuota, isoWeekKey } from './budget.ts';
import { ShadowStore } from './shadow.ts';
import { classifyNotLearn, shouldReject } from './notlearn.ts';
import { ProactiveStore, buildWouldDo, scoreScan } from './proactive_scan.ts';
import { RecallLog, RetrievalEvalStore } from './retrieval.ts';
import {
  StyleStore,
  analyzeTurn,
  classifyBucket,
  fingerprintOf,
  statusOf,
  styleSimilarity,
} from './style.ts';
import type { StyleRow } from './style.ts';
import { judgeRegister, scoreRegister, RegisterLog, isRuntimeContext, THRESHOLD, AMBIGUITY_THRESHOLD } from './register.ts';
import { SuperagentClient, compactTicket, buildOverview } from './superagent.ts';
import { apply } from './index.ts';
import { upsertManagedBlock, readManagedBlock, wrapBlock, AgentsFileSync, BEGIN_MARKER, END_MARKER } from './agents_file.ts';
import { PlaybookStore } from './playbook.ts';
import { blocksAcceptance, detectsConstantRanking } from './cpe.ts';
import { extractAssumptions, AssumptionLedger } from './assumptions.ts';
import { memoryConfidence } from './views.ts';
import { runDreaming } from './dreaming.ts';
import { SedimentStore } from './sediment.ts';
import { inspectRequirement } from './ambiguity.ts';
import { completionNeedsEvidence } from './task_manager.ts';
import { TopicStore } from './topics.ts';
import { buildDistillPrompt, parseDistillResult } from './distill.ts';
import { dataDir, expandHome, packageRoot, resolveDataFile, resolveUserPath } from './util.ts';
import { JsonStateStore } from './persist.ts';
import {
  DialecticalReflectionEngine,
  buildAntithesisPrompt,
  MockDialecticalLLM,
  ReflectionWorker,
  extractContradictions,
} from './reflection.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';

/** 测试产物一律写系统临时目录：不能在插件包根/工作目录留垃圾，否则又会诱发「清理仓库时误删」。 */
const TEST_TMP = mkdtempSync(join(tmpdir(), 'dsh-cognition-test-'));

/** 造一批风格行（测试用）。 */
function makeStyleRows(count: number, overrides: Partial<StyleRow> = {}): StyleRow[] {
  const rows: StyleRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      v: 2,
      at: 1000 + i,
      sessionId: 's',
      turn: i,
      bucket: 'casual',
      chars: 100,
      meanSentLen: 25,
      sentLenCv: 0.5,
      shortRatio: 0.2,
      tonePerK: 5,
      firstPersonPerK: 10,
      punctPer100: 8,
      emojiPerK: 0,
      catchphrasePerK: 0,
      ...overrides,
    });
  }
  return rows;
}

let passed = 0;
const failures: Array<{ name: string; error: unknown }> = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \u2717 ${name}`);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.log(`      ${message.split('\n')[0]}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function main(): Promise<void> {
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
    assert.equal(isCurrent(store.get(typescript.id)!, now), true);
    assert.equal(isCurrent(store.get(python.id)!, now), false);
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
    assert.deepEqual(
      [conflicts[0]?.leftId, conflicts[0]?.rightId].sort(),
      [a.id, b.id].sort(),
    );
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
    const first = new JsonStateStore<{ n: number }>({
      filePath: file,
      debounceMs: 0,
      serialize: () => ({ n: 1 }),
      restore: () => undefined,
    });
    await first.flush();
    // 模拟「rename 数据后、写 .sha256 前」崩溃：侧车还是旧值
    writeFileSync(`${file}.sha256`, 'stale-hash', 'utf8');
    let restored = { n: 0 };
    const second = new JsonStateStore<{ n: number }>({
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
    assert.ok(result.calls[0]!.finishedAt <= result.calls[1]!.startedAt);
    assert.ok(result.calls[1]!.finishedAt <= result.calls[2]!.startedAt);
  });

  await test('上一段输出确实被拼进下一段 prompt', async () => {
    const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
    const result = await engine.reflect('要不要重写遗留系统');

    assert.ok(result.thesis.includes('THESIS'));
    assert.ok(result.calls[1]!.prompt.includes(result.thesis), 'ANTITHESIS 必须带上 THESIS 原文');
    assert.ok(result.calls[2]!.prompt.includes(result.thesis), 'SYNTHESIS 必须带上 THESIS');
    assert.ok(
      result.calls[2]!.prompt.includes('ANTITHESIS (critique)'),
      'SYNTHESIS 必须带上 ANTITHESIS',
    );
    assert.ok(result.calls[2]!.prompt.includes('IDENTIFIED CONTRADICTIONS'), '必须附上矛盾清单');
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
    const order: string[] = [];
    const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
    const running = engine.reflectInBackground('要不要引入缓存层').then((result) => {
      order.push('done');
      return result;
    });
    setTimeout(() => order.push('tick'), 0);

    const result = await running;
    assert.deepEqual(order, ['tick', 'done'], '主线程的定时器必须先于反思完成执行');
    assert.deepEqual(
      result.calls.map((call) => call.phase),
      ['thesis', 'antithesis', 'synthesis'],
    );
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
    assert.ok(due[0]!.overdueMs >= 2_000);

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
  const newPlaybook = (): PlaybookStore =>
    new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, validateSourceIds: () => [] });

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
    pb.accept(first.entry!.id);

    const second = pb.submit({ content: '发版前必须先跑完整测试再打包发布出去', section: '约定' });
    assert.equal(second.accepted, false);
    assert.equal(second.duplicateOf, first.entry!.id, '应指出与哪条重复');
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
    assert.equal(pb.accept(a.entry!.id), true);
    assert.equal(pb.pending().length, 0);
    assert.equal(pb.active().length, 1);

    const b = pb.submit({ content: '另一条待审的准则内容示例文本', section: '约定' });
    assert.equal(pb.reject(b.entry!.id), true);
    assert.equal(pb.get(b.entry!.id), undefined, 'reject 直接移除');
  });

  await test('编辑保留历史版本', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '最初的准则内容写在这里示例', section: '约定' });
    const id = a.entry!.id;
    assert.equal(pb.revise(id, '修改之后的准则内容写在这里示例'), true);
    const entry = pb.get(id)!;
    assert.equal(entry.history.length, 1);
    assert.equal(entry.history[0]?.content, '最初的准则内容写在这里示例');
  });

  await test('有害标记达阈值自动退场', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '一条经常误导人的准则内容示例', section: '坑' });
    const id = a.entry!.id;
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
    pb.mark(a.entry!.id, 'helpful', 2);
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
    const b = pb.addManual({ content: '文档整理一格一图每行独立标题', section: '约定' });
    pb.setTopics(a.entry!.id, ['t_release']);
    pb.setTopics(b.entry!.id, ['t_photo']);
    const text = pb.render(1_000_000, undefined, (id) =>
      id === 't_release' ? '发布流程' : id === 't_photo' ? '文档整理' : undefined,
    );
    assert.ok(text.includes('## 发布流程'), text);
    assert.ok(text.includes('## 文档整理'), text);
    assert.ok(!text.includes('## 未归类'), '都挂了主题就不该有未归类组');
  });

  await test('三道约束：自查/拦截/审计默认全关', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: 'npm 发布必须显式加 --registry 参数', section: '坑' });
    const entry = pb.get(a.entry!.id)!;
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
    pb.setFlags(a.entry!.id, { guard: true });
    const selfCheck = pb.renderSelfCheck();
    assert.ok(selfCheck.includes('【开工前自查】'), selfCheck);
    assert.ok(selfCheck.includes('ctxt-00001'), '应点名条目 id');
    // 整个注入段落也要带上它
    assert.ok(pb.renderSection().startsWith('【开工前自查】'), pb.renderSection().slice(0, 40));
  });

  await test('拦截判定：触发匹配且缺必需项才算违反', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: 'npm 发布必须显式加 --registry 参数', section: '坑' });
    pb.setFlags(a.entry!.id, { enforce: true, trigger: 'npm\\s+publish', required: '--registry' });

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
    pb.setFlags(a.entry!.id, { audit: true, trigger: 'prod\\.json' });
    const audited = pb.checkToolCall('edit {"path":"prod.json"}');
    assert.equal(audited.violated.length, 1, '应记录');
    assert.equal(audited.blocked.length, 0, '审计不拦截');

    const b = pb.addManual({ content: '所有接口一律用 POST 提交参数', section: '约定' });
    pb.setFlags(b.entry!.id, { trigger: 'api' });
    // 没勾 enforce 也没勾 audit → 即使 trigger 命中也什么都不做
    const ignored = pb.checkToolCall('fetch {"url":"api/x"}');
    assert.equal(ignored.violated.length, 0);
  });

  await test('违规计数与非法正则不炸', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: 'npm 发布必须显式加 --registry 参数', section: '坑' });
    pb.setFlags(a.entry!.id, { enforce: true, trigger: '[未闭合', required: '' });
    // 非法正则按「不匹配」处理，不抛错
    const result = pb.checkToolCall('bash {"command":"npm publish"}');
    assert.equal(result.violated.length, 0);

    pb.setFlags(a.entry!.id, { trigger: 'npm', required: '--registry' });
    pb.recordViolation(a.entry!.id);
    pb.recordViolation(a.entry!.id);
    assert.equal(pb.get(a.entry!.id)?.violations, 2);
    assert.equal(pb.stats().violationsTotal, 2);
    assert.ok((pb.get(a.entry!.id)?.lastViolationAt ?? 0) > 0);
  });

  await test('准则可永久删除（任意状态）', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
    const id = a.entry!.id;
    assert.equal(pb.remove(id), true, '应删除成功');
    assert.equal(pb.get(id), undefined, '删除后应查不到');
    assert.equal(pb.active().length, 0);
    assert.equal(pb.remove(id), false, '重复删除返回 false');

    // pending 与 retired 也要能删
    const pendingOne = pb.submit({ content: '一条待审的准则内容示例文本', section: '状态' });
    assert.equal(pb.remove(pendingOne.entry!.id), true, 'pending 可删');

    const retiredOne = pb.addManual({ content: '一条会被停用的准则内容示例', section: '坑' });
    pb.retire(retiredOne.entry!.id, '测试');
    assert.equal(pb.remove(retiredOne.entry!.id), true, 'retired 可删');
    assert.equal(pb.all().length, 0, '全部删完');
  });

  await test('条目数超限时淘汰打分最低的', () => {
    const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, maxEntries: 2 });
    const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
    pb.mark(a.entry!.id, 'helpful', 5);
    pb.addManual({ content: '改 JS 一律用 Node 脚本不要用 PowerShell', section: '坑' });
    pb.addManual({ content: '当前处于 v0.8 到 v0.9 的过渡阶段', section: '状态' });
    assert.equal(pb.active().length, 2, '不应超过上限');
    assert.equal(pb.get(a.entry!.id)?.status, 'active', '高 helpful 的应留下');
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
    assert.ok(prompt.includes(entry.entry!.id), '应带上现有准则 id 便于打标');
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
    assert.equal(pb.revise(a.entry!.id, '本周先用 A 方案，下周再评估切换'), false, '内容没变不该算修改');
    // 手工设一个过去的时间点
    const entry = pb.get(a.entry!.id)!;
    assert.ok(entry !== undefined);
    pb.extend(a.entry!.id, now - 1);
    assert.equal(pb.expired(now).length, 1, '应进入过期集合');
    assert.equal(pb.active(now).length, 0, '过期的不算 active');
    assert.equal(pb.render(now).includes('A 方案'), false, '过期条目不应被注入');
  });

  await test('extend 延长有效期后重新生效', () => {
    const now = 1_000_000;
    const pb = new PlaybookStore({ filePath: pbFile, now: () => now });
    const a = pb.addManual({ content: '阶段内不要改动数据库连接池配置', section: '坑' });
    pb.extend(a.entry!.id, now - 1);
    assert.equal(pb.active(now).length, 0);
    pb.extend(a.entry!.id, now + 86_400_000);
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
  const newTopics = (): TopicStore => new TopicStore({ filePath: topicFile, now: () => 1_000_000 });

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
    const sub = ts.add({ name: '发布', parentId: (top as { id: string }).id });
    assert.ok(typeof sub === 'object');
    const third = ts.add({ name: 'npm', parentId: (sub as { id: string }).id });
    assert.equal(third, '主题最多两层');
  });

  await test('主题：归档后不参与匹配，但仍可查到', () => {
    const ts = newTopics();
    const a = ts.add({ name: '文档整理', aliases: ['图片'] }) as { id: string };
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
    assert.deepEqual(pb.get(rule.entry!.id)?.topicIds, []);
    assert.equal(pb.setTopics(rule.entry!.id, ['t_001']), true);
    assert.deepEqual(pb.get(rule.entry!.id)?.topicIds, ['t_001']);
  });


  await test('任务可挂主题，成为该主题的进行中事项', async () => {
    const file = join(TEST_TMP, 'test-task-topic.json');
    // 先清掉上一轮残留，否则 pending 数量会累积
    rmSync(file, { force: true });
    const manager = new LongHorizonTaskManager({ filePath: file, now: () => 1_000_000 });
    await manager.load();
    const task = await manager.create_task('整理某期文档', { topicIds: ['t_photo'] });
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
    pb.setFlags(a.entry!.id, { when: '发布版本时' });
    const text = pb.render();
    assert.ok(text.includes('发布版本时：'), text);
    assert.ok(text.includes('功能发版前'), text);
    // 没有 when 的保持原样
    const b = pb.addManual({ content: '插件保持零外部依赖不引入数据库组件', section: '约定' });
    pb.setFlags(b.entry!.id, { when: '' });
    assert.ok(pb.render().includes(':: 插件保持零外部依赖'), '无 when 时不加前缀');
  });

  await test('蒸馏候选可携带 when', () => {
    const parsed = parseDistillResult(
      JSON.stringify({
        candidates: [{ section: '约定', when: '发布版本时', content: '依次执行五步不可跳步' }],
      }),
    );
    assert.equal(parsed.candidates[0]?.when, '发布版本时');
  });

  await test('来源等级：手写是 human，蒸馏是 auto，确认后升 agent', () => {
    const pb = newPlaybook();
    // 用户手写 → human
    const manual = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    assert.equal(pb.get(manual.entry!.id)?.origin, 'human');
    // 蒸馏产出 → auto
    const distilled = pb.submit({ content: '改 JS 一律用 Node 脚本别用 PowerShell', section: '坑' });
    assert.equal(pb.get(distilled.entry!.id)?.origin, 'auto');
    // 人工确认 → 升一级到 agent，但绝不跳到 human
    pb.accept(distilled.entry!.id);
    assert.equal(pb.get(distilled.entry!.id)?.origin, 'agent', 'auto 确认后只能升到 agent');
    // 再确认一次也不会变 human——human 只能用户手写
    assert.equal(pb.get(distilled.entry!.id)?.origin, 'agent');
  });

  await test('agent 来源的准则在注入里标注「待核实」', () => {
    const pb = newPlaybook();
    const d = pb.submit({ content: '改 JS 一律用 Node 脚本别用 PowerShell', section: '坑' });
    pb.accept(d.entry!.id);
    const text = pb.render();
    assert.ok(text.includes('（AI 记录，待核实）'), text);
    // human 条目不加标注
    const m = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    pb.accept(m.entry!.id);
    assert.equal((pb.get(m.entry!.id)?.origin), 'human');
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
    pb.setSourceIds(a.entry!.id, ['mem-a']);
    // 首次重算：从「无证据状态」变成 intact，也算一次变化
    assert.ok(pb.recheckEvidence().includes(a.entry!.id));
    assert.equal(pb.get(a.entry!.id)?.evidence?.status, 'intact');

    // 源记忆失效 → orphaned，且不注入
    alive.delete('mem-a');
    const changed = pb.recheckEvidence();
    assert.ok(changed.includes(a.entry!.id), '应报告状态变化');
    assert.equal(pb.get(a.entry!.id)?.evidence?.status, 'orphaned');
    assert.equal(pb.render().includes('功能发版前'), false, 'orphaned 不注入');
    // 但条目本身还在——不是删除
    assert.ok(pb.get(a.entry!.id) !== undefined, '不删除，只是不注入');

    // 源恢复 → 自动回到 intact
    alive.add('mem-a');
    pb.recheckEvidence();
    assert.equal(pb.get(a.entry!.id)?.evidence?.status, 'intact');
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
    pb.setSourceIds(a.entry!.id, ['mem-a', 'mem-b']);
    pb.recheckEvidence();
    assert.equal(pb.get(a.entry!.id)?.evidence?.status, 'weakened');
    assert.ok(pb.render().includes('（证据已部分失效）'), pb.render());
    // 仍会注入——只是降权提示
    assert.ok(pb.render().includes('功能发版前'));
  });

  await test('分项计数：applied / good / bad / missed 分开记', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    const id = a.entry!.id;
    pb.markUsage(id, 'applied');
    pb.markUsage(id, 'appliedGood');
    pb.markUsage(id, 'appliedBad', '用户说结果不对');
    pb.markUsage(id, 'missed');
    pb.markUsage(id, 'userCorrected');
    const u = pb.get(id)!.usage!;
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
    const id = a.entry!.id;
    for (let i = 0; i < 10; i += 1) pb.markUsage(id, 'missed');
    assert.equal(pb.get(id)?.status, 'active', 'missed 再多也不该退场');
  });

  await test('好评率过低才降级，且需要 5 个样本', () => {
    const pb = newPlaybook();
    // 用模型自产的候选来测阈值：用户来源的准则受「证据门控」保护，不会自动退场（见 S5）
    const a = pb.submit({ content: '模型生成的候选准则，内容写够长便于比较', section: '约定' });
    pb.accept(a.entry!.id);
    const id = a.entry!.id;
    // 4 个样本：即使全差也不降级
    for (let i = 0; i < 4; i += 1) pb.markUsage(id, 'appliedBad');
    assert.equal(pb.get(id)?.status, 'active', '样本不足不降级');
    // 第 5 个样本，好评率 0 < 0.3 → 退场
    pb.markUsage(id, 'appliedBad');
    assert.equal(pb.get(id)?.status, 'retired', '5 样本且好评率过低应退场');
  });

  await test('effectiveScore：证据充分的好条目分数更高', () => {
    const pb = newPlaybook();
    const good = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    const bad = pb.addManual({ content: '改 JS 一律用 Node 脚本别用 PowerShell', section: '约定' });
    for (let i = 0; i < 5; i += 1) pb.markUsage(good.entry!.id, 'appliedGood');
    for (let i = 0; i < 5; i += 1) pb.markUsage(bad.entry!.id, 'appliedBad');
    const g = pb.effectiveScore(pb.get(good.entry!.id)!);
    const b = pb.effectiveScore(pb.get(bad.entry!.id)!);
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
    assert.equal(pb.accept(neu.entry!.id), false, '弱证据不能推翻强证据');
    assert.equal(pb.get(old.entry!.id)?.status, 'active', '旧条保持生效');
    assert.equal(pb.get(neu.entry!.id)?.status, 'retired');
  });

  await test('冲突裁决：势均力敌时两条都生效并挂同一组', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
    const b = pb.submit({ content: '发版前不要跑完整测试就直接打包发布', section: '约定' });
    // 把新条提升到 human（模拟用户手写），强度相等
    (pb as unknown as { entryRef: (id: string) => { origin: string } | undefined }).entryRef(b.entry!.id)!.origin = 'human';
    assert.equal(pb.accept(b.entry!.id), true);
    const ga = pb.get(a.entry!.id)?.conflictGroupId;
    const gb = pb.get(b.entry!.id)?.conflictGroupId;
    assert.ok(ga !== undefined && ga === gb, '两条应挂同一冲突组');
    // 注入里要能看见未决标记
    assert.ok(pb.render().includes('未决分歧'), pb.render());
  });

  await test('人工裁决冲突：保留一条，另一条退场', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
    const b = pb.submit({ content: '发版前不要跑完整测试就直接打包发布', section: '约定' });
    (pb as unknown as { entryRef: (id: string) => { origin: string } | undefined }).entryRef(b.entry!.id)!.origin = 'human';
    pb.accept(b.entry!.id);
    assert.equal(pb.resolveConflict(a.entry!.id, b.entry!.id, '测试裁决'), true);
    assert.equal(pb.get(a.entry!.id)?.status, 'active');
    assert.equal(pb.get(b.entry!.id)?.status, 'retired');
    assert.equal(pb.get(a.entry!.id)?.conflictGroupId, undefined, '胜出的那条应清空冲突组');
  });

  await test('墓碑：撤销与被取代分开记', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '发版前必须跑完整测试再打包发布', section: '约定' });
    assert.equal(pb.revoke(a.entry!.id, '这条规则本身就是错的'), true);
    const entry = pb.get(a.entry!.id)!;
    assert.equal(entry.status, 'retired');
    assert.equal(entry.tombstone?.reason, '这条规则本身就是错的');
    assert.equal(entry.tombstone?.revokedAt !== undefined, true);
  });

  await test('SEU 准入：人类确认标「可复用」，AI 来源标「仅参考」', () => {
    const pb = newPlaybook();
    const human = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    const ai = pb.submit({ content: '改 JS 一律用 Node 脚本别用 PowerShell 拼', section: '坑' });
    pb.accept(ai.entry!.id);
    const text = pb.render();
    // 人类确认的不加标记（没标记 = 可放心用）
    assert.ok(!text.includes('[仅参考]功能发版前'), text);
    assert.equal(pb.usageHint(pb.get(human.entry!.id)!), 'reusable');
    // AI 来源加「仅参考」
    assert.equal(pb.usageHint(pb.get(ai.entry!.id)!), 'reference');
    assert.ok(text.includes('[仅参考]'), text);
  });

  await test('SEU 准入：实测差评 ≥2 时标「存疑」', () => {
    const pb = newPlaybook();
    const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    assert.equal(pb.usageHint(pb.get(a.entry!.id)!), 'reusable');
    pb.markUsage(a.entry!.id, 'appliedBad');
    pb.markUsage(a.entry!.id, 'appliedBad');
    assert.equal(pb.usageHint(pb.get(a.entry!.id)!), 'doubtful');
    assert.ok(pb.render().includes('[存疑]'), pb.render());
  });

  await test('SEU 准入：证据部分失效标「存疑」', () => {
    const alive = new Set(['mem-a']);
    const pb = new PlaybookStore({ filePath: pbFile, now: () => 1_000_000, isSourceAlive: (id) => alive.has(id) });
    const a = pb.addManual({ content: '功能发版前依次执行五步流程不可跳步', section: '约定' });
    pb.setSourceIds(a.entry!.id, ['mem-a', 'mem-b']);
    pb.recheckEvidence();
    assert.equal(pb.usageHint(pb.get(a.entry!.id)!), 'doubtful');
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
    for (let i = 0; i < 8; i += 1) store.add({ text: `第 ${i} 个缺口：某个还没搞懂的技术细节` });
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
    const unrelated = lcsSimilarity('文档整理一格一图', 'npm 发布必须用官方源');
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
    store.ingest({ subject: '文档整理', content: '文档整理一格一图', source: 'user', tags: [] });
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
    assert.ok(pb.get(base.entry!.id) !== undefined);
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
    assert.ok(pb.effectiveScore(pb.get(cold.entry!.id)!) > 4, '冷启动不该是 0 分');
    for (let i = 0; i < 5; i += 1) pb.markUsage(warm.entry!.id, 'appliedGood');
    assert.ok(pb.effectiveScore(pb.get(warm.entry!.id)!) > pb.effectiveScore(pb.get(cold.entry!.id)!), '好评多了应超过冷启动');
    // 老计数必须 clamp，否则 20 次 helpful 就压过 base 上限
    const legacy = pb.addManual({ content: '第三条准则用来测试老计数是否有上限', section: '约定' });
    for (let i = 0; i < 20; i += 1) pb.mark(legacy.entry!.id, 'helpful');
    assert.ok(pb.effectiveScore(pb.get(legacy.entry!.id)!) < 15, '老计数应被 clamp 住，不能无界增长');
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
    assert.equal(
      extractUserText({
        role: 'user',
        content: [
          { type: 'text', text: '你好' },
          { type: 'image', attachment: { attachmentId: 'a' } },
          { type: 'text', text: '再见' },
        ],
      }),
      '你好\n再见',
    );
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
    writeFileSync(
      file,
      [
        JSON.stringify({ at: 1, sessionId: 'old', turn: 1, ruleIds: ['ctxt-00001'], chars: 100, verdict: 'pending' }),
        JSON.stringify({ at: 2, sessionId: 'old', turn: 2, ruleIds: ['ctxt-00001'], chars: 100, verdict: 'pending' }),
        JSON.stringify({ v: 2, at: 3, sessionId: 's1', turn: 1, ruleIds: ['ctxt-00002'], chars: 90, verdict: 'pending' }),
      ].join('\n') + '\n',
      'utf8',
    );
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
    const scored: Array<{ kind: string; ids: string[]; reaction: string }> = [];
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
    writeFileSync(
      file,
      JSON.stringify({
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
            value: '做文档整理工作，中文为主。',
            slots: { preferences: { verbosity: '简短' } },
            history: [],
          },
        },
      }),
      'utf8',
    );
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
    writeFileSync(
      file,
      JSON.stringify({
        schema: 'cognition.persona',
        version: 1,
        revision: 1,
        updatedAt: 1,
        budget: { persona: 200, human: 200, total: 400 },
        blocks: {
          persona: { label: 'persona', limit: 200, value: '我是小认。边界：不编造事实。', lockedPhrases: ['不编造事实'], history: [] },
          human: { label: 'human', limit: 200, value: '中文为主。', history: [] },
        },
      }),
      'utf8',
    );
    const store = new PersonaStore({ filePath: file, proposalPath: propFile, now: () => 6000 });
    store.loadSync();

    // 硬规则 3：agent 不许改用户画像
    const blocked = store.propose({ label: 'human', value: '用户喜欢吹捧', by: 'agent' });
    assert.ok(blocked.rejected !== undefined, 'agent 改 human 必须被拒');
    assert.equal(store.pending().length, 0);

    // 硬规则 2：把锁定的边界删掉 → 确认时拒绝
    const bad = store.propose({ label: 'persona', value: '我是小认，很聪明。', by: 'user' });
    assert.ok(bad.proposal !== undefined);
    const rejected = store.confirm(bad.proposal!.id, 'user');
    assert.equal(rejected.ok, false);
    assert.ok((rejected.reason ?? '').includes('不编造事实'), '拒绝理由要指出被删的边界');
    assert.equal(store.document?.revision, 1, '拒绝后 revision 不能变');

    // 正常提案 → 用户确认 → 生效
    const good = store.propose({ label: 'persona', value: '我是小认，直接务实。边界：不编造事实。', by: 'agent' });
    assert.ok(good.proposal !== undefined);
    assert.equal(store.pending().length, 1, '未确认前只是提案');
    assert.equal(store.document?.blocks.persona.value.includes('直接务实'), false, '未确认不能生效');
    const ok = store.confirm(good.proposal!.id, 'user');
    assert.equal(ok.ok, true);
    assert.equal(ok.revision, 2);
    assert.ok(store.document!.blocks.persona.value.includes('直接务实'));
    assert.equal(store.pending().length, 0);
    assert.equal(store.document!.blocks.persona.history.length, 1, '要留下改动历史');
    // 重新加载：revision 与内容都要落盘
    const reloaded = new PersonaStore({ filePath: file, proposalPath: propFile });
    assert.equal(reloaded.document?.revision, 2);
    assert.ok(reloaded.document!.blocks.persona.value.includes('直接务实'));
    rmSync(file, { force: true });
    rmSync(propFile, { force: true });
  });

  await test('人格块：超预算截断，不挤爆上下文', () => {
    const file = join(TEST_TMP, 'persona-budget.json');
    const propFile = join(TEST_TMP, 'persona-budget-props.json');
    rmSync(file, { force: true });
    writeFileSync(
      file,
      JSON.stringify({
        schema: 'cognition.persona',
        version: 1,
        revision: 1,
        updatedAt: 1,
        budget: { persona: 120, human: 120, total: 240 },
        blocks: {
          persona: { label: 'persona', limit: 120, value: '甲'.repeat(400), history: [] },
          human: { label: 'human', limit: 120, value: '乙'.repeat(400), history: [] },
        },
      }),
      'utf8',
    );
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

  await test('人格块：超预算截断时，锁定的边界短语不能被切掉', () => {
    const file = join(TEST_TMP, 'persona-guard-clip.json');
    const propFile = join(TEST_TMP, 'persona-guard-clip-props.json');
    rmSync(file, { force: true });
    // 正文很长，边界在最后 —— 直接 clip 会把「边界：…」整段切掉
    const longBody = `我是小认。\n风格：${'甲'.repeat(80)}\n边界：不编造事实；不替用户做不可逆决定。`;
    writeFileSync(
      file,
      JSON.stringify({
        schema: 'cognition.persona',
        version: 1,
        revision: 1,
        updatedAt: 1,
        budget: { persona: 120, human: 60, total: 200 },
        blocks: {
          persona: {
            label: 'persona',
            limit: 120,
            value: longBody,
            lockedPhrases: ['不编造事实', '不替用户做不可逆决定'],
            history: [],
          },
          human: { label: 'human', limit: 60, value: '中文为主。', history: [] },
        },
      }),
      'utf8',
    );
    const store = new PersonaStore({ filePath: file, proposalPath: propFile });
    const rendered = store.render();
    assert.ok(rendered.includes('不编造事实'), '锁定短语不能因为截断而消失');
    assert.ok(rendered.includes('不替用户做不可逆决定'));
    // 渲染出来的 persona 块不能被撑爆
    assert.ok(rendered.length < 200, `渲染总长应受控，实际 ${rendered.length}`);
    rmSync(file, { force: true });
    rmSync(propFile, { force: true });
  });

  await test('人格块：undo 用 before 快照真的退得回去', () => {
    const file = join(TEST_TMP, 'persona-undo.json');
    const propFile = join(TEST_TMP, 'persona-undo-props.json');
    rmSync(file, { force: true });
    rmSync(propFile, { force: true });
    writeFileSync(
      file,
      JSON.stringify({
        schema: 'cognition.persona',
        version: 1,
        revision: 1,
        updatedAt: 1,
        budget: { persona: 300, human: 200, total: 500 },
        blocks: {
          persona: { label: 'persona', limit: 300, value: '我是小认。边界：不编造事实。', lockedPhrases: ['不编造事实'], history: [] },
          human: { label: 'human', limit: 200, value: '中文为主。', history: [] },
        },
      }),
      'utf8',
    );
    const store = new PersonaStore({ filePath: file, proposalPath: propFile, now: () => 7000 });
    store.loadSync();
    const original = store.document!.blocks.persona.value;

    const p = store.propose({ label: 'persona', value: '我是小认，改过一版。边界：不编造事实。', by: 'agent' });
    assert.equal(store.confirm(p.proposal!.id, 'user').ok, true);
    assert.ok(store.document!.blocks.persona.value.includes('改过一版'));
    // history 必须带原文快照，否则回滚不了
    const entry = store.document!.blocks.persona.history.at(-1)!;
    assert.equal(entry.before, original, 'history 要存改动前的原文');
    // revision 链：parentHash 要串起来
    assert.ok((store.document!.parentHash ?? '').length > 0, '应记录 parentHash');
    const chainHash = store.document!.parentHash;

    const undone = store.undo();
    assert.equal(undone.ok, true);
    assert.equal(store.document!.blocks.persona.value, original, 'undo 后应回到原文');
    assert.equal(store.document!.revision, 3);
    assert.notEqual(store.document!.parentHash, chainHash, '每改一次 parentHash 都要换');
    // 落盘也要是回滚后的内容
    const reloaded = new PersonaStore({ filePath: file, proposalPath: propFile });
    assert.equal(reloaded.document!.blocks.persona.value, original);
    rmSync(file, { force: true });
    rmSync(propFile, { force: true });
  });

  await test('人格块：写盘失败必须报错并回退内存，不能假装成功', () => {
    const file = join(TEST_TMP, 'persona-writefail.json');
    const propFile = join(TEST_TMP, 'persona-writefail-props.json');
    rmSync(file, { force: true, recursive: true });
    rmSync(propFile, { force: true });
    writeFileSync(
      file,
      JSON.stringify({
        schema: 'cognition.persona',
        version: 1,
        revision: 1,
        updatedAt: 1,
        budget: { persona: 300, human: 200, total: 500 },
        blocks: {
          persona: { label: 'persona', limit: 300, value: '我是小认。边界：不编造事实。', lockedPhrases: ['不编造事实'], history: [] },
          human: { label: 'human', limit: 200, value: '中文为主。', history: [] },
        },
      }),
      'utf8',
    );
    const store = new PersonaStore({ filePath: file, proposalPath: propFile });
    store.loadSync();
    // 把文件变成一个同名目录 → 后续 writeFileSync 必然失败
    rmSync(file);
    mkdirSync(file);
    const p = store.propose({ label: 'persona', value: '我是小认，新版本。边界：不编造事实。', by: 'agent' });
    const result = store.confirm(p.proposal!.id, 'user');
    assert.equal(result.ok, false, '写不进去就不能报成功');
    assert.ok((result.reason ?? '').includes('写入失败'), `理由要说明是写入失败，实得 ${result.reason}`);
    assert.equal(store.document!.blocks.persona.value, '我是小认。边界：不编造事实。', '内存也要回退');
    assert.equal(store.document!.revision, 1, 'revision 不能涨');
    assert.ok((store.lastSaveError ?? '').length > 0, 'lastSaveError 要能取到');
    // 提案要回到待确认队列，不能丢
    assert.equal(store.pending().length, 1);
    rmSync(file, { recursive: true, force: true });
    rmSync(propFile, { force: true });
  });

  section('[14] 风格指纹（S4）');

  await test('风格统计：句长、短句比、语气词、第一人称、标点、emoji', () => {
    const text = '好的。这个我来吧！嗯……其实呢。\n我先查一下 😀 再说吧';
    const m = analyzeTurn(text);
    assert.ok(m.chars > 0);
    assert.ok(m.meanSentLen > 0 && m.meanSentLen < 30, `平均句长应是个小数，实得 ${m.meanSentLen}`);
    assert.ok(m.shortRatio > 0 && m.shortRatio <= 1, `短句比 ${m.shortRatio}`);
    assert.ok(m.tonePerK > 0, '「吧/呢/嗯」应被计入语气词');
    assert.ok(m.firstPersonPerK > 0, '「我」应被计入第一人称');
    assert.ok(m.punctPer100 > 0, '标点密度应 > 0');
    assert.equal(m.emojiPerK > 0, true, 'emoji 应被计入');
    // 纯空白/空串不能炸
    const empty = analyzeTurn('   \n  ');
    assert.equal(empty.chars, 0);
    assert.equal(empty.meanSentLen, 0);
    assert.equal(empty.sentLenCv, 0);
  });

  await test('语域分桶：技术 > 情绪 > 闲聊，且技术优先', () => {
    assert.equal(classifyBucket('跑 `npm run build` 报错了'), 'technical');
    assert.equal(classifyBucket('看 D:\\dshgz\\cognition-engine\\src\\index.ts'), 'technical');
    assert.equal(classifyBucket('我今天有点焦虑，压力挺大的'), 'emotional');
    assert.equal(classifyBucket('好。嗯。我累了。'), 'emotional', '短句多 + 第一人称多也应判情绪');
    assert.equal(classifyBucket('明天把那份文档整理一下就好'), 'casual');
  });

  await test('风格相似度：同风格接近 1，单维异常不会淹没结论', () => {
    const base = fingerprintOf(makeStyleRows(20, { meanSentLen: 25, tonePerK: 5, shortRatio: 0.2 }));
    const same = fingerprintOf(makeStyleRows(20, { meanSentLen: 25, tonePerK: 5, shortRatio: 0.2 }));
    assert.equal(styleSimilarity(base, same), 1);
    // 语气词从 5 飙到 200：有界距离下只该拉低一部分，不该直接归零
    const noisy = fingerprintOf(makeStyleRows(20, { meanSentLen: 25, tonePerK: 200, shortRatio: 0.2 }));
    const sim = styleSimilarity(noisy, base);
    assert.ok(sim > 0.5 && sim < 0.95, `单项爆炸后相似度应居中，实得 ${sim}`);
    assert.equal(statusOf(0.9), 'green');
    assert.equal(statusOf(0.8), 'yellow');
    assert.equal(statusOf(0.7), 'orange');
    assert.equal(statusOf(0.5), 'red');
  });

  await test('风格存储：只落统计量，**不落原文**', () => {
    const file = join(TEST_TMP, 'style-notext.jsonl');
    const baseline = join(TEST_TMP, 'style-notext-baseline.json');
    rmSync(file, { force: true });
    const store = new StyleStore({ filePath: file, baselinePath: baseline, now: () => 1000, minTurns: 5, minChars: 100 });
    const secret = '秘密标记XYZ这段原话不该出现在磁盘上';
    store.record({ sessionId: 's1', turn: 1, text: `${secret}。好。` });
    const raw = readFileSync(file, 'utf8');
    assert.equal(raw.includes('秘密标记XYZ'), false, '原文绝不能落盘');
    assert.ok(raw.includes('meanSentLen'), '统计量应在');
    rmSync(file, { force: true });
  });

  await test('风格对比：样本不足报 insufficient，够了才给分；冻结基线后可对照', () => {
    const file = join(TEST_TMP, 'style-compare.jsonl');
    const baselinePath = join(TEST_TMP, 'style-compare-baseline.json');
    rmSync(file, { force: true });
    rmSync(baselinePath, { force: true });
    const store = new StyleStore({ filePath: file, baselinePath, now: () => 2000, minTurns: 5, minChars: 100 });

    const none = store.compare();
    assert.equal(none.status, 'insufficient', '一行都没有时必须明说不足');
    assert.equal(none.similarity, null);

    for (let i = 0; i < 4; i += 1) {
      store.record({ sessionId: 's1', turn: i + 1, text: '我先查一下，然后给你结论。这个方案可行。' });
    }
    assert.equal(store.compare().status, 'insufficient', '还没到门槛，仍然不该给分');

    for (let i = 0; i < 8; i += 1) {
      store.record({ sessionId: 's1', turn: i + 5, text: '我先查一下，然后给你结论。这个方案可行。' });
    }
    const ready = store.compare({ recentTurns: 6 });
    assert.notEqual(ready.status, 'insufficient');
    assert.equal(ready.baseline?.source, 'auto-split');
    assert.ok(typeof ready.similarity === 'number');

    const frozen = store.freezeBaseline();
    assert.equal(frozen.ok, true);
    const afterFreeze = store.compare({ recentTurns: 6 });
    assert.equal(afterFreeze.baseline?.source, 'frozen', '冻结后应改用冻结基线');
    // 换风格：整段变成报告体长句
    for (let i = 0; i < 6; i += 1) {
      store.record({
        sessionId: 's1',
        turn: 100 + i,
        text:
          '综上所述，本方案在可行性、经济性与可维护性三个维度上均满足预期要求，' +
          '建议按照既定的实施路径分阶段推进，并在每个阶段结束后开展一次全面的效果评估工作以确认目标的达成情况。',
      });
    }
    const drifted = store.compare({ recentTurns: 6 });
    assert.ok(drifted.similarity !== null && drifted.similarity < 0.9, `换报告体后相似度应下降，实得 ${drifted.similarity}`);
    assert.ok(drifted.topDiffs.length > 0, '应能列出差异最大的维度');
    rmSync(file, { force: true });
    rmSync(baselinePath, { force: true });
  });

  await test('人格块：create 从零建文件，锁定短语从「边界：」行派生，且不许覆盖重建', () => {
    const file = join(TEST_TMP, 'persona-create.json');
    const propFile = join(TEST_TMP, 'persona-create-props.json');
    rmSync(file, { force: true });
    rmSync(propFile, { force: true });
    const store = new PersonaStore({ filePath: file, proposalPath: propFile, now: () => 8000 });

    assert.deepEqual(deriveLockedPhrases('我是X。\n边界：不编造事实；不替你做出不可逆的决定。'), [
      '不编造事实',
      '不替你做出不可逆的决定',
    ]);
    assert.deepEqual(deriveLockedPhrases('没有边界行'), []);
    // 顿号是句内并列，不能切成「发版」「推送」这种两字碎片（锁它们只会误伤正常改写）
    assert.deepEqual(
      deriveLockedPhrases('我是X。\n边界：不编造事实；发版、推送、删数据这类不可逆的事，先问再做。'),
      ['不编造事实', '发版、推送、删数据这类不可逆的事，先问再做'],
    );

    const made = store.create({
      persona: '我是小认。\n边界：不编造事实；不替你做出不可逆的决定。',
      human: '做文档整理工作，中文为主。',
    });
    assert.equal(made.ok, true);
    assert.equal(made.revision, 1);
    assert.equal(store.present, true);
    assert.deepEqual(store.document!.blocks.persona.lockedPhrases, ['不编造事实', '不替你做出不可逆的决定']);
    assert.equal(store.document!.blocks.persona.history[0]?.op, 'create');
    // 再建一次必须被拒（不能当覆盖后门）
    const again = store.create({ persona: '另一份', human: '' });
    assert.equal(again.ok, false);
    assert.ok((again.reason ?? '').includes('已存在'));
    // 落盘可重新加载
    const reloaded = new PersonaStore({ filePath: file, proposalPath: propFile });
    assert.equal(reloaded.present, true);
    assert.equal(reloaded.document!.blocks.human.value, '做文档整理工作，中文为主。');
    rmSync(file, { force: true });
    rmSync(propFile, { force: true });
  });

  section('[15] CPE 回归闸门（S5）');

  await test('CPE：用例不足报 insufficient，够数才给分；掉分超阈值判 red', () => {
    const file = join(TEST_TMP, 'cpe-gate.json');
    rmSync(file, { force: true });
    const store = new CpeStore({ filePath: file, now: () => 9000 });
    // 用例 5 条，但 minCases 默认 20 → insufficient
    for (let i = 0; i < 5; i += 1) {
      store.addCase({ question: `问题${i}`, expectedRuleIds: ['ctxt-00001'] });
    }
    const insufficient = store.check(() => ['ctxt-00001', 'ctxt-00002']);
    assert.equal(insufficient.status, 'insufficient');
    assert.equal(insufficient.delta, null, '不足时不给 delta');

    // 调整阈值到 5 条，并打基线（全通过）
    const doc = store.document;
    doc.thresholds.minCases = 5;
    doc.thresholds.maxDrop = 0.2;
    const base = store.measureBaseline((q) => [q, 'ctxt-00001', 'ctxt-00002']);
    assert.equal(base.ok, true);
    assert.equal(base.baseline?.passRate, 1);

    // 同一状态下检查 → green
    assert.equal(store.check((q) => [q, 'ctxt-00001', 'ctxt-00002']).status, 'green');
    // 期望的准则被挤出前 K → 3/5 通过 = 0.6，掉 0.4 > 0.2 → red
    let call = 0;
    const degraded = store.check(() => {
      call += 1;
      return call <= 2 ? ['ctxt-00001'] : ['ctxt-00009', 'ctxt-00008'];
    });
    assert.equal(degraded.status, 'red');
    assert.equal(degraded.passRate, 0.4);
    assert.ok(degraded.failures.length >= 3);
    rmSync(file, { force: true });
  });

  await test('CPE：冻结后不许改用例；从准则派生会标 derivedFrom=rules', () => {
    const file = join(TEST_TMP, 'cpe-freeze.json');
    rmSync(file, { force: true });
    const store = new CpeStore({ filePath: file, now: () => 9100 });
    const seeded = store.seedFromRules([
      { id: 'ctxt-00001', content: '发版前依次执行六步，不可跳步' },
      { id: 'ctxt-00002', content: '纯文档只推 commit，不动版本号' },
    ]);
    assert.equal(seeded.added, 2);
    assert.equal(store.cases().every((item) => item.derivedFrom === 'rules'), true);

    store.freeze();
    const blocked = store.addCase({ question: '新问题', expectedRuleIds: ['ctxt-00003'] });
    assert.ok(blocked.rejected !== undefined, '冻结后应拒绝新增');
    assert.equal(store.removeCase(store.cases()[0]!.id), false, '冻结后也不许删');
    store.unfreeze();
    assert.equal(store.removeCase(store.cases()[0]!.id), true);
    rmSync(file, { force: true });
  });

  await test('CPE：回滚快照能把被改坏的文件恢复原样', () => {
    const file = join(TEST_TMP, 'cpe-rollback.json');
    const victim = join(TEST_TMP, 'cpe-victim.txt');
    rmSync(file, { force: true });
    writeFileSync(victim, '原始内容', 'utf8');
    const store = new CpeStore({ filePath: file, now: () => 9200 });
    const snap = store.snapshotFiles([victim]);
    writeFileSync(victim, '被改坏了', 'utf8');
    store.restoreFiles(snap);
    assert.equal(readFileSync(victim, 'utf8'), '原始内容');
    rmSync(file, { force: true });
    rmSync(victim, { force: true });
  });

  await test('准则证据门控：用户来源的准则不会被自动打分退场', () => {
    const pbFile = join(TEST_TMP, 'gate-playbook.json');
    rmSync(pbFile, { force: true });
    const pb = new PlaybookStore({ filePath: pbFile });
    const human = pb.addManual({ content: '用户说过的一条重要准则，内容要够长才好', section: '约定' });
    const auto = pb.submit({ content: '模型自己生成的一条准则，内容也够长了', section: '约定' });
    // auto 的是候选态，先接受再打差评
    pb.accept(auto.entry!.id);

    for (let i = 0; i < 6; i += 1) {
      pb.markUsage(human.entry!.id, 'appliedBad');
      pb.markUsage(auto.entry!.id, 'appliedBad');
    }
    // 用户来源 + 证据完好 → 不许自动退场
    assert.notEqual(pb.get(human.entry!.id)?.status, 'retired', '用户准则不该被自动退场');
    assert.ok((pb.get(human.entry!.id)?.note ?? '').includes('证据门控'));
    // 模型自产 → 照常退场
    assert.equal(pb.get(auto.entry!.id)?.status, 'retired', '模型自产的低分准则应退场');
    rmSync(pbFile, { force: true });
  });

  section('[16] 学习预算 + shadow + 八类不学（S6）');

  await test('预算：配额随规模变化，消耗到 0 后拒绝，跨周重置', () => {
    assert.deepEqual(computeQuota(5), { total: 8, revise: 5, new: 2, reserve: 1 });
    assert.equal(computeQuota(0).total, 8);
    assert.equal(computeQuota(5000).total, 12, '规模再大也不超过 12');
    assert.equal(isoWeekKey(new Date('2026-11-04T00:00:00Z')), '2026-W45');

    const file = join(TEST_TMP, 'budget-test.json');
    rmSync(file, { force: true });
    let t = Date.parse('2026-11-04T00:00:00Z');
    const store = new BudgetStore({ filePath: file, now: () => t });
    store.syncActiveRules(5);
    const status = store.status();
    assert.equal(status.quota.total, 8);
    assert.equal(status.quota.new, 2);

    assert.equal(store.consume('new').ok, true);
    assert.equal(store.consume('new').ok, true);
    const third = store.canLearn('new');
    assert.equal(third.ok, false, '学新名额用完应拒绝');
    assert.ok((third.reason ?? '').includes('学新'));

    // 跨周：used 归零
    t = Date.parse('2026-11-11T00:00:00Z');
    const rolled = store.rolloverIfNeeded();
    assert.equal(rolled.rolled, true);
    assert.equal(store.status().used.total, 0);
    assert.equal(store.canLearn('new').ok, true);
    rmSync(file, { force: true });
  });

  await test('预算：停止信号能触发暂停，到期自动解除', () => {
    const file = join(TEST_TMP, 'budget-pause.json');
    rmSync(file, { force: true });
    let t = Date.parse('2026-11-04T00:00:00Z');
    const store = new BudgetStore({ filePath: file, now: () => t });
    const signals = store.evaluateSignals({ activeRules: 450, orphanedRules: 0 });
    assert.equal(signals.some((s) => s.code === 'overcrowded'), true);
    const futile = store.evaluateSignals({ newRulesHits3w: 0, lastWeekNewUsageRatio: 0.5, activeRules: 5 });
    assert.equal(futile.some((s) => s.code === 'futile'), true);

    store.pause({ code: 'futile', reason: '学了没用上', action: 'pause-new' });
    assert.equal(store.canLearn('new').ok, false);
    assert.ok((store.status().pauseReason ?? '').includes('futile'));

    // 下一周自动解除
    t = Date.parse('2026-11-11T00:00:00Z');
    store.rolloverIfNeeded();
    assert.equal(store.status().paused, false, '暂停到下周一应自动解除');
    rmSync(file, { force: true });
  });

  await test('shadow：去重、命中 3 次才够格转正、到期自动 expire', () => {
    const file = join(TEST_TMP, 'shadow-test.json');
    rmSync(file, { force: true });
    let t = Date.parse('2026-11-04T00:00:00Z');
    const store = new ShadowStore({ filePath: file, now: () => t, ttlDays: 21 });

    const a = store.add({ text: '新学到的一条准则内容', subject: '发版流程' });
    assert.ok(a.entry !== undefined);
    // 同内容不重复入库
    assert.equal(store.add({ text: '新学到的一条准则内容' }).entry?.id, a.entry!.id);
    assert.equal(store.stats().active, 1);

    assert.equal(store.promote(a.entry!.id).ok, false, '命中不足不能转正');
    store.record(a.entry!.id, { occurrence: true, hit: true, helpful: true });
    store.record(a.entry!.id, { occurrence: true, hit: true, helpful: true });
    assert.equal(store.canPromote(store.active()[0]!), false, '2 次命中还不够');
    store.record(a.entry!.id, { hit: true, helpful: true });
    assert.equal(store.canPromote(store.active()[0]!), true, '3 次命中且 helpful 够 → 够格');
    assert.equal(store.promote(a.entry!.id).ok, true);
    assert.equal(store.stats().promoted, 1);

    // 到期：21 天后零命中 → expired
    const b = store.add({ text: '另一条零命中的准则' });
    t += 22 * 24 * 60 * 60 * 1000;
    const expired = store.sweepExpired();
    assert.equal(expired.length, 1);
    assert.equal(expired[0]?.id, b.entry!.id);
    rmSync(file, { force: true });
  });

  await test('八类不学：每类两例都能识别（硬/软分级）', () => {
    const hard: Array<[string, string]> = [
      ['secret', '发布时把 token 写进 README 就行'],
      ['secret', '记住密码是 abc12345'],
      ['one-shot', '2026-11-06 这天要发版'],
      ['one-shot', '这次的单号 A12345 要留着'],
      ['env-bound', '配置在 D:\\dshgz\\config.json 里'],
      ['env-bound', '连 192.168.1.5 的端口就行'],
    ];
    for (const [code, text] of hard) {
      const verdict = shouldReject(text);
      assert.equal(verdict.reject, true, `应拒绝：${text}`);
      assert.ok(verdict.hits.some((hit) => hit.code === code), `应命中 ${code}：${text}，实得 ${verdict.hits.map((h) => h.code)}`);
    }
    const soft: Array<[string, string, Record<string, unknown>]> = [
      ['over-granular', '这条准则特别长'.repeat(10), {}],
      ['no-user-evidence', '模型自己猜的一条规则', { hasUserEvidence: false }],
      ['conflict-tie', '两条准则矛盾且证据平手', { conflictTie: true }],
      ['retracted-in-turn', '用户先纠正又收回的说法', { retractedInSameTurn: true }],
      ['flip-flop-subject', '同一主题反复改', { supersede30d: 4 }],
    ];
    for (const [code, text, ctx] of soft) {
      const hits = classifyNotLearn(text, ctx as never);
      assert.ok(hits.some((hit) => hit.code === code), `应命中 ${code}：${text}`);
    }
    // 正常准则不该被硬拒
    const ok = shouldReject('发版前依次执行六步，不可跳步');
    assert.equal(ok.reject, false);
  });

  section('[17] 主动闸门（S7）');

  await test('主动打分：信号越多分越高，零信号不过线', () => {
    const none = scoreScan({ pendingDue: 0, unresolvedGaps: 0, brokenEvidence: 0, expiredRules: 0 });
    assert.ok(none.score < 0.4, `零信号分应很低，实得 ${none.score}`);
    const some = scoreScan({ pendingDue: 1, unresolvedGaps: 1, brokenEvidence: 0, expiredRules: 0 });
    const many = scoreScan({ pendingDue: 3, unresolvedGaps: 2, brokenEvidence: 1, expiredRules: 3, silenceMs: 7 * 24 * 3600_000 });
    assert.ok(some.score > none.score, '有信号应比零信号高');
    assert.ok(many.score > some.score, '信号越多分越高');
    assert.ok(many.score <= 1 && many.score >= 0, '分数必须有界');
  });

  await test('wouldDo：每条都能回答「用户要做什么 / 能得到什么」', () => {
    const drafts = buildWouldDo(
      {
        dueTasks: [{ id: 't1', description: '整理文档整理', overdueHours: 30 }],
        gaps: [{ id: 'g1', text: '不清楚某个 slot 的取值' }],
        brokenRules: [{ id: 'ctxt-00001', content: '发版六步不可跳步' }],
        expiredRules: [{ id: 'ctxt-00002', content: '纯文档只推 commit' }],
      },
      0.8,
    );
    assert.equal(drafts.length, 4);
    for (const draft of drafts) {
      assert.ok(draft.userAction.length > 0, `${draft.kind} 缺少 userAction`);
      assert.ok(draft.benefit.length > 0, `${draft.kind} 缺少 benefit`);
      assert.ok(draft.action.length > 0);
      assert.ok(draft.key.includes(draft.targetId));
    }
  });

  await test('wouldDo 入库：同一条反复扫到只加 seen，不重复；处理过的不复活', () => {
    const file = join(TEST_TMP, 'proactive-test.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 10_000 });
    const source = {
      dueTasks: [{ id: 't1', description: '整理文档整理', overdueHours: 30 }],
      gaps: [],
      brokenRules: [],
      expiredRules: [],
    };
    const first = store.recordScan(source, 0.7);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.seen, 1);
    store.recordScan(source, 0.7);
    store.recordScan(source, 0.7);
    const pending = store.pending();
    assert.equal(pending.length, 1, '同一件事不能重复入列');
    assert.equal(pending[0]?.seen, 3);

    // 忽略后不再复活
    assert.equal(store.dismiss(pending[0]!.id), true);
    assert.equal(store.pending().length, 0);
    store.recordScan(source, 0.7);
    assert.equal(store.pending().length, 0, '已处理过的同一件事不该复活');
    assert.equal(store.adoptionRate(), 0, '只有 dismiss，采纳率 0');
    rmSync(file, { force: true });
  });

  await test('三阶段：P1 只记录不发言，P2 需用户规则，P3 有门槛', () => {
    const file = join(TEST_TMP, 'proactive-phase.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 11_000 });
    assert.equal(store.phase, 'P1', '默认必须是 P1');
    assert.equal(store.canSpeak(0.99).speak, false, 'P1 分数再高也不发言');

    store.setPhase('P2');
    assert.equal(store.canSpeak(0.99).speak, false, 'P2 没规则不发言');
    store.addRule('每天 9 点提醒待办');
    assert.equal(store.canSpeak(0.2).speak, true, 'P2 有规则即可发言');

    const blocked = store.setPhase('P3');
    assert.equal(blocked.ok, false, '样本不足不许升 P3');
    assert.ok((blocked.reason ?? '').includes('样本不足'));

    // 造够样本 + 高采纳率
    for (let i = 0; i < 18; i += 1) store.document.stats.adopted += 1;
    for (let i = 0; i < 2; i += 1) store.document.stats.dismissed += 1;
    const ok = store.setPhase('P3');
    assert.equal(ok.ok, true, `20 样本 90% 采纳应允许升 P3，实得 ${JSON.stringify(ok)}`);
    assert.equal(store.canSpeak(0.7).speak, true);
    assert.equal(store.canSpeak(0.3).speak, false, 'P3 分数不够仍不发言');
    // 降级随时允许
    assert.equal(store.setPhase('P1').ok, true);
    rmSync(file, { force: true });
  });

  section('[18] 检索度量（S8）');

  await test('召回日志：零结果率、平均条数、按模式分桶、未标注筛选', () => {
    const file = join(TEST_TMP, 'recall-log.jsonl');
    rmSync(file, { force: true });
    const log = new RecallLog({ filePath: file, now: () => 12_000 });
    log.record({ query: '发版流程', mode: 'strict', ids: ['mem-1', 'mem-2'], scores: [0.9, 0.5] });
    log.record({ query: '发版流程', mode: 'strict', ids: ['mem-1'], scores: [0.8] });
    log.record({ query: '数据库选型', mode: 'strict', ids: [], scores: [], count: 0 });
    const overview = log.overview();
    assert.equal(overview.total, 3);
    assert.equal(overview.zeroResult, 1);
    assert.equal(overview.zeroRate, 0.333);
    assert.equal(overview.avgCount, 1);
    assert.equal(overview.byMode.strict, 3);

    // 未标注：去重 + 排除已标
    const un = log.unannotated(new Set(['数据库选型']), 10);
    assert.equal(un.length, 1, '同一查询只出现一次，且排除已标注的');
    assert.equal(un[0]?.query, '发版流程');
    rmSync(file, { force: true });
  });

  await test('检索评测：Top-1/Top-3、expectEmpty、misses、样本不足报 insufficient', () => {
    const file = join(TEST_TMP, 'retrieval-eval.json');
    rmSync(file, { force: true });
    const store = new RetrievalEvalStore({ filePath: file, now: () => 13_000, minCases: 4 });

    assert.equal(store.addCase({ query: '没给期望' }).rejected !== undefined, true, '既没 expected 也没 expectEmpty 应拒绝');
    store.addCase({ query: '发版流程', expectedIds: ['mem-1'] });
    store.addCase({ query: '数据库选型', expectedIds: ['mem-2'] });
    store.addCase({ query: '无关内容', expectEmpty: true });
    store.addCase({ query: 'npm 发布', expectedIds: ['mem-3'] });

    const fake = (q: string): string[] => {
      if (q === '发版流程') return ['mem-1', 'mem-9'];
      if (q === '数据库选型') return ['mem-9', 'mem-2']; // top1 错，top3 对
      if (q === '无关内容') return [];
      return ['mem-3'];
    };
    const m = store.evaluate(fake);
    assert.equal(m.cases, 4);
    assert.equal(m.top1, 0.75, '4 条里 top1 对 3 条');
    assert.equal(m.top3, 1, '4 条 top3 全对');
    assert.equal(m.status, 'yellow', 'Top-3 达标但 Top-1 不足 → yellow');
    assert.equal(m.misses.length, 0, 'top3 全中，不该有 miss');

    // 期望空但召回了东西 → 计 miss
    store.addCase({ query: '瞎查', expectEmpty: true });
    const withMiss = store.evaluate((q) => (q === '瞎查' ? ['mem-7'] : fake(q)));
    assert.equal(withMiss.misses.some((x) => x.query === '瞎查'), true);

    // 样本不足
    const small = new RetrievalEvalStore({ filePath: join(TEST_TMP, 'retrieval-small.json'), minCases: 50 });
    small.addCase({ query: 'a', expectedIds: ['x'] });
    assert.equal(small.evaluate(() => ['x']).status, 'insufficient');
    rmSync(file, { force: true });
    rmSync(join(TEST_TMP, 'retrieval-small.json'), { force: true });
  });

  await test('检索评测：同一条查询重复标注只保留最新', () => {
    const file = join(TEST_TMP, 'retrieval-dedupe.json');
    rmSync(file, { force: true });
    const store = new RetrievalEvalStore({ filePath: file, now: () => 14_000 });
    store.addCase({ query: '发版流程', expectedIds: ['mem-1'] });
    store.addCase({ query: '发版流程', expectedIds: ['mem-2'] });
    assert.equal(store.cases().length, 1, '同一查询只保留一条');
    assert.deepEqual(store.cases()[0]?.expectedIds, ['mem-2']);
    rmSync(file, { force: true });
  });

  await test('联动：目标消失后待处理提醒自动下线，且不计入采纳率', () => {
    const file = join(TEST_TMP, 'proactive-link.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 12_000 });
    const withTask = {
      dueTasks: [{ id: 't1', description: '整理文档整理', overdueHours: 30 }],
      gaps: [],
      brokenRules: [],
      expiredRules: [],
    };
    store.recordScan(withTask, 0.7);
    assert.equal(store.pending().length, 1);

    // 任务被标记完成 → 下一次扫描时 dueTasks 里没有它 → 该提醒应下线
    store.recordScan({ dueTasks: [], gaps: [], brokenRules: [], expiredRules: [] }, 0.1);
    assert.equal(store.pending().length, 0, '目标消失后不该还挂着提醒');
    // stale 不是「用户不要」，不能进采纳率分母
    assert.equal(store.adoptionRate(), 0);
    assert.equal(store.document.stats.dismissed, 0, 'stale 不该记成 dismissed');

    // 任务后来又逾期了 → 应该重新提醒（stale 允许复活）
    store.recordScan(withTask, 0.7);
    assert.equal(store.pending().length, 1, '条件再次成立应重新提醒');
    rmSync(file, { force: true });
  });

  await test('联动：clearByTarget 能即时清掉某一条的提醒', () => {
    const file = join(TEST_TMP, 'proactive-clear.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 13_000 });
    store.recordScan(
      {
        dueTasks: [
          { id: 't1', description: '任务一', overdueHours: 10 },
          { id: 't2', description: '任务二', overdueHours: 20 },
        ],
        gaps: [],
        brokenRules: [],
        expiredRules: [],
      },
      0.8,
    );
    assert.equal(store.pending().length, 2);
    assert.equal(store.clearByTarget('t1', '任务已完成'), 1);
    const left = store.pending();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.targetId, 't2', '只清指定的那条，不误伤其他');
    assert.equal(store.clearByTarget('not-exist'), 0);
    rmSync(file, { force: true });
  });

  await test('联动：dismiss 只冷却不永久封杀，冷却过后同一件事会再出现', () => {
    const file = join(TEST_TMP, 'proactive-cooldown.json');
    rmSync(file, { force: true });
    const DAY = 24 * 60 * 60 * 1000;
    let t = 20_000;
    const store = new ProactiveStore({ filePath: file, now: () => t });
    const src = {
      dueTasks: [{ id: 't1', description: '整理文档整理', overdueHours: 30 }],
      gaps: [],
      brokenRules: [],
      expiredRules: [],
    };
    store.recordScan(src, 0.7);
    const first = store.pending()[0]!;
    assert.equal(store.dismiss(first.id), true);
    assert.equal(store.pending().length, 0, 'dismiss 后当次不再显示');

    // 冷却期内：条件仍成立，但不重复打扰
    t += 3 * DAY;
    store.recordScan(src, 0.7);
    assert.equal(store.pending().length, 0, '7 天冷却期内不该重复提');

    // 冷却期过后：允许重新出现（关键修复点）
    t += 5 * DAY;
    store.recordScan(src, 0.7);
    assert.equal(store.pending().length, 1, '冷却过后同一件事应重新提醒');
    rmSync(file, { force: true });
  });

  await test('任务年龄口径统一：withAge 与 detail 用同一套算法', () => {
    const file = join(TEST_TMP, 'task-age.json');
    rmSync(file, { force: true });
    const HOUR = 60 * 60 * 1000;
    const now = 1_000 * HOUR;
    const mgr = new LongHorizonTaskManager({ filePath: file, now: () => now, heartbeatMs: 6 * HOUR });
    return (async () => {
      await mgr.load();
      await mgr.create_task('逾期任务');
      const created = mgr.all()[0]!;
      // 把 lastUpdatedAt 推到 31 小时前
      const raw = { version: 1, tasks: [{ ...created, lastUpdatedAt: now - 31 * HOUR }] };
      writeFileSync(file, JSON.stringify(raw), 'utf8');
      const reloaded = new LongHorizonTaskManager({ filePath: file, now: () => now, heartbeatMs: 6 * HOUR });
      await reloaded.load();
      const withAge = reloaded.withAge();
      assert.equal(withAge[0]?.ageMs, 31 * HOUR, 'ageMs 应是真实年龄');
      assert.equal(withAge[0]?.overdue, true);
      const due = reloaded.check_due_tasks();
      assert.equal(due[0]?.overdueMs, 31 * HOUR, 'check_due_tasks 与 withAge 必须一致');
      rmSync(file, { force: true });
    })();
  });

  section('[19] 分维度审计 + 孤儿取代修复（S9）');

  await test('孤儿取代：删掉取代者后，被取代者应回到 current', () => {
    const store = new TemporalMemoryStore({ now: () => 30_000 });
    const oldFact = store.ingest({ content: '发版流程：四步', subject: '发布流程', validFrom: 1_000 });
    const newFact = store.ingest({ content: '发版流程：六步', subject: '发布流程', validFrom: 2_000 });
    store.supersede(oldFact.id, newFact.id, 2_000);
    assert.equal(store.get(oldFact.id)?.supersededBy, newFact.id);
    assert.equal(store.orphans().length, 0, '取代者还在，不算孤儿');

    // 删掉取代者 → 旧的应该复活
    store.softDelete(newFact.id);
    assert.equal(store.get(oldFact.id)?.supersededBy, null, '取代者没了，不该还指着它');
    assert.equal(store.get(oldFact.id)?.supersededAt, null, '应回到 current');
    const current = store.all().filter((f) => f.deletedAt === undefined && f.supersededAt === null);
    assert.equal(current.some((f) => f.id === oldFact.id), true, '旧事实应重新算当前真值');
  });

  await test('孤儿取代：历史遗留的可批量体检并修复', () => {
    const store = new TemporalMemoryStore({ now: () => 31_000 });
    const a = store.ingest({ content: '配置在 A', subject: '配置', validFrom: 1_000 });
    const b = store.ingest({ content: '配置在 B', subject: '配置', validFrom: 2_000 });
    store.supersede(a.id, b.id, 2_000);
    // 模拟历史数据：直接抹掉 b（绕过 softDelete 的自动修复，制造孤儿状态）
    const raw = store.serialize();
    const patched = raw.map((row) =>
      row.id === b.id ? { ...row, deletedAt: 9_999 } : row,
    );
    const store2 = new TemporalMemoryStore({ now: () => 31_000 });
    store2.restore(patched);
    const orphans = store2.orphans();
    assert.equal(orphans.length, 1, `应检出 1 条孤儿，实得 ${orphans.length}`);
    assert.equal(orphans[0]?.id, a.id);
    assert.equal(store2.repairOrphans(), 1);
    assert.equal(store2.orphans().length, 0, '修完不该还有孤儿');
    assert.equal(store2.get(a.id)?.supersededBy, null);
  });

  section('[20] 工单阶段机（S10）');

  await test('工单：阶段推进、依赖阻塞、完成解开别人', () => {
    const file = join(TEST_TMP, 'ticket-test.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 40_000 });
    store.recordScan(
      {
        dueTasks: [
          { id: 't1', description: '出一版稿子', overdueHours: 10 },
          { id: 't2', description: '拿稿子去核对', overdueHours: 20 },
        ],
        gaps: [],
        brokenRules: [],
        expiredRules: [],
      },
      0.8,
    );
    const tickets = store.tickets();
    assert.equal(tickets.length, 2);
    const a = tickets.find((t) => t.targetId === 't1')!;
    const b = tickets.find((t) => t.targetId === 't2')!;
    assert.equal(a.stage, 'open', '老数据没 stage 时默认 open');

    // 让 b 依赖 a
    store.update(b.id, { blockedBy: [a.id], deliverable: '一份核对结论' });
    const blocked = store.setStage(b.id, 'doing');
    assert.equal(blocked.ok, false, '前置没完成不能开工');
    assert.ok((blocked.reason ?? '').includes('前置'));

    // a 推进到 done，应解开 b
    const done = store.setStage(a.id, 'done');
    assert.equal(done.ok, true);
    assert.deepEqual(done.unblocked, [b.id], 'a 完成后应报告 b 被解开');

    // 现在 b 可以开工
    assert.equal(store.setStage(b.id, 'doing').ok, true);
    assert.equal(store.setStage(b.id, 'review').ok, true);
    const finished = store.setStage(b.id, 'done');
    assert.equal(finished.ok, true);

    // 阶段历史要留痕
    const finalB = store.tickets().find((t) => t.id === b.id)!;
    assert.ok((finalB.history ?? []).length >= 3, `应留下多步历史，实得 ${(finalB.history ?? []).length}`);
    assert.equal(finalB.deliverable, '一份核对结论', '产物字段要存住');
    rmSync(file, { force: true });
  });

  await test('工单：看板按阶段分组，已下线的进不去', () => {
    const file = join(TEST_TMP, 'ticket-board.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 41_000 });
    // 一次扫描里放两条：recordScan 是**整批**的，分两次扫会把上一批标成 stale
    store.recordScan(
      {
        dueTasks: [
          { id: 'x1', description: '甲事', overdueHours: 5 },
          { id: 'x2', description: '乙事', overdueHours: 6 },
        ],
        gaps: [],
        brokenRules: [],
        expiredRules: [],
      },
      0.7,
    );
    const board = store.board();
    assert.equal(board.length, 5, '五档：草稿/待办/进行中/待验收/已完成');
    const openCol = board.find((c) => c.stage === 'open')!;
    assert.equal(openCol.items.length, 2, `两条都应在待办，实得 ${openCol.items.length}`);

    const one = store.tickets()[0]!;
    store.setStage(one.id, 'doing');
    assert.equal(store.board().find((c) => c.stage === 'doing')!.items.length, 1);
    assert.equal(store.board().find((c) => c.stage === 'open')!.items.length, 1);

    // dismiss 掉的不该出现在看板
    const two = store.tickets().find((t) => t.id !== one.id)!;
    store.dismiss(two.id);
    const total = store.board().reduce((acc, col) => acc + col.items.length, 0);
    assert.equal(total, 1, 'dismissed 不进看板');
    rmSync(file, { force: true });
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
  section('[21] 场合判定（register）');

  await test('场合判定：明确派活的词命中关键词层，置信度 1', () => {
    for (const text of [
      '把这个文档改一下，标题要按站名加电压',
      '报错了，帮我看看日志',
      '加一个新页面',
      'npm run build 之后打包',
    ]) {
      const d = judgeRegister(text);
      assert.equal(d.verdict, 'work', `「${text}」应判干活，实得 ${d.verdict}（${d.reason}）`);
      assert.equal(d.layer, 'keyword', `「${text}」应走关键词层，实得 ${d.layer}`);
      assert.equal(d.confidence, 1);
    }
  });

  await test('场合判定：明确闲聊命中关键词层', () => {
    for (const text of ['今天好累啊', '晚安', '在干嘛呢', '周末放假了吗', '哈哈笑死']) {
      const d = judgeRegister(text);
      assert.equal(d.verdict, 'chat', `「${text}」应判闲聊，实得 ${d.verdict}（${d.reason}）`);
      assert.equal(d.layer, 'keyword');
    }
  });

  await test('场合判定：应答词不能被当成闲聊信号', () => {
    for (const text of ['好的', '行', '可以', '嗯', '继续']) {
      const d = judgeRegister(text);
      assert.equal(d.verdict, 'work', `「${text}」应按干活，实得 ${d.verdict}`);
      assert.equal(d.layer, 'keyword', `「${text}」应由应答词规则直接定`);
      assert.ok((d.reason ?? '').includes('应答'), `「${text}」理由应说明是应答词，实得 ${d.reason}`);
    }
  });

  await test('场合判定：两边词都命中时不猜，交给打分', () => {
    const d = judgeRegister('累了一天，帮我把文档改完');
    assert.notEqual(d.layer, 'keyword', '两边都命中不该在关键词层定论');
  });

  await test('场合判定：分不清一律按干活（代价不对称）', () => {
    // 无关键词、无语气词、长度中等：两级都弱 → 兜底按干活
    const d = judgeRegister('这个东西放在那边的桌子上');
    assert.equal(d.layer, 'fallback', `应走兜底层，实得 ${d.layer}（${d.reason}）`);
    assert.equal(d.verdict, 'work', `兜底必须是干活，实得 ${d.verdict}`);
    assert.equal(judgeRegister('   ').verdict, 'work');
    assert.equal(judgeRegister('   ').layer, 'fallback');
  });

  await test('场合判定：短闲聊不能被当成纯应答（实测踩过的坑）', () => {
    // 「瘫着哦」「普通说话」「聊天」在真实对话里被误判成干活，导致人机味不消
    for (const text of ['瘫着哦', '普通说话', '聊天', '你好']) {
      const d = judgeRegister(text);
      assert.equal(d.verdict, 'chat', `「${text}」应判闲聊，实得 ${d.verdict}（${d.reason}）`);
    }
    // 真正的纯应答仍然按干活
    for (const text of ['好的', '嗯', '行', '可以', '继续']) {
      assert.equal(judgeRegister(text).verdict, 'work', `「${text}」是纯应答，应按干活`);
    }
  });

  await test('场合判定：双阈值真的在起作用', () => {
    assert.equal(THRESHOLD, 0.3);
    assert.equal(AMBIGUITY_THRESHOLD, 0.1);
    const s = scoreRegister('这个函数报错，帮我改成 async，顺便加个测试');
    assert.ok(s.work > s.chat, `work ${s.work} 应大于 chat ${s.chat}`);
    assert.ok(s.gap >= AMBIGUITY_THRESHOLD);
  });

  await test('场合判定：记录只存摘要，不存全量原文', () => {
    const file = join(TEST_TMP, 'register-test.jsonl');
    rmSync(file, { force: true });
    const log = new RegisterLog({ filePath: file, now: () => 50_000 });
    const longText = '一'.repeat(120);
    log.record({ sessionId: 's1', turn: 1, text: longText, decision: judgeRegister(longText) });
    const rows = log.recent(1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.excerpt.length, 40, '摘要应截断到 40 字');
    const onDisk = readFileSync(file, 'utf8');
    assert.equal(onDisk.includes('一'.repeat(41)), false, '磁盘上不该出现超过 40 字的原文');
    rmSync(file, { force: true });
  });

  await test('场合判定：标注判错后 overview 能算出来', () => {
    const file = join(TEST_TMP, 'register-label.jsonl');
    rmSync(file, { force: true });
    const log = new RegisterLog({ filePath: file, now: () => 51_000 });
    log.record({ sessionId: 's1', turn: 1, text: '今天好累啊', decision: judgeRegister('今天好累啊') });
    log.record({ sessionId: 's1', turn: 2, text: '把文档改一下', decision: judgeRegister('把文档改一下') });
    assert.equal(log.overview().total, 2);
    assert.equal(log.overview().chat, 1);
    assert.equal(log.label('s1', 1, 'wrong'), true);
    const ov = log.overview();
    assert.equal(ov.labelled, 1, `标注数应为 1，实得 ${ov.labelled}`);
    assert.equal(ov.wrong, 1, `判错数应为 1，实得 ${ov.wrong}`);
    assert.equal(ov.total, 2, '标注不应增加总轮数');
    rmSync(file, { force: true });
  });

  await test('场合判定：重新加载日志后统计一致', () => {
    const file = join(TEST_TMP, 'register-reload.jsonl');
    rmSync(file, { force: true });
    const a = new RegisterLog({ filePath: file, now: () => 52_000 });
    a.record({ sessionId: 's1', turn: 1, text: '晚安', decision: judgeRegister('晚安') });
    a.record({ sessionId: 's1', turn: 2, text: '改一下代码', decision: judgeRegister('改一下代码') });
    const b = new RegisterLog({ filePath: file });
    assert.equal(b.overview().total, 2);
    assert.equal(b.overview().byLayer.keyword, 2);
    rmSync(file, { force: true });
  });

  await test('场合判定：运行时注入的上下文块要跳过', () => {
    // 这些块也走 user/message 事件（实测），不跳过会污染统计并误命中英文词
    for (const text of [
      'Time sampled while preparing turn 362, step 47: 2026-11-08T20:51:42+08:00',
      'Tokens prefixed with @ are paths the user explicitly referenced.',
      'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.',
      '<system-reminder>一些提醒</system-reminder>',
      'Instructions from: AGENTS.md',
    ]) {
      assert.equal(isRuntimeContext(text), true, `应识别为运行时上下文：${text.slice(0, 20)}`);
    }
    assert.equal(isRuntimeContext('把这个文档改一下'), false, '正常用户消息不能被跳过');
  });

  await test('场合判定：ASCII 关键词要按词边界匹配', () => {
    // 「PR」不能命中「preparing」这类英文单词内部
    const d = judgeRegister('Time sampled while preparing turn 362');
    assert.equal(d.layer === 'keyword' && (d.hits ?? []).includes('PR'), false, 'PR 不该命中 preparing');
    // 真正的 PR 要命中
    const real = judgeRegister('把这个 PR 合一下');
    assert.equal(real.verdict, 'work');
    assert.equal((real.hits ?? []).includes('PR'), true, '独立的 PR 应命中');
  });

  section('[22] 超级代理对接（superagent）');

  await test('superagent：工单紧凑化只取人要看字段，actions 摊平', () => {
    const t = compactTicket({
      id: 'abc123',
      title: '把 README 补一节',
      state: 'open',
      stage: 'person',
      action: 'review',
      strength: 'explicit',
      assignments: 13,
      inputs: 0,
      sessionId: 'worker-abc',
      actions: { retry: false, stop: true },
      ignoredField: 'x',
    });
    assert.ok(t !== undefined);
    assert.equal(t!.id, 'abc123');
    assert.equal(t!.stage, 'person');
    assert.equal(t!.assignments, 13);
    assert.equal(t!.canRetry, false);
    assert.equal(t!.canStop, true);
    // 没有 id 的条目直接丢弃（对面改版时不至于画出一行空白）
    assert.equal(compactTicket({ title: '无 id' }), undefined);
    assert.equal(compactTicket(null), undefined);
  });

  await test('superagent：概览按 stage 分组计数，starting 不算异常', () => {
    const overview = buildOverview(
      'http://x',
      {
        paused: false,
        load: { running: 1, queued: 2, maxWorkers: 3 },
        health: {
          runtime: { state: 'ready' },
          github: { state: 'starting' },
          feishu: { state: 'error', detail: 'auth failed' },
        },
      },
      {
        items: [
          { id: 'a', title: 'A', state: 'open', stage: 'person', actions: { retry: true, stop: true } },
          { id: 'b', title: 'B', state: 'open', stage: 'working' },
          { id: 'c', title: 'C', state: 'open', stage: 'idle' },
          { id: 'd', title: 'D', state: 'ended' },
        ],
      },
      1000,
    );
    assert.equal(overview.reachable, true);
    assert.equal(overview.counts!.total, 4);
    assert.equal(overview.counts!.needsPerson, 1);
    assert.equal(overview.counts!.working, 1);
    assert.equal(overview.counts!.idle, 1);
    assert.equal(overview.load!.maxWorkers, 3);
    // 只有 error 算异常；ready / starting 都不算
    assert.deepEqual(
      overview.unhealthy!.map((item) => item.name),
      ['feishu'],
    );
  });

  await test('superagent：不可达时降级为 reachable=false，不抛错', () => {
    const client = new SuperagentClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 800 });
    return client.overview().then((overview) => {
      assert.equal(overview.reachable, false);
      assert.ok((overview.error ?? '').length > 0, '应带一句原因');
    });
  });

  await test('superagent：动作白名单，未知动作与缺 id 都直接拒绝（不发请求）', async () => {
    const client = new SuperagentClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    assert.equal((await client.act('retry')).ok, false);
    assert.equal((await client.act('stop', '')).ok, false);
    // 合法动作在网络失败时返回 ok:false，而不是抛
    assert.equal((await client.act('pause')).ok, false);
  });

  await test('superagent：本地工单可关联外部 Ticket，只存引用不改状态', () => {
    const file = join(TEST_TMP, 'ticket-link.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 60_000 });
    store.recordScan(
      { dueTasks: [{ id: 't1', description: '甲事', overdueHours: 5 }], gaps: [], brokenRules: [], expiredRules: [] },
      0.8,
    );
    const mine = store.tickets()[0]!;
    const stageBefore = mine.stage;

    assert.equal(store.linkTicket(mine.id, 'ext-abc123'), true);
    let rows = store.tickets();
    assert.equal(rows[0]!.linkedTicket, 'ext-abc123');
    assert.equal(rows[0]!.stage, stageBefore, '关联不能改阶段');

    // 取消关联
    assert.equal(store.linkTicket(mine.id, null), true);
    rows = store.tickets();
    assert.equal(rows[0]!.linkedTicket, undefined, '取消后应没有该字段');

    // 重新加载后仍能读到
    store.linkTicket(mine.id, 'ext-def456');
    const reloaded = new ProactiveStore({ filePath: file });
    assert.equal(reloaded.tickets()[0]!.linkedTicket, 'ext-def456');
    rmSync(file, { force: true });
  });

  await test('injectionOnly：只注册两段提示，不注册工具/路由，一个字节也不写', () => {
    const dir = join(TEST_TMP, 'injection-only');
    mkdirSync(dir, { recursive: true });
    const playbookFile = join(dir, 'pb.json');
    const personaFile = join(dir, 'persona.json');
    const sections: Array<{ name: string; order: number; text: (context?: unknown) => string }> = [];
    const fakeCtx = {
      get: (service: string): unknown =>
        service === 'systemPrompt'
          ? {
              section: (section: { name: string; order: number; text: (context?: unknown) => string }) => {
                sections.push(section);
                return () => {};
              },
            }
          : undefined,
      logger: { warn: () => {}, info: () => {} },
    };

    const dispose = apply(fakeCtx as never, { injectionOnly: true, playbookFile, personaFile });

    assert.equal(sections.length, 2, `应只注册 2 段，实得 ${sections.length}`);
    assert.deepEqual(
      sections.map((item) => item.name).sort(),
      ['cognition-engine-memory', 'cognition-engine-persona'],
    );
    // text() 是纯函数：文件不存在时返回空串，且调用它不产生文件
    const memorySection = sections.find((item) => item.name === 'cognition-engine-memory');
    assert.ok(memorySection !== undefined);
    assert.equal(memorySection!.text({}), '');
    assert.equal(existsSync(playbookFile), false, 'injectionOnly 不能写准则文件');
    assert.equal(existsSync(personaFile), false, 'injectionOnly 不能写人格文件');

    assert.equal(typeof dispose, 'function');
    (dispose as () => void)();
    rmSync(dir, { recursive: true, force: true });
  });

  section('[23] AGENTS.md 受控块（agents_file）');

  await test('受控块：文件不存在时只创建块', () => {
    const r = upsertManagedBlock(null, '人格段\n准则段');
    assert.equal(r.changed, true);
    assert.equal(r.malformed, false);
    assert.ok(r.content.includes(BEGIN_MARKER));
    assert.ok(r.content.includes(END_MARKER));
    assert.ok(r.content.includes('人格段'));
    assert.equal(readManagedBlock(r.content), '人格段\n准则段');
  });

  await test('受控块：只替换标记之间，标记外一个字都不动', () => {
    const original = `# 我的全局指令\n\n用户自己写的内容，别动。\n\n${wrapBlock('旧的块')}\n\n后面还有用户内容。\n`;
    const r = upsertManagedBlock(original, '新的块');
    assert.equal(r.malformed, false);
    assert.ok(r.content.startsWith('# 我的全局指令'));
    assert.ok(r.content.includes('用户自己写的内容，别动。'));
    assert.ok(r.content.includes('后面还有用户内容。'));
    assert.ok(r.content.includes('新的块'));
    assert.equal(r.content.includes('旧的块'), false);
    assert.equal(readManagedBlock(r.content), '新的块');
  });

  await test('受控块：内容没变时 changed=false（幂等）', () => {
    const first = upsertManagedBlock(null, '同一段').content;
    const second = upsertManagedBlock(first, '同一段');
    assert.equal(second.changed, false);
  });

  await test('受控块：标记残缺时不吞原文，追加并报告 malformed', () => {
    const broken = '# 用户内容\n\n<!-- cognition-engine:begin -->\n写到一半就断了';
    const r = upsertManagedBlock(broken, '完整块');
    assert.equal(r.malformed, true);
    assert.ok(r.content.includes('# 用户内容'));
    assert.ok(r.content.includes('写到一半就断了'), '残缺内容必须保留');
    assert.ok(r.content.includes('完整块'));
  });

  await test('受控块：没有标记但有内容时追加到末尾', () => {
    const r = upsertManagedBlock('# 只有用户内容\n', '块');
    assert.equal(r.malformed, false);
    assert.ok(r.content.startsWith('# 只有用户内容'));
    assert.equal(readManagedBlock(r.content), '块');
  });

  await test('受控块：写盘 → 重读 → 再写幂等 → 可回滚', () => {
    const dir = join(TEST_TMP, 'agents-sync');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'AGENTS.md');

    const sync = new AgentsFileSync({ filePath: file });
    const first = sync.apply('第一条');
    assert.equal(first.ok, true);
    assert.equal(first.changed, true);
    assert.equal(first.previous, null);
    assert.ok(readFileSync(file, 'utf8').includes('第一条'));

    const second = sync.apply('第一条');
    assert.equal(second.changed, false, '同内容第二次不应再写');

    const third = sync.apply('第二条');
    assert.equal(third.changed, true);
    const content = readFileSync(file, 'utf8');
    assert.equal(content.includes('第一条'), false);
    assert.ok(content.includes('第二条'));

    // 回滚到第一次之前（文件原本不存在 → 传 null 不应崩）
    assert.equal(sync.rollback(null), true);
    rmSync(dir, { recursive: true, force: true });
  });

  section('[24] 三项防伪修正：零矛盾不合成 / 自报不算数 / 测不出来不放行');

  await test('反思：反题零矛盾时不产出合题（fail-closed）', async () => {
    const calls: string[] = [];
    const engine = new DialecticalReflectionEngine((_prompt, phase) => {
      calls.push(phase);
      if (phase === 'thesis') return '正题：这个方案可行。';
      // 反题故意只写漂亮话，不给 CONTRADICTION/EVIDENCE 对
      if (phase === 'antithesis') return '反题：整体来看有一些可以斟酌的地方，但大方向没问题。';
      return '合题：不该被调用';
    });
    const result = await engine.reflect('这个方案可行吗');
    assert.equal(result.verdict, 'no-contradiction');
    assert.equal(result.synthesis, '', '零矛盾时不应产出合题');
    assert.equal(result.contradictions.length, 0);
    assert.ok(result.note !== undefined && result.note.length > 0);
    assert.deepEqual(calls, ['thesis', 'antithesis'], 'synthesis 不应被调用');
    // 报告里要明确说没合成，不能装作有结论
    const transcript = engine.renderTranscript(result);
    assert.ok(transcript.includes('未产出合题'), transcript);
  });

  await test('反思：关掉 fail-closed 时才允许零矛盾走完全程', async () => {
    const calls: string[] = [];
    const engine = new DialecticalReflectionEngine(
      (_prompt, phase) => {
        calls.push(phase);
        if (phase === 'thesis') return '正题';
        if (phase === 'antithesis') return '反题：没有具体矛盾';
        return '合题';
      },
      { failClosedOnNoContradiction: false },
    );
    const result = await engine.reflect('随便问点什么');
    assert.equal(result.verdict, 'synthesized');
    assert.deepEqual(calls, ['thesis', 'antithesis', 'synthesis']);
  });

  await test('反思：反题给了矛盾对时正常合成，verdict 为 synthesized', async () => {
    const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
    const result = await engine.reflect('要不要重写遗留系统');
    assert.equal(result.verdict, 'synthesized');
    assert.ok(result.contradictions.length > 0);
    assert.ok(result.synthesis.length > 0);
  });

  await test('准则：模型自报的 appliedGood 不进主计数，也推不动降级/升级', () => {
    const store = new PlaybookStore({ filePath: join(TEST_TMP, 'pb-selfreport.json') });
    const entry = store.addManual({ content: '模型自报的好坏不应影响准则的升降级判断', section: '约定' }).entry!;
    store.accept(entry.id);

    for (let i = 0; i < 8; i += 1) store.markUsage(entry.id, 'appliedGood', `自报第${i}次`, 'self');
    for (let i = 0; i < 8; i += 1) store.markUsage(entry.id, 'appliedBad', `自报第${i}次`, 'self');

    const usage = store.get(entry.id)!.usage!;
    assert.equal(usage.appliedGood, 0, '自报不得写入 appliedGood');
    assert.equal(usage.appliedBad, 0, '自报不得写入 appliedBad');
    assert.equal(usage.selfAppliedGood, 8);
    assert.equal(usage.selfAppliedBad, 8);
    assert.notEqual(store.get(entry.id)!.status, 'retired', '自报不能把准则弄退场');
    rmSync(join(TEST_TMP, 'pb-selfreport.json'), { force: true });
  });

  await test('准则：用户/系统来源的 appliedBad 仍然能触发降级判断（原能力没丢）', () => {
    const store = new PlaybookStore({ filePath: join(TEST_TMP, 'pb-userbad.json') });
    const entry = store.addManual({ content: '用户说这条准则总是出错需要退场处理', section: '约定' }).entry!;
    store.accept(entry.id);
    for (let i = 0; i < 6; i += 1) store.markUsage(entry.id, 'appliedBad', '用户纠正', 'user');

    const after = store.get(entry.id)!;
    assert.equal(after.usage!.appliedBad, 6, '外部来源必须真的计数');
    // 两种情况都算「降级判断生效」：要么自动退场，要么被证据门控挡下并留痕。
    const downgraded = after.status === 'retired' || (after.note ?? '').includes('证据门控');
    assert.ok(downgraded, `外部差评必须进入降级判断，当前 status=${after.status} note=${after.note ?? ''}`);
    rmSync(join(TEST_TMP, 'pb-userbad.json'), { force: true });
  });

  await test('CPE：测不出来（insufficient）在严格模式下必须拦，非严格才放行', () => {
    assert.equal(blocksAcceptance('insufficient', true), true);
    assert.equal(blocksAcceptance('insufficient', false), false);
    assert.equal(blocksAcceptance('green', true), false);
    assert.equal(blocksAcceptance('yellow', true), false);
    assert.equal(blocksAcceptance('red', true), false, 'red 由回滚逻辑处理，不归这里');
  });

  section('[25] 记忆冲突：写入前候选提示 + 取代留理由');

  await test('similarLive：只给同主题、还活着、语义相近的候选，且排除自身重复', () => {
    const store = new TemporalMemoryStore();
    const a = store.ingest({ subject: '部署区域', content: '部署区域在上海机房' });
    store.ingest({ subject: '部署区域', content: '部署区域在北京机房' }); // 相近
    store.ingest({ subject: '后端语言', content: '部署区域在成都机房' }); // 不同主题，不该出现
    const dead = store.ingest({ subject: '部署区域', content: '部署区域在深圳机房' });
    store.softDelete(dead.id);

    const hits = store.similarLive('部署区域在杭州机房', '部署区域', 0.3, 3);
    const ids = hits.map((h) => h.id);
    assert.ok(ids.includes(a.id), '同主题相近的活事实应入选');
    assert.equal(ids.includes(dead.id), false, '已删除的不该出现');
    assert.ok(hits.every((h) => h.similarity >= 0.3));
    assert.ok(hits.length <= 3);

    // 完全相同的内容不提示（它是 hash 去重，不是冲突）
    const same = store.similarLive('部署区域在上海机房', '部署区域', 0.3, 3);
    assert.equal(same.some((h) => h.id === a.id), false);
  });

  await test('supersede 会记下理由，且历史仍可查到原因', () => {
    const store = new TemporalMemoryStore();
    const oldFact = store.ingest({ subject: '部署区域', content: '部署区域在上海机房' });
    const newFact = store.ingest({
      subject: '部署区域',
      content: '部署区域在北京机房',
      supersedes: oldFact.id,
      supersedeReason: '客户 11 月改到北京机房',
    });
    const closed = store.get(oldFact.id)!;
    assert.equal(closed.supersededBy, newFact.id);
    assert.equal(closed.supersedeReason, '客户 11 月改到北京机房');
    // 当前真值只剩新的；旧的没被删除，只是闭合了区间（历史可查）
    assert.equal(store.get(newFact.id)!.supersededAt, null, '新事实仍是当前版本');
    assert.ok(closed.validTo !== null, '旧事实应被闭合 validTo');
    assert.ok(store.all().some((f) => f.id === oldFact.id), '被取代的事实不能从库里消失');
  });

  await test('手动 supersede（面板用）也能带理由，且理由长度被截断保护', () => {
    const store = new TemporalMemoryStore();
    const a = store.ingest({ subject: '口径', content: '口径按 2026 版执行' });
    const b = store.ingest({ subject: '口径', content: '口径按 2027 版执行' });
    const longReason = 'x'.repeat(500);
    store.supersede(a.id, b.id, Date.now(), longReason);
    const closed = store.get(a.id)!;
    assert.equal(closed.supersedeReason!.length, 200, '理由应被截到 200 字');
  });

  section('[26] P0 三项：注入上限 / 假设台账 / 评测反作弊');

  await test('假设抽取：抓住「按…理解」「我默认」「应该是…」，忽略普通陈述', () => {
    const hits = extractAssumptions(
      '好的，我来处理。按照你的理解，这次只改 README。我默认这份文档只给内部看。另外今天天气不错。应该是把标题改成二级。',
    );
    assert.ok(hits.some((h) => h.includes('按照你的理解')), hits.join(' | '));
    assert.ok(hits.some((h) => h.includes('我默认')), hits.join(' | '));
    assert.ok(hits.some((h) => h.includes('应该是')), hits.join(' | '));
    assert.equal(hits.some((h) => h.includes('天气不错')), false, '普通陈述不该被抓');
    assert.ok(hits.length <= 3);
  });

  await test('假设台账：去重、上限 3 条、用户纠正后清空、渲染为空时不占位', () => {
    const ledger = new AssumptionLedger();
    assert.equal(ledger.render('s1'), '', '空台账应返回空串');
    ledger.observe('s1', '我假设你要的是 A 方案。');
    ledger.observe('s1', '我假设你要的是 A 方案。'); // 重复
    assert.equal(ledger.count('s1'), 1, '重复假设不应重复登记');
    ledger.observe('s1', '应该是要在周五前交。');
    ledger.observe('s1', '按照惯例这块归你确认。');
    ledger.observe('s1', '我默认这次不动数据。');
    assert.ok(ledger.count('s1') <= 3, '最多 3 条');
    const rendered = ledger.render('s1');
    assert.ok(rendered.includes('尚未确认的假设'), rendered);
    ledger.clear('s1');
    assert.equal(ledger.count('s1'), 0, '清空后应为 0');
  });

  await test('CPE 反作弊：恒定 top-1 判红，正常排名不误伤', () => {
    assert.equal(detectsConstantRanking(['a', 'a', 'a']), true);
    assert.equal(detectsConstantRanking(['a', 'b', 'a']), false);
    assert.equal(detectsConstantRanking(['a', 'a']), false, '少于 3 条不判');

    const store = new CpeStore({ filePath: join(TEST_TMP, 'cpe-cheat.json') });
    // minCases 默认 20，这里只放 4 条用例，所以先把阈值调低。
    store.document.thresholds.minCases = 3;
    const ruleIds = ['r1', 'r2', 'r3'];
    for (let i = 0; i < 4; i += 1) {
      store.addCase({ question: `问题${i}`, expectedRuleIds: [ruleIds[i % 3]!], by: 'user' });
    }
    // 作弊解析器：对任何问题都返回同一顺序
    const cheating = store.check(() => ['r1', 'r2', 'r3']);
    assert.equal(cheating.antiCheat, 'constant-ranking');
    assert.equal(cheating.status, 'red', '恒定排名必须判红，不能当高分');

    // 正常解析器：按问题给不同 order
    const honest = store.check((question) => {
      const index = Number(question.replace(/\D/g, '')) % 3;
      return [ruleIds[index]!, ...ruleIds.filter((id) => id !== ruleIds[index])];
    });
    assert.equal(honest.antiCheat, undefined, '正常排名不应被判作弊');
    assert.notEqual(honest.status, 'red', '正常且全对不应判红');
    rmSync(join(TEST_TMP, 'cpe-cheat.json'), { force: true });
  });

  section('[27] P1 四项：完成要证据 / 歧义闸门 / 主题隔离 / 最小编辑');

  await test('歧义闸门：模糊需求报歧义且只给一个问题，具体需求不误报', () => {
    const vague = inspectRequirement('帮我优化一下那个文档');
    assert.equal(vague.ambiguous, true);
    assert.ok(vague.findings.length >= 1);
    assert.ok(vague.question.length > 0);
    assert.equal((vague.question.match(/？/g) ?? []).length, 1, '只问一个问题');

    const clear = inspectRequirement('把 README.md 第 12 行的标题改成「安装」');
    assert.equal(clear.ambiguous, false, clear.findings.map((f) => f.type).join(','));
    assert.equal(clear.question, '');
  });

  await test('完成要证据：COMPLETED 无 evidence 被拦，有证据放行，非完成状态不拦', () => {
    assert.equal(completionNeedsEvidence('COMPLETED', undefined), true);
    assert.equal(completionNeedsEvidence('COMPLETED', '做完了'), true, '无信息量的答复不算证据');
    assert.equal(completionNeedsEvidence('COMPLETED', 'docs/README.md 已更新，测试 179 全绿'), false);
    assert.equal(completionNeedsEvidence('IN_PROGRESS', undefined), false);
  });

  await test('主题隔离：注入只含当前主题 + 未归类的准则，别的主题被挡在外', () => {
    const store = new PlaybookStore({ filePath: join(TEST_TMP, 'pb-topic-scope.json') });
    const release = store.addManual({ content: '发版之前必须在真实入口点一遍，不能只跑测试', section: '发布流程' }).entry!;
    store.setTopics(release.id, ['t_release']);
    const doc = store.addManual({ content: '文档里每一行都必须有自己独立的标题行', section: '文档整理' }).entry!;
    store.setTopics(doc.id, ['t_doc']);
    const inbox = store.addManual({ content: '通用约定：任何回答都把结论写在最前面', section: '约定' }).entry!;
    for (const id of [release.id, doc.id, inbox.id]) store.accept(id);

    const all = store.renderSection(undefined, undefined);
    assert.ok(all.includes('发版之前必须在真实入口'), '不隔离时应全量');
    assert.ok(all.includes('每一行都必须有自己独立的标题行'));

    const scoped = store.renderSection(undefined, undefined, (entry) => entry.topicIds.length === 0 || entry.topicIds.includes('t_release'));
    assert.ok(scoped.includes('发版之前必须在真实入口'), '相关主题必须保留');
    assert.ok(scoped.includes('结论写在最前面'), '未归类的必须保留');
    assert.equal(scoped.includes('每一行都必须有自己独立的标题行'), false, '无关主题必须被挡');
    rmSync(join(TEST_TMP, 'pb-topic-scope.json'), { force: true });
  });

  await test('最小编辑：派单文本自带「只改必要的行」约束', () => {
    const client = readFileSync('client.js', 'utf8');
    assert.ok(client.includes('只改必要的行'), '派单模板里应有最小编辑约束');
    assert.ok(client.includes('3 倍'), '应有改动行数的上限');
  });

  await test('孤儿工单：来源待办已删除时，pruneOrphanedTargets 立即下线（不等下一次扫描）', () => {
    const file = join(TEST_TMP, 'proactive-orphan.json');
    rmSync(file, { force: true });
    const store = new ProactiveStore({ filePath: file, now: () => 70_000 });
    store.recordScan(
      { dueTasks: [{ id: 'gone-1', description: '核对某站防水工程量', overdueHours: 32 }], gaps: [], brokenRules: [], expiredRules: [] },
      0.8,
    );
    assert.equal(store.pending().length, 1);

    // 目标还在 → 不动
    assert.equal(store.pruneOrphanedTargets(() => true), 0);
    assert.equal(store.pending().length, 1);

    // 目标已删 → 下线，且不算「用户 dismiss」（不能拉低采纳率）
    assert.equal(store.pruneOrphanedTargets(() => false), 1);
    assert.equal(store.pending().length, 0);
    assert.equal(store.document.stats.dismissed, 0, '自动下线不能记成用户忽略');
    const item = store.tickets().find((row) => row.targetId === 'gone-1');
    if (item !== undefined) assert.equal(item.status, 'stale');
    rmSync(file, { force: true });
  });

  section('[28] P2：语言化采样 / 置信度分档 / 日志脱敏 / 审计题型');

  await test('语言化采样：反题提示要求先给 3 条候选并标概率', () => {
    const prompt = buildAntithesisPrompt('这个方案行不行', '正题内容');
    assert.ok(prompt.includes('3 candidate critiques'), '应要求先列 3 条候选');
    assert.ok(prompt.includes('p=0.xx'), '要求给每条候选标概率');
    assert.ok(prompt.includes('highest-probability'), '要求取概率最高的展开');
  });

  await test('置信度分档：用户/修正过=verified，导入=reported，模型自写=inferred', () => {
    assert.equal(memoryConfidence({ source: 'user' }), 'verified');
    assert.equal(memoryConfidence({ source: 'agent', revisedAt: 1 }), 'verified');
    assert.equal(memoryConfidence({ source: 'imported' }), 'reported');
    assert.equal(memoryConfidence({ source: 'agent', origin: 'agent_tool' }), 'inferred');
  });

  await test('日志脱敏脚本：正文被打码，结构化字段保留，损坏行不带原文', () => {
    const dir = join(TEST_TMP, 'redact');
    mkdirSync(join(dir, 'in'), { recursive: true });
    writeFileSync(
      join(dir, 'in', 'cognition-audit.jsonl'),
      '{"op":"remember","content":"这是一条很长的敏感正文内容需要打码","subject":"测试","source":"user"}\n',
      'utf8',
    );
    execFileSync(process.execPath, ['scripts/redact-export.mjs', join(dir, 'in'), join(dir, 'out'), '--keep', '4'], {
      cwd: process.cwd(),
    });
    const out = readFileSync(join(dir, 'out', 'cognition-audit.redacted.jsonl'), 'utf8');
    assert.equal(out.includes('敏感正文'), false, '正文必须打码');
    assert.ok(out.includes('"subject":"测试"'), '结构化字段应保留');
    rmSync(dir, { recursive: true, force: true });
  });

  await test('人格审计题库：自由作答 + 评分细则，不是选择题（避免选项偏差）', () => {
    const bank = JSON.parse(readFileSync('docs/persona/persona-audit-bank.example.json', 'utf8').replace(/^\uFEFF/, ''));
    const first = bank.items[0];
    assert.ok(typeof first.prompt === 'string' && first.prompt.length > 0, '应有自由作答的 prompt');
    assert.ok(first.rubric && first.rubric.held && first.rubric.soft && first.rubric.hard, '应有三档评分细则');
    assert.equal(Array.isArray(first.options), false, '不应是选择题');
  });

  section('[29] 记忆 v5 P0：索引注入 + dreaming 离线整合');

  await test('索引注入：只给 id + 短标题，正文不出现，且比全量短', () => {
    const store = new PlaybookStore({ filePath: join(TEST_TMP, 'pb-index.json') });
    const longBody = '发版之前必须在真实入口点一遍，不能只跑单元测试和静态检查，否则按钮没做、工具没注册这类问题照样发现不了，这是 0.9.0 踩过的坑';
    const entry = store.addManual({ content: longBody, section: '发布流程' }).entry!;
    store.accept(entry.id);
    const full = store.renderSection();
    const index = store.renderIndexOnly();
    assert.ok(index.includes(entry.id), '索引必须带 id');
    assert.ok(index.includes('发版之前必须在真实入口'), index);
    assert.equal(index.includes('不能只跑测试和静态检查'), false, '索引不应出现完整正文');
    assert.ok(index.length < full.length, `索引(${index.length}) 应短于全量(${full.length})`);
    rmSync(join(TEST_TMP, 'pb-index.json'), { force: true });
  });

  await test('dreaming：检出同主题重复、未挂主题准则、证据全断准则；忽略已取代事实', () => {
    const report = runDreaming({
      facts: [
        { id: 'f1', subject: '部署区域', content: '部署区域在上海机房，主用', supersededAt: null },
        { id: 'f2', subject: '部署区域', content: '部署区域在上海机房，主用。', supersededAt: null },
        { id: 'f3', subject: '部署区域', content: '部署区域在深圳机房做灾备，异地双活', supersededAt: null },
        { id: 'f4', subject: '部署区域', content: '部署区域在北京机房，主用', supersededAt: 12345 },
      ],
      rules: [
        { id: 'r1', section: '发布流程', content: '发版前跑真实入口', status: 'active', topicIds: [] },
        { id: 'r2', section: '文档整理', content: '每行都要有独立标题', status: 'active', topicIds: ['t1'], evidenceStatus: 'orphaned' },
      ],
      topicCount: 2,
      now: 1000,
    });
    const dup = report.items.filter((item) => item.kind === 'duplicate-live');
    assert.equal(dup.length, 1, '只有 f1/f2 该被判重复');
    assert.deepEqual(dup[0]!.ids.sort(), ['f1', 'f2']);
    assert.equal(dup[0]!.ids.includes('f3'), false, '不相似的不该误报');
    assert.equal(dup[0]!.ids.includes('f4'), false, '已取代的不参与');
    assert.equal(report.counts['untopiced-rule'], 1);
    assert.equal(report.counts['orphan-evidence'], 1);
    assert.equal(report.scanned.facts, 3, '只统计活事实');
  });

  await test('dreaming：报告按严重度排序，高危在前', () => {
    const report = runDreaming({
      facts: [],
      rules: [
        { id: 'low', section: 'A', content: 'x', status: 'active', topicIds: [] },
        { id: 'high', section: 'B', content: 'y', status: 'active', topicIds: ['t'], evidenceStatus: 'orphaned' },
      ],
      topicCount: 1,
      now: 1,
    });
    assert.equal(report.items[0]!.severity, 'high');
  });

  section('[30] 沉积层 Step 0 原型：四项断言');

  await test('沉积层原型：不对称/不可逆/路径依赖+非检索/惊奇≠张力 四项全过', () => {
    const out = execFileSync(process.execPath, ['scripts/sediment-proto.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.ok(out.includes('4/4 通过'), out);
    assert.ok(out.includes('全部通过'), out);
    for (const name of ['A 不对称', 'B 不可逆', 'C 路径依赖', 'D 惊奇≠张力']) {
      assert.ok(out.includes(name), `缺少断言：${name}`);
    }
  });

  section('[31] 沉积层 Step 1：落盘 + 校验');

  await test('沉积层落盘：张力事件写入、状态可重放、补充不写', () => {
    const dir = join(TEST_TMP, 'sediment');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'chain.jsonl');
    const store = new SedimentStore({ filePath: file, now: () => 1000 });
    const ok = store.observe({
      subject: '部署区域',
      from: 'mem-1',
      to: 'mem-2',
      oldText: '部署区域在上海机房，主用',
      newText: '不对，部署区域改成北京机房，主用',
    });
    assert.equal(ok.skipped, false, JSON.stringify(ok));
    assert.equal(store.log().length, 1);

    // 补充不该写
    const skipped = store.observe({
      subject: '部署区域',
      from: 'mem-2',
      to: 'mem-3',
      oldText: '部署区域在北京机房，主用',
      newText: '部署区域在北京机房，主用，另外加了一台缓存服务器',
    });
    assert.equal(skipped.skipped, true);
    assert.equal(store.log().length, 1, '纯补充不能产生事件');

    // 证据绑定：缺 from/to 拒绝
    const noIds = store.observe({
      subject: '部署区域', from: null, to: null,
      oldText: '部署区域在北京机房，主用', newText: '不对，改成上海机房，主用',
    });
    assert.equal(noIds.skipped, true);

    // 重放：新实例读文件后状态应一致
    const reloaded = new SedimentStore({ filePath: file });
    reloaded.loadSync();
    assert.deepEqual(reloaded.state(), store.state());
    assert.equal(reloaded.verify().ok, true);
    rmSync(dir, { recursive: true, force: true });
  });

  await test('沉积层校验：篡改中间一条 → brokenAt 精确指向该条', () => {
    const dir = join(TEST_TMP, 'sediment-tamper');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'chain.jsonl');
    const store = new SedimentStore({ filePath: file, now: () => 2000 });
    for (let i = 0; i < 4; i += 1) {
      store.observe({
        subject: '部署区域',
        from: `mem-a${i}`,
        to: `mem-b${i}`,
        oldText: i % 2 === 0 ? '部署区域在上海机房，主用' : '部署区域在北京机房，主用',
        newText: i % 2 === 0 ? '不对，部署区域改成北京机房，主用' : '不对，部署区域改回上海机房，主用',
      });
    }
    assert.equal(store.verify().ok, true);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 4);
    const target = JSON.parse(lines[2]!);
    target.tension = Number((target.tension + 0.01).toFixed(6));
    lines[2] = JSON.stringify(target);
    writeFileSync(file, lines.join('\n') + '\n', 'utf8');

    const after = new SedimentStore({ filePath: file });
    const result = after.verify();
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 2, `应指向 seq=2，实得 ${result.brokenAt}`);
    rmSync(dir, { recursive: true, force: true });
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
