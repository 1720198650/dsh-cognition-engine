/**
 * src/shadow.ts — shadow 试运行（S6）
 *
 * 新学到的东西先进 shadow：**保留在库里、但不注入系统提示**。
 * 用一段时间（默认 21 天）看它到底有没有被用上、有没有帮上忙，
 * 够了才转正。这解决一个具体的失败：模型偶尔冒出一条「听起来很对」的准则，
 * 直接进注入段就污染了每一轮上下文，而且很难说清是哪天开始变差的。
 *
 * 转正条件（对齐 docs/upgrade-plan-v3.md §7.3）：
 *   命中 ≥ 3 次且 helpful ≥ harmful
 * 到期条件：21 天零命中 → expired
 *
 * 本模块只存数据与状态机，**不参与注入渲染**——这是它的定义性质，不是遗漏。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataFile } from "./util.js";
const DAY_MS = 24 * 60 * 60 * 1000;
export class ShadowStore {
    filePath;
    clock;
    ttlDays;
    doc = { schema: 'cognition.shadow', version: 1, entries: [] };
    loaded = false;
    saveError;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-shadow.json') : resolve(options.filePath);
        this.clock = options.now ?? (() => Date.now());
        this.ttlDays = options.ttlDays ?? 21;
    }
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        try {
            if (!existsSync(this.filePath))
                return false;
            const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.shadow' || !Array.isArray(raw.entries)) {
                return false;
            }
            this.doc = {
                schema: 'cognition.shadow',
                version: 1,
                entries: raw.entries.filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string'),
            };
            return true;
        }
        catch {
            return false;
        }
    }
    get path() {
        return this.filePath;
    }
    get lastSaveError() {
        return this.saveError;
    }
    /** 在册的（未定论的）条目。 */
    active() {
        this.loadSync();
        return this.doc.entries.filter((entry) => entry.verdict === null);
    }
    all() {
        this.loadSync();
        return [...this.doc.entries];
    }
    /** 放一条进 shadow。 */
    add(input) {
        this.loadSync();
        const text = input.text.trim();
        if (text.length === 0)
            return { rejected: '内容不能为空' };
        // 同一内容不重复进 shadow（避免「学三次同样的东西」占三个名额）
        const duplicate = this.doc.entries.find((entry) => entry.verdict === null && entry.text === text);
        if (duplicate !== undefined)
            return { entry: duplicate };
        const now = this.clock();
        const entry = {
            id: `sh-${randomUUID().slice(0, 8)}`,
            subject: (input.subject ?? '未分类').trim() || '未分类',
            text,
            source: input.source ?? 'manual',
            createdAt: now,
            expiresAt: now + this.ttlDays * DAY_MS,
            occurrences: 0,
            hits: 0,
            helpful: 0,
            harmful: 0,
            verdict: null,
            ...(input.note === undefined ? {} : { note: input.note }),
        };
        this.doc.entries.push(entry);
        this.#save();
        return { entry };
    }
    /**
     * 记一次使用结果。
     *
     * `occurrence` = 被检索到（不管用没用上）；`hit` = 确实用上了；
     * `helpful` / `harmful` = 用户反馈的方向。
     */
    record(id, update) {
        this.loadSync();
        const entry = this.doc.entries.find((item) => item.id === id);
        if (entry === undefined || entry.verdict !== null)
            return false;
        if (update.occurrence === true)
            entry.occurrences += 1;
        if (update.hit === true)
            entry.hits += 1;
        if (update.helpful === true)
            entry.helpful += 1;
        if (update.harmful === true)
            entry.harmful += 1;
        this.#save();
        return true;
    }
    /** 是否够格转正：命中 ≥3 且 helpful ≥ harmful。 */
    canPromote(entry) {
        return entry.verdict === null && entry.hits >= 3 && entry.helpful >= entry.harmful;
    }
    /**
     * 转正：把条目交还给调用方（由它写进准则本），并标 promoted。
     *
     * 这里不直接依赖 playbook，是为了让 shadow 不绑死在准则本上——
     * 将来记忆条目也能走同一条试运行通道。
     */
    promote(id) {
        this.loadSync();
        const entry = this.doc.entries.find((item) => item.id === id);
        if (entry === undefined)
            return { ok: false, reason: `找不到 shadow 条目 ${id}` };
        if (entry.verdict !== null)
            return { ok: false, reason: `该条目已定论：${entry.verdict}` };
        if (!this.canPromote(entry)) {
            return { ok: false, reason: `还不够格：命中 ${entry.hits}/3，helpful ${entry.helpful} vs harmful ${entry.harmful}` };
        }
        entry.verdict = 'promoted';
        this.#save();
        return { ok: true, entry };
    }
    reject(id, note) {
        this.loadSync();
        const entry = this.doc.entries.find((item) => item.id === id);
        if (entry === undefined || entry.verdict !== null)
            return false;
        entry.verdict = 'rejected';
        if (note !== undefined)
            entry.note = note;
        this.#save();
        return true;
    }
    /** 扫描到期：21 天零命中 → expired。返回本次到期的条目。 */
    sweepExpired() {
        this.loadSync();
        const now = this.clock();
        const expired = [];
        for (const entry of this.doc.entries) {
            if (entry.verdict !== null)
                continue;
            if (entry.expiresAt > now)
                continue;
            if (entry.hits > 0)
                continue; // 有过命中就不算「零命中」，留给人工决定
            entry.verdict = 'expired';
            expired.push(entry);
        }
        if (expired.length > 0)
            this.#save();
        return expired;
    }
    stats() {
        this.loadSync();
        let promoted = 0;
        let expired = 0;
        let rejected = 0;
        let active = 0;
        let ready = 0;
        for (const entry of this.doc.entries) {
            if (entry.verdict === 'promoted')
                promoted += 1;
            else if (entry.verdict === 'expired')
                expired += 1;
            else if (entry.verdict === 'rejected')
                rejected += 1;
            else {
                active += 1;
                if (this.canPromote(entry))
                    ready += 1;
            }
        }
        return { active, promoted, expired, rejected, readyToPromote: ready };
    }
    #save() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(this.doc, null, 2) + '\n', 'utf8');
            this.saveError = undefined;
        }
        catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
        }
    }
}
