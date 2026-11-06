/**
 * src/retrieval.ts — 检索度量（S8）
 *
 * ## 为什么这一步比前面所有优化都值钱
 *
 * BM25 调研的最后一条建议是：「**先用最近 100 次真实召回人工标 top-3**——
 * 这一步比报告里所有建议都值钱。」
 *
 * 前三轮评测全是**合成数据**：自己造查询、自己定标准答案，然后宣布召回率 90%+。
 * 那只证明代码符合我的假设，不证明它在你身上有用。S8 干的就是把这件事变成
 * 「真实查询 + 真人标注 + 可复现的 Top-1/Top-3」。
 *
 * ## 三个东西
 *
 * 1. **召回日志**（自动）：每次调 `cognition_recall` 记下查询、模式、返回的 top-N id 与分数。
 * 2. **标注集**（人工）：给某条查询标「应该命中哪些 id」。这才是金标准。
 * 3. **指标**：Top-1 / Top-3 准确率 + 误召回清单（哪些查询完全没召回到东西）。
 *
 * ## 一条硬规矩
 *
 * **标注集不参与任何调参**。它只回答「现在准不准」，不参与「把参数调到它上面好看」。
 * 一旦拿它调 BM25 的 k1/b，它就退化成训练集，下次报的数就没意义了。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataFile } from './util.ts';

/** 一次召回记录（一行 JSONL）。 */
export interface RecallRecord {
  at: number;
  query: string;
  mode: string;
  /** 返回的 id（按顺序，最多 5 个）。 */
  ids: string[];
  /** 对应的分数（与 ids 等长）。 */
  scores: number[];
  /** 一共返回了多少条。 */
  count: number;
  /** 是否开了 render（render 走另一条分支，也记）。 */
  rendered?: boolean;
}

/** 一条标注用例。 */
export interface EvalCase {
  id: string;
  query: string;
  /** 期望被召回的 id（金标准）。 */
  expectedIds: string[];
  /** 也可标「这条查询本来就不该召回任何东西」。 */
  expectEmpty?: boolean;
  createdAt: number;
  note?: string;
  source: 'user' | 'auto';
}

export interface RetrievalDoc {
  schema: 'cognition.recall.eval';
  version: 1;
  cases: EvalCase[];
  updatedAt: number;
}

export interface RetrievalMetrics {
  /** 参与计算的用例数（有期望 id 或 expectEmpty）。 */
  cases: number;
  top1: number | null;
  top3: number | null;
  /** 完全召回空的查询占比（越接近 0 越好）。 */
  emptyRate: number | null;
  /** 目标值，页面上直接显示差距。 */
  targets: { top1: number; top3: number };
  status: 'insufficient' | 'green' | 'yellow' | 'red';
  note: string;
}

export interface RetrievalMetricsResult extends RetrievalMetrics {
  /** 没通过的用例，给人看「错在哪」。 */
  misses: Array<{ caseId: string; query: string; expected: string[]; got: string[] }>;
}

export interface RecallLogOptions {
  filePath?: string;
  now?: () => number;
  /** 内存/文件读取时的窗口：只看最近多少条。 */
  window?: number;
}

export class RecallLog {
  private readonly filePath: string;
  private readonly clock: () => number;
  private readonly window: number;
  private rows: RecallRecord[] = [];
  private loaded = false;
  private saveError: string | undefined;

  constructor(options: RecallLogOptions = {}) {
    this.filePath = options.filePath === undefined ? resolveDataFile('cognition-recall.jsonl') : resolve(options.filePath);
    this.clock = options.now ?? (() => Date.now());
    this.window = options.window ?? 500;
  }

  loadSync(): boolean {
    if (this.loaded) return true;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return false;
      const out: RecallRecord[] = [];
      for (const line of readFileSync(this.filePath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const row = JSON.parse(trimmed) as RecallRecord;
          if (typeof row.query === 'string' && Array.isArray(row.ids)) out.push(row);
        } catch {
          /* 坏行跳过 */
        }
      }
      this.rows = out.slice(-this.window);
      return out.length > 0;
    } catch {
      return false;
    }
  }

  get path(): string {
    return this.filePath;
  }

  get lastSaveError(): string | undefined {
    return this.saveError;
  }

  /** 记一次召回。**只记 id 和分数，不记记忆正文**——正文在 state 文件里，不必抄一份。 */
  record(input: { query: string; mode: string; ids: string[]; scores?: number[]; count?: number; rendered?: boolean }): void {
    this.loadSync();
    const ids = input.ids.slice(0, 5);
    const row: RecallRecord = {
      at: this.clock(),
      query: input.query,
      mode: input.mode,
      ids,
      scores: (input.scores ?? []).slice(0, ids.length),
      count: input.count ?? ids.length,
      ...(input.rendered === true ? { rendered: true } : {}),
    };
    this.rows.push(row);
    if (this.rows.length > this.window) this.rows.shift();
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify(row) + '\n', 'utf8');
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error);
    }
  }

  recent(limit = 20): RecallRecord[] {
    this.loadSync();
    return this.rows.slice(-limit).reverse();
  }

  /** 基本盘：总量、零结果率、平均返回条数。不需要人工标注就能算。 */
  overview(): { total: number; zeroResult: number; zeroRate: number; avgCount: number; byMode: Record<string, number> } {
    this.loadSync();
    let zero = 0;
    let sum = 0;
    const byMode: Record<string, number> = {};
    for (const row of this.rows) {
      if (row.count === 0) zero += 1;
      sum += row.count;
      byMode[row.mode] = (byMode[row.mode] ?? 0) + 1;
    }
    const total = this.rows.length;
    return {
      total,
      zeroResult: zero,
      zeroRate: total === 0 ? 0 : Number((zero / total).toFixed(3)),
      avgCount: total === 0 ? 0 : Number((sum / total).toFixed(2)),
      byMode,
    };
  }

  /** 还没被标注过的最近查询（给标注工作流用）。 */
  unannotated(annotatedQueries: ReadonlySet<string>, limit = 20): RecallRecord[] {
    this.loadSync();
    const seen = new Set<string>();
    const out: RecallRecord[] = [];
    for (let i = this.rows.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const row = this.rows[i]!;
      if (annotatedQueries.has(row.query) || seen.has(row.query)) continue;
      seen.add(row.query);
      out.push(row);
    }
    return out;
  }
}

export interface RetrievalStoreOptions {
  filePath?: string;
  now?: () => number;
  /** 少于这么多条标注一律 insufficient。 */
  minCases?: number;
}

export class RetrievalEvalStore {
  private readonly filePath: string;
  private readonly clock: () => number;
  private readonly minCases: number;
  private doc: RetrievalDoc;
  private loaded = false;
  private saveError: string | undefined;

  constructor(options: RetrievalStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined ? resolveDataFile('cognition-recall-eval.json') : resolve(options.filePath);
    this.clock = options.now ?? (() => Date.now());
    this.minCases = options.minCases ?? 20;
    this.doc = { schema: 'cognition.recall.eval', version: 1, cases: [], updatedAt: this.clock() };
  }

  loadSync(): boolean {
    if (this.loaded) return true;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return false;
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<RetrievalDoc>;
      if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.recall.eval') return false;
      this.doc = {
        schema: 'cognition.recall.eval',
        version: 1,
        cases: Array.isArray(raw.cases)
          ? raw.cases.filter((c): c is EvalCase => c !== null && typeof c === 'object' && typeof (c as EvalCase).query === 'string')
          : [],
        updatedAt: Number(raw.updatedAt ?? this.clock()),
      };
      return true;
    } catch {
      return false;
    }
  }

  get path(): string {
    return this.filePath;
  }

  get lastSaveError(): string | undefined {
    return this.saveError;
  }

  get minCasesRequired(): number {
    return this.minCases;
  }

  cases(): EvalCase[] {
    this.loadSync();
    return [...this.doc.cases];
  }

  /** 加一条标注。同 query 覆盖旧的（同一查询只保留最新一次标注）。 */
  addCase(input: { query: string; expectedIds?: string[]; expectEmpty?: boolean; note?: string; source?: 'user' | 'auto' }): {
    case?: EvalCase;
    rejected?: string;
  } {
    this.loadSync();
    const query = input.query.trim();
    if (query.length === 0) return { rejected: '查询不能为空' };
    const expected = (input.expectedIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
    if (expected.length === 0 && input.expectEmpty !== true) {
      return { rejected: '要么给期望 id，要么显式标 expectEmpty（本来就不该召回任何东西）' };
    }
    this.doc.cases = this.doc.cases.filter((item) => item.query !== query);
    const entry: EvalCase = {
      id: `rv-${randomUUID().slice(0, 8)}`,
      query,
      expectedIds: expected,
      ...(input.expectEmpty === true ? { expectEmpty: true } : {}),
      createdAt: this.clock(),
      ...(input.note === undefined ? {} : { note: input.note }),
      source: input.source ?? 'user',
    };
    this.doc.cases.push(entry);
    this.doc.updatedAt = this.clock();
    this.#save();
    return { case: entry };
  }

  removeCase(id: string): boolean {
    this.loadSync();
    const before = this.doc.cases.length;
    this.doc.cases = this.doc.cases.filter((item) => item.id !== id);
    if (this.doc.cases.length === before) return false;
    this.doc.updatedAt = this.clock();
    this.#save();
    return true;
  }

  /**
   * 算指标。
   *
   * `recall(query)` 返回当前系统对这条查询给出的**有序 id 列表**。
   * 每次调用都**现算**，不用历史日志——历史日志当时的库和现在不同，
   * 拿它算指标会得到「过去的准确率」，没有意义。
   */
  evaluate(recall: (query: string) => string[]): RetrievalMetricsResult {
    this.loadSync();
    const cases = this.doc.cases;
    const targets = { top1: 0.8, top3: 0.95 };
    const misses: RetrievalMetricsResult['misses'] = [];
    if (cases.length === 0) {
      return {
        cases: 0,
        top1: null,
        top3: null,
        emptyRate: null,
        targets,
        status: 'insufficient',
        note: '还没有标注：先给最近的真实查询标「应该命中什么」',
        misses,
      };
    }

    let top1 = 0;
    let top3 = 0;
    let empties = 0;
    for (const item of cases) {
      const got = recall(item.query);
      if (item.expectEmpty === true) {
        if (got.length === 0) {
          top1 += 1;
          top3 += 1;
        } else {
          misses.push({ caseId: item.id, query: item.query, expected: [], got: got.slice(0, 3) });
        }
        continue;
      }
      const want = item.expectedIds;
      const head1 = got.slice(0, 1);
      const head3 = got.slice(0, 3);
      const hit1 = want.every((id) => head1.includes(id));
      const hit3 = want.every((id) => head3.includes(id));
      if (hit1) top1 += 1;
      if (hit3) top3 += 1;
      if (!hit3) misses.push({ caseId: item.id, query: item.query, expected: [...want], got: head3 });
      if (got.length === 0) empties += 1;
    }

    const n = cases.length;
    const top1Rate = Number((top1 / n).toFixed(3));
    const top3Rate = Number((top3 / n).toFixed(3));
    const emptyRate = Number((empties / n).toFixed(3));
    let status: RetrievalMetrics['status'];
    let note: string;
    if (n < this.minCases) {
      status = 'insufficient';
      note = `只有 ${n} 条标注（建议 ≥${this.minCases}），数字仅供观察`;
    } else if (top3Rate >= targets.top3 && top1Rate >= targets.top1) {
      status = 'green';
      note = `Top-1 ${(top1Rate * 100).toFixed(0)}% / Top-3 ${(top3Rate * 100).toFixed(0)}%（目标 ${targets.top1 * 100}/${targets.top3 * 100}）`;
    } else if (top3Rate >= targets.top3) {
      status = 'yellow';
      note = `Top-3 达标但 Top-1 ${(top1Rate * 100).toFixed(0)}% 低于 ${targets.top1 * 100}%`;
    } else {
      status = 'red';
      note = `Top-3 ${(top3Rate * 100).toFixed(0)}% 低于目标 ${targets.top3 * 100}%，有 ${misses.length} 条没命中`;
    }
    return { cases: n, top1: top1Rate, top3: top3Rate, emptyRate, targets, status, note, misses };
  }

  /** 已标注的查询集合（给「未标注」筛选）。 */
  annotatedQueries(): Set<string> {
    this.loadSync();
    return new Set(this.doc.cases.map((item) => item.query));
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
