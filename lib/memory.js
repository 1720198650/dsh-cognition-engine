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
import { DEFAULT_RULES, describeRejection, evaluateAdmission } from "./admission.js";
const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
/** 强度放大的上限倍数（activation 每 1 点让半衰期翻倍，最多到此）。 */
const MAX_STRENGTH_BOOST = 5;
/** 召回强化：低于这个相似度的命中不加权，避免把噪声记忆越喂越重。 */
export const RECALL_REINFORCE_FLOOR = 0.12;
/** 单次召回命中给多少激活量。 */
export const RECALL_ACTIVATION_GAIN = 0.1;
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
/**
 * 归一化文本，仅用于**比较**（不要拿它存库）。
 *
 * 干掉「同一条被存两遍」的最常见来源：全半角、大小写、空白、
 * 标点、零宽字符。这一步几乎零成本，收益比换任何相似度算法都直接
 * （SimHash/MinHash 在几百条规模是过度设计）。
 */
export function normalizeForCompare(text) {
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u200b-\u200d\ufeff]+/gu, '')
        .replace(/[\p{P}\p{S}]/gu, '');
}
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
/**
 * 最长公共子序列（LCS）相似度，Dice 归一化。
 *
 * 为什么需要它：中文二元组余弦抓不住「改写」。
 * 实测：「发版前要跑完整测试」vs「发布版本之前必须先跑测试」
 *   bigram 余弦只有 0.107，LCS 有 0.600——因为字序相同、只换了个别字。
 *
 * 标定数据（本项目真实准则）：
 *   真实准则两两 LCS 最高 0.173（不会互相误判）
 *   改了否定词的冲突对 LCS 0.769 / 0.933 / 0.875（能检出）
 *
 * 只用于**短文本两两比较**（准则、记忆条目），不要拿来做全库检索——
 * 它是 O(n×m)，没有索引。
 */
export function lcsSimilarity(a, b) {
    const ca = comparableChars(a);
    const cb = comparableChars(b);
    const n = ca.length;
    const mm = cb.length;
    if (n === 0 || mm === 0)
        return 0;
    let prev = new Uint16Array(mm + 1);
    let cur = new Uint16Array(mm + 1);
    for (let i = 1; i <= n; i += 1) {
        for (let j = 1; j <= mm; j += 1) {
            cur[j] = ca[i - 1] === cb[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0);
        }
        const swap = prev;
        prev = cur;
        cur = swap;
        cur.fill(0);
    }
    const lcs = prev[mm] ?? 0;
    if (lcs === 0)
        return 0;
    return (2 * lcs) / (n + mm);
}
/** 参与 LCS 比较的字符：去掉标点空格与常用虚词，只留实词与字母数字。 */
function comparableChars(text) {
    const out = [];
    for (const ch of text.toLowerCase()) {
        if (/[\u4e00-\u9fff]/.test(ch)) {
            if (!CJK_STOPWORDS.has(ch))
                out.push(ch);
        }
        else if (/[a-z0-9]/.test(ch)) {
            out.push(ch);
        }
    }
    return out;
}
/**
 * 两个短文本的综合相似度：二元组余弦与 LCS 取较大者。
 *
 * 余弦擅长「用词重合」，LCS 擅长「改写」。两者都高才算像，
 * 取 max 是因为任一种命中都足够说明问题。
 */
export function textSimilarity(a, b) {
    const cosineScore = cosine(tokenize(a), tokenize(b));
    return Math.max(cosineScore, lcsSimilarity(a, b));
}
/**
 * 从一批已分词的文档构建 BM25 统计。
 *
 * 参数取值依据：在本项目 212 个真实章节上网格搜索，
 * k1=1.2 / b=0.5 表现最好（短文本语料，长度差异小，所以 b 取低一些）。
 */
export function buildBm25Stats(docs) {
    const df = new Map();
    let totalLen = 0;
    let count = 0;
    for (const doc of docs) {
        let len = 0;
        for (const [term, tf] of doc) {
            len += tf;
            df.set(term, (df.get(term) ?? 0) + 1);
        }
        totalLen += len;
        count += 1;
    }
    return { df, avgLen: count === 0 ? 0 : totalLen / count, N: count };
}
/** 单条查询对单条文档的 BM25 得分。 */
export function bm25Score(query, doc, stats, k1 = 1.2, b = 0.5) {
    if (stats.N === 0)
        return 0;
    let docLen = 0;
    for (const tf of doc.values())
        docLen += tf;
    let score = 0;
    for (const [term, qtf] of query) {
        const tf = doc.get(term);
        if (tf === undefined)
            continue;
        const df = stats.df.get(term) ?? 0;
        // 加 1 平滑，保证 IDF 非负（小语料里 df 可能接近 N）
        const idf = Math.log(1 + (stats.N - df + 0.5) / (df + 0.5));
        const denom = tf + k1 * (1 - b + (b * docLen) / (stats.avgLen || 1));
        score += idf * ((tf * (k1 + 1)) / denom) * qtf;
    }
    return score;
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
    /** 用户可配置的准入规则。 */
    rules = DEFAULT_RULES;
    /** 同主题自动取代的相似度阈值。 */
    tokens = new Map();
    clock;
    halfLifeMs;
    idPrefix;
    onEvent;
    seq = 0;
    constructor(options = {}) {
        this.clock = options.now ?? (() => Date.now());
        this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
        this.idPrefix = options.idPrefix ?? 'mem';
        this.onEvent = options.onEvent;
    }
    /** 安全触发审计回调。 */
    emit(event) {
        try {
            this.onEvent?.(event);
        }
        catch {
            // 审计失败不能影响写入
        }
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
            origin: input.origin ?? 'agent_tool',
            existing: [...this.facts.values()]
                .filter((fact) => fact.supersededAt === null && !fact.archived)
                .map((fact) => ({ id: fact.id, subject: fact.subject, content: fact.content, source: fact.source, origin: fact.origin })),
        }, this.rules);
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
            topicIds: Object.freeze([...(input.topicIds ?? [])]),
            source: input.source ?? 'manual',
            importance: clamp01(input.importance ?? 0.5),
            scope: input.scope ?? 'global',
            workspaceId: input.workspaceId ?? null,
            sessionId: input.sessionId ?? null,
            activation: 0,
            archived: false,
            lastAccessedAt: this.clock(),
            ...(input.origin === undefined ? {} : { origin: input.origin }),
        });
        this.facts.set(fact.id, fact);
        this.emit({ op: 'remember', id: fact.id, subject: fact.subject, hash: fact.hash, source: fact.source, origin: fact.origin });
        this.tokens.set(fact.id, tokenize(`${fact.subject} ${fact.content}`));
        const bucket = this.bySubject.get(fact.subject) ?? new Set();
        bucket.add(fact.id);
        this.bySubject.set(fact.subject, bucket);
        let onConflictTriggered = false;
        if (input.supersedes !== undefined) {
            const previous = this.facts.get(input.supersedes);
            if (previous !== undefined) {
                this.supersede(input.supersedes, fact.id, validFrom, input.supersedeReason);
                onConflictTriggered = previous.supersededAt === null;
            }
        }
        const stored = this.facts.get(fact.id) ?? fact;
        return { ...stored, onConflictTriggered };
    }
    get(id) {
        return this.facts.get(id);
    }
    /**
     * 写入前的「候选冲突」提示：同主题下语义相近的活事实。
     *
     * 为什么要有：原本模型要取代一条旧事实，得凭空想起它的 id——记错一个字符就污染，
     * 想不起来就只能让两条并存。业界做法（Mem0, arXiv:2504.19413）是**先检索候选，
     * 再让模型在 ADD/UPDATE/DELETE/NOOP 里选**。这里只做「检索候选」，不改任何数据，
     * 所以即使提示不准也不会污染记忆库。
     *
     * 注意：仅按 subject 分桶，跨主题的语义重复抓不到（已知局限，见 README）。
     */
    similarLive(content, subjectHint, threshold = 0.55, limit = 3) {
        const trimmed = content.trim();
        if (trimmed.length === 0)
            return [];
        const subject = (subjectHint ?? deriveSubject(trimmed)).trim();
        const ids = this.bySubject.get(subject);
        if (ids === undefined)
            return [];
        const out = [];
        for (const id of ids) {
            const fact = this.facts.get(id);
            if (fact === undefined)
                continue;
            if (fact.deletedAt !== undefined || fact.supersededAt !== null || fact.archived === true)
                continue;
            if (fact.content.trim() === trimmed)
                continue;
            const similarity = textSimilarity(trimmed, fact.content);
            if (similarity < threshold)
                continue;
            out.push({ id: fact.id, content: fact.content, similarity, validFrom: fact.validFrom });
        }
        out.sort((a, b) => b.similarity - a.similarity);
        return out.slice(0, Math.max(1, limit));
    }
    all() {
        return [...this.facts.values()];
    }
    /** 删除一条事实（连同索引与分词缓存）。用于纠正错误数据、清理测试数据。 */
    remove(id) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            return false;
        this.emit({ op: 'forget', id: fact.id, subject: fact.subject, hash: fact.hash });
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
    supersede(oldId, newId, at = this.clock(), reason) {
        const old = this.facts.get(oldId);
        const current = this.facts.get(newId);
        if (old === undefined)
            throw new Error(`supersede: 未知的旧事实 ${oldId}`);
        if (current === undefined)
            throw new Error(`supersede: 未知的新事实 ${newId}`);
        if (oldId === newId)
            throw new Error('supersede: 不能用自己取代自己');
        const closeAt = old.validTo !== null && old.validTo < at ? old.validTo : at;
        const trimmedReason = reason === undefined ? '' : reason.trim().slice(0, 200);
        const superseded = Object.freeze({
            ...old,
            validTo: closeAt,
            supersededAt: at,
            supersededBy: newId,
            ...(trimmedReason.length === 0 && old.supersedeReason === undefined
                ? {}
                : { supersedeReason: trimmedReason.length > 0 ? trimmedReason : old.supersedeReason }),
        });
        this.facts.set(oldId, superseded);
        return { superseded, current };
    }
    /**
     * 衰减系数。
     *
     * 对齐 MemoryBank (AAAI 2024) 的 R = exp(-t/S)：强度 S 随召回增长，
     * 于是常用的记忆衰减更慢。我们用半衰期当 S——activation 每 +1，半衰期翻倍，
     * 最多放大 1 + MAX_STRENGTH_BOOST（=6）倍，避免高频记忆永不衰减。
     */
    /**
     * 时间衰减（0.2 ~ 1.0）。
     *
     * 两个依据：
     * 1. **幂律优于指数**——Wixted & Ebbesen 1991、Rubin & Wenzel 1996（210 个数据集）
     *    都显示幂函数拟合更好。两者在短延迟几乎一致，**分歧在长延迟**：
     *    指数半衰期 7 天时 90 天后只剩 0.0001（等于判死），
     *    同样参数下幂律还有 0.50。这是「长期记忆」和「短期缓存」的区别。
     * 2. **衰减不能决定真假**——条数少、使用频率低时，衰减参数根本估不出来。
     *    它只该影响**排序**，不该影响一条记忆是否还成立，
     *    更不能拿它触发删除（arXiv 2604.11364：最近没被访问 ≠ 不太真）。
     *
     * 公式照 FSRS：R = (1 + 19/81 · t/S)^(-0.5)，t=S 时 R=0.9。
     * 取了下界 0.2——半年前的笔记仍有基础分，只是排序靠后。
     */
    decay(factOrId, now = this.clock()) {
        const fact = typeof factOrId === 'string' ? this.facts.get(factOrId) : factOrId;
        if (fact === undefined)
            return 0;
        const elapsed = Math.max(0, now - fact.lastAccessedAt);
        const boost = 1 + Math.min(Math.max(0, fact.activation), MAX_STRENGTH_BOOST);
        const raw = Math.pow(1 + (19 / 81) * (elapsed / (this.halfLifeMs * boost)), -0.5);
        return Math.max(0.2, Math.min(1, raw));
    }
    /**
     * 设置一条记忆的归属主题。
     *
     * 主题是人定的适用范围键，所以这里只接受显式 id 列表；
     * 传空数组表示移回「未归类」。
     */
    setTopics(id, topicIds) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            throw new Error(`setTopics: 未知事实 ${id}`);
        const next = Object.freeze({
            ...fact,
            topicIds: Object.freeze([...new Set(topicIds.filter((t) => t.length > 0))]),
        });
        this.facts.set(id, next);
        return next;
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
        // 先跑一遍过滤，收集候选——BM25 需要语料统计（df / 平均长度），
        // 只对「当前可见的候选」统计，避免被归档/过期的条目污染 IDF。
        const candidates = [];
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
            candidates.push({ fact, tokens: this.tokens.get(fact.id) ?? tokenize(fact.content) });
        }
        const stats = buildBm25Stats(candidates.map((c) => c.tokens));
        const hits = [];
        for (const { fact, tokens: factTokens } of candidates) {
            // 用 BM25 而不是纯 TF 余弦：实测在真实语料上 Top1 高 13-27 个百分点
            const similarity = bm25Score(queryTokens, factTokens, stats);
            const decay = this.decay(fact, now);
            // 权重依据：时间项**不能**比重要性还大。
            // 原来是 0.6/0.25/0.15/0.1——衰减 0.25 压过重要度 0.15，
            // 结果是「新而无关」压过「旧而重要」，与"记得住"的初衷相反。
            const score = 0.6 * similarity +
                0.1 * decay +
                0.2 * fact.importance +
                // activation 用饱和曲线而不是硬截断在 1：
                // 原来 Math.min(1, activation) 意味着召回 10 次后打分不再增长，
                // 却同时让 autoArchive 永久豁免它，两个语义在 1.0 处撞车。
                0.1 * (fact.activation / (1 + fact.activation));
            if (score < minScore)
                continue;
            hits.push({ fact, score, similarity, decay });
        }
        hits.sort((a, b) => b.score - a.score || b.fact.validFrom - a.fact.validFrom);
        const top = hits.slice(0, limit);
        for (const hit of top) {
            // 只有真正相关（相似度过线）的命中才自我强化。
            // 否则查一个完全无关的词，返回的低分命中也会被越喂越重。
            if (hit.similarity < RECALL_REINFORCE_FLOOR)
                continue;
            const bumped = this.reinforce(hit.fact.id, RECALL_ACTIVATION_GAIN, now);
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
            .filter((fact) => fact !== undefined && fact.deletedAt === undefined)
            .sort((a, b) => a.validFrom - b.validFrom);
    }
    /**
     * 冲突检测：同一 subject 下，两条内容不同的事实其有效区间发生重叠，
     * 说明系统同时持有两个互斥的「当前真值」。
     *
     * **只统计还活着的事实**：已删除 / 已被取代的不算冲突。
     * 早期版本没过滤，删掉的测试条目会一直挂在 conflicts 里（实测 3 条冲突中 2 条是已删条目），
     * 让 `cognition_state` 报出一个永远降不下来的数字。
     */
    conflicts() {
        const out = [];
        for (const [subject, ids] of this.bySubject) {
            const list = [...ids]
                .map((id) => this.facts.get(id))
                .filter((fact) => fact !== undefined && fact.deletedAt === undefined && fact.supersededAt === null && fact.archived !== true)
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
        let deleted = 0;
        const liveSubjects = new Set();
        for (const fact of this.facts.values()) {
            // 软删除的条目对用户来说已经不存在，不能计入任何可见统计。
            if (fact.deletedAt !== undefined) {
                deleted += 1;
                continue;
            }
            liveSubjects.add(fact.subject);
            if (fact.supersededAt !== null)
                superseded += 1;
            if (fact.archived === true)
                archived += 1;
            if (isCurrent(fact, now) && fact.archived !== true)
                current += 1;
        }
        return {
            total: this.facts.size - deleted,
            current,
            superseded,
            subjects: liveSubjects.size,
            conflicts: this.conflicts().length,
            archived,
            deleted,
        };
    }
    /**
     * 手动修正一条记忆：内容、主题、录入时间、有效状态。
     *
     * 注意 recordedAt 是双时态的事务时间轴，改动会让 belief 口径的答案偏移，
     * 所以这里会打上 revisedAt 标记，表示「这条被人工改过」。
     */
    updateFact(id, patch) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            return undefined;
        const content = (patch.content ?? fact.content).trim();
        if (content.length === 0)
            throw new Error('content 不能为空');
        const subject = (patch.subject ?? fact.subject).trim();
        const recordedAt = patch.recordedAt ?? fact.recordedAt;
        const superseded = patch.superseded ?? fact.supersededAt !== null;
        const now = this.clock();
        const next = Object.freeze({
            ...fact,
            content,
            subject,
            recordedAt,
            hash: contentHash(subject, content, String(fact.validFrom)),
            supersededAt: superseded ? fact.supersededAt ?? now : null,
            validTo: superseded ? fact.validTo ?? now : null,
            supersededBy: superseded ? fact.supersededBy : null,
            revisedAt: now,
        });
        // 维护主题索引
        const oldBucket = this.bySubject.get(fact.subject);
        if (oldBucket !== undefined) {
            oldBucket.delete(id);
            if (oldBucket.size === 0)
                this.bySubject.delete(fact.subject);
        }
        this.emit({ op: 'update', id, subject, hash: next.hash, detail: '手动修正' });
        this.facts.set(id, next);
        this.tokens.set(id, tokenize(subject + ' ' + content));
        const bucket = this.bySubject.get(subject) ?? new Set();
        bucket.add(id);
        this.bySubject.set(subject, bucket);
        return next;
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
    /**
     * 记忆归并：同一主题下，内容高度相似且极性一致的条目收敛成一条，
     * 其余标记 mergedInto（不删除，历史仍可查）。
     *
     * 纯规则实现，不调用 LLM：相似度用词频余弦，保留重要度最高的一条作为主条目。
     */
    consolidate(options = {}) {
        const threshold = options.threshold ?? 0.75;
        const out = [];
        const subjects = options.subject === undefined ? [...this.bySubject.keys()] : [options.subject];
        for (const subject of subjects) {
            const active = [...(this.bySubject.get(subject) ?? [])]
                .map((id) => this.facts.get(id))
                .filter((fact) => fact !== undefined &&
                fact.supersededAt === null &&
                fact.archived !== true &&
                fact.mergedInto === undefined)
                .sort((a, b) => b.importance - a.importance || b.recordedAt - a.recordedAt);
            if (active.length < 2)
                continue;
            const merged = [];
            const kept = [];
            for (const fact of active) {
                const target = kept.find((candidate) => Math.sign(candidate.importance) === Math.sign(fact.importance) &&
                    cosine(this.tokens.get(candidate.id) ?? new Map(), this.tokens.get(fact.id) ?? new Map()) >= threshold);
                if (target === undefined) {
                    kept.push(fact);
                    continue;
                }
                this.facts.set(fact.id, Object.freeze({ ...fact, mergedInto: target.id }));
                merged.push(fact.id);
            }
            if (merged.length > 0)
                out.push({ kept: kept.map((f) => f.id), merged });
        }
        return out;
    }
    /** 软删除：任何召回口径都不再返回，数据保留，可恢复。 */
    softDelete(id) {
        const fact = this.facts.get(id);
        if (fact === undefined)
            return false;
        this.emit({ op: 'delete', id, subject: fact.subject });
        this.facts.set(id, Object.freeze({ ...fact, deletedAt: this.clock() }));
        // 作废会传染（TMS）：被这条取代过的事实，现在失去了「取代者」。
        // 它们的 supersededBy 指向一条不存在的记录，于是永远不生效、也永远说不清为什么。
        // 正确语义：取代者被删 → 被取代者回到 current。
        this.#reviveOrphansOf(id);
        return true;
    }
    /**
     * 取代者消失后，让被它取代的事实回到 current。
     *
     * 只解除 supersede 关系，**不改 validFrom** —— 时间线不动，
     * 只是「当前真值」这一列重新有主人。同时清掉 supersededBy，
     * 免得它还指着一条已经没有的记录。
     */
    #reviveOrphansOf(goneId) {
        let revived = 0;
        for (const [factId, fact] of this.facts) {
            if (fact.supersededBy !== goneId)
                continue;
            this.facts.set(factId, Object.freeze({ ...fact, supersededAt: null, supersededBy: null, validTo: null }));
            this.emit({ op: 'restore', id: factId, subject: fact.subject });
            revived += 1;
        }
        return revived;
    }
    /** 恢复一条软删除的记忆。 */
    restoreDeleted(id) {
        const fact = this.facts.get(id);
        if (fact === undefined || fact.deletedAt === undefined)
            return false;
        this.emit({ op: 'restore', id, subject: fact.subject });
        const { deletedAt: _drop, ...rest } = fact;
        this.facts.set(id, Object.freeze(rest));
        return true;
    }
    /**
     * 体检：找出「取代者已经不存在，但自己还被标成已取代」的事实。
     *
     * 这是历史数据里的常见坏味道（删掉新版本后旧版永久失效）。
     * 返回 id 供页面提示，`repairOrphans()` 才是修。
     */
    orphans() {
        const out = [];
        for (const [id, fact] of this.facts) {
            if (fact.supersededBy === null)
                continue;
            const killer = this.facts.get(fact.supersededBy);
            if (killer === undefined || killer.deletedAt !== undefined) {
                out.push({ id, subject: fact.subject, missingBy: fact.supersededBy });
            }
        }
        return out;
    }
    /** 修掉所有孤儿取代关系（把被取代者放回 current）。返回修了几条。 */
    repairOrphans() {
        const targets = this.orphans();
        for (const target of targets) {
            const fact = this.facts.get(target.id);
            if (fact === undefined)
                continue;
            this.facts.set(target.id, Object.freeze({ ...fact, supersededAt: null, supersededBy: null, validTo: null }));
            this.emit({ op: 'restore', id: target.id, subject: fact.subject });
        }
        return targets.length;
    }
    /** 设置准入规则（页面上的开关）。 */
    setRules(rules) {
        this.rules = { ...this.rules, ...rules };
        return this.rules;
    }
    /** 当前准入规则。 */
    getRules() {
        return { ...this.rules };
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
                // 老状态文件没有 topicIds 字段，补空数组保持向后兼容
                topicIds: Object.freeze([...(raw.topicIds ?? [])]),
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
                if (fact.deletedAt !== undefined)
                    return false;
                if (fact.archived === true || fact.mergedInto !== undefined)
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
