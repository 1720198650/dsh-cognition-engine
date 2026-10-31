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
/** 准入矩阵：与官方 ADMISSION_DEFAULTS 同构（点名的允许发送者恒为 explicit）。 */
export const ADMISSION_DEFAULTS = Object.freeze({
    listedUnaddressed: 'inferred',
    unlistedAddressed: 'ignore',
    unlistedUnaddressed: 'ignore',
});
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
/** 判断准入等级。 */
export function classify(signal) {
    const listed = signal.listed ?? false;
    const addressed = signal.addressed ?? false;
    if (listed && addressed)
        return 'explicit';
    if (listed)
        return ADMISSION_DEFAULTS.listedUnaddressed;
    if (addressed)
        return ADMISSION_DEFAULTS.unlistedAddressed;
    return ADMISSION_DEFAULTS.unlistedUnaddressed;
}
export class ProactiveGate {
    observations = new Map();
    seenTopics = new Set();
    clock;
    idleThresholdMs;
    minScore;
    recordOnly;
    cooldownMs;
    lastSpokeAt = Number.NEGATIVE_INFINITY;
    seq = 0;
    constructor(options = {}) {
        this.clock = options.now ?? (() => Date.now());
        this.idleThresholdMs = options.idleThresholdMs ?? 5 * 60_000;
        this.minScore = options.minScore ?? 0.6;
        this.recordOnly = options.recordOnly ?? true;
        this.cooldownMs = options.cooldownMs ?? 10 * 60_000;
    }
    get isRecordOnly() {
        return this.recordOnly;
    }
    /**
     * 第一段：冷场触发。
     * 永远不在这里生成发言——只把观察记下来，返回 OBSERVE。
     */
    observe(signal) {
        const admission = classify(signal);
        const id = `obs-${++this.seq}`;
        if (admission === 'ignore') {
            return {
                state: 'SILENT',
                admission,
                reason: '准入为 ignore：发送者不在允许名单且没有点名，按官方默认不做',
                observationId: id,
            };
        }
        const observation = {
            id,
            signal,
            admission,
            score: this.score(signal, admission),
            recordedAt: this.clock(),
        };
        this.observations.set(id, observation);
        return {
            state: 'OBSERVE',
            admission,
            reason: '已记录观察，等待二次判断（默认不做，不在此处生成发言）',
            observationId: id,
        };
    }
    /**
     * 第二段：二次判断。
     * 只有这里才可能 SPEAK；recordOnly 模式下把结论降级为 SILENT 并保留草稿。
     */
    judge(observationId) {
        const observation = this.observations.get(observationId);
        if (observation === undefined) {
            return {
                state: 'SILENT',
                admission: 'ignore',
                reason: `未知观察 ${observationId}`,
                observationId,
            };
        }
        const { signal, admission, score } = observation;
        if (score < this.minScore) {
            return { state: 'SILENT', admission, reason: `分数 ${score.toFixed(2)} 未过线 ${this.minScore}`, observationId };
        }
        const now = this.clock();
        if (now - this.lastSpokeAt < this.cooldownMs) {
            return { state: 'SILENT', admission, reason: '处于冷却期，本轮不发言', observationId };
        }
        const draft = this.compose(signal);
        if (this.recordOnly) {
            return {
                state: 'SILENT',
                admission,
                reason: 'recordOnly：只记录本来会说的话，不发送',
                observationId,
                draft,
            };
        }
        this.lastSpokeAt = now;
        if (signal.topic !== undefined)
            this.seenTopics.add(signal.topic);
        return { state: 'SPEAK', admission, reason: `分数 ${score.toFixed(2)} 过线，允许发言`, observationId, draft };
    }
    /** 尚未二次判断的观察。 */
    pending() {
        return [...this.observations.values()];
    }
    /** 观察的分数构成，便于解释为什么说/不说。 */
    explain(observationId) {
        const observation = this.observations.get(observationId);
        if (observation === undefined)
            return undefined;
        return {
            silence: clamp01(observation.signal.silenceMs / this.idleThresholdMs),
            novelty: this.novelty(observation.signal),
            admission: observation.admission === 'explicit' ? 1 : observation.admission === 'inferred' ? 0.5 : 0,
            score: observation.score,
        };
    }
    score(signal, admission) {
        if (admission === 'ignore')
            return 0;
        const silence = clamp01(signal.silenceMs / this.idleThresholdMs);
        const novelty = this.novelty(signal);
        const weight = admission === 'explicit' ? 1 : 0.5;
        return 0.4 * silence + 0.3 * novelty + 0.3 * weight;
    }
    novelty(signal) {
        if (signal.topic === undefined)
            return 0.3;
        return this.seenTopics.has(signal.topic) ? 0.2 : 1;
    }
    compose(signal) {
        const topic = signal.topic ?? '当前话题';
        return `关于「${topic}」，我可以补充一条可验证的观察（草稿，未发送）。`;
    }
}
