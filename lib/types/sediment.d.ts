export declare const DIMS: readonly ["retention", "caution", "openness", "attachment"];
export type Dim = (typeof DIMS)[number];
export interface SedimentState {
    retention: number;
    caution: number;
    openness: number;
    attachment: number;
}
/**
 * 判定的五类（v4.1，依据 docs/m0-findings.md 的实测）：
 * 「取代」≠「翻案」——3 次真实取代里真翻案只有 1 次，照旧设计会 2/3 误记。
 */
export type SedimentClass = 'reversal' | 'narrowing' | 'reframe' | 'extension' | 'supplement';
/** 一次取代的语义判定。**必须冻结进事件**，否则重放结果不同、哈希链会断。 */
export interface SedimentJudge {
    class: SedimentClass;
    /** 0..1；低于 minimumJudgeConfidence 视为 uncertain，不写状态事件 */
    confidence: number;
    /** 原文片段（不是编号），人能一眼看出"它凭什么这么判" */
    evidenceFrom: string;
    evidenceTo: string;
    /** 'rules' 或具体模型名 —— 换模型后判定风格会变，统计要分层 */
    model: string;
}
/** 各类别的幅度系数（不是 0/1 二分，这是 M0 实测的直接产物）。 */
export declare const CLASS_WEIGHT: Record<SedimentClass, number>;
/** 低于这个置信度：不写状态事件，只留日志等人看（fail-closed）。 */
export declare const DEFAULT_MIN_JUDGE_CONFIDENCE = 0.6;
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
    /** 冻结的语义判定（v2 起必有；v1 旧行没有，校验会报断链） */
    judge?: SedimentJudge;
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
    /** 取代理由（人话），常用于判断是不是翻案。 */
    reason?: string;
    /** 预先算好的语义判定（LLM 或规则）；不传则用规则兜底 */
    judge?: SedimentJudge;
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
    /** 影子模式：只记录，**biasFor 一律返回中性**（Step 3）。默认 true。 */
    shadow?: boolean;
    threshold?: number;
}
export declare function classifyByRules(oldText: string, newText: string, reason?: string): SedimentJudge;
/** 兼容旧调用：把判定折算成 flip（0/0.5/1）。新代码请直接用 classifyByRules / LLM 判定。 */
export declare function detectFlip(_oldText: string, newText: string, reason?: string): {
    flip: number;
    kind: 'reversal' | 'softening' | 'supplement';
};
/** 向后兼容：旧代码引用 POLARITY 的地方（v4.1 起内部走 CLASS_POLARITY）。 */
export declare const POLARITY: Record<'reversal' | 'softening' | 'supplement', SedimentState>;
/** 规范化序列化：字段顺序固定、数字 6 位，保证同一事件永远同一哈希。 */
export declare function canonicalEvent(event: Omit<SedimentEvent, 'hash'>): string;
export declare function hashEvent(event: Omit<SedimentEvent, 'hash'>): string;
/**
 * 一次真实取代 → 沉积层事件（单向：事实 → 偏置）。
 * 抽成纯函数便于单测；`lookup` 由调用方提供（插件里就是 memory.get）。
 * 找不到任一事实就静默返回——取代已被别处处理，这里不报错。
 */
export declare function observeSupersedeFrom(store: SedimentStore, lookup: (id: string) => {
    subject: string;
    content: string;
} | undefined, oldId: string, newId: string, reason?: string, judge?: SedimentJudge): void;
export declare class SedimentStore {
    readonly filePath: string;
    private readonly clock;
    private readonly eta;
    private readonly shadow;
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
    /** 视角窗：拿当前 4 维（**不受影子模式限制**，因为是预览）+ 一组事实算出来。 */
    perspective(subject: string, facts: readonly PerspectiveFact[]): Perspective;
    /** 自检摘要：只给结论与「哪几维动了」，**不给数值**（界面上只用它）。 */
    summary(): SedimentSummary;
    /** 只读日志（给界面）。不含参数值。 */
    log(limit?: number): SedimentEvent[];
    /** 校验整条链。返回第一处断点；**不自动修复**。 */
    verify(): {
        ok: boolean;
        brokenAt: number | null;
        total: number;
    };
}
export interface PerspectiveFact {
    id: string;
    subject: string;
    content: string;
    validFrom: number;
    importance: number;
}
export interface PerspectiveItem {
    id: string;
    label: string;
    wasRank: number;
    nowRank: number;
    why: string;
}
export interface Perspective {
    subject: string;
    noticed: PerspectiveItem[];
    suppressed: PerspectiveItem[];
    stance: 'direct' | 'ask-first' | 'wait';
    note: string;
}
/**
 * 计算视角。
 *
 * 规则（保持可解释、可单测）：
 * - 中性排序：importance 降序，同分按新→旧
 * - 偏置排序：retention 抬高「更旧」的事实（旧结论分量重）；attachment 抬高 importance
 * - 前 3 名进入「会先看到」；原本在前 3、现在掉出去的进「会忽略」
 * - 姿态由 caution 分档（<0.65 直接给 / <0.78 先确认 / 否则再等等）
 *
 * 注意：**影子期也照常计算**——这是预览，不是生效；只有 biasFor 才受 shadow 限制。
 */
export declare function computePerspective(dims: SedimentState, subject: string, facts: readonly PerspectiveFact[]): Perspective;
export interface SedimentSummary {
    verdict: 'empty' | 'neutral' | 'drifted' | 'broken';
    events: number;
    tensions: number;
    /** 已经偏离中性的维度名（对外只说"哪几维"，不说数值）。 */
    moved: string[];
    chainOk: boolean;
    brokenAt: number | null;
    lastAt: number | null;
}
export declare function summarizeSediment(events: readonly SedimentEvent[], brokenAt: number | null): SedimentSummary;
