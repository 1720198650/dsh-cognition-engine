/**
 * 自动修订的元数据（落数据字段，**不往内容里写前缀**）。
 *
 * 依据 docs/l3-autorevise.md：ACE 的 bullet 元数据只有 id 和 helpful/harmful 计数，
 * 不满足"可审计"；能抄的是 SkillHone 的决策记录 h=(诊断, 修订, 证据, 结果)。
 * 前缀只该出现在显示层——写进 content 会污染检索与去重，也会混进注入。
 */
export interface RevisionMeta {
    origin: 'auto_revise' | 'manual';
    by: 'auto' | 'user';
    /** 触发来源：用户纠正 / 反证 / 资料 */
    trigger: 'user_correction' | 'counter_evidence' | 'source';
    /** 可核对证据（原话或出处 id） */
    evidence: string;
    reason: string;
}
/** 渲染层用：给自动修订过的条目加个可见标记（不进数据）。 */
export declare function revisionBadge(meta: {
    by?: 'auto' | 'user';
    origin?: string;
} | undefined): string;
export type RevisionTarget = 'fact' | 'rule';
export interface RevisionRecord {
    id: string;
    at: number;
    target: RevisionTarget;
    targetId: string;
    /** 修改前的完整快照（回滚用） */
    before: Record<string, unknown>;
    /** 修改后的完整快照 */
    after: Record<string, unknown>;
    /** 为什么改（一句话，人看得懂） */
    reason: string;
    /** 诊断：错在哪、以后怎么避免（准则修订要求 ≥4 字） */
    diagnosis: string;
    /** 触发来源：auto = 自动，user = 用户点的 */
    by: 'auto' | 'user';
    /** 已回滚过？ */
    undone?: boolean;
}
export interface ReviseGateInput {
    target: RevisionTarget;
    /** 支持新版本的证据条数（反证/用户纠正次数） */
    counterEvidence: number;
    /** 距上次修订过去了多少小时 */
    hoursSinceLastRevision: number;
    /** 用户是否明确说过"以前那条不对/改成这样" */
    userSaidSo: boolean;
    /** 今天已经自动改了几次 */
    todayCount?: number;
    /** 全局自动修订开关 */
    autoReviseEnabled: boolean;
    /** 冷却小时（默认 24，经验值） */
    cooldownHours?: number;
    /** 每天上限（默认 5，经验值） */
    maxPerDay?: number;
}
export type ReviseDecision = {
    allow: true;
    reason: string;
} | {
    allow: false;
    reason: string;
};
/** 每天自动修订上限——**经验值，未标定**（audit-evidence.md 判为无来源）。 */
export declare const MAX_REVISIONS_PER_DAY = 5;
/** 冷却小时数——**经验值，未标定**。 */
export declare const COOLDOWN_HOURS = 24;
/**
 * 自动修订门槛（依据 docs/l3-autorevise.md）。
 *
 * 最重要的一条不是阈值，而是**触发只能来自外部信号**：
 * Huang et al. 2024 实测，没有外部反馈的自我修订轮数越多越差
 * （GPT-3.5 GSM8K 75.9→74.7，Llama-2 CommonSenseQA 62.0→36.5）。
 * 所以这里没有"自查"这条路：没有你的明确纠正，就只提建议、不自改。
 *
 *   1. 你明确纠正过（≥1 次）→ 可以改；
 *   2. 只是"资料说要这样"→ 不改内容，只提候选（本函数直接拒绝）；
 *   3. 24 小时冷却、每天最多 5 次。
 * 阈值强度：第 1 条有实验支持（Huang 2024 外部反馈），第 3 条是工程取值。
 */
export declare function shouldAutoRevise(input: ReviseGateInput): ReviseDecision;
/** 兼容旧调用：不再往内容里写前缀，原样返回（标注改在数据字段与渲染层）。 */
export declare function markAuto(content: string): string;
/** 兼容旧调用：内容里没有前缀了，去掉历史前缀即可。 */
export declare function unmarkAuto(content: string): string;
/** append-only 修订存档。 */
export declare class RevisionLog {
    readonly filePath: string;
    private readonly clock;
    private cache;
    constructor(options: {
        filePath: string;
        now?: () => number;
    });
    private load;
    /**
     * 先存档。返回存档记录；调用方拿到它之后才去改数据。
     *
     * 注意顺序：**存档写盘成功才返回**，写不进去就抛错让调用方放弃修订——
     * 宁可这次不改，也不能出现"改了但没存档"。
     */
    backup(input: {
        target: RevisionTarget;
        targetId: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        reason: string;
        diagnosis: string;
        by: 'auto' | 'user';
    }): RevisionRecord;
    list(limit?: number): RevisionRecord[];
    /** 某个目标上次被改是什么时候（算冷却期用）。 */
    lastAt(targetId: string): number | undefined;
    markUndone(id: string): void;
}
