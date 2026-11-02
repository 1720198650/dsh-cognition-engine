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
 * 情绪联动（本次新增）：
 *   - `ingest()` 在「本条取代了旧事实」时返回 `onConflictTriggered = true`；
 *
 * 存储：纯 TypeScript + Map，无任何外部数据库。
 */
import type { AdmissionRules } from './admission.ts';
export type RecallMode = 'strict' | 'historical' | 'belief' | 'associative';
/** 记忆作用域：全局共享 / 工作区共享 / 会话私有。 */
export type MemoryScope = 'global' | 'workspace' | 'session';
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
    /** 作用域，默认 global。 */
    readonly scope: MemoryScope;
    /** scope = workspace 时的归属工作区 id。 */
    readonly workspaceId: string | null;
    /** scope = session 时的归属会话 id。 */
    readonly sessionId: string | null;
    /** 强化量（每次 recall 命中或被显式 reinforce 时增加），不参与 hash。 */
    readonly activation: number;
    /** 是否已归档：不进 strict 召回，但历史与联想仍可查。 */
    readonly archived: boolean;
    /** 最近一次手动修正的时间（用户改过内容/状态/录入时间）。 */
    readonly revisedAt?: number;
    /** 已被归并到哪条记忆（归并后不进 strict 召回，但历史仍可查）。 */
    readonly mergedInto?: string;
    readonly lastAccessedAt: number;
}
/** 兼容旧命名：外部文档里把这条记录叫 MemoryNode。 */
export type MemoryNode = TemporalFact;
/** ingest 的返回值：事实本身 + 本次写入是否触发了「取代」。 */
export interface IngestResult extends TemporalFact {
    /** 本次写入是否把某条旧事实的 validTo 闭合、并标记了 supersededBy。 */
    readonly onConflictTriggered: boolean;
}
/** ingest 入参。 */
export interface IngestInput {
    content: string;
    subject?: string;
    tags?: readonly string[];
    source?: string;
    importance?: number;
    /** 作用域，默认 global。 */
    scope?: MemoryScope;
    workspaceId?: string;
    sessionId?: string;
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
    /**
     * 作用域过滤。
     *   'all'（默认）→ 不过滤，保持旧行为
     *   'global'      → 只要全局记忆
     *   'workspace'   → 全局 + 指定工作区
     *   'session'     → 全局 + 指定会话
     */
    scope?: MemoryScope | 'all';
    workspaceId?: string;
    sessionId?: string;
}
export interface RecallHit {
    fact: TemporalFact;
    score: number;
    similarity: number;
    decay: number;
}
/** 召回结果。 */
export interface RecallMeta {
    hits: RecallHit[];
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
    /** 已归档的记忆条数。 */
    archived: number;
}
export interface MemoryOptions {
    now?: () => number;
    /** 衰减半衰期，默认 7 天。 */
    halfLifeMs?: number;
    idPrefix?: string;
}
/** importance ≥ 此值视为「核心记忆」（对应需求里的 CORE 级）。 */
export declare const CORE_IMPORTANCE = 0.8;
/** 超过这个年龄的核心记忆会触发「怀旧」。 */
export declare const NOSTALGIA_AGE_MS: number;
/** 事实在世界时间 t 是否为真（含被取代的历史真值）。 */
export declare function isValidAt(fact: TemporalFact, validTime: number): boolean;
/** 系统在事务时间 t 是否已经知道这条事实（含后来被取代的版本）。 */
export declare function isRecordedAt(fact: TemporalFact, recordedTime: number): boolean;
/** 是否「此刻的当前真值」：未被取代 + 已知 + 当前有效。 */
export declare function isCurrent(fact: TemporalFact, now: number): boolean;
/** 英文按词、中文按二元组切分，返回词频表（纯虚词 bigram 不产出）。 */
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
    /** 用户可配置的准入规则。 */
    private rules;
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
     *
     * 返回 `IngestResult`：事实字段全部保留，另外带 `onConflictTriggered`——
     * 当本次写入通过 `supersedes` 把某条旧事实的 validTo 闭合时，它为 true。
     */
    ingest(input: IngestInput): IngestResult;
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
     * 按时间口径召回（保持原签名，返回命中数组）。
     * 需要情绪聚合时用 `recallWithMeta()`。
     */
    recall(query: string, options?: RecallOptions): RecallHit[];
    /**
     * 按时间口径召回，并计算本批结果的情绪聚合。
     *
       *   isNostalgic  = 是否命中「30 天前 + 核心权重」的记忆
     */
    recallWithMeta(query: string, options?: RecallOptions): RecallMeta;
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
    /**
     * 手动修正一条记忆：内容、主题、录入时间、有效状态。
     *
     * 注意 recordedAt 是双时态的事务时间轴，改动会让 belief 口径的答案偏移，
     * 所以这里会打上 revisedAt 标记，表示「这条被人工改过」。
     */
    updateFact(id: string, patch: {
        content?: string;
        subject?: string;
        recordedAt?: number;
        superseded?: boolean;
    }): TemporalFact | undefined;
    /** 归档 / 取消归档一条记忆（不删数据，只影响 strict 召回）。 */
    setArchived(id: string, archived: boolean): boolean;
    /**
     * 自动归档：长期没被访问、且从未被强化的记忆标记为 archived。
     * 不做合并、不删数据——只是让它们退出 strict 召回。
     */
    autoArchive(options?: {
        idleDays?: number;
        maxActivation?: number;
        now?: number;
    }): string[];
    /**
     * 记忆归并：同一主题下，内容高度相似且极性一致的条目收敛成一条，
     * 其余标记 mergedInto（不删除，历史仍可查）。
     *
     * 纯规则实现，不调用 LLM：相似度用词频余弦，保留重要度最高的一条作为主条目。
     */
    consolidate(options?: {
        subject?: string;
        threshold?: number;
    }): Array<{
        kept: string[];
        merged: string[];
    }>;
    /** 设置准入规则（页面上的开关）。 */
    setRules(rules: Partial<AdmissionRules>): AdmissionRules;
    /** 当前准入规则。 */
    getRules(): AdmissionRules;
    /** 导出为纯 JSON（可自行落盘到 .json 文件，仍然不依赖数据库）。 */
    serialize(): TemporalFact[];
    /** 从 serialize() 的结果恢复；缺失字段按默认值补齐。 */
    restore(facts: readonly TemporalFact[]): void;
    private visibleByScope;
    private visible;
    private findByHash;
}
