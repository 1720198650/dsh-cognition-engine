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
    targets: {
        top1: number;
        top3: number;
    };
    status: 'insufficient' | 'green' | 'yellow' | 'red';
    note: string;
}
export interface RetrievalMetricsResult extends RetrievalMetrics {
    /** 没通过的用例，给人看「错在哪」。 */
    misses: Array<{
        caseId: string;
        query: string;
        expected: string[];
        got: string[];
    }>;
}
export interface RecallLogOptions {
    filePath?: string;
    now?: () => number;
    /** 内存/文件读取时的窗口：只看最近多少条。 */
    window?: number;
}
export declare class RecallLog {
    private readonly filePath;
    private readonly clock;
    private readonly window;
    private rows;
    private loaded;
    private saveError;
    constructor(options?: RecallLogOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    /** 记一次召回。**只记 id 和分数，不记记忆正文**——正文在 state 文件里，不必抄一份。 */
    record(input: {
        query: string;
        mode: string;
        ids: string[];
        scores?: number[];
        count?: number;
        rendered?: boolean;
    }): void;
    recent(limit?: number): RecallRecord[];
    /** 基本盘：总量、零结果率、平均返回条数。不需要人工标注就能算。 */
    overview(): {
        total: number;
        zeroResult: number;
        zeroRate: number;
        avgCount: number;
        byMode: Record<string, number>;
    };
    /** 还没被标注过的最近查询（给标注工作流用）。 */
    unannotated(annotatedQueries: ReadonlySet<string>, limit?: number): RecallRecord[];
}
export interface RetrievalStoreOptions {
    filePath?: string;
    now?: () => number;
    /** 少于这么多条标注一律 insufficient。 */
    minCases?: number;
}
export declare class RetrievalEvalStore {
    #private;
    private readonly filePath;
    private readonly clock;
    private readonly minCases;
    private doc;
    private loaded;
    private saveError;
    constructor(options?: RetrievalStoreOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    get minCasesRequired(): number;
    cases(): EvalCase[];
    /** 加一条标注。同 query 覆盖旧的（同一查询只保留最新一次标注）。 */
    addCase(input: {
        query: string;
        expectedIds?: string[];
        expectEmpty?: boolean;
        note?: string;
        source?: 'user' | 'auto';
    }): {
        case?: EvalCase;
        rejected?: string;
    };
    removeCase(id: string): boolean;
    /**
     * 算指标。
     *
     * `recall(query)` 返回当前系统对这条查询给出的**有序 id 列表**。
     * 每次调用都**现算**，不用历史日志——历史日志当时的库和现在不同，
     * 拿它算指标会得到「过去的准确率」，没有意义。
     */
    evaluate(recall: (query: string) => string[]): RetrievalMetricsResult;
    /** 已标注的查询集合（给「未标注」筛选）。 */
    annotatedQueries(): Set<string>;
}
