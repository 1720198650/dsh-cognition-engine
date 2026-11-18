/**
 * src/inbox.ts — 候选材料收件箱（L0，不联网）
 *
 * 参考：
 * - Zettelkasten / Ahrens《How to Take Smart Notes》：**fleeting → literature → permanent** 三段流。
 *   这里就是 "fleeting 收件箱"：进来的是候选，不是记忆；处理完才成为永久笔记。
 * - Mem0（arXiv:2504.19413）：写入用显式操作 **ADD / UPDATE / DELETE / NOOP**——
 *   所以 accept 时必须先判"是不是已有同一条"（NOOP），不能无脑塞。
 * - Hermes issue #56817（tiered write-approval）：全量审批会阻塞整合、把队列灌满。
 *   所以**只有外部材料进收件箱**；平时的记忆写入不受影响。
 * - GraphRAG SDK ingestion：去重是收益最高的一步，且要"质量过滤 → 剪枝 → 归并"。
 *
 * 零依赖：纯 JSON 文件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { textSimilarity } from "./memory.js";
const DUP_THRESHOLD = 0.9;
const MAX_CANDIDATES = 500;
/** 归一化：去空白标点，便于判重。 */
export function normalizeForDup(text) {
    return text
        .replace(/[\s\u3000]+/g, '')
        .replace(/[，。；：！？、,.!?;:"'“”‘’（）()【】\[\]]/g, '')
        .toLowerCase();
}
export function contentHash(text) {
    return createHash('sha256').update(normalizeForDup(text)).digest('hex').slice(0, 16);
}
/**
 * 便宜的重要性估计（不调模型）。
 *
 * 目的不是"打分"，而是**排序**：让你先看更可能有用的。
 * 依据：Generative Agents 用 importance 决定检索优先级；这里只借"要排序"这一点。
 */
export function estimateImportance(text) {
    let score = 0.4;
    if (text.length >= 80)
        score += 0.1;
    if (/\d/.test(text))
        score += 0.1; // 有数字/编号/型号
    if (/(必须|不要|禁止|结论|改用|改为|原因|因为)/.test(text))
        score += 0.15;
    if (/[A-Za-z]{3,}/.test(text))
        score += 0.05; // 含英文术语/命令
    return Math.min(1, Number(score.toFixed(2)));
}
export class CandidateInbox {
    filePath;
    clock;
    data = { version: 1, seq: 0, candidates: [] };
    loaded = false;
    constructor(options) {
        this.filePath = options.filePath;
        this.clock = options.now ?? (() => Date.now());
    }
    load() {
        if (this.loaded)
            return;
        this.loaded = true;
        if (!existsSync(this.filePath))
            return;
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
            if (parsed !== null && Array.isArray(parsed.candidates)) {
                this.data = { version: 1, seq: Number(parsed.seq) || parsed.candidates.length, candidates: parsed.candidates };
            }
        }
        catch {
            /* 坏文件当空库，不覆盖 */
        }
    }
    persist() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
        renameSync(temp, this.filePath);
    }
    /**
     * 加一条候选。
     *
     * 判重两级：先精确（归一化哈希），再近似（与 pending 候选 + 现有事实算相似度）。
     * 命中就标 duplicate 并**保留记录**——"重复了什么"本身是信息。
     */
    add(input, existing) {
        this.load();
        const content = input.content.trim();
        if (content.length < 8)
            throw new Error('候选内容太短（<8 字），至少给一句完整的话');
        const hash = contentHash(content);
        const base = {
            id: `cand-${++this.data.seq}`,
            createdAt: this.clock(),
            title: (input.title ?? content.slice(0, 30)).trim(),
            ...(input.url === undefined ? {} : { url: input.url }),
            content,
            // 确定性摘要：取前 200 字（不调模型）；长材料在面板上只显示这段
            summary: (input.summary ?? content).replace(/\s+/g, ' ').slice(0, 200),
            ...(input.subject === undefined ? {} : { subject: input.subject }),
            source: input.source ?? 'paste',
            ...(input.note === undefined ? {} : { note: input.note }),
            ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
            status: 'pending',
            importance: estimateImportance(content),
        };
        // 1) 精确重复
        const exact = this.data.candidates.find((cand) => contentHash(cand.content) === hash && cand.status !== 'rejected');
        if (exact !== undefined) {
            const dup = { ...base, status: 'duplicate', duplicateOf: exact.id, note: '与已有候选完全重复' };
            this.data.candidates.push(dup);
            this.trim();
            this.persist();
            return dup;
        }
        // 2) 近似重复（候选）
        for (const cand of this.data.candidates) {
            if (cand.status === 'rejected')
                continue;
            if (textSimilarity(cand.content, content) >= DUP_THRESHOLD) {
                const dup = { ...base, status: 'duplicate', duplicateOf: cand.id, note: `与候选 ${cand.id} 高度相似` };
                this.data.candidates.push(dup);
                this.trim();
                this.persist();
                return dup;
            }
        }
        // 3) 与现有事实重复（NOOP，别写第二遍）
        for (const fact of existing?.facts ?? []) {
            if (textSimilarity(fact.content, content) >= DUP_THRESHOLD) {
                const dup = { ...base, status: 'duplicate', duplicateOf: fact.id, note: '与现有记忆重复，采用也只会是 NOOP' };
                this.data.candidates.push(dup);
                this.trim();
                this.persist();
                return dup;
            }
        }
        this.data.candidates.push(base);
        this.trim();
        this.persist();
        return { ...base };
    }
    list(status) {
        this.load();
        const list = status === undefined ? this.data.candidates : this.data.candidates.filter((cand) => cand.status === status);
        return list.slice().sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt).map((cand) => ({ ...cand }));
    }
    get(id) {
        this.load();
        const found = this.data.candidates.find((cand) => cand.id === id);
        return found === undefined ? undefined : { ...found };
    }
    /**
     * 采用：唯一会写事实的入口。
     *
     * `sink` 由调用方注入（插件里就是 memory.ingest），这样本模块不依赖记忆层，便于单测。
     */
    accept(id, sink, overrides) {
        this.load();
        const cand = this.data.candidates.find((item) => item.id === id);
        if (cand === undefined)
            throw new Error(`没有这个候选：${id}`);
        if (cand.status !== 'pending')
            throw new Error(`候选 ${id} 状态是 ${cand.status}，不能再采用`);
        // 采用前允许改：改过就覆盖候选原文（审计上仍保留原 content 在 note 里）
        if (overrides?.content !== undefined && overrides.content.trim().length > 0 && overrides.content.trim() !== cand.content) {
            cand.note = `采用时改写：原 ${cand.content.slice(0, 40)}…`;
            cand.content = overrides.content.trim();
            cand.summary = cand.content.replace(/\s+/g, ' ').slice(0, 200);
        }
        if (overrides?.subject !== undefined && overrides.subject.trim().length > 0) {
            cand.subject = overrides.subject.trim();
        }
        const content = (overrides?.factContent ?? cand.summary ?? cand.content).trim();
        const factId = sink({
            content,
            subject: (cand.subject ?? '待归类').slice(0, 40),
            tags: ['inbox', cand.source, ...(cand.url === undefined ? [] : [cand.url])],
            importance: cand.importance,
            origin: 'inbox',
        });
        cand.status = 'accepted';
        cand.acceptedFactId = factId;
        cand.note = [
            cand.note,
            overrides?.factContent === undefined ? `已采用 → ${factId}` : `已采用 → ${factId}（记忆里是入口与要点，全文在资料库）`,
        ]
            .filter((part) => typeof part === 'string' && part.length > 0)
            .join('；');
        this.persist();
        return { ...cand };
    }
    reject(id, reason) {
        this.load();
        const cand = this.data.candidates.find((item) => item.id === id);
        if (cand === undefined)
            throw new Error(`没有这个候选：${id}`);
        if (cand.status !== 'pending')
            throw new Error(`候选 ${id} 状态是 ${cand.status}，不能再丢弃`);
        cand.status = 'rejected';
        cand.note = reason === undefined || reason.trim() === '' ? '已丢弃' : `已丢弃：${reason.trim()}`;
        this.persist();
        return { ...cand };
    }
    stats() {
        this.load();
        const count = (status) => this.data.candidates.filter((cand) => cand.status === status).length;
        return {
            total: this.data.candidates.length,
            pending: count('pending'),
            accepted: count('accepted'),
            rejected: count('rejected'),
            duplicate: count('duplicate'),
        };
    }
    /** 上限保护：超过 MAX_CANDIDATES 时先丢最旧的 rejected/duplicate。 */
    trim() {
        if (this.data.candidates.length <= MAX_CANDIDATES)
            return;
        const disposable = this.data.candidates
            .map((cand, index) => ({ cand, index }))
            .filter(({ cand }) => cand.status === 'rejected' || cand.status === 'duplicate')
            .sort((a, b) => a.cand.createdAt - b.cand.createdAt);
        const excess = this.data.candidates.length - MAX_CANDIDATES;
        const drop = new Set(disposable.slice(0, excess).map(({ index }) => index));
        if (drop.size > 0) {
            this.data.candidates = this.data.candidates.filter((_, index) => !drop.has(index));
        }
    }
}
