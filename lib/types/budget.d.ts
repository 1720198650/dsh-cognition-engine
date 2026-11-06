/**
 * src/budget.ts — 学习预算 + 五条停止信号（S6）
 *
 * ## 为什么需要「预算」这种看起来官僚的东西
 *
 * 学习系统的失败模式不是「学不会」，而是**学太多**：
 * - 上下文被塞满（准则越多，每条分到的注意力越少，反而更差）；
 * - 学进来一堆一次性事实和环境相关的噪音；
 * - 同一个主题反复翻烙饼（改来改去），把稳定知识搅乱。
 *
 * 所以这里给「学习」本身加配额：每周最多改几条、学几条。
 * 配额不是敌人——**它逼我们把名额花在真正值得的条目上**。
 *
 * ## 公式
 *
 *   W = clamp(max(ceil(N × 1%), 8), 4, 12)     N = 当前生效准则数
 *   默认 8 = 修旧 5 + 学新 2 + 预留 1
 *
 * 超过配额怎么办：**转入 shadow 试运行**，而不是硬拦。
 * 这样「想学」和「不许污染上下文」两件事都能满足。
 */
export type LearnKind = 'revise' | 'new';
export interface BudgetQuota {
    total: number;
    revise: number;
    new: number;
    reserve: number;
}
export interface BudgetUsed {
    total: number;
    revise: number;
    new: number;
}
/** 一条停止信号。 */
export interface StopSignal {
    /** 信号编号（稳定，便于页面与日志对齐）。 */
    code: 'futile' | 'still-wrong' | 'overcrowded' | 'flip-flop' | 'idle-quota';
    /** 人话说明。 */
    reason: string;
    /** 触发后应该做什么。 */
    action: 'pause-new' | 'revise-only' | 'freeze-subject' | 'shrink-quota';
}
export interface BudgetDoc {
    schema: 'cognition.budget';
    version: 1;
    /** ISO 周，如 2026-W45。跨周自动重置 used。 */
    week: string;
    activeRules: number;
    quota: BudgetQuota;
    used: BudgetUsed;
    /** 上周没用完的名额不累积，避免「攒着一次学一堆」。 */
    debt: number;
    paused: boolean;
    pauseReason: string | null;
    pausedUntilWeek: string | null;
    updatedAt: number;
}
export interface BudgetStoreOptions {
    filePath?: string;
    now?: () => number;
}
/** ISO 周键（周一起始）。 */
export declare function isoWeekKey(date: Date): string;
/** 按当前生效准则数算配额。 */
export declare function computeQuota(activeRules: number): BudgetQuota;
export declare class BudgetStore {
    #private;
    private readonly filePath;
    private readonly clock;
    private doc;
    private loaded;
    private saveError;
    constructor(options?: BudgetStoreOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    /** 跨周重置：used 归零，未用名额不结转。暂停到期自动解除。 */
    rolloverIfNeeded(): {
        rolled: boolean;
        from?: string;
        to?: string;
    };
    /** 同步当前生效准则数并重算配额（配额随规模变化）。 */
    syncActiveRules(activeRules: number): void;
    status(): BudgetDoc & {
        remaining: BudgetUsed;
        canLearnNew: boolean;
        canRevise: boolean;
    };
    /** 能不能学（不消耗）。 */
    canLearn(kind: LearnKind): {
        ok: boolean;
        reason?: string;
    };
    /** 消耗一个名额。调用方应先用 canLearn 检查。 */
    consume(kind: LearnKind): {
        ok: boolean;
        used: BudgetUsed;
        reason?: string;
    };
    /** 触发停止信号 → 暂停学新（到下周一自动解除）。 */
    pause(signal: StopSignal): void;
    resume(): void;
    /**
     * 五条停止信号（docs/upgrade-plan-v3.md §7.2）。
     *
     * 全部用**可观测的计数**判，不做主观判断。没数据就当没触发——
     * 宁可漏报也不误停，因为误停会让学习整体停摆。
     */
    evaluateSignals(input: {
        /** 近 3 周新增准则的累计命中次数。 */
        newRulesHits3w?: number;
        /** 近 2 周出现的负反馈条数（未修正）。 */
        negativeUnfixed2w?: number;
        /** 生效准则总数。 */
        activeRules?: number;
        /** 证据链失效（orphaned）准则数。 */
        orphanedRules?: number;
        /** 近 30 天 supersede 次数最多的 subject 的计数。 */
        maxSupersede30d?: number;
        /** 上周「学新」名额使用率 0..1。 */
        lastWeekNewUsageRatio?: number;
    }): StopSignal[];
}
