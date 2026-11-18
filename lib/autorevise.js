/**
 * src/autorevise.ts — 自动修订的"安全内核"：先存档、再改、必标注、可回滚。
 *
 * 用户 2026-11-18 授权自动修订，但附了三条硬条件：
 *   ① 面板有开关；② 修改要标注；③ **修改前要有存档**。
 * 这个文件只管 ②③（①在 settings 里），而且刻意做成三件事分离：
 *
 *   1. 门槛（shouldAutoRevise）：纯函数，不碰数据。宁可少改，不可乱改。
 *   2. 存档（RevisionLog）：append-only JSONL，先写存档再改数据；改失败也要留痕。
 *   3. 标注（AUTO_MARK）：写进内容里，而不是只在渲染时加前缀——
 *      渲染前缀会丢（换个界面就没了），写进内容才跟数据一起走。
 *
 * 为什么"先存档再改"：自动修订是唯一一种会让插件自己改自己判断的机制，
 * 出错时用户需要的是"能回到改之前"，而不是"看日志猜之前是什么"。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** 自动改过的内容统一带这个前缀，肉眼和检索都能认出来。 */
export const AUTO_MARK = '[自动修订]';
/**
 * 自动修订门槛（依据 docs/l3-autorevise.md）：
 *   - 事实：≥2 条反证即可（有双时态，改错能回滚，代价低）；
 *   - 准则：必须「用户明确说过」+ ≥2 条反证（准则每轮注入，改错影响面大）；
 *   - 任何目标都有 24 小时冷却，避免来回抖；
 *   - 开关关着就一律不改。
 */
export function shouldAutoRevise(input) {
    if (!input.autoReviseEnabled)
        return { allow: false, reason: '自动修订开关是关的' };
    if (input.hoursSinceLastRevision < 24) {
        return { allow: false, reason: `冷却期内（上次修订 ${input.hoursSinceLastRevision.toFixed(1)} 小时前，至少要 24 小时）` };
    }
    if (input.target === 'rule') {
        if (!input.userSaidSo)
            return { allow: false, reason: '准则要自动改必须你明确说过这条不对' };
        if (input.counterEvidence < 2) {
            return { allow: false, reason: `准则反证不足（${input.counterEvidence}/2）` };
        }
        return { allow: true, reason: '你明确说过 + 反证足够 + 过冷却期' };
    }
    if (input.counterEvidence < 2) {
        return { allow: false, reason: `事实反证不足（${input.counterEvidence}/2）` };
    }
    return { allow: true, reason: '反证足够 + 过冷却期' };
}
/** 自动改过的内容加标注；已带标注的不重复加。 */
export function markAuto(content) {
    const trimmed = content.trim();
    if (trimmed.startsWith(AUTO_MARK))
        return trimmed;
    return `${AUTO_MARK} ${trimmed}`;
}
/** 去掉标注（回滚时用，避免回滚后的内容还挂着"自动修订"）。 */
export function unmarkAuto(content) {
    return content.replace(new RegExp(`^${AUTO_MARK.replace(/[[\]]/g, '\\$&')}\\s*`), '').trim();
}
/** append-only 修订存档。 */
export class RevisionLog {
    filePath;
    clock;
    cache;
    constructor(options) {
        this.filePath = options.filePath;
        this.clock = options.now ?? (() => Date.now());
    }
    load() {
        if (this.cache !== undefined)
            return this.cache;
        this.cache = [];
        if (!existsSync(this.filePath))
            return this.cache;
        for (const line of readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            try {
                this.cache.push(JSON.parse(trimmed));
            }
            catch {
                continue; // 坏行只跳过这一行，别把后面全丢了
            }
        }
        return this.cache;
    }
    /**
     * 先存档。返回存档记录；调用方拿到它之后才去改数据。
     *
     * 注意顺序：**存档写盘成功才返回**，写不进去就抛错让调用方放弃修订——
     * 宁可这次不改，也不能出现"改了但没存档"。
     */
    backup(input) {
        const records = this.load();
        const record = {
            id: `rev-${records.length + 1}`,
            at: this.clock(),
            target: input.target,
            targetId: input.targetId,
            before: input.before,
            after: input.after,
            reason: input.reason,
            diagnosis: input.diagnosis,
            by: input.by,
        };
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
        records.push(record);
        return record;
    }
    list(limit = 30) {
        return [...this.load()].reverse().slice(0, Math.max(1, limit));
    }
    /** 某个目标上次被改是什么时候（算冷却期用）。 */
    lastAt(targetId) {
        let latest;
        for (const record of this.load()) {
            if (record.targetId !== targetId)
                continue;
            if (latest === undefined || record.at > latest)
                latest = record.at;
        }
        return latest;
    }
    markUndone(id) {
        // JSONL 只追加：回滚标记写成新记录（type 里带 undone），不改老行
        const records = this.load();
        const target = records.find((record) => record.id === id);
        if (target === undefined)
            throw new Error('没有这条修订记录：' + id);
        const marker = { ...target, id: `${id}-undo`, at: this.clock(), undone: true, by: 'user' };
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(marker)}\n`, 'utf8');
        records.push(marker);
    }
}
