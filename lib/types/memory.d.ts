/**
 * src/memory.ts — TemporalMemoryStore
 *
 * 双时态记忆存储，工程机制对齐 LongMemory（CaviraOSS/LongMemory）的
 * `src/core/temporal/bitemporal.ts` 与 `docs/temporal.md`：
 *
 *   - 两条独立时间轴：
 *       valid time    → validFrom / validTo     （事实在「世界」里何时为真）
 *       recorded time → recordedAt / supersededAt（系统在「事务时间」何时知道）
 *   - `validTo === null`     表示「仍然有效」
 *   - `supersededAt === null` 表示「仍是当前版本」
 *   - 闭合区间（写 validTo / supersededAt）不改变内容的 durable identity：
 *     hash 只由 subject + content + validFrom 计算，被取代的事实保留原 id 与 hash，
 *     只是从「当前视图」里退场。
 *   - 严格召回只取 current truth；历史召回保留被取代的真值（point-in-time truth）。
 *
 * 存储：纯 TypeScript + Map，无任何外部数据库。
 */
/** 召回口径。 */
export type RecallMode = 'strict' | 'historical' | 'belief';
/** 一条不可变记忆事实。内容字段创建后不再改写（闭合区间时整体替换为新对象）。 */
export interface TemporalFact {
    readonly id: string;
    /** 冲突检测的归一化主题键。 */
    readonly subject: string;
    readonly content: string;
    /** 内容指纹：subject + content + validFrom。不含 validTo / supersededAt。 */
    readonly hash: string;
    readonly validFrom: number;
    readonly validTo: number | null;
    readonly recordedAt: number;
    readonly supersededAt: number | null;
    readonly supersededBy: string | null;
    readonly tags: readonly string[];
    readonly source: string;
    readonly importance: number;
    /** 强化量（每次 recall 命中或被显式 reinforce 时增加），不参与 hash。 */
    readonly activation: number;
    readonly lastAccessedAt: number;
}
/** ingest 入参。 */
export interface IngestInput {
    content: string;
    subject?: string;
    tags?: readonly string[];
    source?: string;
    importance?: number;
    validFrom?: number;
    validTo?: number | null;
    recordedAt?: number;
    /** 显式声明本条取代哪条旧事实（LongMemory 的 supersedeNode）。 */
    supersedes?: string;
}
export interface RecallOptions {
    mode?: RecallMode;
    /** historical 模式下「那时」的世界时间。 */
    validTime?: number;
    /** belief 模式下「那时」的事务时间。 */
    recordedTime?: number;
    limit?: number;
    minScore?: number;
    subject?: string;
    tags?: readonly string[];
}
export interface RecallHit {
    fact: TemporalFact;
    score: number;
    similarity: number;
    decay: number;
}
export interface Conflict {
    subject: string;
    leftId: string;
    rightId: string;
    overlapFrom: number;
    overlapTo: number | null;
}
/**
 * Inline & Spill 渲染参数。
 * 机制来源：dsh-superagent-prototype 的上下文装载——正文在额度内直接 inline，
 * 超限只给 `chars` 与 read pointer（docs/007-architecture.md 第 594 行）。
 */
export interface RenderOptions extends RecallOptions {
    /** 单条 inline 正文上限，超出只保留前缀并标记 truncated。 */
    inlineChars?: number;
    /** 多久以内算「近期」，超出则只给 ID 引用。 */
    inlineMaxAgeMs?: number;
}
export interface InlineMemory {
    id: string;
    content: string;
    chars: number;
    truncated: boolean;
    validFrom: number;
}
export interface SpilledMemory {
    id: string;
    chars: number;
    pointer: string;
    validFrom: number;
}
export interface RenderedMemory {
    inline: InlineMemory[];
    spilled: SpilledMemory[];
    /** 可直接塞进 prompt 的文本。 */
    text: string;
    stats: {
        inline: number;
        spilled: number;
        savedChars: number;
    };
}
export interface MemoryStats {
    total: number;
    current: number;
    superseded: number;
    subjects: number;
    conflicts: number;
}
export interface MemoryOptions {
    now?: () => number;
    /** 衰减半衰期，默认 7 天。 */
    halfLifeMs?: number;
    idPrefix?: string;
}
/** 事实在世界时间 t 是否为真（含被取代的历史真值）。 */
export declare function isValidAt(fact: TemporalFact, validTime: number): boolean;
/** 系统在事务时间 t 是否已经知道这条事实（含后来被取代的版本）。 */
export declare function isRecordedAt(fact: TemporalFact, recordedTime: number): boolean;
/** 是否「此刻的当前真值」：未被取代 + 已知 + 当前有效。 */
export declare function isCurrent(fact: TemporalFact, now: number): boolean;
/** 英文按词、中文按二元组切分，返回词频表。 */
export declare function tokenize(text: string): Map<string, number>;
/** 余弦相似度。 */
export declare function cosine(a: Map<string, number>, b: Map<string, number>): number;
/** FNV-1a 32 位内容指纹（纯 TS，不依赖 node:crypto）。 */
export declare function contentHash(...parts: readonly string[]): string;
/** 从正文推导主题键：优先取冒号前的短语，否则取前 16 个字符。 */
export declare function deriveSubject(content: string): string;
export declare class TemporalMemoryStore {
    private readonly facts;
    private readonly bySubject;
    private readonly tokens;
    private readonly clock;
    private readonly halfLifeMs;
    private readonly idPrefix;
    private seq;
    constructor(options?: MemoryOptions);
    /** 当前时钟。 */
    now(): number;
    get size(): number;
    /**
     * 写入一条记忆。内容与时间戳立即冻结；重复内容（同 hash）直接返回既有事实，
     * 不做覆盖写，这就是「不可变内容」的落地方式。
     */
    ingest(input: IngestInput): TemporalFact;
    get(id: string): TemporalFact | undefined;
    all(): readonly TemporalFact[];
    /** 删除一条事实（连同索引与分词缓存）。用于纠正错误数据、清理测试数据。 */
    remove(id: string): boolean;
    /** 按来源批量删除，返回删除条数。 */
    removeBySource(source: string): number;
    /** 按主题批量删除，返回删除条数。 */
    removeBySubject(subject: string): number;
    /**
     * 用新事实取代旧事实：给旧事实闭合 validTo 与 supersededAt，并记下 supersededBy。
     * id / hash 不变——被取代的版本仍然可以被「历史召回」找回。
     */
    supersede(oldId: string, newId: string, at?: number): {
        superseded: TemporalFact;
        current: TemporalFact;
    };
    /** 记忆衰减：距上次访问越久，权重越低（指数半衰期）。 */
    decay(factOrId: TemporalFact | string, now?: number): number;
    /** 显式强化：提升激活量并重置衰减计时。 */
    reinforce(id: string, amount?: number, now?: number): TemporalFact;
    /**
     * 按时间口径召回。
     *   strict     → 当前真值（被取代的、尚未生效的都不返回）
     *   historical → 在 validTime 那个时刻为真的事实（含被取代的历史版本）
     *   belief     → 在 recordedTime 那个事务时刻系统已经知道的版本
     */
    recall(query: string, options?: RecallOptions): RecallHit[];
    /**
     * Inline & Spill：按需装载。
     * 近期记忆直接给正文（可截断并标记 chars / truncated），
     * 久远记忆只给 ID 引用（pointer），由调用方决定要不要再取一次。
     */
    render(query: string, options?: RenderOptions): RenderedMemory;
    /** 同一 subject 的完整时间线（按 validFrom 升序）。 */
    history(subject: string): TemporalFact[];
    /**
     * 冲突检测：同一 subject 下，两条内容不同的事实其有效区间发生重叠，
     * 说明系统同时持有两个互斥的「当前真值」。
     */
    conflicts(): Conflict[];
    stats(): MemoryStats;
    /** 导出为纯 JSON（可自行落盘到 .json 文件，仍然不依赖数据库）。 */
    serialize(): TemporalFact[];
    /** 从 serialize() 的结果恢复。 */
    restore(facts: readonly TemporalFact[]): void;
    private visible;
    private findByHash;
}
