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
import { resolveDataFile } from './util.ts';

/** 一条回归用例。 */
export interface CpeCase {
  id: string;
  question: string;
  /** 期望出现在前 K 名的准则 id。 */
  expectedRuleIds: string[];
  note?: string;
  /** user = 用户亲手标；rules = 从现有准则自动派生（弱，仅作起步）。 */
  derivedFrom: 'user' | 'rules';
}

export interface CpeBaseline {
  passRate: number;
  measuredAt: number;
  cases: number;
  topK: number;
}

export interface CpeThresholds {
  /** 允许相对基线掉多少（0.10 = 10 个百分点）。 */
  maxDrop: number;
  /** 用例少于此数一律 insufficient，不给分数。 */
  minCases: number;
  /** 命中前 K 名算通过。 */
  topK: number;
}

export interface CpeIncident {
  at: number;
  label: string;
  before: number | null;
  after: number | null;
  dropped: number | null;
  rolledBack: boolean;
  detail?: string;
}

export interface CpeFailure {
  caseId: string;
  question: string;
  expected: string[];
  got: string[];
}

export type CpeStatus = 'insufficient' | 'green' | 'yellow' | 'red';

/**
 * 反作弊标记。
 *
 * 依据：ICLR 2025 Oral《Cheating Automatic LLM Benchmarks》(arXiv:2410.07137)——
 * 一个对任何输入都返回同一段文本的「null model」能在 AlpacaEval 2.0 拿到 86.5% 的
 * length-controlled 胜率；改写评测模板、加困惑度过滤都挡不住。
 *
 * 我们的回归集是「问题 → 应该被检索到的准则 id」，对应的作弊形态就是
 * **对每个问题都返回同一个排名**（恒定 top-1）。那不是「检索准」，是没在检索。
 */
export type CpeAntiCheat = 'constant-ranking';

/**
 * 恒定排名检测：用例数 ≥ 3 且所有用例的 top-1 完全相同。
 *
 * 阈值定 3 是因为 1~2 条时同分撞车属正常；3 条以上还完全一致基本不可能是巧合。
 */
export function detectsConstantRanking(top1s: readonly string[]): boolean {
  if (top1s.length < 3) return false;
  const first = top1s[0];
  return top1s.every((id) => id === first);
}

export interface CpeCheck {
  at: number;
  passRate: number | null;
  status: CpeStatus;
  delta: number | null;
  failures: CpeFailure[];
  note: string;
  cases: number;
  /** 反作弊标记；非空表示这次结果不可信（详见 CpeAntiCheat）。 */
  antiCheat?: CpeAntiCheat;
}

export interface CpeDoc {
  schema: 'cognition.cpe';
  version: 1;
  holdout: {
    cases: CpeCase[];
    /** 冻结时间；冻结后新增用例要先解冻，避免「边测边改」。 */
    frozenAt: number | null;
    neverUsedForGeneration: true;
  };
  baseline: CpeBaseline | null;
  thresholds: CpeThresholds;
  lastCheck: CpeCheck | null;
  incidents: CpeIncident[];
}

export interface CpeStoreOptions {
  filePath?: string;
  now?: () => number;
}

const DEFAULT_THRESHOLDS: CpeThresholds = { maxDrop: 0.1, minCases: 20, topK: 3 };
/** 事故记录上限，防止文件无限长。 */
const MAX_INCIDENTS = 100;

function emptyDoc(): CpeDoc {
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

/** 文件快照：路径 → 内容（null 表示文件原本不存在）。 */
export type FileSnapshot = Record<string, string | null>;

/**
 * 严格闸门下，这次检查结果是否应该**拦住**新准则启用。
 *
 * 只拦 `insufficient`——也就是「测不出来」。`green/yellow` 放行，`red` 由调用方走回滚逻辑。
 *
 * 为什么把「测不出来」当拦：一个测不出来的闸门，通过它等于没有闸门。
 * 同类做法见 NeMo 质量门（基准缺失即判失败）与 ai_eval（空题集 passed_gate=FALSE，
 * 不给 0 分当及格）。
 */
export function blocksAcceptance(status: CpeStatus, strict: boolean): boolean {
  return strict && status === 'insufficient';
}

export class CpeStore {
  private readonly filePath: string;
  private readonly clock: () => number;
  private doc: CpeDoc = emptyDoc();
  private loaded = false;
  private saveError: string | undefined;

  constructor(options: CpeStoreOptions = {}) {
    this.filePath = options.filePath === undefined ? resolveDataFile('cognition-cpe.json') : resolve(options.filePath);
    this.clock = options.now ?? (() => Date.now());
  }

  loadSync(): boolean {
    if (this.loaded) return true;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return false;
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<CpeDoc>;
      if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.cpe') return false;
      const cases = Array.isArray(raw.holdout?.cases)
        ? raw.holdout.cases.filter(
            (item): item is CpeCase =>
              item !== null &&
              typeof item === 'object' &&
              typeof (item as CpeCase).question === 'string' &&
              Array.isArray((item as CpeCase).expectedRuleIds),
          )
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
    } catch {
      this.doc = emptyDoc();
      return false;
    }
  }

  get path(): string {
    return this.filePath;
  }

  get lastSaveError(): string | undefined {
    return this.saveError;
  }

  get document(): CpeDoc {
    this.loadSync();
    return this.doc;
  }

  cases(): CpeCase[] {
    this.loadSync();
    return [...this.doc.holdout.cases];
  }

  /** 新增用例。冻结后拒绝（避免边测边改用例，等于给自己放水）。 */
  addCase(input: { question: string; expectedRuleIds: string[]; note?: string; by?: 'user' | 'rules' }): {
    case?: CpeCase;
    rejected?: string;
  } {
    this.loadSync();
    const question = input.question.trim();
    const expected = input.expectedRuleIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (question.length === 0) return { rejected: '问题不能为空' };
    if (expected.length === 0) return { rejected: '至少要指定一个期望命中的准则 id' };
    if (this.doc.holdout.frozenAt !== null) {
      return { rejected: '回归集已冻结：新增用例请先 unfreeze，改完再冻结（冻结后才可信）' };
    }
    const duplicate = this.doc.holdout.cases.find(
      (item) => item.question === question && item.expectedRuleIds.join(',') === expected.join(','),
    );
    if (duplicate !== undefined) return { case: duplicate };
    const entry: CpeCase = {
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

  removeCase(id: string): boolean {
    this.loadSync();
    if (this.doc.holdout.frozenAt !== null) return false;
    const before = this.doc.holdout.cases.length;
    this.doc.holdout.cases = this.doc.holdout.cases.filter((item) => item.id !== id);
    if (this.doc.holdout.cases.length === before) return false;
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
  seedFromRules(rules: readonly { id: string; content: string }[]): { added: number; skipped: number } {
    this.loadSync();
    let added = 0;
    let skipped = 0;
    for (const rule of rules) {
      const question = rule.content.slice(0, 60);
      const result = this.addCase({ question, expectedRuleIds: [rule.id], note: '从准则自动派生', by: 'rules' });
      if (result.case !== undefined && result.case.derivedFrom === 'rules') added += 1;
      else skipped += 1;
    }
    return { added, skipped };
  }

  freeze(): { ok: boolean; frozenAt: number | null; cases: number } {
    this.loadSync();
    this.doc.holdout.frozenAt = this.clock();
    this.#save();
    return { ok: true, frozenAt: this.doc.holdout.frozenAt, cases: this.doc.holdout.cases.length };
  }

  unfreeze(): { ok: boolean } {
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
  evaluate(resolver: (question: string) => string[]): {
    passRate: number | null;
    total: number;
    passed: number;
    failures: CpeFailure[];
    /** 反作弊判定：null = 正常；'constant-ranking' = 疑似被恒定输出刷分。 */
    antiCheat: CpeAntiCheat | null;
  } {
    this.loadSync();
    const cases = this.doc.holdout.cases;
    if (cases.length === 0) return { passRate: null, total: 0, passed: 0, failures: [], antiCheat: null };
    const topK = Math.max(1, this.doc.thresholds.topK);
    let passed = 0;
    const failures: CpeFailure[] = [];
    const top1s: string[] = [];
    for (const item of cases) {
      const ranked = resolver(item.question);
      const top = ranked.slice(0, topK);
      if (top.length > 0 && top[0] !== undefined) top1s.push(top[0]);
      const ok = item.expectedRuleIds.every((id) => top.includes(id));
      if (ok) passed += 1;
      else failures.push({ caseId: item.id, question: item.question, expected: [...item.expectedRuleIds], got: top });
    }
    return {
      passRate: Number((passed / cases.length).toFixed(4)),
      total: cases.length,
      passed,
      failures,
      antiCheat: detectsConstantRanking(top1s) ? 'constant-ranking' : null,
    };
  }

  /** 测一次并写入基线。基线只能在「当前状态被认为正确」时打。 */
  measureBaseline(resolver: (question: string) => string[]): {
    ok: boolean;
    baseline?: CpeBaseline;
    reason?: string;
    check?: CpeCheck;
  } {
    this.loadSync();
    const result = this.evaluate(resolver);
    if (result.passRate === null) return { ok: false, reason: '回归集是空的，先加用例' };
    if (result.total < this.doc.thresholds.minCases) {
      return {
        ok: false,
        reason: `用例太少（${result.total}/${this.doc.thresholds.minCases}），此时打基线等于把噪声当标准`,
      };
    }
    const baseline: CpeBaseline = {
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
  check(resolver: (question: string) => string[]): CpeCheck {
    this.loadSync();
    const result = this.evaluate(resolver);
    const { minCases, maxDrop } = this.doc.thresholds;

    if (result.total < minCases || result.passRate === null) {
      const note =
        result.total === 0
          ? '回归集为空：先在 S5 页面/接口加用例，或从现有准则派生起步集'
          : `用例不足（${result.total}/${minCases}），不做判断`;
      const check: CpeCheck = { at: this.clock(), passRate: result.passRate, status: 'insufficient', delta: null, failures: result.failures, note, cases: result.total };
      this.doc.lastCheck = check;
      this.#save();
      return check;
    }

    // 反作弊：恒定排名 = 评测失效，直接判红，不参与基线比较。
    // 否则「所有问题都返回同一条准则」会稳定拿高分，闸门形同虚设。
    if (result.antiCheat !== null) {
      const check: CpeCheck = {
        at: this.clock(),
        passRate: result.passRate,
        status: 'red',
        delta: null,
        failures: result.failures,
        note: '评测疑似被恒定输出刷分：所有用例的 top-1 完全相同，这次分数不可信，已判红',
        cases: result.total,
        antiCheat: result.antiCheat,
      };
      this.doc.lastCheck = check;
      this.#save();
      return check;
    }

    if (this.doc.baseline === null) {
      const check: CpeCheck = {
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
    let status: CpeCheck['status'] = 'green';
    if (delta < -maxDrop) status = 'red';
    else if (delta < -maxDrop / 2) status = 'yellow';
    const derivedCount = this.doc.holdout.cases.filter((item) => item.derivedFrom === 'rules').length;
    const note =
      status === 'red'
        ? `能力侵蚀：从 ${this.doc.baseline.passRate} 掉到 ${result.passRate}（${(delta * 100).toFixed(1)}pp，阈值 -${(maxDrop * 100).toFixed(0)}pp）`
        : status === 'yellow'
          ? `轻微下降 ${(delta * 100).toFixed(1)}pp，连续观察，暂不回滚`
          : `回归通过（${result.passRate}，基线 ${this.doc.baseline.passRate}）`;
    const check: CpeCheck = {
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

  recordIncident(input: { label: string; before: number | null; after: number | null; dropped: number | null; rolledBack: boolean; detail?: string }): void {
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

  snapshotFiles(paths: readonly string[]): FileSnapshot {
    const snap: FileSnapshot = {};
    for (const path of paths) {
      try {
        snap[path] = existsSync(path) ? readFileSync(path, 'utf8') : null;
      } catch {
        snap[path] = null;
      }
    }
    return snap;
  }

  restoreFiles(snap: FileSnapshot): { restored: string[]; failed: string[] } {
    const restored: string[] = [];
    const failed: string[] = [];
    for (const [path, content] of Object.entries(snap)) {
      try {
        if (content === null) {
          // 原本不存在：尽力删掉变更期间新建的文件
          try {
            if (existsSync(path)) writeFileSync(path, '', 'utf8');
          } catch {
            /* ignore */
          }
        } else {
          mkdirSync(dirname(resolve(path)), { recursive: true });
          writeFileSync(path, content, 'utf8');
        }
        restored.push(path);
      } catch {
        failed.push(path);
      }
    }
    return { restored, failed };
  }

  #save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.doc, null, 2) + '\n', 'utf8');
      this.saveError = undefined;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error);
    }
  }
}
