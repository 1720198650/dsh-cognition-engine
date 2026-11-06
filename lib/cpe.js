/**
 * src/cpe.ts — CPE 回归闸门（S5）
 *
 * ## 为什么这是整个计划里唯一的「差异化」
 *
 * 2026 年自我进化领域最大的发现是**能力侵蚀**（arXiv 2605.09315）：
 * 适应新任务会逐步侵蚀旧能力，workflow / skill / model / memory 四条通道都会。
 * 别人追求「越学越强」，我们追求**「越学越稳」**。
 *
 * 落地形态是一个**冻结回归集 + 变更闸门**：
 *
 *   变更前 → 快照 → 应用变更 → 跑回归集 → 掉分超过阈值就回滚
 *
 * ## 三条从论文实证里来的设计约束
 *
 * 1. **阈值按「超过基线多少」判，不能看单点**。论文里 memory 通道是
 *    83.9 → 81.6 → 83.3：先掉分再回升。单点比会在 81.6 误判成能力侵蚀，
 *    把一次正常调整回滚掉。
 * 2. **回归集必须冻结，且永不参与候选生成**（`neverUsedForGeneration: true`）。
 *    否则测的是「它记住了测试集」，不是「它没变差」。
 * 3. **阈值不能卡在噪声里**。记忆通道自然波动约 ±2.3pp，
 *    `maxDrop` 若设 0.02 就是纯噪声报警；默认 0.10。
 *
 * ## 这里的「回归」怎么测（不调 LLM，零成本）
 *
 * 每个用例是「一个问题 + 应该被检索到的准则 id」。
 * 评测 = 把当前生效准则按与问题的相似度排序，看期望的准则是否还在前 K 名。
 *
 * 这测的是一件很具体的事：**加了新准则之后，原来该命中的准则有没有被挤出去**。
 * 它不需要模型、不需要网络、跑一遍是毫秒级。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataFile } from "./util.js";
const DEFAULT_THRESHOLDS = { maxDrop: 0.1, minCases: 20, topK: 3 };
/** 事故记录上限，防止文件无限长。 */
const MAX_INCIDENTS = 100;
function emptyDoc() {
    return {
        schema: 'cognition.cpe',
        version: 1,
        holdout: { cases: [], frozenAt: null, neverUsedForGeneration: true },
        baseline: null,
        thresholds: { ...DEFAULT_THRESHOLDS },
        lastCheck: null,
        incidents: [],
    };
}
export class CpeStore {
    filePath;
    clock;
    doc = emptyDoc();
    loaded = false;
    saveError;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-cpe.json') : resolve(options.filePath);
        this.clock = options.now ?? (() => Date.now());
    }
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        try {
            if (!existsSync(this.filePath))
                return false;
            const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.cpe')
                return false;
            const cases = Array.isArray(raw.holdout?.cases)
                ? raw.holdout.cases.filter((item) => item !== null &&
                    typeof item === 'object' &&
                    typeof item.question === 'string' &&
                    Array.isArray(item.expectedRuleIds))
                : [];
            this.doc = {
                schema: 'cognition.cpe',
                version: 1,
                holdout: {
                    cases,
                    frozenAt: typeof raw.holdout?.frozenAt === 'number' ? raw.holdout.frozenAt : null,
                    neverUsedForGeneration: true,
                },
                baseline: raw.baseline ?? null,
                thresholds: { ...DEFAULT_THRESHOLDS, ...(raw.thresholds ?? {}) },
                lastCheck: raw.lastCheck ?? null,
                incidents: Array.isArray(raw.incidents) ? raw.incidents.slice(-MAX_INCIDENTS) : [],
            };
            return true;
        }
        catch {
            this.doc = emptyDoc();
            return false;
        }
    }
    get path() {
        return this.filePath;
    }
    get lastSaveError() {
        return this.saveError;
    }
    get document() {
        this.loadSync();
        return this.doc;
    }
    cases() {
        this.loadSync();
        return [...this.doc.holdout.cases];
    }
    /** 新增用例。冻结后拒绝（避免边测边改用例，等于给自己放水）。 */
    addCase(input) {
        this.loadSync();
        const question = input.question.trim();
        const expected = input.expectedRuleIds.map((id) => id.trim()).filter((id) => id.length > 0);
        if (question.length === 0)
            return { rejected: '问题不能为空' };
        if (expected.length === 0)
            return { rejected: '至少要指定一个期望命中的准则 id' };
        if (this.doc.holdout.frozenAt !== null) {
            return { rejected: '回归集已冻结：新增用例请先 unfreeze，改完再冻结（冻结后才可信）' };
        }
        const duplicate = this.doc.holdout.cases.find((item) => item.question === question && item.expectedRuleIds.join(',') === expected.join(','));
        if (duplicate !== undefined)
            return { case: duplicate };
        const entry = {
            id: `case-${randomUUID().slice(0, 8)}`,
            question,
            expectedRuleIds: expected,
            ...(input.note === undefined ? {} : { note: input.note }),
            derivedFrom: input.by ?? 'user',
        };
        this.doc.holdout.cases.push(entry);
        this.#save();
        return { case: entry };
    }
    removeCase(id) {
        this.loadSync();
        if (this.doc.holdout.frozenAt !== null)
            return false;
        const before = this.doc.holdout.cases.length;
        this.doc.holdout.cases = this.doc.holdout.cases.filter((item) => item.id !== id);
        if (this.doc.holdout.cases.length === before)
            return false;
        this.#save();
        return true;
    }
    /**
     * 从现有准则派生一批起步用例。
     *
     * **这是弱数据**：用准则自己的内容当问题去测它自己，等于开卷考试。
     * 所以打上 `derivedFrom: 'rules'`，并在 `check()` 里提示「建议换成用户手标的用例」。
     * 有总比没有强——它能抓住「加新准则把旧的挤出去」这类回归。
     */
    seedFromRules(rules) {
        this.loadSync();
        let added = 0;
        let skipped = 0;
        for (const rule of rules) {
            const question = rule.content.slice(0, 60);
            const result = this.addCase({ question, expectedRuleIds: [rule.id], note: '从准则自动派生', by: 'rules' });
            if (result.case !== undefined && result.case.derivedFrom === 'rules')
                added += 1;
            else
                skipped += 1;
        }
        return { added, skipped };
    }
    freeze() {
        this.loadSync();
        this.doc.holdout.frozenAt = this.clock();
        this.#save();
        return { ok: true, frozenAt: this.doc.holdout.frozenAt, cases: this.doc.holdout.cases.length };
    }
    unfreeze() {
        this.loadSync();
        this.doc.holdout.frozenAt = null;
        this.#save();
        return { ok: true };
    }
    /**
     * 跑一遍回归集。
     *
     * `resolver(question)` 返回**按相关度降序的准则 id 列表**（由调用方用当前准则本现算）。
     * 期望 id 全部落在前 `topK` 名才算通过。
     */
    evaluate(resolver) {
        this.loadSync();
        const cases = this.doc.holdout.cases;
        if (cases.length === 0)
            return { passRate: null, total: 0, passed: 0, failures: [] };
        const topK = Math.max(1, this.doc.thresholds.topK);
        let passed = 0;
        const failures = [];
        for (const item of cases) {
            const ranked = resolver(item.question);
            const top = ranked.slice(0, topK);
            const ok = item.expectedRuleIds.every((id) => top.includes(id));
            if (ok)
                passed += 1;
            else
                failures.push({ caseId: item.id, question: item.question, expected: [...item.expectedRuleIds], got: top });
        }
        return { passRate: Number((passed / cases.length).toFixed(4)), total: cases.length, passed, failures };
    }
    /** 测一次并写入基线。基线只能在「当前状态被认为正确」时打。 */
    measureBaseline(resolver) {
        this.loadSync();
        const result = this.evaluate(resolver);
        if (result.passRate === null)
            return { ok: false, reason: '回归集是空的，先加用例' };
        if (result.total < this.doc.thresholds.minCases) {
            return {
                ok: false,
                reason: `用例太少（${result.total}/${this.doc.thresholds.minCases}），此时打基线等于把噪声当标准`,
            };
        }
        const baseline = {
            passRate: result.passRate,
            measuredAt: this.clock(),
            cases: result.total,
            topK: this.doc.thresholds.topK,
        };
        this.doc.baseline = baseline;
        this.#save();
        return { ok: true, baseline };
    }
    /** 与基线比较。用例不足或缺基线时明确说 insufficient/无基线，不编分数。 */
    check(resolver) {
        this.loadSync();
        const result = this.evaluate(resolver);
        const { minCases, maxDrop } = this.doc.thresholds;
        if (result.total < minCases || result.passRate === null) {
            const note = result.total === 0
                ? '回归集为空：先在 S5 页面/接口加用例，或从现有准则派生起步集'
                : `用例不足（${result.total}/${minCases}），不做判断`;
            const check = { at: this.clock(), passRate: result.passRate, status: 'insufficient', delta: null, failures: result.failures, note, cases: result.total };
            this.doc.lastCheck = check;
            this.#save();
            return check;
        }
        if (this.doc.baseline === null) {
            const check = {
                at: this.clock(),
                passRate: result.passRate,
                status: 'green',
                delta: null,
                failures: result.failures,
                note: '还没有基线：当前值仅供参考，确认状态正确后请 measureBaseline',
                cases: result.total,
            };
            this.doc.lastCheck = check;
            this.#save();
            return check;
        }
        const delta = Number((result.passRate - this.doc.baseline.passRate).toFixed(4));
        let status = 'green';
        if (delta < -maxDrop)
            status = 'red';
        else if (delta < -maxDrop / 2)
            status = 'yellow';
        const derivedCount = this.doc.holdout.cases.filter((item) => item.derivedFrom === 'rules').length;
        const note = status === 'red'
            ? `能力侵蚀：从 ${this.doc.baseline.passRate} 掉到 ${result.passRate}（${(delta * 100).toFixed(1)}pp，阈值 -${(maxDrop * 100).toFixed(0)}pp）`
            : status === 'yellow'
                ? `轻微下降 ${(delta * 100).toFixed(1)}pp，连续观察，暂不回滚`
                : `回归通过（${result.passRate}，基线 ${this.doc.baseline.passRate}）`;
        const check = {
            at: this.clock(),
            passRate: result.passRate,
            status,
            delta,
            failures: result.failures,
            note: derivedCount > 0 ? `${note}；注意有 ${derivedCount} 条用例是自动派生的，建议换成手标用例` : note,
            cases: result.total,
        };
        this.doc.lastCheck = check;
        this.#save();
        return check;
    }
    recordIncident(input) {
        this.loadSync();
        this.doc.incidents = [
            ...this.doc.incidents,
            {
                at: this.clock(),
                label: input.label,
                before: input.before,
                after: input.after,
                dropped: input.dropped,
                rolledBack: input.rolledBack,
                ...(input.detail === undefined ? {} : { detail: input.detail }),
            },
        ].slice(-MAX_INCIDENTS);
        this.#save();
    }
    /* ------------------------ 变更前后快照 / 回滚 ------------------------ */
    snapshotFiles(paths) {
        const snap = {};
        for (const path of paths) {
            try {
                snap[path] = existsSync(path) ? readFileSync(path, 'utf8') : null;
            }
            catch {
                snap[path] = null;
            }
        }
        return snap;
    }
    restoreFiles(snap) {
        const restored = [];
        const failed = [];
        for (const [path, content] of Object.entries(snap)) {
            try {
                if (content === null) {
                    // 原本不存在：尽力删掉变更期间新建的文件
                    try {
                        if (existsSync(path))
                            writeFileSync(path, '', 'utf8');
                    }
                    catch {
                        /* ignore */
                    }
                }
                else {
                    mkdirSync(dirname(resolve(path)), { recursive: true });
                    writeFileSync(path, content, 'utf8');
                }
                restored.push(path);
            }
            catch {
                failed.push(path);
            }
        }
        return { restored, failed };
    }
    #save() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(this.doc, null, 2) + '\n', 'utf8');
            this.saveError = undefined;
        }
        catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
        }
    }
}
