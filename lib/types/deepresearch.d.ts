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
    /** 交叉核对后的答案簇（逐源作答再归并） */
    clusters: AnswerCluster[];
    /** 交叉核对通过的条数 / 总条数 */
    verified: number;
    total: number;
    failures: Array<{
        url: string;
        reason: string;
    }>;
    /** 结论状态：verified / divergent（互斥）/ insufficient_sources（来源太少）/ no_agreement（无人一致） */
    status?: ResearchStatus;
    /** claim 表（每条挂 support 与出处） */
    claims?: ClaimRow[];
}
/** 一个来源对"同一个问题"的回答（逐源作答，才能横向比）。 */
export interface AnswerRecord {
    source: string;
    /** 直接回答问题的句子（≤200 字） */
    answer: string;
    /** 支撑这句回答的逐字引文 */
    quote: string;
    /** 这个来源到底有没有回答问题 */
    relevant: boolean;
}
export interface AnswerCluster {
    answer: string;
    sources: string[];
    quotes: string[];
    /** 有几个独立来源给出同一个回答 */
    agreement: number;
    /** 几个来源里有一致的 / 总共给出回答的 */
    ratio: number;
    verified: boolean;
}
/**
 * 「同一个问题逐源作答 → 比答案」的提示词。
 *
 * 这是重做的核心：旧版让每篇各抽各的结论，不同网页讲不同侧面，永远凑不出同义结论
 * （实测 5 篇 13 条 0 条通过）。改成对**同一个问题**作答，答案才有可比性。
 */
export declare function buildAnswerPrompt(input: {
    question: string;
    title: string;
    text: string;
}): string;
/** 解析逐源作答输出。 */
export declare function parseAnswer(raw: string): AnswerRecord;
/**
 * 答案归并：把表达同一结论的答案合成一簇。
 *
 * 判定分两档（依据 docs/l4-deepresearch.md）：
 *   - 便宜档：字符级 token-F1 + 数字/否定词硬规则；
 *     ≥0.55 判同一，0.40~0.55 灰区（交给上层用一次 LLM 三分类），<0.40 判不同。
 *   - 阈值是初值，要用 30~50 对人工标注扫描后标定；这里先不假装它准。
 * 硬规则不变：只有 1 个独立来源的答案 verified=false。
 */
export declare const SAME_THRESHOLD = 0.55;
export declare const GREY_THRESHOLD = 0.4;
/** 字符级 token-F1（中文按字、英文按词）。 */
export declare function tokenF1(a: string, b: string): number;
/** 抽数字（含百分数、小数），用来发现"数值互相矛盾"。 */
export declare function digitsOf(text: string): string[];
export type PairVerdict = 'same' | 'grey' | 'different';
/**
 * 两条答案的关系判定。
 *
 * 数字冲突、否定相反 → 直接判 different（这类分歧不该被相似度抹平）；
 * 其余按 token-F1 分三档。
 */
export declare function judgeAnswerPair(a: string, b: string): {
    verdict: PairVerdict;
    f1: number;
    reason: string;
};
export declare function crossCheckAnswers(answers: readonly AnswerRecord[], threshold?: number): AnswerCluster[];
/** 归并结果连同"灰区待判"的配对一起返回，供上层做一次 LLM 三分类。 */
export declare function mergeAnswers(answers: readonly AnswerRecord[], threshold?: number): {
    clusters: AnswerCluster[];
    greyPairs: Array<{
        a: string;
        b: string;
        fa: number;
        fb: number;
    }>;
};
/** 灰区三分类提示词：一次判多对，控制调用次数。 */
export declare function buildTriagePrompt(pairs: ReadonlyArray<{
    a: string;
    b: string;
}>): string;
/** 解析三分类；解析不出来就全判 different（保守：不合并）。 */
export declare function parseTriage(raw: string, expected: number): Array<'same' | 'different' | 'contradict'>;
export type ResearchStatus = 'verified' | 'divergent' | 'insufficient_sources' | 'no_agreement';
/**
 * 结论状态：只有"一致"才叫 verified，其余三种要分开报，不能都塞一句"未找到"。
 *
 * 文献（docs/l4-deepresearch.md）要求：检索失败、无人作答、无一致、来源互斥分开说。
 */
export declare function researchStatus(input: {
    verified: number;
    answeredSources: number;
    clusters: number;
    hasContradiction?: boolean;
}): ResearchStatus;
export interface ClaimRow {
    claim: string;
    /** 断言级支撑：每条挂一个来源与可核对引文 */
    support: Array<{
        source: string;
        quote: string;
    }>;
    agreement: number;
    ratio: number;
    status: 'verified' | 'single_source' | 'contradicted';
}
/** 产出结构：claim 表，而不是一段长报告。 */
export declare function toClaimTable(clusters: readonly AnswerCluster[]): ClaimRow[];
