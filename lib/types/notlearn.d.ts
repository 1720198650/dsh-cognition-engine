/**
 * src/notlearn.ts — 「八类不学」过滤器（S6）
 *
 * 学习系统最贵的错误不是漏学，而是**学错**：一旦一条错准则进了注入段，
 * 它会污染之后每一轮，而且很难归因。所以在「进库之前」设一道确定性过滤。
 *
 * 八类（docs/upgrade-plan-v3.md §7.4）分两种严重程度：
 *
 *   hard（直接不学）：无用户依据、含密钥/密码、一次性事实、与环境绑定
 *   soft（可学但要标注）：超粒度、与已有准则平手冲突、同轮先纠正又收回、投机主题
 *
 * 为什么分两级：hard 的错了会直接有害；soft 的只是「可能不值得占名额」，
 * 一刀切会误杀真正有用的长准则。soft 命中时带 `note` 交给人工看一眼。
 */
export type NotLearnCode = 'one-shot' | 'env-bound' | 'conflict-tie' | 'retracted-in-turn' | 'over-granular' | 'no-user-evidence' | 'flip-flop-subject' | 'secret';
export interface NotLearnHit {
    code: NotLearnCode;
    /** hard = 直接不学；soft = 能学但要标注。 */
    severity: 'hard' | 'soft';
    reason: string;
}
export interface NotLearnContext {
    /** 有没有用户依据（用户原话 / 用户确认过的记忆）。 */
    hasUserEvidence?: boolean;
    /** 与已有准则的冲突是否势均力敌（平手）。 */
    conflictTie?: boolean;
    /** 同一轮里先纠正又收回（用户口误）。 */
    retractedInSameTurn?: boolean;
    /** 该 subject 近 30 天被取代次数。 */
    supersede30d?: number;
    /** 准则长度上限（字符），默认 60。 */
    maxChars?: number;
}
export declare function classifyNotLearn(text: string, context?: NotLearnContext): NotLearnHit[];
/** 是否应当直接拒绝（任一 hard 命中）。 */
export declare function shouldReject(text: string, context?: NotLearnContext): {
    reject: boolean;
    hits: NotLearnHit[];
};
/** 一行式摘要，写日志用。 */
export declare function summarize(hits: NotLearnHit[]): string;
