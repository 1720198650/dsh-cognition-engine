/**
 * src/injection_log.ts — 注入快照 + 反馈识别
 *
 * 解决的问题：整个「学习」链条是断的——
 *
 *   模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己
 *
 * appliedGood / appliedBad 字段早就有了，但没有自动来源。
 * 这里补上两个东西：
 *   1. 每轮注入了哪些准则（快照）
 *   2. 用户下一轮的反应（纠正 / 确认）→ 回写给上一轮的准则
 *
 * 关键设计：**单次纠正不降级**。
 * ReasoningBank 的结论：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感。
 * 所以累计 appliedBad ≥ 3 且 > appliedGood 才进入 disputed（由 playbook.markUsage 处理）。
 */
/** 一条注入快照（一轮一行）。 */
export interface InjectionSnapshot {
    at: number;
    sessionId: string;
    turn: number;
    /** 本轮注入的准则 id。 */
    ruleIds: string[];
    /** 注入总字符数。 */
    chars: number;
    /** 反馈回写状态：pending 还没判定，scored 已回写，neutral 判定为中性的。 */
    verdict?: 'pending' | 'scored' | 'neutral';
    /** 回写时的反馈类型。 */
    feedback?: FeedbackKind;
}
/** 用户反应的判定结果。 */
export type FeedbackKind = 'correction' | 'confirmation' | 'neutral';
/**
 * 判定用户这句话是「纠正」「确认」还是「中性」。
 *
 * 只取消息**开头**前 30 字判断——用户的反应通常在句首。
 */
export declare function classifyFeedback(message: string): FeedbackKind;
export interface InjectionLogOptions {
    filePath?: string;
    now?: () => number;
    /** 内存保留最近多少条（默认 200，足够回溯）。 */
    keepRecent?: number;
}
/**
 * 注入快照日志。
 *
 * 一轮一行 JSONL；读取时只保留最近 N 条在内存。
 * 回写反馈时用 `markVerdict()` 追加一条带 verdict 的记录（不改原行），
 * 读取时以后出现的为准——同样是「append-only」的思路。
 */
export declare class InjectionLog {
    #private;
    private readonly filePath;
    private readonly clock;
    private readonly keepRecent;
    private snapshots;
    private loaded;
    constructor(options?: InjectionLogOptions);
    loadSync(): boolean;
    /** 记录一轮注入。 */
    record(sessionId: string, turn: number, ruleIds: string[], chars: number): void;
    /**
     * 给某一轮打反馈判定。返回该轮注入的准则 id（供调用方批量 markUsage）。
     *
     * 找不到该轮返回空数组。
     */
    markVerdict(sessionId: string, turn: number, feedback: FeedbackKind): string[];
    /** 最近 N 条快照（新的在前）。 */
    recent(limit?: number): InjectionSnapshot[];
    /** 找最近一轮（用于「用户这句话是针对上一轮」）。 */
    latest(sessionId?: string): InjectionSnapshot | undefined;
    statistics(): {
        total: number;
        pending: number;
        corrected: number;
        confirmed: number;
    };
    get path(): string;
}
