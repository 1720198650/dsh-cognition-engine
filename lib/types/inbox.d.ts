export type CandidateStatus = 'pending' | 'accepted' | 'rejected' | 'duplicate';
export interface Candidate {
    id: string;
    createdAt: number;
    title: string;
    url?: string;
    content: string;
    summary?: string;
    subject?: string;
    source: 'paste' | 'web' | 'file';
    status: CandidateStatus;
    /** 指向不可变来源（SoMem 的 Source 层） */
    sourceId?: string;
    /** 判重命中的对象（候选 id 或事实 id） */
    duplicateOf?: string;
    /** 采用后落到哪条事实 */
    acceptedFactId?: string;
    note?: string;
    /** 0..1：值不值得你花时间审（长度/编号/结论性词） */
    importance: number;
}
export interface InboxStats {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    duplicate: number;
}
/** 归一化：去空白标点，便于判重。 */
export declare function normalizeForDup(text: string): string;
export declare function contentHash(text: string): string;
/**
 * 便宜的重要性估计（不调模型）。
 *
 * 目的不是"打分"，而是**排序**：让你先看更可能有用的。
 * 依据：Generative Agents 用 importance 决定检索优先级；这里只借"要排序"这一点。
 */
export declare function estimateImportance(text: string): number;
export declare class CandidateInbox {
    readonly filePath: string;
    private readonly clock;
    private data;
    private loaded;
    constructor(options: {
        filePath: string;
        now?: () => number;
    });
    load(): void;
    private persist;
    /**
     * 加一条候选。
     *
     * 判重两级：先精确（归一化哈希），再近似（与 pending 候选 + 现有事实算相似度）。
     * 命中就标 duplicate 并**保留记录**——"重复了什么"本身是信息。
     */
    add(input: {
        title?: string;
        content: string;
        url?: string;
        summary?: string;
        subject?: string;
        source?: 'paste' | 'web' | 'file';
        /** 抽取阶段留下的说明（含可疑句式等） */
        note?: string;
        /** 不可变来源 id（由调用方先写入 Source 账本） */
        sourceId?: string;
    }, existing?: {
        facts: readonly {
            id: string;
            content: string;
        }[];
    }): Candidate;
    list(status?: CandidateStatus): Candidate[];
    get(id: string): Candidate | undefined;
    /**
     * 采用：唯一会写事实的入口。
     *
     * `sink` 由调用方注入（插件里就是 memory.ingest），这样本模块不依赖记忆层，便于单测。
     */
    accept(id: string, sink: (input: {
        content: string;
        subject: string;
        tags: string[];
        importance: number;
        origin: string;
    }) => string, overrides?: {
        content?: string;
        subject?: string;
        /** 写进记忆的正文（不改候选原文）：长资料只落"入口 + 要点"，全文留在资料库 */
        factContent?: string;
    }): Candidate;
    reject(id: string, reason?: string): Candidate;
    stats(): InboxStats;
    /** 上限保护：超过 MAX_CANDIDATES 时先丢最旧的 rejected/duplicate。 */
    private trim;
}
