/**
 * src/sediment.ts — 沉积层（Step 1：落盘 + 校验）
 *
 * 设计见 docs/plan-sediment-v3.md。本文件只做三件事：
 *   1. 张力事件的**只追加哈希链**（不可逆是结构性的，不靠自觉）
 *   2. 4 维状态的单调/带惯性累加（不对称）
 *   3. 给生成层读的三个数（biasFor）——**不读日志正文，不产出任何文本**
 *
 * 不做什么：
 *   - 不生成人格描述；不改事实库；不回写记忆
 *   - 不接奖励/评分；不提供"重置"（回滚只能追加 manual 事件）
 *
 * 零依赖：只用 node:crypto / node:fs / node:path。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { textSimilarity } from "./memory.js";
export const DIMS = ['retention', 'caution', 'openness', 'attachment'];
const ZERO_HASH = '0'.repeat(64);
const DEFAULT_ETA = 0.02;
const DEFAULT_THRESHOLD = 0.45;
/** 翻转强度：否定/反义命中 = 1；语气弱化 = 0.5；纯补充 = 0。 */
const HARD_FLIP = /(不对|不是|取消|作废|推翻|改成|换成|改为|不再|停止|撤销)/;
const SOFT_FLIP = /(其实|更准确|严格讲|准确说|补充一下)/;
export function detectFlip(_oldText, newText, reason = '') {
    // 只看「新的说法」和「取代理由」——绝不能把旧文本里的翻转词算进来，
    // 否则一次翻案之后的每一条补充都会被误判成翻案（实测踩过）。
    const signal = `${newText} ${reason}`;
    if (HARD_FLIP.test(signal))
        return { flip: 1, kind: 'reversal' };
    if (SOFT_FLIP.test(signal))
        return { flip: 0.5, kind: 'softening' };
    return { flip: 0, kind: 'supplement' };
}
const POLARITY = {
    reversal: { retention: 1, caution: 1, openness: -1, attachment: 0 },
    softening: { retention: 1, caution: -1, openness: 1, attachment: 0 },
    supplement: { retention: 0, caution: 0, openness: 0, attachment: 0 },
};
/** 规范化序列化：字段顺序固定、数字 6 位，保证同一事件永远同一哈希。 */
export function canonicalEvent(event) {
    const d = event.delta;
    return [
        event.prevHash,
        String(event.seq),
        String(event.at),
        event.kind,
        event.subject,
        event.from ?? '',
        event.to ?? '',
        event.tension.toFixed(6),
        [d.retention, d.caution, d.openness, d.attachment].map((x) => x.toFixed(6)).join(','),
    ].join('|');
}
export function hashEvent(event) {
    return createHash('sha256').update(canonicalEvent(event)).digest('hex');
}
/**
 * 一次真实取代 → 沉积层事件（单向：事实 → 偏置）。
 * 抽成纯函数便于单测；`lookup` 由调用方提供（插件里就是 memory.get）。
 * 找不到任一事实就静默返回——取代已被别处处理，这里不报错。
 */
export function observeSupersedeFrom(store, lookup, oldId, newId, reason) {
    const oldFact = lookup(oldId);
    const newFact = lookup(newId);
    if (oldFact === undefined || newFact === undefined)
        return;
    store.observe({
        subject: newFact.subject,
        from: oldId,
        to: newId,
        oldText: oldFact.content,
        newText: newFact.content,
        ...(reason === undefined ? {} : { reason }),
    });
}
export class SedimentStore {
    filePath;
    clock;
    eta;
    shadow;
    threshold;
    events = [];
    dims = { retention: 0.5, caution: 0.5, openness: 0.5, attachment: 0.5 };
    direction = { retention: 0, caution: 0, openness: 0, attachment: 0 };
    loaded = false;
    recentTensions = [];
    /** subject → 最后一次出现的事件序号（用于 K 轮作用域，Step 4 用）。 */
    lastSeen = new Map();
    constructor(options) {
        this.filePath = options.filePath;
        this.clock = options.now ?? (() => Date.now());
        this.eta = options.eta ?? DEFAULT_ETA;
        this.shadow = options.shadow !== false;
        this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
    }
    /** 读文件并**重放**状态（状态永远由事件推导，不单独存快照）。 */
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        if (!existsSync(this.filePath))
            return false;
        const raw = readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '');
        this.events = [];
        this.dims = { retention: 0.5, caution: 0.5, openness: 0.5, attachment: 0.5 };
        this.direction = { retention: 0, caution: 0, openness: 0, attachment: 0 };
        this.recentTensions = [];
        this.lastSeen.clear();
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch {
                break; // 半行/损坏：停在能读到的最后一条，后续由 verify 报告
            }
            this.events.push(parsed);
            this.applyEvent(parsed);
        }
        return true;
    }
    /** 把一条事件的状态效果叠加回来（只用于重放与写入后同步）。 */
    applyEvent(event) {
        for (const dim of DIMS) {
            const d = event.delta[dim] ?? 0;
            if (d !== 0) {
                const dir = Math.sign(d);
                if (this.direction[dim] === 0)
                    this.direction[dim] = dir;
                this.dims[dim] = Number(Math.min(1, Math.max(0, this.dims[dim] + d)).toFixed(6));
            }
        }
        if (event.kind === 'tension' && event.tension > 0) {
            this.recentTensions.push(event.tension);
            if (this.recentTensions.length > 20)
                this.recentTensions.shift();
        }
        if (event.subject !== '—')
            this.lastSeen.set(event.subject, event.seq);
    }
    append(event) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
        this.events.push(event);
        this.applyEvent(event);
    }
    /**
     * 唯一写入口。
     * 纯补充（flip=0）或张力不足 → 不写事件、不改状态。
     */
    observe(input) {
        this.loadSync();
        const { flip, kind } = detectFlip(input.oldText, input.newText, input.reason ?? '');
        if (flip === 0)
            return { skipped: true, reason: '纯补充（flip=0）不触发位移' };
        const similarity = textSimilarity(input.oldText, input.newText);
        const tension = Number((similarity * flip).toFixed(6));
        if (tension < this.threshold) {
            return { skipped: true, reason: `张力 ${tension} 未达阈值 ${this.threshold}` };
        }
        // 证据绑定：没有双 id 的张力事件拒绝写入（ARPM 的教训）
        if (input.from === null || input.to === null) {
            return { skipped: true, reason: '缺少 from/to 事实 id，拒绝写入（证据绑定）' };
        }
        const polarity = { ...POLARITY[kind] };
        if (input.personRelated === true)
            polarity.attachment = 1;
        const delta = { retention: 0, caution: 0, openness: 0, attachment: 0 };
        const nextDims = { ...this.dims };
        for (const dim of DIMS) {
            let raw = this.eta * tension * polarity[dim];
            if (raw === 0)
                continue;
            const dir = Math.sign(raw);
            // 反向位移只给 1/4 幅度，且不翻方向（滞后）
            if (this.direction[dim] !== 0 && dir !== this.direction[dim])
                raw *= 0.25;
            const next = Math.min(1, Math.max(0, nextDims[dim] + raw));
            delta[dim] = Number((next - nextDims[dim]).toFixed(6));
            nextDims[dim] = Number(next.toFixed(6));
        }
        const seq = this.events.length;
        const draft = {
            seq,
            at: input.at ?? this.clock(),
            kind: 'tension',
            subject: input.subject,
            from: input.from,
            to: input.to,
            similarity: Number(similarity.toFixed(6)),
            flip,
            tension,
            delta,
            prevHash: seq === 0 ? ZERO_HASH : this.events[seq - 1].hash,
        };
        const event = { ...draft, hash: hashEvent(draft) };
        this.append(event);
        // 前提误差（可选）：与最近若干次均值偏差大，小幅调 caution（幅度 1/3）
        if (input.protention === true && this.recentTensions.length >= 4) {
            const history = this.recentTensions.slice(0, -1).slice(-10);
            const expected = history.reduce((a, b) => a + b, 0) / history.length;
            if (Math.abs(tension - expected) > 0.2) {
                const bump = Number(((this.eta / 3) * Math.sign(tension - expected)).toFixed(6));
                const next = Number(Math.min(1, Math.max(0, this.dims.caution + bump)).toFixed(6));
                const delta2 = { retention: 0, caution: Number((next - this.dims.caution).toFixed(6)), openness: 0, attachment: 0 };
                const draft2 = {
                    ...draft,
                    seq: this.events.length,
                    kind: 'protentionError',
                    tension: 0,
                    delta: delta2,
                    prevHash: this.events[this.events.length - 1].hash,
                    note: `期望 ${expected.toFixed(3)}，实际 ${tension.toFixed(3)}`,
                };
                this.append({ ...draft2, hash: hashEvent(draft2) });
            }
        }
        return { skipped: false, seq: event.seq, tension: event.tension, delta: event.delta };
    }
    /** 巩固：连续无冲突时缓慢降 retention（地板 0.2），也是追加事件。 */
    settle(subject = '—') {
        this.loadSync();
        const next = Math.max(0.2, this.dims.retention * 0.995);
        const delta = { retention: Number((next - this.dims.retention).toFixed(6)), caution: 0, openness: 0, attachment: 0 };
        if (delta.retention === 0)
            return null;
        const draft = {
            seq: this.events.length,
            at: this.clock(),
            kind: 'settle',
            subject,
            from: null,
            to: null,
            similarity: 0,
            flip: 0,
            tension: 0,
            delta,
            prevHash: this.events.length === 0 ? ZERO_HASH : this.events[this.events.length - 1].hash,
        };
        const event = { ...draft, hash: hashEvent(draft) };
        this.append(event);
        return event;
    }
    state() {
        this.loadSync();
        return { ...this.dims };
    }
    /**
     * 生成层读取的三个数。
     * Step 1 只实现"按 subject 是否近期出现过"的中性回退，权重映射在 Step 4 才启用。
     */
    biasFor(subject, scopeTurns = 20) {
        this.loadSync();
        // 影子期：只记录不生效——这是 Step 3 的全部含义。
        if (this.shadow)
            return { strictThresholdDelta: 0, cautionWeight: 0, relateBoost: 0 };
        const last = this.lastSeen.get(subject);
        const neutral = { strictThresholdDelta: 0, cautionWeight: 0, relateBoost: 0 };
        if (last === undefined)
            return neutral;
        if (this.events.length - last > scopeTurns)
            return neutral;
        return {
            strictThresholdDelta: Number(((this.dims.retention - 0.5) * 0.2).toFixed(4)),
            cautionWeight: Number(Math.max(0, this.dims.caution - 0.5).toFixed(4)),
            relateBoost: 0,
        };
    }
    /** 视角窗：拿当前 4 维（**不受影子模式限制**，因为是预览）+ 一组事实算出来。 */
    perspective(subject, facts) {
        this.loadSync();
        return computePerspective(this.dims, subject, facts);
    }
    /** 只读日志（给界面）。不含参数值。 */
    log(limit = 50) {
        this.loadSync();
        return this.events.slice(-Math.max(1, limit));
    }
    /** 校验整条链。返回第一处断点；**不自动修复**。 */
    verify() {
        this.loadSync();
        let prev = ZERO_HASH;
        for (const event of this.events) {
            const { hash, ...rest } = event;
            const expect = hashEvent({ ...rest, prevHash: prev });
            if (event.prevHash !== prev || hash !== expect) {
                return { ok: false, brokenAt: event.seq, total: this.events.length };
            }
            prev = hash;
        }
        return { ok: true, brokenAt: null, total: this.events.length };
    }
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
export function computePerspective(dims, subject, facts) {
    const list = facts.filter((fact) => fact.subject === subject);
    const stance = dims.caution < 0.65 ? 'direct' : dims.caution < 0.78 ? 'ask-first' : 'wait';
    const note = '这是她此刻看到的世界，不是她本人。只读，不改变任何东西。';
    if (list.length === 0) {
        return { subject, noticed: [], suppressed: [], stance, note: '这个主题还没有记忆，看不到什么。' };
    }
    const byImportance = [...list].sort((a, b) => b.importance - a.importance || b.validFrom - a.validFrom);
    const neutralRank = new Map(byImportance.map((fact, index) => [fact.id, index + 1]));
    const age = (fact) => {
        const times = list.map((item) => item.validFrom);
        const min = Math.min(...times);
        const max = Math.max(...times);
        if (max === min)
            return 0.5;
        return 1 - (fact.validFrom - min) / (max - min); // 越旧越接近 1
    };
    const biasScore = (fact) => fact.importance +
        (dims.retention - 0.5) * age(fact) * 0.8 +
        (dims.attachment - 0.5) * fact.importance * 0.4;
    const byBias = [...list].sort((a, b) => biasScore(b) - biasScore(a) || b.validFrom - a.validFrom);
    const biasedRank = new Map(byBias.map((fact, index) => [fact.id, index + 1]));
    const label = (fact) => {
        const text = fact.content.replace(/\s+/g, ' ');
        return text.length > 34 ? `${text.slice(0, 34)}…` : text;
    };
    const noticed = [];
    for (const fact of byBias.slice(0, 3)) {
        const was = neutralRank.get(fact.id) ?? 0;
        const now = biasedRank.get(fact.id) ?? 0;
        if (now < was) {
            noticed.push({ id: fact.id, label: label(fact), wasRank: was, nowRank: now, why: '旧结论的分量把它往前挪' });
        }
    }
    const suppressed = [];
    for (const fact of byImportance.slice(0, 3)) {
        const now = biasedRank.get(fact.id) ?? 0;
        const was = neutralRank.get(fact.id) ?? 0;
        if (now > 3 && was <= 3) {
            suppressed.push({ id: fact.id, label: label(fact), wasRank: was, nowRank: now, why: '细节被压后（她这次不太愿意翻旧账）' });
        }
    }
    return { subject, noticed, suppressed, stance, note };
}
