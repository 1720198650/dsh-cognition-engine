/**
 * src/proactive.ts — 主动发言闸门（默认不做）
 *
 * 机制来源：dsh-superagent-prototype 的
 *   - `src/admission.ts`：per-scope 准入矩阵，把消息判成 explicit / inferred / ignore
 *   - `docs/000-philosophy.md`：没人点名的工作先「只记录 agent 本来会做什么」，不发言
 *
 * 这里把它落成两段式判断：
 *   冷场触发 → observe() 永远只返回 OBSERVE（记录，不说话）
 *            → judge() 二次判断，才可能返回 SPEAK
 * 默认 recordOnly = true，即使二次判断通过也只记录草稿（SILENT + draft），
 * 和官方「proactive work only recorded」的默认姿态一致。
 */
export type Admission = 'explicit' | 'inferred' | 'ignore';
export type GateState = 'OBSERVE' | 'SPEAK' | 'SILENT';
/** 一次冷场信号。 */
export interface ColdSignal {
    /** 已经安静了多久（毫秒）。 */
    silenceMs: number;
    topic?: string;
    /** 这条消息是否直接点名了 agent。 */
    addressed?: boolean;
    /** 发送者是否在允许名单里。 */
    listed?: boolean;
}
export interface Observation {
    id: string;
    signal: ColdSignal;
    admission: Admission;
    score: number;
    recordedAt: number;
}
export interface GateDecision {
    state: GateState;
    admission: Admission;
    reason: string;
    observationId: string;
    /** 本来会说的话；recordOnly 时也留在这里，供事后复盘。 */
    draft?: string;
}
export interface ProactiveOptions {
    now?: () => number;
    /** 冷场多久算「冷」。 */
    idleThresholdMs?: number;
    /** 二次判断的通过线。 */
    minScore?: number;
    /** 默认只记录不发言（官方默认姿态）。 */
    recordOnly?: boolean;
    /** 两次发言之间的冷却，避免刷屏。 */
    cooldownMs?: number;
}
/** 准入矩阵：与官方 ADMISSION_DEFAULTS 同构（点名的允许发送者恒为 explicit）。 */
export declare const ADMISSION_DEFAULTS: Readonly<Record<'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed', Admission>>;
/** 判断准入等级。 */
export declare function classify(signal: ColdSignal): Admission;
export declare class ProactiveGate {
    private readonly observations;
    private readonly seenTopics;
    private readonly clock;
    private readonly idleThresholdMs;
    private readonly minScore;
    private readonly recordOnly;
    private readonly cooldownMs;
    private lastSpokeAt;
    private seq;
    constructor(options?: ProactiveOptions);
    get isRecordOnly(): boolean;
    /**
     * 第一段：冷场触发。
     * 永远不在这里生成发言——只把观察记下来，返回 OBSERVE。
     */
    observe(signal: ColdSignal): GateDecision;
    /**
     * 第二段：二次判断。
     * 只有这里才可能 SPEAK；recordOnly 模式下把结论降级为 SILENT 并保留草稿。
     */
    judge(observationId: string): GateDecision;
    /** 尚未二次判断的观察。 */
    pending(): Observation[];
    /** 观察的分数构成，便于解释为什么说/不说。 */
    explain(observationId: string): Record<string, number> | undefined;
    private score;
    private novelty;
    private compose;
}
