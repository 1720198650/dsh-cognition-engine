/**
 * src/mood.ts — MoodStateMachine
 *
 * 两个连续量 + 一个带迟滞的状态标签：
 *   energy      0..100    精力，随时间自然衰减，休息回补
 *   favorability -100..100 好感度，事件驱动，随时间向 0 缓慢回归
 *
 * 「迟滞（hysteresis）」是关键：进入「戒备」的门槛是 -20，退出要回到 -12 以上，
 * 避免好感在阈值附近抖动时状态条疯狂跳字。
 */
export type MoodEvent = 'praise' | 'insult' | 'success' | 'failure' | 'conflict' | 'rest' | 'ignore';
export type MoodLabel = '兴奋' | '愉悦' | '平静' | '戒备' | '敌意' | '疲惫';
export interface MoodDelta {
    energy: number;
    favorability: number;
}
export interface MoodSnapshot {
    energy: number;
    favorability: number;
    mood: MoodLabel;
    /** 状态条文本，例如 `[能量 ███████░░░ 72%] [好感 ██████░░░░ +18] 状态:平静`。 */
    bar: string;
    at: number;
}
/** 一个数值区间的含义。 */
export interface MoodBand {
    /** 区间下界（含）。 */
    min: number;
    /** 区间上界（不含）。 */
    max: number;
    label: string;
    /** 这个区间代表工作处于什么状态。 */
    meaning: string;
}
/** 「为什么是这个值 + 这个值说明什么」。 */
export interface MoodReading {
    value: number;
    initial: number;
    /** 事件造成的累计变化。 */
    fromEvents: number;
    /** 时间流逝造成的累计变化。 */
    fromTime: number;
    band: string;
    meaning: string;
    /** 一句话解释：初值 + 哪些事件 + 时间 = 当前值。 */
    reason: string;
    /** 是否被上下限钳住。 */
    clamped: 'none' | 'min' | 'max';
    events: Array<{
        event: MoodEvent;
        at: number;
        delta: MoodDelta;
    }>;
}
export interface MoodExplanation {
    energy: MoodReading;
    favorability: MoodReading;
    mood: {
        label: MoodLabel;
        reason: string;
        meaning: string;
    };
    /** 数值是否真的会自己变化（当前插件里 tick 未被调用时为 false）。 */
    timeDriven: boolean;
}
/** 能量的四档含义。 */
export declare const ENERGY_BANDS: readonly MoodBand[];
/** 好感的五档含义。 */
export declare const FAVORABILITY_BANDS: readonly MoodBand[];
export interface MoodOptions {
    energy?: number;
    favorability?: number;
    now?: () => number;
    /** 每分钟自然流失的精力，默认 1.5。 */
    energyDrainPerMinute?: number;
    /** 每分钟好感向 0 回归的速度，默认 0.5。 */
    favorabilityDriftPerMinute?: number;
    /** 状态条格子数，默认 10。 */
    barWidth?: number;
}
/** 每种事件对两个连续量的基础影响。 */
export declare const MOOD_DELTAS: Readonly<Record<MoodEvent, MoodDelta>>;
/** 可落盘的心情状态。 */
export interface MoodState {
    energy: number;
    favorability: number;
    log: Array<{
        event: MoodEvent;
        at: number;
        delta: MoodDelta;
    }>;
}
export declare class MoodStateMachine {
    private energyValue;
    private favorabilityValue;
    private label;
    private readonly clock;
    private readonly energyDrainPerMinute;
    private readonly favorabilityDriftPerMinute;
    private readonly barWidth;
    private lastTickAt;
    private readonly log;
    /** 启动时的初值，用来解释「为什么现在是这个数」。 */
    private readonly initialEnergy;
    private readonly initialFavorability;
    /** 时间流逝造成的累计变化（tick 从未被调用时恒为 0）。 */
    private drainedEnergy;
    private driftedFavorability;
    /** tick 被真正推进过几次：为 0 说明数值只会被事件改变。 */
    private tickCount;
    constructor(options?: MoodOptions);
    get energy(): number;
    get favorability(): number;
    get mood(): MoodLabel;
    /** 施加一个事件，返回新快照。intensity 是力度倍数，默认 1。 */
    apply(event: MoodEvent, intensity?: number): MoodSnapshot;
    /** 推进时间：精力自然流失，好感向 0 回归。 */
    tick(dtMs: number): MoodSnapshot;
    /** 按真实时钟推进到当前时刻。 */
    sync(): MoodSnapshot;
    snapshot(): MoodSnapshot;
    /** 渲染状态条。 */
    statusBar(): string;
    /** 最近事件流水（最多 100 条）。 */
    history(): ReadonlyArray<{
        event: MoodEvent;
        at: number;
        delta: MoodDelta;
    }>;
    /** 导出当前状态，供落盘。 */
    serialize(): MoodState;
    /** 从落盘状态恢复。 */
    restore(state: MoodState): void;
    /** 回到初始值（页面的「清空心情」用）。 */
    reset(): void;
    /**
     * 解释当前数值：为什么是这个值、这个值说明工作处于什么状态。
     * 只读，不改变任何状态。
     */
    explain(): MoodExplanation;
    private reading;
    private labelReason;
    private bar;
    private recomputeLabel;
}
