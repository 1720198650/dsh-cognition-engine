/**
 * src/deepresearch.ts — 「深研」：像子代理调研那样学，而不是把一篇资料压成摘要。
 *
 * 区别（用户 2026-11-18 指出，我认）：
 *   快学 = 拿一篇资料压成 3~6 条结论，不核对，产出物是"事实条目"。
 *   深研 = 带着一个问题去查 → 多源 → **交叉核对** → 产出带出处、带反例、带边界的知识条目。
 *
 * 本文件只放确定性部分：结论归一化、跨源归并、交叉核对、提示词与解析。
 * 检索、抓取、模型调用在 index.ts 里。
 */
/** 结论归一化后的比较键：去标点、去空白、小写。 */
export declare function conclusionKey(text: string): string;
/** 两条结论的相似度（bigram 覆盖率，取较小者方向，避免长句压短句）。 */
export declare function conclusionSimilarity(a: string, b: string): number;
export interface Claim {
    /** 结论（可改写） */
    conclusion: string;
    /** 支撑它的原文引文（逐字） */
    quote: string;
    /** 哪个来源（sourceId 或 URL） */
    source: string;
}
export interface Cluster {
    /** 归一化后的簇代表（最长的那条结论） */
    conclusion: string;
    /** 支持它的独立来源（去重后） */
    sources: string[];
    /** 每条来源的引文 */
    quotes: string[];
    /** ≥2 个独立来源 = 可交叉核对通过 */
    verified: boolean;
    /** 反例/边界（模型给出则合并） */
    counter?: string;
    boundary?: string;
}
/**
 * 跨源归并：把"同一件事的不同说法"合成一簇，再看有几个独立来源。
 *
 * 硬规则（这是"深研"和"快学"的分界线）：**只有 1 个来源的结论标 verified=false**。
 * 宁可少留，也不要让单篇资料的话冒充"多源印证过的知识"。
 */
export declare function crossCheck(claims: readonly Claim[], similarityThreshold?: number): Cluster[];
/** 深研提示词：要结论、要逐字引文、要反例。 */
export declare function buildDeepClaimPrompt(input: {
    question: string;
    title: string;
    text: string;
    maxClaims?: number;
}): string;
/** 解析模型输出（宽容到能从废话里抠 JSON，但不猜内容）。 */
export declare function parseDeepClaims(raw: string): Array<{
    conclusion: string;
    quote: string;
}>;
export interface ResearchRecord {
    id: string;
    at: number;
    question: string;
    /** 每个来源抓了多少字、抽了几条 */
    sources: Array<{
        sourceId: string;
        url: string;
        chars: number;
        claims: number;
    }>;
    clusters: Cluster[];
    /** 交叉核对通过的条数 / 总条数 */
    verified: number;
    total: number;
    failures: Array<{
        url: string;
        reason: string;
    }>;
}
