/**
 * src/memory.ts — TemporalMemoryStore
 *
 * 双时态记忆存储，工程机制对齐 LongMemory（CaviraOSS/LongMemory）的
 * `src/core/temporal/bitemporal.ts` 与 `docs/temporal.md`：
 *
 *   - 两条独立时间轴：
 *       valid time    → validFrom / validTo     （事实在「世界」里何时为真）
 *       recorded time → recordedAt / supersededAt（系统在「事务时间」何时知道）
 *   - `validTo === null`     表示「仍然有效」
 *   - `supersededAt === null` 表示「仍是当前版本」
 *   - 闭合区间（写 validTo / supersededAt）不改变内容的 durable identity：
 *     hash 只由 subject + content + validFrom 计算，被取代的事实保留原 id 与 hash，
 *     只是从「当前视图」里退场。
 *   - 严格召回只取 current truth；历史召回保留被取代的真值（point-in-time truth）。
 *
 * 情绪联动（本次新增）：
 *   - `ingest()` 在「本条取代了旧事实」时返回 `onConflictTriggered = true`；
 *
 * 存储：纯 TypeScript + Map，无任何外部数据库。
 */
/** 召回口径。 */
import { describeRejection, evaluateAdmission } from "./admission.js";
const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
/** importance ≥ 此值视为「核心记忆」（对应需求里的 CORE 级）。 */
export const CORE_IMPORTANCE = 0.8;
/** 超过这个年龄的核心记忆会触发「怀旧」。 */
export const NOSTALGIA_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/* ------------------------------------------------------------------ */
/* 时间可见性：逐条对齐 LongMemory bitemporal.ts                        */
/* ------------------------------------------------------------------ */
/** 事实在世界时间 t 是否为真（含被取代的历史真值）。 */
export function isValidAt(fact, validTime) {
    return fact.validFrom <= validTime && (fact.validTo === null || validTime < fact.validTo);
}
/** 系统在事务时间 t 是否已经知道这条事实（含后来被取代的版本）。 */
export function isRecordedAt(fact, recordedTime) {
    return (fact.recordedAt <= recordedTime &&
        (fact.supersededAt === null || recordedTime < fact.supersededAt));
}
/** 是否「此刻的当前真值」：未被取代 + 已知 + 当前有效。 */
export function isCurrent(fact, now) {
    return fact.supersededAt === null && fact.recordedAt <= now && isValidAt(fact, now);
}
/* ------------------------------------------------------------------ */
/* 轻量文本相似度（无第三方库、无向量服务）                             */
/* ------------------------------------------------------------------ */
const CJK = /[\u4e00-\u9fff]+/g;
const LATIN = /[a-z0-9_]+/g;
/**
 * 中文虚词集合。
 *
 * 只用于过滤「纯虚词 bigram」——两个字都在集合里才丢弃（如「的是」「了的」），
 * 这样「在华东」这类混着实词的组合仍然保留。零依赖，内联四十余字即可。
 */
const CJK_STOPWORDS = new Set('的了是在和与或就都也很还又再而且因所以如果把这被给让从到对于为之其者呢吧吗啊呀哦嗯那这些么什怎样'.split(''));
/** 英文按词、中文按二元组切分，返回词频表（纯虚词 bigram 不产出）。 */
export function tokenize(text) {
    const counts = new Map();
    const lower = text.toLowerCase();
    for (const word of lower.match(LATIN) ?? []) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    for (const run of lower.match(CJK) ?? []) {
        if (run.length === 1) {
            if (CJK_STOPWORDS.has(run))
                continue;
            counts.set(run, (counts.get(run) ?? 0) + 1);
            continue;
        }
        for (let i = 0; i < run.length - 1; i += 1) {
            const gram = run.slice(i, i + 2);
            // 两个字都是虚词才算噪声；混着实词的一律保留
            if (CJK_STOPWORDS.has(gram[0] ?? '') && CJK_STOPWORDS.has(gram[1] ?? ''))
                continue;
            counts.set(gram, (counts.get(gram) ?? 0) + 1);
        }
    }
    return counts;
}
/** 余弦相似度。 */
export function cosine(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const [term, va] of a) {
        na += va * va;
        const vb = b.get(term);
        if (vb !== undefined)
            dot += va * vb;
    }
    for (const vb of b.values())
        nb += vb * vb;
    if (na === 0 || nb === 0)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
/** FNV-1a 32 位内容指纹（纯 TS，不依赖 node:crypto）。 */
export function contentHash(...parts) {
    let hash = 0x811c9dc5;
    const payload = parts.join('\u0000');
    for (let i = 0; i < payload.length; i += 1) {
        hash ^= payload.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
/** 从正文推导主题键：优先取冒号前的短语，否则取前 16 个字符。 */
export function deriveSubject(content) {
    const trimmed = content.trim();
    const sep = trimmed.search(/[:：]/);
    const head = sep > 0 ? trimmed.slice(0, sep) : trimmed.slice(0, 16);
    return head.replace(/\s+/g, ' ').trim().toLowerCase();
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
/* ------------------------------------------------------------------ */
/* TemporalMemoryStore                                                 */
/* ------------------------------------------------------------------ */
export class TemporalMemoryStore {
    facts = new Map();
    bySubject = new Map();
    tokens = new Map();
    clock;
    halfLifeMs;
    idPrefix;
    seq = 0;
    constructor(options = {}) {
        this.clock = options.now ?? (() => Date.now());
        this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
        this.idPrefix = options.idPrefix ?? 'mem';
    }
    /** 当前时钟。 */
    now() {
        return this.clock();
    }
    get size() {
        return this.facts.size;
    }
    /**
     * 写入一条记忆。内容与时间戳立即冻结；重复内容（同 hash）直接返回既有事实，
     * 不做覆盖写，这就是「不可变内容」的落地方式。
     *
     * 返回 `IngestResult`：事实字段全部保留，另外带 `onConflictTriggered`——
     * 当本次写入通过 `supersedes` 把某条旧事实的 validTo 闭合时，它为 true。
     */
    ingest(input) {
        const content = input.content.trim();
        if (content.length === 0)
            throw new Error('ingest: content 不能为空');
        const subject = (input.subject ?? deriveSubject(content)).trim();
        let validFrom = input.validFrom ?? this.clock();
        // 同一毫秒内写入的「取代」会把旧区间压成空集 [T, T)，历史真值就丢了。
        // 这里保证新事实严格晚于被取代的旧事实开始生效。
        if (input.supersedes !== undefined) {
            const previous = this.facts.get(input.supersedes);
            if (previous !== undefined && validFrom <= previous.validFrom) {
                validFrom = previous.validFrom + 1;
            }
        }
        const hash = contentHash(subject, content, String(validFrom));
        const existing = this.findByHash(hash);
        if (existing !== undefined) {
            return { ...existing, onConflictTriggered: false };
        }
        // 准入策略（移植自 memoripy/admission.py）：
        // 噪声 → 敏感数据 → 指令注入 → 权威冲突，任一不过就不写入。
        const decision = evaluateAdmission({
            text: content,
            subject,
            source: input.source ?? 'agent',
            existing: [...this.facts.values()]
                .filter((fact) => fact.supersededAt === null && !fact.archived)
                .map((fact) => ({ id: fact.id, subject: fact.subject, content: fact.content, source: fact.source })),
        });
        if (decision.action === 'reject') {
            throw new Error(`记忆未准入：${describeRejection(decision)}`);
        }
        const fact = Object.freeze({
            id: `${this.idPrefix}-${++this.seq}-${hash.slice(0, 6)}`,
            subject,
            content,
            hash,
            validFrom,
            validTo: input.validTo ?? null,
            recordedAt: input.recordedAt ?? this.clock(),
            supersededAt: null,
            supersededBy: null,
            tags: Object.freeze([...(input.tags ?? [])]),
            source: input.source ?? 'manual',
            importance: clamp01(input.importance ?? 0.5),
            scope: input.scope ?? 'global',
            workspaceId: input.workspaceId ?? null,
            sessionId: input.sessionId ?? null,
            activation: 0,
            archived: false,
            lastAccessedAt: this.clock(),
        });
        this.facts.set(fact.id, fact);
        this.tokens.set(fact.id, tokenize(`${fact.subject} ${fact.content}`));
        const bucket = this.bySubject.get(fact.subject) ?? new Set();
        bucket.add(fact.id);
        this.bySubject.set(fact.subject, bucket);
        let onConflictTriggered = false;
        if (input.supersedes !== undefined) {
            const previous = this.facts.get(input.supersedes);
            if (previous !== undefined) {
                this.supersede(input.supersedes, fact.id, validFrom);
                onConflictTriggered = previous.supersededAt === null;
            }
        }
        const stored = this.facts.get(fact.id) ?? fact;
        return { ...stored, onConflictTriggered };
    }
    get(id) {
        return this.facts.get(id);
    }
    all() {
        return [...this.facts.values()];
    }
    /** 删除一条事实（连同索引与分词缓存）。用于纠正错误数据、清理测试数据。 */
    remove(id) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            return false;
        this.facts.delete(id);
        this.tokens.delete(id);
        const bucket = this.bySubject.get(fact.subject);
        if (bucket !== undefined) {
            bucket.delete(id);
            if (bucket.size === 0)
                this.bySubject.delete(fact.subject);
        }
        return true;
    }
    /** 按来源批量删除，返回删除条数。 */
    removeBySource(source) {
        const targets = [...this.facts.values()].filter((fact) => fact.source === source);
        for (const fact of targets)
            this.remove(fact.id);
        return targets.length;
    }
    /** 按主题批量删除，返回删除条数。 */
    removeBySubject(subject) {
        const ids = [...(this.bySubject.get(subject) ?? [])];
        for (const id of ids)
            this.remove(id);
        return ids.length;
    }
    /**
     * 用新事实取代旧事实：给旧事实闭合 validTo 与 supersededAt，并记下 supersededBy。
     * id / hash 不变——被取代的版本仍然可以被「历史召回」找回。
     */
    supersede(oldId, newId, at = this.clock()) {
        const old = this.facts.get(oldId);
        const current = this.facts.get(newId);
        if (old === undefined)
            throw new Error(`supersede: 未知的旧事实 ${oldId}`);
        if (current === undefined)
            throw new Error(`supersede: 未知的新事实 ${newId}`);
        if (oldId === newId)
            throw new Error('supersede: 不能用自己取代自己');
        const closeAt = old.validTo !== null && old.validTo < at ? old.validTo : at;
        const superseded = Object.freeze({
            ...old,
            validTo: closeAt,
            supersededAt: at,
            supersededBy: newId,
        });
        this.facts.set(oldId, superseded);
        return { superseded, current };
    }
    /** 记忆衰减：距上次访问越久，权重越低（指数半衰期）。 */
    decay(factOrId, now = this.clock()) {
        const fact = typeof factOrId === 'string' ? this.facts.get(factOrId) : factOrId;
        if (fact === undefined)
            return 0;
        const elapsed = Math.max(0, now - fact.lastAccessedAt);
        return Math.pow(0.5, elapsed / this.halfLifeMs);
    }
    /** 显式强化：提升激活量并重置衰减计时。 */
    reinforce(id, amount = 0.3, now = this.clock()) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            throw new Error(`reinforce: 未知事实 ${id}`);
        const next = Object.freeze({
            ...fact,
            activation: fact.activation + Math.max(0, amount),
            lastAccessedAt: now,
        });
        this.facts.set(id, next);
        return next;
    }
    /**
     * 按时间口径召回（保持原签名，返回命中数组）。
     * 需要情绪聚合时用 `recallWithMeta()`。
     */
    recall(query, options = {}) {
        return this.recallWithMeta(query, options).hits;
    }
    /**
     * 按时间口径召回，并计算本批结果的情绪聚合。
     *
       *   isNostalgic  = 是否命中「30 天前 + 核心权重」的记忆
     */
    recallWithMeta(query, options = {}) {
        const mode = options.mode ?? 'strict';
        const now = this.clock();
        const limit = options.limit ?? 5;
        const minScore = options.minScore ?? 0;
        const queryTokens = tokenize(query);
        const hits = [];
        for (const fact of this.facts.values()) {
            if (!this.visible(fact, mode, options, now))
                continue;
            if (options.subject !== undefined && fact.subject !== options.subject)
                continue;
            if (!this.visibleByScope(fact, options))
                continue;
            if (options.tags !== undefined && options.tags.length > 0) {
                const own = new Set(fact.tags);
                if (!options.tags.every((tag) => own.has(tag)))
                    continue;
            }
            const factTokens = this.tokens.get(fact.id) ?? tokenize(fact.content);
            const similarity = cosine(queryTokens, factTokens);
            const decay = this.decay(fact, now);
            const score = 0.6 * similarity +
                0.25 * decay +
                0.15 * fact.importance +
                0.1 * Math.min(1, fact.activation);
            if (score < minScore)
                continue;
            hits.push({ fact, score, similarity, decay });
        }
        hits.sort((a, b) => b.score - a.score || b.fact.validFrom - a.fact.validFrom);
        const top = hits.slice(0, limit);
        for (const hit of top) {
            const bumped = Object.freeze({
                ...hit.fact,
                activation: hit.fact.activation + 0.1,
                lastAccessedAt: now,
            });
            this.facts.set(hit.fact.id, bumped);
            hit.fact = bumped;
        }
        return { hits: top };
    }
    /**
     * Inline & Spill：按需装载。
     * 近期记忆直接给正文（可截断并标记 chars / truncated），
     * 久远记忆只给 ID 引用（pointer），由调用方决定要不要再取一次。
     */
    render(query, options = {}) {
        const inlineChars = options.inlineChars ?? 240;
        const inlineMaxAgeMs = options.inlineMaxAgeMs ?? 24 * 60 * 60 * 1000;
        const now = this.clock();
        const hits = this.recall(query, options);
        const inline = [];
        const spilled = [];
        let savedChars = 0;
        for (const hit of hits) {
            const { fact } = hit;
            const age = Math.max(0, now - fact.recordedAt);
            const chars = fact.content.length;
            if (age <= inlineMaxAgeMs) {
                const truncated = chars > inlineChars;
                inline.push({
                    id: fact.id,
                    content: truncated ? `${fact.content.slice(0, inlineChars)}…` : fact.content,
                    chars,
                    truncated,
                    validFrom: fact.validFrom,
                });
                continue;
            }
            spilled.push({ id: fact.id, chars, pointer: `memory://${fact.id}`, validFrom: fact.validFrom });
            savedChars += chars;
        }
        const lines = [];
        if (inline.length > 0) {
            lines.push('近期记忆（inline）：');
            for (const item of inline) {
                lines.push(`- [${item.id}] ${item.content}${item.truncated ? `（全文 ${item.chars} 字，已截断）` : ''}`);
            }
        }
        if (spilled.length > 0) {
            if (lines.length > 0)
                lines.push('');
            lines.push('久远记忆（仅 ID 引用，需要时再按 id 取回）：');
            for (const item of spilled) {
                lines.push(`- ${item.id} (chars=${item.chars}, pointer=${item.pointer})`);
            }
        }
        return {
            inline,
            spilled,
            text: lines.join('\n'),
            stats: { inline: inline.length, spilled: spilled.length, savedChars },
        };
    }
    /** 同一 subject 的完整时间线（按 validFrom 升序）。 */
    history(subject) {
        const ids = this.bySubject.get(subject) ?? new Set();
        return [...ids]
            .map((id) => this.facts.get(id))
            .filter((fact) => fact !== undefined)
            .sort((a, b) => a.validFrom - b.validFrom);
    }
    /**
     * 冲突检测：同一 subject 下，两条内容不同的事实其有效区间发生重叠，
     * 说明系统同时持有两个互斥的「当前真值」。
     */
    conflicts() {
        const out = [];
        for (const [subject, ids] of this.bySubject) {
            const list = [...ids]
                .map((id) => this.facts.get(id))
                .filter((fact) => fact !== undefined)
                .sort((a, b) => a.validFrom - b.validFrom);
            for (let i = 0; i < list.length; i += 1) {
                for (let j = i + 1; j < list.length; j += 1) {
                    const left = list[i];
                    const right = list[j];
                    if (left === undefined || right === undefined)
                        continue;
                    if (left.hash === right.hash)
                        continue;
                    const overlapFrom = Math.max(left.validFrom, right.validFrom);
                    const leftEnd = left.validTo ?? Number.POSITIVE_INFINITY;
                    const rightEnd = right.validTo ?? Number.POSITIVE_INFINITY;
                    const overlapTo = Math.min(leftEnd, rightEnd);
                    if (overlapFrom >= overlapTo)
                        continue;
                    out.push({
                        subject,
                        leftId: left.id,
                        rightId: right.id,
                        overlapFrom,
                        overlapTo: Number.isFinite(overlapTo) ? overlapTo : null,
                    });
                }
            }
        }
        return out;
    }
    stats() {
        const now = this.clock();
        let current = 0;
        let superseded = 0;
        let archived = 0;
        for (const fact of this.facts.values()) {
            if (fact.supersededAt !== null)
                superseded += 1;
            if (fact.archived === true)
                archived += 1;
            if (isCurrent(fact, now) && fact.archived !== true)
                current += 1;
        }
        return {
            total: this.facts.size,
            current,
            superseded,
            subjects: this.bySubject.size,
            conflicts: this.conflicts().length,
            archived,
        };
    }
    /** 归档 / 取消归档一条记忆（不删数据，只影响 strict 召回）。 */
    setArchived(id, archived) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            return false;
        this.facts.set(id, Object.freeze({ ...fact, archived }));
        return true;
    }
    /**
     * 自动归档：长期没被访问、且从未被强化的记忆标记为 archived。
     * 不做合并、不删数据——只是让它们退出 strict 召回。
     */
    autoArchive(options = {}) {
        const now = options.now ?? this.clock();
        const idleMs = (options.idleDays ?? 180) * 86_400_000;
        const maxActivation = options.maxActivation ?? 1;
        const archivedIds = [];
        for (const fact of this.facts.values()) {
            if (fact.archived === true)
                continue;
            if (fact.supersededAt !== null)
                continue;
            if (fact.activation > maxActivation)
                continue;
            if (now - fact.lastAccessedAt < idleMs)
                continue;
            this.facts.set(fact.id, Object.freeze({ ...fact, archived: true }));
            archivedIds.push(fact.id);
        }
        return archivedIds;
    }
    /** 导出为纯 JSON（可自行落盘到 .json 文件，仍然不依赖数据库）。 */
    serialize() {
        return [...this.facts.values()].map((fact) => ({ ...fact }));
    }
    /** 从 serialize() 的结果恢复；缺失字段按默认值补齐。 */
    restore(facts) {
        for (const raw of facts) {
            const fact = Object.freeze({
                ...raw,
                tags: Object.freeze([...(raw.tags ?? [])]),
                scope: raw.scope ?? 'global',
                workspaceId: raw.workspaceId ?? null,
                sessionId: raw.sessionId ?? null,
                archived: raw.archived ?? false,
            });
            this.facts.set(fact.id, fact);
            this.tokens.set(fact.id, tokenize(`${fact.subject} ${fact.content}`));
            const bucket = this.bySubject.get(fact.subject) ?? new Set();
            bucket.add(fact.id);
            this.bySubject.set(fact.subject, bucket);
            const tail = Number.parseInt(fact.id.split('-')[1] ?? '0', 10);
            if (Number.isFinite(tail) && tail > this.seq)
                this.seq = tail;
        }
    }
    visibleByScope(fact, options) {
        const scope = options.scope ?? 'all';
        if (scope === 'all')
            return true;
        if (fact.scope === 'global')
            return true;
        if (fact.scope === 'workspace') {
            return options.workspaceId !== undefined && fact.workspaceId === options.workspaceId;
        }
        return options.sessionId !== undefined && fact.sessionId === options.sessionId;
    }
    visible(fact, mode, options, now) {
        switch (mode) {
            case 'strict':
                // 已归档的记忆不再算「当前真值」，但仍可被 historical / associative 查到
                if (fact.archived === true)
                    return false;
                return isCurrent(fact, now);
            case 'historical':
                return isValidAt(fact, options.validTime ?? now);
            case 'belief':
                return isRecordedAt(fact, options.recordedTime ?? now);
            case 'associative':
                // 联想模式：不做时间过滤，被取代的、未来的都参与排序，
                // 由「相似度 + 激活量 + 重要度」决定谁浮上来（对齐 LongMemory 的 associative recall）。
                return true;
            default:
                return false;
        }
    }
    findByHash(hash) {
        for (const fact of this.facts.values()) {
            if (fact.hash === hash)
                return fact;
        }
        return undefined;
    }
}
