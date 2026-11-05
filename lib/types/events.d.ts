/**
 * src/events.ts — 准则事件日志（轻量事件溯源）
 *
 * 定位：**只追加事件，不改主存储**。
 *
 * 为什么不做完整事件溯源：Microsoft Azure 架构中心明确警告——
 * 「Event sourcing is a complex pattern... costly to migrate to or from...
 *  For most systems and most parts of the traditional data management is sufficient.」
 * 我们的准则是「低频、高价值、需要审计」的典型场景，适合事件溯源；
 * 但整个插件还在早期，全盘改造风险太高。
 *
 * 所以：cognition-playbook.json 仍是主存储，事件流是「带意图的完整日志」。
 * 将来真要时间旅行，事件已经在了，只差把 JSON 改成纯派生态。
 *
 * 六条设计规则（来自 Azure 文档的六个坑）：
 *   1. 捕获意图而非状态：RuleRetired{reason} 而不是 StatusChanged{to}
 *   2. 不可变：改内容用 RuleUpdated 带 before/after，不原地改
 *   3. 版本演进：每条带 v，将来用 upcasting
 *   4. 排序：seq 单调递增 + at 时间戳双保险
 *   5. 幂等：消费端记 lastSeq，重复跳过
 *   6. 个人数据外置：事件只存 ruleId + 摘要，不存记忆原文
 */
/** 事件发起者。 */
export type EventBy = 'user' | 'agent' | 'system' | 'distiller';
/** 一条事件的公共字段。 */
interface EventBase {
    /** 单调递增序号，全局唯一且连续。 */
    seq: number;
    /** 事件 schema 版本，将来用 upcasting 转新版。 */
    v: 1;
    /** 发生时间（毫秒）。 */
    at: number;
    by: EventBy;
}
export type PlaybookEvent = (EventBase & {
    type: 'RuleProposed';
    ruleId: string;
    /** 只存摘要，不存记忆原文（个人数据外置）。 */
    content: string;
    section?: string;
    when?: string;
    sourceIds?: string[];
    origin?: string;
}) | (EventBase & {
    type: 'RuleAccepted';
    ruleId: string;
}) | (EventBase & {
    type: 'RuleUpdated';
    ruleId: string;
    field: 'content' | 'when' | 'section' | 'trigger' | 'required';
    before: string;
    after: string;
    reason: string;
}) | (EventBase & {
    type: 'RuleEvidenceChanged';
    ruleId: string;
    before: 'intact' | 'weakened' | 'orphaned';
    after: 'intact' | 'weakened' | 'orphaned';
    staleBecause: string[];
}) | (EventBase & {
    type: 'RuleUsageRecorded';
    ruleId: string;
    usage: 'applied' | 'appliedGood' | 'appliedBad' | 'missed' | 'userCorrected';
    trace?: string;
}) | (EventBase & {
    type: 'RuleRetired';
    ruleId: string;
    reason: string;
}) | (EventBase & {
    type: 'RuleRevived';
    ruleId: string;
    reason: string;
}) | (EventBase & {
    type: 'RuleRevoked';
    ruleId: string;
    reason: string;
});
/** 新建事件时调用方要提供的部分（seq/v/at 由 store 填）。 */
export type EventInput = Omit<Extract<PlaybookEvent, {
    type: 'RuleProposed';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleAccepted';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleUpdated';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleEvidenceChanged';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleUsageRecorded';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleRetired';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleRevived';
}>, 'seq' | 'v' | 'at'> | Omit<Extract<PlaybookEvent, {
    type: 'RuleRevoked';
}>, 'seq' | 'v' | 'at'>;
export interface EventLogOptions {
    filePath?: string;
    now?: () => number;
    /** 内存中最多保留多少条（默认全部，几百条量级无压力）。 */
    maxInMemory?: number;
}
/**
 * 准则事件日志。
 *
 * 追加写（appendFileSync），读时一次性加载——几百条事件只有几十 KB。
 * 不做快照：事件还少，重放一秒钟能跑几千次。
 */
export declare class PlaybookEventLog {
    private readonly filePath;
    private readonly clock;
    private events;
    private loaded;
    private nextSeq;
    constructor(options?: EventLogOptions);
    /** 从磁盘加载（文件不存在是正常的）。 */
    loadSync(): boolean;
    /** 追加一条事件。返回带 seq 的完整事件。 */
    append(input: EventInput): PlaybookEvent;
    /** 全部事件（按 seq 升序）。 */
    all(): readonly PlaybookEvent[];
    /** 某个准则的全部事件。 */
    forRule(ruleId: string): PlaybookEvent[];
    /** 某个时间点之前的事件。 */
    upTo(at: number): PlaybookEvent[];
    /** 统计。 */
    stats(): {
        total: number;
        byType: Record<string, number>;
    };
    /** 文件的绝对路径，供调试用。 */
    get path(): string;
}
export {};
