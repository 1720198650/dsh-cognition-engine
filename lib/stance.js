/**
 * src/stance.ts — 立场层：项目目标 + 判据（goal / prefer / forbid）。
 *
 * 为什么要有这一层（用户 2026-11-19）：
 *   自动化学习若没有评价标准，就会「学得多但没方向」——对用户的话没评价、
 *   对事情没判断、对项目没目标。人格卡管「怎么说话」，四维管「起点偏置」，
 *   真正缺的是「按什么判断」。
 *
 * 边界（宪章 2026-11-19 修订）：
 *   - 禁止：给人格打分、画人格画像、"她是什么样的人"这类汇总。
 *   - 允许：显式、可读、可改的项目目标与判据；不打分、不算总分、不隐藏数值。
 *   - 判据只评「事该不该做」，不评「我是谁」。
 *
 * 零依赖：纯 JSON。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export class StanceStore {
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
        this.data = { items: [], nextId: 1 };
        if (!existsSync(this.filePath))
            return this.data;
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
            const items = Array.isArray(parsed.items) ? parsed.items : [];
            const nextId = typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : items.length + 1;
            this.data = { items, nextId };
        }
        catch {
            this.data = { items: [], nextId: 1 };
        }
        return this.data;
    }
    persist() {
        const data = this.load();
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    }
    add(input) {
        const text = input.text.trim();
        if (text.length < 4)
            throw new Error('判据太短（至少 4 字）');
        const data = this.load();
        const existing = data.items.find((item) => item.text === text && item.kind === input.kind);
        if (existing !== undefined)
            return { ...existing };
        const now = this.clock();
        const item = {
            id: `st-${data.nextId}`,
            kind: input.kind,
            text,
            ...(input.deny === undefined ? {} : { deny: input.deny.map((word) => word.trim()).filter((word) => word.length > 0) }),
            active: true,
            origin: input.origin ?? 'user',
            createdAt: now,
            updatedAt: now,
        };
        data.items.push(item);
        data.nextId += 1;
        this.persist();
        return { ...item };
    }
    remove(id) {
        const data = this.load();
        const index = data.items.findIndex((item) => item.id === id);
        if (index < 0)
            return false;
        data.items.splice(index, 1);
        this.persist();
        return true;
    }
    list(activeOnly = false) {
        const items = this.load().items;
        return (activeOnly ? items.filter((item) => item.active) : [...items]).map((item) => ({ ...item }));
    }
    /**
     * 违反判据检查：候选/记忆文本命中任一 active forbid 的 deny 词即算违反。
     *
     * 只做**明确词命中**，不做语义推断——宁可漏判也不误杀正常内容。
     */
    violates(text) {
        const lower = text.toLowerCase();
        for (const item of this.load().items) {
            if (item.active !== true || item.kind !== 'forbid')
                continue;
            for (const word of item.deny ?? []) {
                if (word.length >= 2 && lower.includes(word.toLowerCase())) {
                    return { violates: true, rule: { ...item }, word };
                }
            }
        }
        return { violates: false };
    }
    /**
     * 渲染成注入段：目标在前、判据在后。限额 chars，超了按顺序截。
     *
     * 不打分、不排序、不给"倾向"——顺序就是添加顺序，人能预测。
     */
    render(maxChars = 320) {
        const items = this.list(true);
        if (items.length === 0)
            return '';
        const goals = items.filter((item) => item.kind === 'goal');
        const prefs = items.filter((item) => item.kind === 'prefer');
        const forbids = items.filter((item) => item.kind === 'forbid');
        const lines = [];
        let used = 0;
        const push = (line) => {
            if (used + line.length + 1 > maxChars)
                return false;
            lines.push(line);
            used += line.length + 1;
            return true;
        };
        push('【立场】按这个判断，与用户要求冲突时先说明分歧：');
        for (const item of goals)
            if (!push('目标：' + item.text))
                break;
        for (const item of prefs)
            if (!push('· ' + item.text))
                break;
        for (const item of forbids)
            if (!push('· 禁止：' + item.text))
                break;
        return lines.length <= 1 ? '' : lines.join('\n');
    }
}
