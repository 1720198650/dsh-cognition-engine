export type CandidateKind = 'fact' | 'rule' | 'skill';
export type CandidateStatus = 'pending' | 'accepted' | 'rejected';
/** 这条候选讲的是"外部世界怎么运作"还是"关于用户为真"。判不准一律落 world。 */
export type CandidateScope = 'world' | 'user';
/** 外部锚：这条候选是从哪段原文/哪句话来的。 */
export interface Anchor {
    /** source = 资料块；turn = 用户原话；tool = 工具输出 */
    type: 'source' | 'turn' | 'tool';
    /** source 时为 sourceId（如 src-12），turn 时为事件/会话 id */
    ref: string;
    /** source 时为块序号 */
    block?: number;
    /** 用来核对的引文片段 */
    quote: string;
}
export interface LearningCandidate {
    id: string;
    kind: CandidateKind;
    content: string;
    subject?: string;
    /** 准则/技能建议填适用边界（别的项目该不该照搬） */
    boundaryEnvs?: string[];
    anchor: Anchor;
    /** world = 资料里的世界知识；user = 关于用户为真（判不准默认 world） */
    scope: CandidateScope;
    /** 引文只是转述（覆盖率 0.6~0.9），建议用户补一句原文再采用 */
    needsQuote?: boolean;
    /** 0..1，便宜估计，只用于排序 */
    confidence: number;
    status: CandidateStatus;
    createdAt: number;
    /** 锚校验通过时记下实际核对到的字数 */
    anchorChars?: number;
    /** 锚所在原文块的可疑标记（非空时上层应降级） */
    anchorFlags?: string[];
    note?: string;
    /** 采用后落到了哪里（记忆 id / 准则 id / 技能 id） */
    acceptedRef?: string;
}
export interface AnchorLookup {
    /** 取资料块原文 */
    blockText?: (sourceId: string, block: number) => string | undefined;
    /** 取用户原话 */
    turnText?: (ref: string) => string | undefined;
    /** 取该块的可疑标记 */
    blockFlags?: (sourceId: string, block: number) => string[];
}
export type AnchorCheck = {
    ok: true;
    matchedChars: number;
    flags: string[];
    needsQuote?: boolean;
} | {
    ok: false;
    reason: string;
};
/** 归一化：只留字母数字与汉字，用来做"引文是否真在原文里"的比对。 */
export declare function normalizeForAnchor(text: string): string;
/** 最长公共子序列长度（引文一般 ≤200 字，O(n×m) 够用）。 */
export declare function lcsLength(a: string, b: string): number;
/** 引文覆盖率 = LCS / 引文长度。逐字 1.0；改两个字 ~0.94；转述 ~0.6；无关 <0.2。 */
export declare function quoteCoverage(quote: string, source: string): number;
/** 引文太短就不算锚：12 字以下几乎在任何文章里都能撞上。 */
export declare const MIN_QUOTE_CHARS = 12;
/**
 * 覆盖率阈值：0.9 以上算逐字、0.6~0.9 算转述。
 *
 * **这两个数是经验值，没有经过标定**（audit-evidence.md 判为弱支撑）：
 * l3-anchor.md 给的对照确实落在 0.90 / 0.64 / 0.15 这类量级，但只在几条样本上跑过，
 * 不是通过 30~50 对人工标注扫描得出的最优点。要改就走 config，不要改这里。
 */
export declare const STRICT_QUOTE_COVERAGE = 0.9;
export declare const LOOSE_QUOTE_COVERAGE = 0.6;
export interface AnchorOptions {
    minQuoteChars?: number;
    strictCoverage?: number;
    looseCoverage?: number;
}
/**
 * 校验一条候选的外部锚（分三层，依据 docs/l3-anchor.md 的标定结果）。
 *
 *   1. 引文归一化后**逐字是原文子串** → 放行；
 *   2. 覆盖率 ≥0.90（改了标点/个别字）→ 放行；
 *   3. 0.60~0.90（转述）→ 放行但标 needsQuote，提示用户补原文；不丢，因为内容仍可能对。
 * 逐字/覆盖都不够时再试相邻块（摘要常跨块），仍不行就判"张冠李戴"丢弃。
 */
export declare function checkAnchor(anchor: Anchor, lookup: AnchorLookup, options?: AnchorOptions): AnchorCheck;
export interface AddCandidateInput {
    kind: CandidateKind;
    content: string;
    anchor: Anchor;
    subject?: string;
    boundaryEnvs?: string[];
    confidence?: number;
    note?: string;
    anchorChars?: number;
    anchorFlags?: string[];
    scope?: CandidateScope;
    needsQuote?: boolean;
}
export interface LearningStats {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    byKind: Record<CandidateKind, number>;
}
/** 候选队列：JSON 落盘，纯确定性操作。 */
export declare class LearningQueue {
    readonly filePath: string;
    private readonly clock;
    private data;
    constructor(options: {
        filePath: string;
        now?: () => number;
    });
    private load;
    private persist;
    /**
     * 入队。默认做两道去重：
     *   1. 与 pending 里内容相同（归一化后）→ 不重复入队；
     *   2. 与 accepted 的同内容 → 也不重复（已经学过了）。
     */
    add(input: AddCandidateInput): {
        candidate: LearningCandidate;
        duplicate: boolean;
    };
    /** 超过上限先丢最旧的 rejected，不碰 pending。 */
    private trim;
    list(status?: CandidateStatus): LearningCandidate[];
    get(id: string): LearningCandidate | undefined;
    /** 标记采用，并记下落到哪里。 */
    markAccepted(id: string, acceptedRef: string): LearningCandidate;
    reject(id: string, reason?: string): LearningCandidate;
    stats(): LearningStats;
}
/**
 * 从一条资料摘要产出候选：每条结论一个 fact 候选。
 *
 * 锚怎么定：**结论是改写、引文是照抄**，所以用引文去核，不用结论去核。
 * 引文必须能在原文块里逐字找到；找不到就不生成候选——
 * 说明这条结论没有可核对的出处，宁可不学（这是防幻觉最省事的一道闸）。
 */
export declare function candidatesFromPoints(input: {
    sourceId: string;
    title: string;
    topic?: string;
    summary: string;
    points: readonly string[];
    /** 与 points 一一对应的原文引文（旧数据没有这一列） */
    quotes?: readonly string[];
    blocks: readonly {
        ord: number;
        text: string;
        flags?: string[];
    }[];
}, options?: AnchorOptions): Array<{
    kind: CandidateKind;
    content: string;
    anchor: Anchor;
    subject?: string;
    confidence: number;
    anchorChars: number;
    anchorFlags: string[];
    note: string;
}>;
