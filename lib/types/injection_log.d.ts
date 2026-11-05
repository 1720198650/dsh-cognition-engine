/**
 * src/injection_log.ts — 注入快照 + 反馈识别 + 轮次跟踪
 *
 * 解决的问题：整个「学习」链条是断的——
 *
 *   模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己
 *
 * appliedGood / appliedBad 字段早就有了，但没有自动来源。
 * 这里补上三个东西：
 *   1. 每轮注入了哪些准则（快照）
 *   2. 用户下一轮的反应（纠正 / 确认）→ 回写给上一轮的准则
 *   3. 用宿主真实轮次推进状态机（见 TurnFeedbackTracker）
 *
 * ## v2：为什么必须改成按「真实轮次」记
 *
 * v1 把 `record()` 放在 `buildInjectedContext()` 里，而这个函数有三个调用点：
 * 系统提示段（每次拼提示都调）、页面 `/state` 快照（面板每 2 秒轮询一次）、
 * `/injected` 路由。结果 2026-11-05 实测：88 分钟写了 2432 行，
 * 其中绝大多数是面板轮询，真正的用户轮次只有几十个。
 *
 * 这不是「日志多了一点」，而是**整个度量被污染**：轮次号变成轮询计数器，
 * 「注入→反馈」的归因链断了。
 *
 * v2 的做法：
 *   - 渲染函数**纯化**（不再有副作用），面板轮询多少次都不写一行；
 *   - 只在宿主的 `session/event` 上推进：turn/start 记本轮注入，
 *     turn/end 用这一轮的用户消息给上一轮打分——一轮 1 行（有反馈时 2 行）。
 *   - 旧行（没有 `v: 2`）读的时候直接跳过，不动文件、不删数据。
 *
 * 关键设计：**单次纠正不降级**。
 * ReasoningBank 的结论：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感。
 * 所以累计 appliedBad ≥ 3 且 > appliedGood 才进入 disputed（由 playbook.markUsage 处理）。
 */
/** 当前记录格式版本。旧行没有这个字段，读取时跳过。 */
export declare const INJECTION_LOG_VERSION = 2;
/** 一条注入快照（一轮一行）。 */
export interface InjectionSnapshot {
    /** 记录格式版本；v1 没有这个字段。 */
    v?: number;
    at: number;
    sessionId: string;
    /** 宿主给的轮次号（session/event 的 turn/start.data.turn）。 */
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
/**
 * 从一条 user 消息里取出纯文本。
 *
 * 宿主的 `UserMessage.content` 是内容块数组（text / image / file / tool-*），
 * 一条用户消息还可能被拆成多个事件（见 session 日志）。这里只拼 text 块，
 * 图片和附件对「用户在说什么」没有贡献。
 *
 * 写成容错形式：宿主换了表示法也不要抛异常——事件监听器里抛错会污染会话。
 */
export declare function extractUserText(message: unknown): string;
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
    /** 读文件时被跳过（v1 格式）的行数，供面板显示「旧日志已忽略」。 */
    private legacyRows;
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
    /** 找最近一轮（用于手动 `/feedback` 与排查）。 */
    latest(sessionId?: string): InjectionSnapshot | undefined;
    statistics(): {
        total: number;
        pending: number;
        corrected: number;
        confirmed: number;
        /** v1 旧行数（已被跳过）；大于 0 说明这个文件里有历史噪声。 */
        legacyRows: number;
    };
    get path(): string;
}
/** 当前应该注入的准则（由调用方从准则本现算）。 */
export interface InjectionBudget {
    ruleIds: string[];
    chars: number;
}
/** 判定出反馈后的回调（调用方负责 markUsage / 写事件日志）。 */
export interface TurnFeedbackHooks {
    /** 开新轮时调一次，取这一轮将要注入的准则。 */
    injection(): InjectionBudget;
    /** 判出非中性反馈时调一次；ruleIds 是**被测那一轮**注入的准则。 */
    onFeedback(feedback: FeedbackKind, ruleIds: string[], reaction: string): void;
}
/**
 * 用宿主真实轮次推进「注入 → 反馈」状态机。
 *
 * 时序（实测自 session 日志）：
 *
 *   agent/inbox/spliced → turn/start[T] → step/start → system/message
 *     → user/message × N（一条用户消息可能拆成多个事件）
 *     → 若干 step → turn/end[T]
 *
 * 所以：
 *   - `turn/start[T]` 时，T-1 的注入内容还在手上 → 挪进 pending；
 *   - `user/message` 累加到当前轮的 text；
 *   - `turn/end[T]` 时，用**当前轮**的 text 给 **pending（T-1）** 打分。
 *     「用户对上一轮的纠正」正是这个时序：这句话出现在第 T 轮，针对第 T-1 轮。
 *
 * 没反馈信号（neutral）也落一行，这样分母是真实的，不会被「只记成功」拉偏。
 */
export declare class TurnFeedbackTracker {
    private readonly log;
    private readonly hooks;
    /** 当前轮（还没结束）。 */
    private readonly current;
    /** 上一轮（等这一轮的用户文本打分）。 */
    private readonly pending;
    constructor(log: InjectionLog, hooks: TurnFeedbackHooks);
    /** 宿主开了一轮。 */
    beginTurn(sessionId: string, turn: number): void;
    /** 这一轮里用户说了一句话（可能被拆成多个事件）。 */
    appendUserText(sessionId: string, text: string): void;
    /** 宿主结束一轮：给上一轮打分，并把这一轮落盘等下一轮打。 */
    endTurn(sessionId: string): void;
    /** 会话销毁时清掉内存槽，避免长跑进程里越积越多。 */
    forget(sessionId: string): void;
    /** 排查用：这个会话现在等着被打分的那一轮。 */
    pendingOf(sessionId: string): {
        turn: number;
        ruleIds: string[];
    } | undefined;
    /** 排查用：这个会话正在进行的那一轮。 */
    currentOf(sessionId: string): {
        turn: number;
        ruleIds: string[];
        chars: number;
    } | undefined;
}
