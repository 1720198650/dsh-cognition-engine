/** 自动改过的内容统一带这个前缀，肉眼和检索都能认出来。 */
export declare const AUTO_MARK = "[\u81EA\u52A8\u4FEE\u8BA2]";
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
    /** 全局自动修订开关 */
    autoReviseEnabled: boolean;
}
export type ReviseDecision = {
    allow: true;
    reason: string;
} | {
    allow: false;
    reason: string;
};
/**
 * 自动修订门槛（依据 docs/l3-autorevise.md）：
 *   - 事实：≥2 条反证即可（有双时态，改错能回滚，代价低）；
 *   - 准则：必须「用户明确说过」+ ≥2 条反证（准则每轮注入，改错影响面大）；
 *   - 任何目标都有 24 小时冷却，避免来回抖；
 *   - 开关关着就一律不改。
 */
export declare function shouldAutoRevise(input: ReviseGateInput): ReviseDecision;
/** 自动改过的内容加标注；已带标注的不重复加。 */
export declare function markAuto(content: string): string;
/** 去掉标注（回滚时用，避免回滚后的内容还挂着"自动修订"）。 */
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
