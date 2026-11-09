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
export declare function detectsConstantRanking(top1s: readonly string[]): boolean;
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
export declare function blocksAcceptance(status: CpeStatus, strict: boolean): boolean;
export declare class CpeStore {
    #private;
    private readonly filePath;
    private readonly clock;
    private doc;
    private loaded;
    private saveError;
    constructor(options?: CpeStoreOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    get document(): CpeDoc;
    cases(): CpeCase[];
    /** 新增用例。冻结后拒绝（避免边测边改用例，等于给自己放水）。 */
    addCase(input: {
        question: string;
        expectedRuleIds: string[];
        note?: string;
        by?: 'user' | 'rules';
    }): {
        case?: CpeCase;
        rejected?: string;
    };
    removeCase(id: string): boolean;
    /**
     * 从现有准则派生一批起步用例。
     *
     * **这是弱数据**：用准则自己的内容当问题去测它自己，等于开卷考试。
     * 所以打上 `derivedFrom: 'rules'`，并在 `check()` 里提示「建议换成用户手标的用例」。
     * 有总比没有强——它能抓住「加新准则把旧的挤出去」这类回归。
     */
    seedFromRules(rules: readonly {
        id: string;
        content: string;
    }[]): {
        added: number;
        skipped: number;
    };
    freeze(): {
        ok: boolean;
        frozenAt: number | null;
        cases: number;
    };
    unfreeze(): {
        ok: boolean;
    };
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
    };
    /** 测一次并写入基线。基线只能在「当前状态被认为正确」时打。 */
    measureBaseline(resolver: (question: string) => string[]): {
        ok: boolean;
        baseline?: CpeBaseline;
        reason?: string;
        check?: CpeCheck;
    };
    /** 与基线比较。用例不足或缺基线时明确说 insufficient/无基线，不编分数。 */
    check(resolver: (question: string) => string[]): CpeCheck;
    recordIncident(input: {
        label: string;
        before: number | null;
        after: number | null;
        dropped: number | null;
        rolledBack: boolean;
        detail?: string;
    }): void;
    snapshotFiles(paths: readonly string[]): FileSnapshot;
    restoreFiles(snap: FileSnapshot): {
        restored: string[];
        failed: string[];
    };
}
