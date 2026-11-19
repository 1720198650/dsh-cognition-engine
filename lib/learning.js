/**
 * src/learning.ts — L3 学习三候选：事实 / 准则 / 技能，全部必须带外部锚。
 *
 * 为什么要有「锚」这一层：
 *   模型从资料里提炼出来的结论，看着都很像真的。如果没有可核对的原话，
 *   它就只能凭"读起来通顺"来判定——那正是幻觉最好的藏身处。
 *   所以每条候选必须能指回一段具体原文（sourceId#块 + 引文），
 *   锚解析不了就直接不入队，不给用户增加审核负担。
 *
 * 三类候选的去向（有意区分）：
 *   - fact  关于用户/工作为真 → 记忆（会被注入，占 token）
 *   - rule  怎么干活的一句话规矩 → 准则本（必须带适用边界）
 *   - skill 可复用的做法/步骤 → 单独一层，只在被调用时载入
 *
 * 本文件只做确定性的事（校验、入队、去重、状态流转），不调模型。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** 归一化：只留字母数字与汉字，用来做"引文是否真在原文里"的比对。 */
export function normalizeForAnchor(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
/** 最长公共子序列长度（引文一般 ≤200 字，O(n×m) 够用）。 */
export function lcsLength(a, b) {
    if (a.length === 0 || b.length === 0)
        return 0;
    const prev = new Array(b.length + 1).fill(0);
    const cur = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i += 1) {
        const ca = a[i - 1];
        for (let j = 1; j <= b.length; j += 1) {
            cur[j] = ca === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0);
        }
        for (let j = 0; j <= b.length; j += 1)
            prev[j] = cur[j] ?? 0;
    }
    return prev[b.length] ?? 0;
}
/** 引文覆盖率 = LCS / 引文长度。逐字 1.0；改两个字 ~0.94；转述 ~0.6；无关 <0.2。 */
export function quoteCoverage(quote, source) {
    const q = normalizeForAnchor(quote);
    if (q.length === 0)
        return 0;
    return lcsLength(q, normalizeForAnchor(source)) / q.length;
}
/** 引文太短就不算锚：12 字以下几乎在任何文章里都能撞上。 */
export const MIN_QUOTE_CHARS = 12;
/**
 * 覆盖率阈值：0.9 以上算逐字、0.6~0.9 算转述。
 *
 * **这两个数是经验值，没有经过标定**（audit-evidence.md 判为弱支撑）：
 * l3-anchor.md 给的对照确实落在 0.90 / 0.64 / 0.15 这类量级，但只在几条样本上跑过，
 * 不是通过 30~50 对人工标注扫描得出的最优点。要改就走 config，不要改这里。
 */
export const STRICT_QUOTE_COVERAGE = 0.9;
export const LOOSE_QUOTE_COVERAGE = 0.6;
/**
 * 校验一条候选的外部锚（分三层，依据 docs/l3-anchor.md 的标定结果）。
 *
 *   1. 引文归一化后**逐字是原文子串** → 放行；
 *   2. 覆盖率 ≥0.90（改了标点/个别字）→ 放行；
 *   3. 0.60~0.90（转述）→ 放行但标 needsQuote，提示用户补原文；不丢，因为内容仍可能对。
 * 逐字/覆盖都不够时再试相邻块（摘要常跨块），仍不行就判"张冠李戴"丢弃。
 */
export function checkAnchor(anchor, lookup, options = {}) {
    const minChars = options.minQuoteChars ?? MIN_QUOTE_CHARS;
    const strict = options.strictCoverage ?? STRICT_QUOTE_COVERAGE;
    const loose = options.looseCoverage ?? LOOSE_QUOTE_COVERAGE;
    const quote = normalizeForAnchor(anchor.quote);
    if (quote.length < minChars) {
        return { ok: false, reason: `引文太短（${quote.length} 字，至少要 ${minChars} 字），无法核对` };
    }
    const judge = (text) => {
        const haystack = normalizeForAnchor(text);
        if (haystack.includes(quote))
            return { matchedChars: quote.length };
        const coverage = quoteCoverage(anchor.quote, text);
        if (coverage >= strict)
            return { matchedChars: Math.round(quote.length * coverage) };
        if (coverage >= loose)
            return { matchedChars: Math.round(quote.length * coverage), needsQuote: true };
        return null;
    };
    if (anchor.type === 'source') {
        if (anchor.block === undefined)
            return { ok: false, reason: '资料锚必须带块序号' };
        const text = lookup.blockText?.(anchor.ref, anchor.block);
        if (text === undefined)
            return { ok: false, reason: `找不到 ${anchor.ref}#${anchor.block} 这块原文` };
        const direct = judge(text);
        if (direct !== null) {
            return { ok: true, ...direct, flags: lookup.blockFlags?.(anchor.ref, anchor.block) ?? [] };
        }
        // 相邻块再试一次：长句被切块切开了是常态
        for (const neighbour of [anchor.block - 1, anchor.block + 1]) {
            if (neighbour < 0)
                continue;
            const near = lookup.blockText?.(anchor.ref, neighbour);
            if (near === undefined)
                continue;
            const found = judge(near);
            if (found !== null) {
                return { ok: true, ...found, flags: lookup.blockFlags?.(anchor.ref, neighbour) ?? [] };
            }
        }
        return {
            ok: false,
            reason: `引文在 ${anchor.ref}#${anchor.block} 及相邻块里都核不到（覆盖率 ${Math.round(quoteCoverage(anchor.quote, text) * 100)}%），可能是模型改写或臆造`,
        };
    }
    const source = lookup.turnText?.(anchor.ref);
    if (source === undefined)
        return { ok: false, reason: `找不到来源记录：${anchor.ref}` };
    const judged = judge(source);
    if (judged === null)
        return { ok: false, reason: `引文不在 ${anchor.ref} 里` };
    return { ok: true, ...judged, flags: [] };
}
const MAX_CANDIDATES = 300;
/** 候选队列：JSON 落盘，纯确定性操作。 */
export class LearningQueue {
    filePath;
    clock;
    data;
    constructor(options) {
        this.filePath = options.filePath;
        this.clock = options.now ?? (() => Date.now());
    }
    load() {
        if (this.data !== undefined)
            return this.data;
        this.data = { candidates: [], nextId: 1 };
        if (!existsSync(this.filePath))
            return this.data;
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
            const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
            const nextId = typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : candidates.length + 1;
            this.data = { candidates, nextId };
        }
        catch {
            this.data = { candidates: [], nextId: 1 };
        }
        return this.data;
    }
    persist() {
        const data = this.load();
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    }
    /**
     * 入队。默认做两道去重：
     *   1. 与 pending 里内容相同（归一化后）→ 不重复入队；
     *   2. 与 accepted 的同内容 → 也不重复（已经学过了）。
     */
    add(input) {
        const data = this.load();
        const content = input.content.trim();
        if (content.length === 0)
            throw new Error('候选内容不能为空');
        const key = normalizeForAnchor(content);
        for (const existing of data.candidates) {
            if (normalizeForAnchor(existing.content) !== key)
                continue;
            if (existing.status === 'rejected')
                continue;
            return { candidate: { ...existing }, duplicate: true };
        }
        const candidate = {
            id: `lc-${data.nextId}`,
            kind: input.kind,
            content,
            anchor: input.anchor,
            // 判不准一律落 world：错标成"关于用户为真"代价更大（会以用户身份进检索与画像）
            scope: input.scope ?? 'world',
            confidence: Math.min(1, Math.max(0, input.confidence ?? 0.5)),
            status: 'pending',
            createdAt: this.clock(),
            ...(input.subject === undefined ? {} : { subject: input.subject }),
            ...(input.boundaryEnvs === undefined ? {} : { boundaryEnvs: input.boundaryEnvs }),
            ...(input.note === undefined ? {} : { note: input.note }),
            ...(input.anchorChars === undefined ? {} : { anchorChars: input.anchorChars }),
            ...(input.anchorFlags === undefined ? {} : { anchorFlags: input.anchorFlags }),
            ...(input.needsQuote === true ? { needsQuote: true } : {}),
        };
        data.candidates.push(candidate);
        data.nextId += 1;
        this.trim();
        this.persist();
        return { candidate: { ...candidate }, duplicate: false };
    }
    /** 超过上限先丢最旧的 rejected，不碰 pending。 */
    trim() {
        const data = this.load();
        if (data.candidates.length <= MAX_CANDIDATES)
            return;
        const overflow = data.candidates.length - MAX_CANDIDATES;
        let dropped = 0;
        data.candidates = data.candidates.filter((candidate) => {
            if (dropped >= overflow)
                return true;
            if (candidate.status !== 'rejected')
                return true;
            dropped += 1;
            return false;
        });
    }
    list(status) {
        const all = [...this.load().candidates].sort((a, b) => b.createdAt - a.createdAt);
        return status === undefined ? all : all.filter((candidate) => candidate.status === status);
    }
    get(id) {
        const found = this.load().candidates.find((candidate) => candidate.id === id);
        return found === undefined ? undefined : { ...found };
    }
    /** 标记采用，并记下落到哪里。 */
    markAccepted(id, acceptedRef) {
        const data = this.load();
        const candidate = data.candidates.find((item) => item.id === id);
        if (candidate === undefined)
            throw new Error(`没有这个候选：${id}`);
        if (candidate.status !== 'pending')
            throw new Error(`候选 ${id} 状态是 ${candidate.status}，不能再采用`);
        candidate.status = 'accepted';
        candidate.acceptedRef = acceptedRef;
        this.persist();
        return { ...candidate };
    }
    reject(id, reason) {
        const data = this.load();
        const candidate = data.candidates.find((item) => item.id === id);
        if (candidate === undefined)
            throw new Error(`没有这个候选：${id}`);
        if (candidate.status !== 'pending')
            return { ...candidate };
        candidate.status = 'rejected';
        candidate.note = reason === undefined || reason.trim().length === 0 ? '已丢弃' : `已丢弃：${reason.trim()}`;
        this.persist();
        return { ...candidate };
    }
    stats() {
        const all = this.load().candidates;
        const count = (status) => all.filter((candidate) => candidate.status === status).length;
        return {
            total: all.length,
            pending: count('pending'),
            accepted: count('accepted'),
            rejected: count('rejected'),
            byKind: {
                fact: all.filter((candidate) => candidate.kind === 'fact').length,
                rule: all.filter((candidate) => candidate.kind === 'rule').length,
                skill: all.filter((candidate) => candidate.kind === 'skill').length,
            },
        };
    }
}
/**
 * 从一条资料摘要产出候选：每条结论一个 fact 候选。
 *
 * 锚怎么定：**结论是改写、引文是照抄**，所以用引文去核，不用结论去核。
 * 引文必须能在原文块里逐字找到；找不到就不生成候选——
 * 说明这条结论没有可核对的出处，宁可不学（这是防幻觉最省事的一道闸）。
 */
export function candidatesFromPoints(input, options = {}) {
    const out = [];
    const normalizedBlocks = input.blocks.map((block) => ({ ...block, normalized: normalizeForAnchor(block.text) }));
    input.points.forEach((point, index) => {
        const content = point.trim();
        if (content.length < (options.minQuoteChars ?? MIN_QUOTE_CHARS))
            return;
        const quote = (input.quotes?.[index] ?? '').trim();
        const normalizedQuote = normalizeForAnchor(quote);
        // 没有引文（老数据/模型偷懒）就不生成：没有可核对出处的东西不该进待审
        if (normalizedQuote.length < (options.minQuoteChars ?? MIN_QUOTE_CHARS))
            return;
        // 与 checkAnchor 同一口径：逐字或 0.6 以上覆盖率才算"核得到"，
        // 但要挑**覆盖率最高**的那块——只看"第一个过线"会把摘要句配到相似的引言块上，
        // 结果每条都被标成"转述"（2026-11-18 实测 5 条全被误标 needsQuote）。
        let hit;
        let bestCoverage = 0;
        for (const block of normalizedBlocks) {
            if (block.normalized.includes(normalizedQuote)) {
                hit = block;
                bestCoverage = 1;
                break;
            }
            const coverage = quoteCoverage(quote, block.text);
            if (coverage > bestCoverage) {
                bestCoverage = coverage;
                hit = block;
            }
        }
        if (hit === undefined || bestCoverage < (options.looseCoverage ?? LOOSE_QUOTE_COVERAGE))
            return;
        out.push({
            kind: 'fact',
            content,
            anchor: { type: 'source', ref: input.sourceId, block: hit.ord, quote },
            ...(input.topic === undefined ? {} : { subject: input.topic }),
            confidence: 0.6,
            anchorChars: normalizedQuote.length,
            anchorFlags: hit.flags ?? [],
            note: `来自资料《${input.title}》的提炼结论`,
        });
    });
    return out;
}
