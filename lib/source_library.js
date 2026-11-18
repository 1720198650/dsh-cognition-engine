/**
 * src/source_library.ts — 资料库：把贴进来的长文变成「可查的知识」，而不是「一条巨长记忆」。
 *
 * 为什么要有这一层（2026-11-18 用户质问"收件如果不能自动学习，我为什么不直接在对话框发给你"）：
 *
 *   - 记忆事实是「关于用户为真」的东西：它参与注入、参与冲突仲裁、按主题和重要度排序。
 *     一篇论文切出几十条同主题事实，会立刻把用户自己的真实口径挤出检索窗口——记忆洪泛。
 *   - 所以长文只能进**资料层**：全量存档（sources.ts，不可变 + 哈希链）→ 切块索引
 *     （本文件）→ 自动摘要（source_note.ts）→ 按需检索。
 *   - 它不占每一轮的注入预算，但任何时候都能被查到、被引用。「学到」= 随时能查，不是「永远摆在眼前」。
 *
 * 零依赖：JSONL + JSON，纯文本切块，bigram 打分。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const TERMINATORS = '。！？；!?;\n';
/**
 * 从 `max` 往 `min` 回溯，找最后一个句末标点；找不到就硬切。
 *
 * 中文资料从 HTML 抽出来后常常没有空行，整篇是一大段——只按空行切会得到
 * 一条 2 万字的块，检索时等于没有索引。所以长段必须按句切。
 */
function lastBoundary(text, min, max) {
    const limit = Math.min(max, text.length);
    const floor = Math.max(1, Math.floor(min / 2));
    for (let i = limit - 1; i >= floor; i -= 1) {
        const ch = text[i];
        if (ch !== undefined && TERMINATORS.includes(ch))
            return i + 1;
    }
    return limit;
}
/**
 * 切块：先按空行分段，长段再按句切，最后贪心合并到目标长度。
 *
 * 目标 600 字是权衡结果：再大则检索命中后塞进上下文的噪声太多，
 * 再小则一句话的上下文被切断。
 */
/**
 * 判断是不是表格型文本（CSV/TSV/管道表）：行数够、分隔符一致。
 *
 * 表格不能按句子切——一行一条记录，切在行中间就把数据劈开了，
 * 检索命中后给出的半行等于废数据。表格要按"表头 + 若干整行"切。
 */
function detectTable(lines) {
    const body = lines.map((line) => line.trim()).filter((line) => line.length > 0);
    if (body.length < 5)
        return null;
    for (const delimiter of [',', '\t', '|']) {
        const counts = body.map((line) => line.split(delimiter).length - 1);
        const first = counts[0] ?? 0;
        if (first < 1)
            continue;
        const same = counts.filter((count) => count === first).length;
        if (same / counts.length >= 0.8) {
            return { delimiter, header: body[0], rows: body.slice(1) };
        }
    }
    return null;
}
/** 表格形状（分隔符 / 表头 / 数据行），不是表格返回 null。 */
export function detectTableShape(text) {
    return detectTable(text.replace(/\r\n?/g, '\n').split('\n'));
}
export function chunkText(text, options = {}) {
    const target = Math.max(80, options.target ?? 600);
    const max = Math.max(target, options.max ?? 1200);
    const clean = text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (clean.length === 0)
        return [];
    // 表格优先：按整行切，每块都带表头，检索命中后能直接读出一行完整记录
    const table = detectTableShape(clean);
    if (table !== null) {
        const blocks = [];
        let rows = [];
        let size = table.header.length;
        for (const row of table.rows) {
            if (rows.length > 0 && size + row.length + 1 > target) {
                blocks.push([table.header, ...rows].join('\n'));
                rows = [];
                size = table.header.length;
            }
            rows.push(row);
            size += row.length + 1;
        }
        if (rows.length > 0)
            blocks.push([table.header, ...rows].join('\n'));
        return blocks;
    }
    const pieces = [];
    for (const para of clean.split(/\n{2,}/)) {
        const p = para.trim();
        if (p.length === 0)
            continue;
        if (p.length <= max) {
            pieces.push(p);
            continue;
        }
        let rest = p;
        // 按目标长度反复切，不是"切到上限就停"——否则只剩一点尾巴时（比如 1092 字）
        // 会整块塞进去，平均块长被拉高（2026-11-18 中文长文实测 avg 1111 → 840）。
        while (rest.length > target) {
            const cut = lastBoundary(rest, target, Math.min(max, target));
            const head = rest.slice(0, cut).trim();
            if (head.length > 0)
                pieces.push(head);
            rest = rest.slice(cut).trim();
        }
        if (rest.length > 0)
            pieces.push(rest);
    }
    const out = [];
    let buffer = '';
    for (const piece of pieces) {
        if (buffer.length === 0) {
            buffer = piece;
            continue;
        }
        if (buffer.length + piece.length + 1 <= target) {
            buffer = `${buffer}\n${piece}`;
            continue;
        }
        out.push(buffer);
        buffer = piece;
    }
    if (buffer.length > 0)
        out.push(buffer);
    return out;
}
/** 去标点小写后的 bigram 集合：中文按双字、英文按双字母，够用且不需要分词器。 */
export function bigrams(text) {
    const clean = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    const out = new Set();
    for (let i = 0; i + 1 < clean.length; i += 1)
        out.add(clean.slice(i, i + 2));
    return out;
}
const CJK = /[\u3400-\u9fff]/;
/**
 * 给一个块打分：中文走 bigram 覆盖率，纯英文按整词命中。
 *
 * 为什么要分两条路：英文长块里 "ablative" 的 7 个 bigram（ab/bl/la/at/ti/iv/ve）
 * 几乎在任何一段英文里都能凑齐，覆盖率全是 1.00 —— 等于没筛。整词命中才有区分度。
 */
export function scoreQuery(query, text) {
    const q = query.trim();
    if (q.length === 0 || text.length === 0)
        return 0;
    const tokens = q
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2);
    const lower = text.toLowerCase();
    let tokenScore = 0;
    if (tokens.length > 0) {
        let total = 0;
        let found = 0;
        for (const token of tokens) {
            total += token.length;
            if (lower.includes(token))
                found += token.length;
        }
        tokenScore = total === 0 ? 0 : found / total;
    }
    const queryGrams = bigrams(q);
    let gramScore = 0;
    if (queryGrams.size > 0) {
        const textGrams = bigrams(text);
        let hit = 0;
        for (const gram of queryGrams)
            if (textGrams.has(gram))
                hit += 1;
        gramScore = hit / queryGrams.size;
    }
    // 纯英文查询只认整词，不受 bigram 噪声影响；中英混排取两者较高值
    return CJK.test(q) ? Math.max(tokenScore, gramScore) : tokenScore;
}
/**
 * 一条"资料"如果整个正文只是一行文件路径，它不该参与检索。
 *
 * 2026-11-18 实测：用户把 `D:\下载\...固定资产投资.xls` 这条路径粘进收件箱，
 * 之后查「固定资产投资」第一名是这条 26 字的路径，真正的表排第二——噪声盖住了内容。
 */
export function isPathOnlyBlock(text) {
    const clean = text.trim();
    if (clean.length === 0 || clean.length > 300)
        return false;
    if (/[\n。！？；]/.test(clean))
        return false;
    return /^([a-zA-Z]:[\\/]|\\\\|~[\\/]|\/)/.test(clean);
}
export class SourceLibrary {
    blocksFile;
    notesFile;
    clock;
    blockCache;
    noteCache;
    constructor(options) {
        this.blocksFile = options.blocksFile;
        this.notesFile = options.notesFile;
        this.clock = options.now ?? (() => Date.now());
    }
    loadBlocks() {
        if (this.blockCache !== undefined)
            return this.blockCache;
        this.blockCache = [];
        if (!existsSync(this.blocksFile))
            return this.blockCache;
        for (const line of readFileSync(this.blocksFile, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            try {
                this.blockCache.push(JSON.parse(trimmed));
            }
            catch {
                // 单行坏了就跳过这一行，**不能 break**：截断后的数组一旦被回写
                // （deleteSource 会写盘），后半部分块就永久丢了
                // （2026-11-18 实测：黄页那篇 15 块在删除操作后整段消失）
                continue;
            }
        }
        return this.blockCache;
    }
    loadNotes() {
        if (this.noteCache !== undefined)
            return this.noteCache;
        this.noteCache = {};
        if (!existsSync(this.notesFile))
            return this.noteCache;
        try {
            const parsed = JSON.parse(readFileSync(this.notesFile, 'utf8').replace(/^\uFEFF/, ''));
            if (parsed !== null && typeof parsed === 'object')
                this.noteCache = parsed;
        }
        catch {
            this.noteCache = {};
        }
        return this.noteCache;
    }
    saveNotes() {
        const all = this.loadNotes();
        mkdirSync(dirname(this.notesFile), { recursive: true });
        writeFileSync(this.notesFile, JSON.stringify(all, null, 2), 'utf8');
    }
    /** 索引一条来源（幂等：同 sourceId 已经有块就跳过）。 */
    indexSource(source, options = {}) {
        const blocks = this.loadBlocks();
        const existing = blocks.filter((block) => block.sourceId === source.id);
        if (existing.length > 0)
            return { sourceId: source.id, blocks: existing.length, skipped: true };
        const pieces = chunkText(source.content, options);
        if (pieces.length === 0)
            return { sourceId: source.id, blocks: 0, skipped: false };
        const at = this.clock();
        const fresh = pieces.map((text, ord) => ({
            id: `blk-${source.id}-${ord}`,
            sourceId: source.id,
            ord,
            at,
            chars: text.length,
            text,
        }));
        mkdirSync(dirname(this.blocksFile), { recursive: true });
        appendFileSync(this.blocksFile, fresh.map((block) => `${JSON.stringify(block)}\n`).join(''), 'utf8');
        blocks.push(...fresh);
        return { sourceId: source.id, blocks: fresh.length, skipped: false };
    }
    blocksOf(sourceId) {
        return this.loadBlocks()
            .filter((block) => block.sourceId === sourceId)
            .sort((a, b) => a.ord - b.ord);
    }
    /**
     * 从资料库里删掉一条来源的块索引与摘要（来源账本不动，哈希链不会断）。
     *
     * 为什么需要：误粘的路径、导入失败的残片会长期占着检索位和列表行。
     * SoMem 的账本是只追加的证据层，删除只能发生在"派生视图"上——这正是块和摘要所在的层。
     */
    deleteSource(sourceId) {
        // 先丢掉缓存、从磁盘重读：删除会整文件回写，用可能过期的内存数组回写
        // 会把别的来源的块一起抹掉（2026-11-18 黄页那篇就这样丢了 15 块）
        this.blockCache = undefined;
        const blocks = this.loadBlocks();
        const kept = blocks.filter((block) => block.sourceId !== sourceId);
        const removed = blocks.length - kept.length;
        if (removed > 0) {
            mkdirSync(dirname(this.blocksFile), { recursive: true });
            writeFileSync(this.blocksFile, kept.map((block) => `${JSON.stringify(block)}\n`).join(''), 'utf8');
            this.blockCache = kept;
        }
        this.noteCache = undefined;
        const notes = this.loadNotes();
        const hadNote = notes[sourceId] !== undefined;
        if (hadNote) {
            delete notes[sourceId];
            this.saveNotes();
        }
        return { sourceId, blocks: removed, note: hadNote };
    }
    note(sourceId) {
        return this.loadNotes()[sourceId];
    }
    setPending(sourceId, title) {
        const all = this.loadNotes();
        const note = { sourceId, at: this.clock(), status: 'pending', title, summary: '', points: [] };
        all[sourceId] = note;
        this.saveNotes();
        return note;
    }
    saveNote(note) {
        const all = this.loadNotes();
        all[note.sourceId] = note;
        this.saveNotes();
        return note;
    }
    notes() {
        return Object.values(this.loadNotes()).sort((a, b) => b.at - a.at);
    }
    /** 收件页要显示的一行摘要：块数 + 摘要状态。 */
    describe(sourceId) {
        if (sourceId === undefined)
            return { blocks: 0, note: null };
        const blocks = this.blocksOf(sourceId).length;
        const note = this.note(sourceId) ?? null;
        return { blocks, note };
    }
    /**
     * 检索：bigram 覆盖率打分，按来源去重上限 `perSource`，总字符不超过 `maxChars`。
     *
     * 命中率门槛 0.15 与准入/冲突检测同一个量级：低于它基本都是"共用几个常见字"。
     */
    search(query, options = {}) {
        const k = Math.max(1, options.k ?? 5);
        const maxChars = Math.max(200, options.maxChars ?? 1500);
        const perSource = Math.max(1, options.perSource ?? 2);
        const minScore = options.minScore ?? 0.15;
        const queryGrams = bigrams(query);
        if (queryGrams.size === 0)
            return [];
        const titles = new Map();
        for (const note of this.notes())
            titles.set(note.sourceId, note.title);
        const scored = [];
        for (const block of this.loadBlocks()) {
            if (isPathOnlyBlock(block.text))
                continue;
            const score = scoreQuery(query, block.text);
            if (score < minScore)
                continue;
            scored.push({
                id: block.id,
                sourceId: block.sourceId,
                title: titles.get(block.sourceId) ?? block.sourceId,
                ord: block.ord,
                score,
                text: block.text,
            });
        }
        scored.sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId) || a.ord - b.ord);
        const out = [];
        const seen = new Map();
        // 同一篇资料被反复导入时（用户试了好几次），块文本完全一样：
        // 输出阶段按正文去重，否则一次检索全是同一段话的 6 份拷贝。
        const seenText = new Set();
        let budget = maxChars;
        for (const hit of scored) {
            if (out.length >= k)
                break;
            const used = seen.get(hit.sourceId) ?? 0;
            if (used >= perSource)
                continue;
            if (hit.text.length > budget)
                continue;
            if (seenText.has(hit.text))
                continue;
            out.push(hit);
            seen.set(hit.sourceId, used + 1);
            seenText.add(hit.text);
            budget -= hit.text.length;
        }
        return out;
    }
    stats() {
        const blocks = this.loadBlocks();
        const notes = this.notes();
        return {
            blocks: blocks.length,
            notes: notes.length,
            ready: notes.filter((note) => note.status === 'ready').length,
            failed: notes.filter((note) => note.status === 'failed').length,
            skipped: notes.filter((note) => note.status === 'skipped').length,
            sources: new Set(blocks.map((block) => block.sourceId)).size,
        };
    }
}
