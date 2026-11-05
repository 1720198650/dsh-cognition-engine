/**
 * src/gaps.ts — 知识缺口（「我不知道」的登记簿）
 *
 * 为什么要有这个：
 * 现在的准则是**离线蒸馏**出来的——从已有记忆里归纳结论。
 * 但真正该学的东西往往出现在**卡壳的那一刻**：模型想不起来、查不到、只能猜。
 * 那一刻的缺口如果不记，下次还会在同一个地方卡住。
 *
 * 风识（dsh-engram-relay）的「自动补卡」验证了这个模式有效：
 * 不会 → 求助 → 查不到 → 当场补卡 → 下次就有。
 * 它自己也有当日上限（5 张）防噪声，我们同理。
 *
 * 与准则本的区别：
 *   准则 = 「已经学会的」
 *   缺口 = 「还没学会但知道该学的」
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveDataFile, resolveUserPath } from "./util.js";
/** 未解决缺口的数量上限——防止变成垃圾场。 */
const MAX_OPEN = 50;
/** 缺口描述长度上限。 */
const MAX_TEXT = 120;
export class GapStore {
    filePath;
    clock;
    gaps = [];
    nextSeq = 1;
    dirty = false;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-gaps.json') : resolveUserPath(options.filePath);
        this.clock = options.now ?? (() => Date.now());
    }
    /** 从磁盘加载（文件不存在是正常的）。 */
    loadSync() {
        try {
            if (!existsSync(this.filePath))
                return false;
            const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(raw.gaps))
                return false;
            this.gaps = raw.gaps
                .filter((g) => typeof g === 'object' && g !== null)
                .map((g) => ({
                id: String(g.id ?? ''),
                text: String(g.text ?? ''),
                ...(typeof g.context === 'string' ? { context: g.context } : {}),
                topicIds: Array.isArray(g.topicIds) ? g.topicIds.map(String) : [],
                createdAt: Number(g.createdAt ?? this.clock()),
                resolvedAt: g.resolvedAt === null || g.resolvedAt === undefined ? null : Number(g.resolvedAt),
                ...(typeof g.resolvedBy === 'string' ? { resolvedBy: g.resolvedBy } : {}),
            }))
                .filter((g) => g.id.length > 0 && g.text.length > 0);
            this.nextSeq = Number(raw.nextSeq ?? this.gaps.length + 1);
            return true;
        }
        catch {
            return false;
        }
    }
    /** 落盘（有变化才写）。 */
    flush() {
        if (!this.dirty)
            return;
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify({ version: 1, nextSeq: this.nextSeq, gaps: this.gaps }, null, 2), 'utf8');
            this.dirty = false;
        }
        catch {
            /* 落盘失败不影响内存 */
        }
    }
    /** 登记一个缺口。同文本的未解决缺口不重复记。 */
    add(input) {
        const text = input.text.trim().slice(0, MAX_TEXT);
        const existing = this.gaps.find((g) => g.resolvedAt === null && g.text.toLowerCase() === text.toLowerCase());
        if (existing !== undefined)
            return { gap: existing, duplicate: true };
        // 超过上限先淘汰最老的未解决缺口
        const open = this.gaps.filter((g) => g.resolvedAt === null);
        if (open.length >= MAX_OPEN) {
            const oldest = open.slice().sort((a, b) => a.createdAt - b.createdAt)[0];
            if (oldest !== undefined) {
                oldest.resolvedAt = this.clock();
                oldest.resolvedBy = '超出待补上限，自动归档';
            }
        }
        const gap = {
            id: `gap-${this.nextSeq}`,
            text,
            ...(input.context === undefined ? {} : { context: input.context.slice(0, 200) }),
            topicIds: [...(input.topicIds ?? [])],
            createdAt: this.clock(),
            resolvedAt: null,
        };
        this.nextSeq += 1;
        this.gaps.push(gap);
        this.dirty = true;
        return { gap, duplicate: false };
    }
    /** 标记为已填补。 */
    resolve(id, by) {
        const gap = this.gaps.find((g) => g.id === id);
        if (gap === undefined || gap.resolvedAt !== null)
            return false;
        gap.resolvedAt = this.clock();
        gap.resolvedBy = by.slice(0, 120);
        this.dirty = true;
        return true;
    }
    /** 所有未解决的缺口，新的在前。 */
    open() {
        return this.gaps.filter((g) => g.resolvedAt === null).sort((a, b) => b.createdAt - a.createdAt);
    }
    all() {
        return this.gaps;
    }
    get(id) {
        return this.gaps.find((g) => g.id === id);
    }
    stats() {
        const open = this.open().length;
        return { open, resolved: this.gaps.length - open, total: this.gaps.length };
    }
    /**
     * 渲染成注入用的清单。
     *
     * 只在有待补缺口时出现，且很短——它提醒模型「这些是你还不知道的」，
     * 而不是占满预算。
     */
    renderSection(budget = 240) {
        const open = this.open();
        if (open.length === 0)
            return '';
        const header = '## 待补的知识缺口';
        const lines = [header];
        const omittedHint = (n) => `（另有 ${n} 条未列出）`;
        let used = header.length;
        let omitted = 0;
        for (const gap of open) {
            const line = `- [${gap.id}] ${gap.text}`;
            if (used + line.length + 1 > budget) {
                omitted += 1;
                continue;
            }
            lines.push(line);
            used += line.length + 1;
        }
        if (omitted > 0)
            lines.push(omittedHint(omitted));
        return lines.join('\n');
    }
}
