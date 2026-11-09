/**
 * src/ambiguity.ts — 开工前的歧义检查
 *
 * ## 为什么需要
 *
 * 依据：arXiv:2604.21505《Clarity Is Not Assumed: Understanding LLM-Based Code Generation
 * under Ambiguous Requirements》——需求歧义会稳定拉低所有模型的产出，**越强的模型掉得越多**；
 * 而且模型**不会主动发现歧义**，会直接挑一种解释往下做。
 *
 * 该文把歧义分四类：词汇（lexical）、句法（syntactic）、语义（semantic）、模糊（vagueness）。
 *
 * ## 这里做什么
 *
 * 只做**规则判定**，不调模型：给出「这个词在需求里缺乏指代对象」这类信号，
 * 然后**只问一个问题**（用户明确反感一次抛三个问题）。
 *
 * 这是"闸门"，不是"理解器"：判出来也可能误报，所以命中只提示「先问一句」，
 * 不阻断任何操作。
 */
export type AmbiguityType = 'lexical' | 'syntactic' | 'semantic' | 'vagueness';
export interface AmbiguityFinding {
    type: AmbiguityType;
    /** 命中的原文片段，便于让人看到"到底哪句话不清楚"。 */
    span: string;
    /** 为什么算歧义。 */
    why: string;
}
export interface AmbiguityReport {
    ambiguous: boolean;
    findings: AmbiguityFinding[];
    /** 只问一个问题；不歧义时为空串。 */
    question: string;
}
/**
 * 检查一条需求。纯函数，不依赖任何服务。
 */
export declare function inspectRequirement(text: string): AmbiguityReport;
