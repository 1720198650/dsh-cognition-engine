export declare const DIMS: readonly ["retention", "caution", "openness", "attachment"];
export type Dim = (typeof DIMS)[number];
export interface SedimentState {
    retention: number;
    caution: number;
    openness: number;
    attachment: number;
}
export interface SedimentEvent {
    seq: number;
    at: number;
    kind: 'tension' | 'protentionError' | 'settle' | 'manual';
    subject: string;
    from: string | null;
    to: string | null;
    similarity: number;
    flip: number;
    tension: number;
    delta: SedimentState;
    prevHash: string;
    hash: string;
    note?: string;
}
export interface ObserveInput {
    subject: string;
    from: string | null;
    to: string | null;
    oldText: string;
    newText: string;
    personRelated?: boolean;
    protention?: boolean;
    at?: number;
}
export interface ObserveResult {
    skipped: boolean;
    reason?: string;
    seq?: number;
    tension?: number;
    delta?: SedimentState;
}
export interface SedimentOptions {
    filePath: string;
    now?: () => number;
    /** 幂律/指数衰减的开关先留位，Step 1 不参与计算。 */
    eta?: number;
    threshold?: number;
}
export declare function detectFlip(oldText: string, newText: string): {
    flip: number;
    kind: 'reversal' | 'softening' | 'supplement';
};
/** 规范化序列化：字段顺序固定、数字 6 位，保证同一事件永远同一哈希。 */
export declare function canonicalEvent(event: Omit<SedimentEvent, 'hash'>): string;
export declare function hashEvent(event: Omit<SedimentEvent, 'hash'>): string;
export declare class SedimentStore {
    readonly filePath: string;
    private readonly clock;
    private readonly eta;
    private readonly threshold;
    private events;
    private dims;
    private direction;
    private loaded;
    private recentTensions;
    /** subject → 最后一次出现的事件序号（用于 K 轮作用域，Step 4 用）。 */
    private lastSeen;
    constructor(options: SedimentOptions);
    /** 读文件并**重放**状态（状态永远由事件推导，不单独存快照）。 */
    loadSync(): boolean;
    /** 把一条事件的状态效果叠加回来（只用于重放与写入后同步）。 */
    private applyEvent;
    private append;
    /**
     * 唯一写入口。
     * 纯补充（flip=0）或张力不足 → 不写事件、不改状态。
     */
    observe(input: ObserveInput): ObserveResult;
    /** 巩固：连续无冲突时缓慢降 retention（地板 0.2），也是追加事件。 */
    settle(subject?: string): SedimentEvent | null;
    state(): SedimentState;
    /**
     * 生成层读取的三个数。
     * Step 1 只实现"按 subject 是否近期出现过"的中性回退，权重映射在 Step 4 才启用。
     */
    biasFor(subject: string, scopeTurns?: number): {
        strictThresholdDelta: number;
        cautionWeight: number;
        relateBoost: number;
    };
    /** 只读日志（给界面）。不含参数值。 */
    log(limit?: number): SedimentEvent[];
    /** 校验整条链。返回第一处断点；**不自动修复**。 */
    verify(): {
        ok: boolean;
        brokenAt: number | null;
        total: number;
    };
}
