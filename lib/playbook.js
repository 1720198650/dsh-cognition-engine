/**
 * src/playbook.ts — 准则本（Playbook）
 *
 * 把记忆蒸馏成一份常驻上下文的「工作准则」。设计依据：
 *
 *   - ACE (ICLR 2026)：条目是 bullet，带 helpful/harmful 双向计数；
 *     **LLM 只产候选，合并/去重/淘汰由确定性代码做**——这是 delta 优于 rewrite 的根因。
 *   - Dynamic Cheatsheet (EACL 2026)：分节 + 计数；整篇重写会因模型写「...」而逐轮退化，
 *     所以这里条目化存储、单条增删。
 *   - MemGPT/Letta：准则本对应 Core Memory——常驻、短、由调用方维护。
 *
 * 本文件只负责「数据 + 确定性合并 + 渲染」，不调用任何模型。
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { cosine, tokenize } from "./memory.js";
import { resolveDataFile } from "./util.js";
/* ------------------------------------------------------------------ */
/* 类型                                                                 */
/* ------------------------------------------------------------------ */
export const PLAYBOOK_SECTIONS = ['约定', '坑', '状态', '未分类'];
const EMPTY_USAGE = {
    applied: 0,
    appliedGood: 0,
    appliedBad: 0,
    missed: 0,
    userCorrected: 0,
};
/* ------------------------------------------------------------------ */
/* 常量                                                                 */
/* ------------------------------------------------------------------ */
const MAX_SNAPSHOTS = 5;
const CONTENT_MIN = 12;
// 60 字对含 URL 的准则太紧（实测「npm 发布必须加 --registry」被误杀）。
// 放宽到 80：仍然足够短，又能容纳一条带命令/URL 的准则。
const CONTENT_MAX = 80;
/**
 * 套话库：这些内容换成任何项目都成立，按 Dynamic Cheatsheet 的 DC-∅ 结论，
 * 它们与「指令本身」没有区别，增益为零，不该进准则本。
 */
const CLICHE_PATTERNS = Object.freeze([
    /认真(检查|对待|阅读)/,
    /注意(边界|细节|安全)/,
    /(仔细|认真)(思考|核对)/,
    /保持(代码|风格)?(整洁|一致)/,
    /(多|要)写(单元)?测试/,
    /(确保|保证)(正确性|质量|可用)/,
    /遵循(最佳实践|规范)/,
    /(及时|经常)备份/,
    /think (carefully|step by step)/i,
    /follow best practices/i,
    /write (unit )?tests/i,
]);
/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */
function clampSection(section) {
    const value = (section ?? '').trim();
    return PLAYBOOK_SECTIONS.includes(value) ? value : '未分类';
}
/** 长度按「字符数」算；中文与英文一视同仁。 */
function normalizeContent(text) {
    return text.replace(/\s+/g, ' ').trim();
}
/** 极简否定检测：够用即可，冲突最终由人裁决。 */
function hasNegation(text) {
    // 单字「不」也要算：准则里最常见的否定就是「不跳步」「不要用 X」。
    // 这里只是打冲突标记供人工看，误报的代价远小于漏报。
    return /(不|没|无|非|未|别|never|not|don't|do not|avoid)/i.test(text);
}
/** 非法正则不能抛错：用户填错一个括号不该让整个插件崩掉。 */
function safeRegex(pattern) {
    try {
        return new RegExp(pattern, 'i');
    }
    catch {
        return null;
    }
}
function isCliche(text) {
    return CLICHE_PATTERNS.some((pattern) => pattern.test(text));
}
function emptyFile() {
    return { version: 1, revision: 0, updatedAt: 0, entries: [] };
}
/* ------------------------------------------------------------------ */
/* 主体                                                                 */
/* ------------------------------------------------------------------ */
export class PlaybookStore {
    filePath;
    snapshotDir;
    clock;
    maxChars;
    maxEntries;
    maxPerSection;
    dedupeThreshold;
    validateSourceIds;
    isSourceAlive;
    data = emptyFile();
    seq = 0;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined
            ? resolveDataFile('cognition-playbook.json')
            : resolve(options.filePath);
        this.snapshotDir = join(dirname(this.filePath), '.snapshots', 'playbook');
        this.clock = options.now ?? (() => Date.now());
        this.maxChars = Math.max(200, options.maxChars ?? 700);
        this.maxEntries = Math.max(1, options.maxEntries ?? 12);
        this.maxPerSection = Math.max(1, options.maxPerSection ?? 5);
        this.dedupeThreshold = Math.min(0.99, Math.max(0.5, options.dedupeThreshold ?? 0.7));
        this.validateSourceIds = options.validateSourceIds;
        this.isSourceAlive = options.isSourceAlive;
    }
    get path() {
        return this.filePath;
    }
    /* ------------------------------ 读写 ------------------------------ */
    /** 启动时恢复；文件不存在或损坏都按空准则本启动，绝不阻断插件加载。 */
    loadSync() {
        try {
            const raw = readFileSync(this.filePath, 'utf8');
            this.restore(JSON.parse(raw));
            return true;
        }
        catch {
            this.data = emptyFile();
            return false;
        }
    }
    async load() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            this.restore(JSON.parse(raw));
            return true;
        }
        catch {
            this.data = emptyFile();
            return false;
        }
    }
    restore(file) {
        const entries = Array.isArray(file.entries) ? file.entries.filter((entry) => typeof entry?.content === 'string') : [];
        this.data = {
            version: 1,
            revision: Number(file.revision ?? 0),
            updatedAt: Number(file.updatedAt ?? 0),
            entries: entries.map((entry) => ({
                id: String(entry.id ?? ''),
                section: clampSection(entry.section),
                content: normalizeContent(entry.content),
                helpful: Number(entry.helpful ?? 0),
                harmful: Number(entry.harmful ?? 0),
                sourceIds: Array.isArray(entry.sourceIds) ? entry.sourceIds.map(String) : [],
                validFrom: entry.validFrom === null || entry.validFrom === undefined ? null : Number(entry.validFrom),
                validTo: entry.validTo === null || entry.validTo === undefined ? null : Number(entry.validTo),
                status: (entry.status ?? 'active'),
                createdAt: Number(entry.createdAt ?? 0),
                updatedAt: Number(entry.updatedAt ?? 0),
                note: String(entry.note ?? ''),
                history: Array.isArray(entry.history) ? entry.history : [],
                // 老文件没有这些字段，一律按「全关」恢复，保持向后兼容
                guard: entry.guard === true,
                enforce: entry.enforce === true,
                audit: entry.audit === true,
                origin: entry.origin === 'agent' ? 'agent' : entry.origin === 'auto' ? 'auto' : 'human',
                ...(entry.evidence === undefined ? {} : { evidence: entry.evidence }),
                ...(entry.usage === undefined ? {} : { usage: { ...EMPTY_USAGE, ...entry.usage } }),
                ...(entry.conflictGroupId === undefined ? {} : { conflictGroupId: String(entry.conflictGroupId) }),
                ...(entry.tombstone === undefined ? {} : { tombstone: entry.tombstone }),
                trigger: typeof entry.trigger === 'string' ? entry.trigger : '',
                when: typeof entry.when === 'string' ? entry.when : '',
                topicIds: Array.isArray(entry.topicIds) ? entry.topicIds.map(String).filter((t) => t.length > 0) : [],
                required: typeof entry.required === 'string' ? entry.required : '',
                violations: Number(entry.violations ?? 0),
                lastViolationAt: entry.lastViolationAt === null || entry.lastViolationAt === undefined
                    ? null
                    : Number(entry.lastViolationAt),
            })),
        };
        // 从已有 id 里续上序号，避免重启后 id 冲突
        this.seq = this.data.entries.reduce((max, entry) => {
            const match = /^ctxt-(\d+)$/.exec(entry.id);
            return match === null ? max : Math.max(max, Number(match[1]));
        }, 0);
    }
    async flush() {
        await this.snapshot();
        this.data.revision += 1;
        this.data.updatedAt = this.clock();
        const payload = `${JSON.stringify(this.data, null, 2)}\n`;
        const temp = `${this.filePath}.tmp`;
        try {
            await mkdir(dirname(this.filePath), { recursive: true });
            await writeFile(temp, payload, 'utf8');
            await rename(temp, this.filePath);
        }
        catch {
            // 写盘失败不能变成未捕获拒绝
        }
    }
    async snapshot() {
        try {
            await stat(this.filePath);
        }
        catch {
            return;
        }
        try {
            await mkdir(this.snapshotDir, { recursive: true });
            const name = `${basename(this.filePath)}.${Date.now()}.json`;
            const { copyFile } = await import('node:fs/promises');
            await copyFile(this.filePath, join(this.snapshotDir, name));
            const names = (await readdir(this.snapshotDir)).filter((item) => item.endsWith('.json')).sort();
            for (const old of names.slice(0, Math.max(0, names.length - MAX_SNAPSHOTS))) {
                await rm(join(this.snapshotDir, old), { force: true }).catch(() => undefined);
            }
        }
        catch {
            // 快照失败不影响写入
        }
    }
    /* ------------------------------ 查询 ------------------------------ */
    all() {
        return this.data.entries.map((entry) => ({ ...entry }));
    }
    get(id) {
        const entry = this.data.entries.find((item) => item.id === id);
        return entry === undefined ? undefined : { ...entry };
    }
    /** 生效中的条目：status=active 且未被 validTo 判过期。 */
    active(now = this.clock()) {
        return this.data.entries.filter((entry) => entry.status === 'active' && !this.isExpired(entry, now));
    }
    pending() {
        return this.data.entries.filter((entry) => entry.status === 'pending');
    }
    stats() {
        const now = this.clock();
        const active = this.active(now);
        return {
            active: active.length,
            pending: this.pending().length,
            retired: this.data.entries.filter((entry) => entry.status === 'retired').length,
            expired: this.expired(now).length,
            conflicted: this.data.entries.filter((entry) => entry.status !== 'retired' && entry.conflictWith !== undefined).length,
            chars: this.render(now).length,
            violationsTotal: this.data.entries.reduce((sum, entry) => sum + entry.violations, 0),
            guarded: active.filter((entry) => entry.guard).length,
            enforced: active.filter((entry) => entry.enforce).length,
            audited: active.filter((entry) => entry.audit).length,
            helpfulTotal: active.reduce((sum, entry) => sum + entry.helpful, 0),
            harmfulTotal: active.reduce((sum, entry) => sum + entry.harmful, 0),
        };
    }
    isExpired(entry, now = this.clock()) {
        if (entry.validTo === null)
            return false;
        return entry.validTo <= now;
    }
    /* ---------------------------- 确定性合并 ---------------------------- */
    /**
     * 提交一个候选。
     *
     * 这里就是 ACE 说的 "lightweight, non-LLM logic"：
     * 去重、长度、分节、来源、套话全部由代码判定，模型只负责提议。
     */
    submit(candidate) {
        const content = normalizeContent(candidate.content ?? '');
        if (content.length === 0)
            return { accepted: false, reason: '内容为空' };
        if (content.length < CONTENT_MIN)
            return { accepted: false, reason: `内容过短（<${CONTENT_MIN} 字）` };
        if (content.length > CONTENT_MAX)
            return { accepted: false, reason: `内容过长（>${CONTENT_MAX} 字）` };
        if (isCliche(content))
            return { accepted: false, reason: '通用套话：换成任何项目都成立，按 DC-∅ 结论增益为零' };
        const sourceIds = Array.isArray(candidate.sourceIds) ? candidate.sourceIds.map(String) : [];
        const validSourceIds = this.validateSourceIds === undefined ? sourceIds : this.validateSourceIds(sourceIds);
        // 明确给了来源却全部无效 → 说明是臆造，丢弃；没给来源则视为手动条目
        if (sourceIds.length > 0 && validSourceIds.length === 0) {
            return { accepted: false, reason: '来源记忆全部不存在（可能已删除）' };
        }
        // 先判冲突，再判重复。
        // 顺序很重要：否定翻转的准则与原文相似度很高（常 >0.7），如果先做去重会被当成
        // 「重复」直接丢掉——但它其实是一条**互相矛盾的**准则，必须留给人工裁决。
        const section = clampSection(candidate.section);
        const conflictWith = this.detectConflict(content, section);
        if (conflictWith === undefined) {
            const own = tokenize(content);
            for (const entry of this.data.entries) {
                if (entry.status === 'retired')
                    continue;
                const similarity = cosine(own, tokenize(entry.content));
                if (similarity >= this.dedupeThreshold) {
                    return { accepted: false, reason: `与 ${entry.id} 重复（相似度 ${similarity.toFixed(2)}）`, duplicateOf: entry.id };
                }
            }
        }
        // 数量上限：满了就把打分最低的 retired 掉，而不是拒绝新条目
        if (this.data.entries.filter((entry) => entry.status !== 'retired').length >= this.maxEntries) {
            const victim = this.worstEntry();
            if (victim !== undefined)
                this.markRetired(victim.id, '条目数超限，按 helpful−harmful×2 淘汰');
        }
        const now = this.clock();
        const entry = {
            id: this.nextId(),
            section,
            content,
            helpful: 0,
            harmful: 0,
            sourceIds: sourceIds.length === 0 ? [] : validSourceIds,
            validFrom: null,
            validTo: candidate.validTo === undefined ? null : candidate.validTo,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            note: conflictWith === undefined ? '' : `与 ${conflictWith} 疑似冲突，待人工裁决`,
            history: [],
            ...(conflictWith === undefined ? {} : { conflictWith }),
            // 蒸馏/模型产出一律 auto，用户手写的走 addManual 显式标 human
            origin: candidate.origin ?? 'auto',
            usage: { ...EMPTY_USAGE },
            // 新条目默认只是一句提醒，三道约束都要人工勾选才生效
            guard: false,
            enforce: false,
            audit: false,
            trigger: '',
            required: '',
            when: (candidate.when ?? '').slice(0, 60),
            topicIds: [],
            violations: 0,
            lastViolationAt: null,
        };
        this.data.entries.push(entry);
        return { accepted: true, entry: { ...entry } };
    }
    /**
     * 冲突检测：同 section + 内容相近 + 一方有否定词。
     *
     * 不做自动裁决——自动合并就是另一种「整篇重写」，会悄悄丢掉差异。
     * 只标记，交给人工在审核界面并排看。
     */
    detectConflict(content, section) {
        const own = tokenize(content);
        const ownNegated = hasNegation(content);
        for (const entry of this.active()) {
            if (entry.section !== section)
                continue;
            const similarity = cosine(own, tokenize(entry.content));
            // 标定：同一句话改否定词 0.915 / 「必须跑」改「不要跑」0.786 /
            // 「不跳步」改「可以跳步」0.420。取 0.38 才能覆盖最后一种。
            // 冲突只是打标记给人看，误报的代价远小于漏报。
            if (similarity < 0.38)
                continue;
            if (hasNegation(entry.content) !== ownNegated)
                return entry.id;
        }
        return undefined;
    }
    /** 已过期的条目（status 仍是 active，但 validTo 已过）。 */
    expired(now = this.clock()) {
        return this.data.entries.filter((entry) => entry.status === 'active' && this.isExpired(entry, now));
    }
    /** 延长有效期（复核后确认继续有效）。 */
    extend(id, validTo) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        entry.validTo = validTo;
        entry.updatedAt = this.clock();
        entry.note = validTo === null ? '' : '已延长有效期';
        return true;
    }
    /** 人工直接新增（跳过审核，直接 active）。 */
    /** 用户手写/确认的条目，来源直接记 human。 */
    addManual(input) {
        const outcome = this.submit({ ...input, origin: 'human' });
        if (!outcome.accepted || outcome.entry === undefined)
            return outcome;
        this.markActive(outcome.entry.id);
        return { accepted: true, entry: this.get(outcome.entry.id) };
    }
    /* ------------------------------ 状态流转 ------------------------------ */
    /**
     * 接受一条待审准则。
     *
     * 如果它与现有生效准则冲突，这里做**确定性裁决**（LeAP 的 1.2× 规则）：
     *   - 新条证据强度 ≥ 1.2×旧条 → 旧条退场（被更强证据取代）
     *   - 旧条 ≥ 1.2×新条          → 拒绝新条（更弱的证据不能推翻更稳的）
     *   - 差不多                    → **两条都生效**，挂同一个 conflictGroupId，
     *                                 注入时并排显示「存在未决分歧」
     *
     * 最后一种最重要：证据差不多时**不强行选一条**。
     * 强行选会静默丢掉分歧，而分歧本身是有价值的信息。
     */
    accept(id) {
        const entry = this.entryRef(id);
        if (entry === undefined || entry.status !== 'pending')
            return false;
        if (entry.conflictWith !== undefined) {
            const other = this.entryRef(entry.conflictWith);
            if (other !== undefined && other.status === 'active') {
                const mine = this.confidenceOf(entry);
                const theirs = this.confidenceOf(other);
                if (mine >= theirs * 1.2) {
                    // 新条更强：旧条退出（记清楚是被谁取代）
                    other.status = 'retired';
                    other.note = `被更强的准则 ${entry.id} 取代（证据强度 ${mine} vs ${theirs}）`;
                    other.updatedAt = this.clock();
                    entry.conflictWith = undefined;
                }
                else if (theirs >= mine * 1.2) {
                    // 旧条更强：新条不能生效，留档说明原因
                    entry.status = 'retired';
                    entry.note = `证据强度不足，未推翻 ${other.id}（${mine} vs ${theirs}）`;
                    entry.updatedAt = this.clock();
                    return false;
                }
                else {
                    // 势均力敌：两条都保留，进入未决组
                    const gid = `cf-${entry.id}-${other.id}`;
                    entry.conflictGroupId = gid;
                    other.conflictGroupId = gid;
                    entry.note = `与 ${other.id} 存在未决分歧，两条都生效`;
                    other.note = `与 ${entry.id} 存在未决分歧，两条都生效`;
                }
            }
        }
        this.markActive(id);
        this.enforceActiveCap();
        return true;
    }
    /**
     * 活跃条目上限保护。
     *
     * 准则本的价值随条数**先升后降**：预算固定时条目越多，每条被注入的概率越低，
     * 最后等于什么都没说。调研建议上限 300，超过就按证据强度淘汰最弱的。
     */
    enforceActiveCap(cap = 300) {
        const active = this.data.entries.filter((entry) => entry.status === 'active');
        if (active.length <= cap)
            return;
        const weakest = active
            .slice()
            .sort((a, b) => this.effectiveScore(a) - this.effectiveScore(b))
            .slice(0, active.length - cap);
        for (const entry of weakest) {
            entry.status = 'retired';
            entry.note = '超出活跃条目上限，按证据强度淘汰';
            entry.updatedAt = this.clock();
        }
    }
    /**
     * 人工标记两条准则冲突。
     *
     * 为什么需要这个：**自然语言的矛盾检测不可靠**。
     * 例：「不可跳步」和「不必执行」都含「不」，否定词启发式会判成同极性。
     * 调研结论是「没有 SPO 就不猜」——所以自动检测只当提示，
     * 真正的冲突由人或模型显式标记，再由 confidence 做确定性裁决。
     */
    markConflict(aId, bId) {
        const a = this.entryRef(aId);
        const b = this.entryRef(bId);
        if (a === undefined || b === undefined || aId === bId)
            return false;
        if (a.status !== 'active' || b.status !== 'active')
            return false;
        const mine = this.confidenceOf(a);
        const theirs = this.confidenceOf(b);
        // 差 1.2 倍以上直接裁决，否则挂未决组
        if (mine >= theirs * 1.2) {
            b.status = 'retired';
            b.note = `被更强的准则 ${aId} 取代（${mine} vs ${theirs}）`;
            b.updatedAt = this.clock();
            return true;
        }
        if (theirs >= mine * 1.2) {
            a.status = 'retired';
            a.note = `被更强的准则 ${bId} 取代（${theirs} vs ${mine}）`;
            a.updatedAt = this.clock();
            return true;
        }
        const gid = `cf-${aId}-${bId}`;
        a.conflictGroupId = gid;
        b.conflictGroupId = gid;
        a.note = `与 ${bId} 存在未决分歧，两条都生效`;
        b.note = `与 ${aId} 存在未决分歧，两条都生效`;
        a.updatedAt = this.clock();
        b.updatedAt = this.clock();
        return true;
    }
    /**
     * 手动裁决未决冲突：保留哪一条。
     *
     * 调用方在界面上点了「以这条为准」后调用——人做最终决定，代码只执行。
     */
    resolveConflict(keepId, dropId, reason = '人工裁决') {
        const keep = this.entryRef(keepId);
        const drop = this.entryRef(dropId);
        if (keep === undefined || drop === undefined)
            return false;
        if (keep.conflictGroupId === undefined || keep.conflictGroupId !== drop.conflictGroupId)
            return false;
        drop.status = 'retired';
        drop.note = `${reason}：由 ${keepId} 胜出`;
        drop.updatedAt = this.clock();
        keep.conflictGroupId = undefined;
        keep.note = '';
        keep.updatedAt = this.clock();
        return true;
    }
    /**
     * 立墓碑：这条本来就错了（不是被更好的取代）。
     *
     * 与 retired 的区别见 tombstone 字段注释——「被推翻」和「被超越」是两种历史。
     */
    revoke(id, reason) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        entry.status = 'retired';
        entry.tombstone = { revokedAt: this.clock(), reason: reason.slice(0, 120) };
        entry.note = `已撤销：${reason.slice(0, 80)}`;
        entry.updatedAt = this.clock();
        return true;
    }
    reject(id) {
        const index = this.data.entries.findIndex((entry) => entry.id === id);
        if (index < 0)
            return false;
        if (this.data.entries[index]?.status !== 'pending')
            return false;
        this.data.entries.splice(index, 1);
        return true;
    }
    /**
     * 永久删除一条准则（任意状态）。
     *
     * 和 retire 的区别：停用是「不再注入但留着记录」，删除是「当它没存在过」。
     * 删除前 flush() 会先留快照，所以还能从 .snapshots/ 找回来。
     */
    remove(id) {
        const index = this.data.entries.findIndex((entry) => entry.id === id);
        if (index < 0)
            return false;
        this.data.entries.splice(index, 1);
        return true;
    }
    retire(id, reason = '') {
        return this.markRetired(id, reason);
    }
    revive(id) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        entry.status = 'active';
        entry.updatedAt = this.clock();
        entry.note = '';
        return true;
    }
    /** 编辑条目：旧内容进 history，不原地丢弃。 */
    revise(id, content) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        const next = normalizeContent(content);
        if (next.length < CONTENT_MIN || next.length > CONTENT_MAX)
            return false;
        if (next === entry.content)
            return false;
        entry.history.push({ content: entry.content, replacedAt: this.clock() });
        entry.content = next;
        entry.updatedAt = this.clock();
        return true;
    }
    /** 记录一次使用反馈（ACE 的双向计数）。 */
    mark(id, kind, amount = 1) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        if (kind === 'helpful')
            entry.helpful += Math.max(0, amount);
        else
            entry.harmful += Math.max(0, amount);
        entry.updatedAt = this.clock();
        // 坏条目的伤害大于好条目的收益（ACE：噪声反射 66.7 < 基线 70.7），
        // 所以 harmful 到阈值直接退场，不靠人记得去点。
        if (entry.harmful >= 3 && entry.harmful > entry.helpful) {
            entry.status = 'retired';
            entry.note = '有害标记过多，自动退场';
        }
        return true;
    }
    /* ------------------------------ 三道约束 ------------------------------ */
    /**
     * 设置某条准则的三道约束开关。
     *
     * 默认全关：准则本身就是给模型的提醒，强制是例外而非常态。
     */
    setFlags(id, flags) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        if (flags.guard !== undefined)
            entry.guard = flags.guard;
        if (flags.enforce !== undefined)
            entry.enforce = flags.enforce;
        if (flags.audit !== undefined)
            entry.audit = flags.audit;
        if (flags.trigger !== undefined)
            entry.trigger = flags.trigger.slice(0, 200);
        if (flags.required !== undefined)
            entry.required = flags.required.slice(0, 200);
        if (flags.when !== undefined)
            entry.when = flags.when.slice(0, 60);
        entry.updatedAt = this.clock();
        return true;
    }
    /**
     * 重算所有条目的证据链状态。
     *
     * 源记忆被取代 / 删除 / 归档后调用。复杂度 O(条款数 × 来源数)，几百条无压力。
     * 返回状态有变化的条目 id。
     */
    recheckEvidence(now = this.clock()) {
        const changed = [];
        for (const entry of this.data.entries) {
            if (entry.sourceIds.length === 0)
                continue;
            const supported = [];
            const orphaned = [];
            for (const sourceId of entry.sourceIds) {
                if (this.isSourceAlive === undefined || this.isSourceAlive(sourceId))
                    supported.push(sourceId);
                else
                    orphaned.push(sourceId);
            }
            const status = orphaned.length === 0 ? 'intact' : supported.length === 0 ? 'orphaned' : 'weakened';
            const before = entry.evidence?.status;
            entry.evidence = { supported, orphaned, status, checkedAt: now };
            // orphaned 的条目自动退出注入，但不删除——前提恢复后会自动回来
            if (status === 'orphaned' && entry.status === 'active') {
                entry.note = '证据链断裂：所有来源记忆都已失效，待复核';
            }
            else if (status !== 'orphaned' && entry.note.startsWith('证据链断裂')) {
                entry.note = '';
            }
            if (before !== status)
                changed.push(entry.id);
        }
        return changed;
    }
    /**
     * 条目的有效分值——注入排序用。
     *
     * 依据：
     * - ACE / ExpeL：**计数来自实际使用结果**，不是手填
     * - ReasoningBank：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感
     *   → 所以样本不足时不给强判断，用 Beta 先验收缩
     * - TMS：证据链断裂的条目要沉下去
     */
    effectiveScore(entry) {
        const u = entry.usage ?? EMPTY_USAGE;
        // Beta(1,1) 先验：没有样本时按 0.5 处理，样本越多越相信实测比例
        const good = u.appliedGood;
        const bad = u.appliedBad + u.userCorrected;
        const ratio = (good + 1) / (good + bad + 2);
        // 置信度随样本量增长：0 样本 ≈ 0，5 样本 ≈ 0.83
        const confidence = 1 - Math.exp(-(good + bad) / 2);
        const base = 10 * ratio * confidence;
        // 老字段继续计入（兼容手动打的 helpful/harmful）
        const legacy = entry.helpful - entry.harmful * 2;
        // 证据链断裂 → 直接沉底；部分失效 → 降权
        const evidencePenalty = entry.evidence?.status === 'orphaned' ? -100 : entry.evidence?.status === 'weakened' ? -5 : 0;
        return base + legacy + evidencePenalty;
    }
    /**
     * 分项打标。
     *
     * 只有 appliedGood / appliedBad / userCorrected 会影响降级判断——
     * missed 记的是检索问题，不该算到准则头上。
     */
    markUsage(id, kind, trace = '') {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        const usage = entry.usage ?? { ...EMPTY_USAGE };
        usage[kind] += 1;
        if (trace.length > 0)
            usage.lastTrace = trace.slice(0, 120);
        entry.usage = usage;
        entry.updatedAt = this.clock();
        // 降级门槛（ReasoningBank 的噪声结论）：样本够 + 好评率低才降级
        const good = usage.appliedGood;
        const bad = usage.appliedBad + usage.userCorrected;
        const samples = good + bad;
        if (samples >= 5 && good / samples < 0.3) {
            entry.status = 'retired';
            entry.note = `实测好评率过低（${good}/${samples}），自动退场`;
        }
        return true;
    }
    /**
     * 证据强度（confidence）——冲突裁决的依据。
     *
     * 由**代码算**，不让模型自报（LeAP：层级由代码控制，而非模型输出）。
     *
     * 设计原则：**已验证 > 未验证，而不是新 > 旧**（AGM / veritas 的核心立场）。
     *   human + 证据完好 = 1.0（用户确认过，最高）
     *   agent（AI 记录、人确认过）= 0.6
     *   auto（模型自产）= 0.4
     * 证据链部分失效 ×0.7，完全失效 ×0.2。
     */
    confidenceOf(entry) {
        const tier = entry.origin === 'human' ? 1 : entry.origin === 'agent' ? 0.6 : 0.4;
        const evidence = entry.evidence === undefined
            ? 1
            : entry.evidence.status === 'intact'
                ? 1
                : entry.evidence.status === 'weakened'
                    ? 0.7
                    : 0.2;
        return Number((tier * evidence).toFixed(3));
    }
    /**
     * 用时可复用等级（SEU：selective experience use）。
     *
     * 依据 PATH-Bench：检索到的经验**在使用时逐条判断**怎么用——
     * preserve（可直接复用）/ abstract（只取高层模式）/ ignore（忽略），
     * 这一层判断让 FGT 最多降 16.84pp，且不动记忆库本身，是最便宜的抗负迁移。
     *
     * 我们的三档：
     *   reusable  证据完好 + 用户确认 → 可以直接套用
     *   reference 来源是 AI 或样本不足 → 只借鉴思路，别当铁律
     *   doubtful  证据部分失效 / 未决冲突 / 实测差评 → 提出来时标明不确定
     */
    usageHint(entry) {
        // 有反证：实测差评明显多于好评
        const u = entry.usage ?? EMPTY_USAGE;
        const bad = u.appliedBad + u.userCorrected;
        if (bad >= 2 && bad > u.appliedGood)
            return 'doubtful';
        // 证据链部分失效 / 未决冲突 → 存疑
        if (entry.evidence?.status === 'weakened' || entry.evidence?.status === 'orphaned')
            return 'doubtful';
        if (entry.conflictGroupId !== undefined)
            return 'doubtful';
        // 用户确认过的才算「可直接复用」；AI 来源一律先当参考
        if (entry.origin === 'human')
            return 'reusable';
        return 'reference';
    }
    /** 设置证据来源（sourceIds），调用方随后应重算证据链。 */
    setSourceIds(id, sourceIds) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        const valid = sourceIds.filter((x) => x.length > 0);
        entry.sourceIds = [...new Set(valid)];
        entry.updatedAt = this.clock();
        return true;
    }
    /** 设置归属主题（多对多，空数组 = 未归类）。 */
    setTopics(id, topicIds) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        entry.topicIds = [...new Set(topicIds.filter((t) => t.length > 0))];
        entry.updatedAt = this.clock();
        return true;
    }
    /** 记一次违反。 */
    recordViolation(id, now = this.clock()) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        entry.violations += 1;
        entry.lastViolationAt = now;
        return true;
    }
    /**
     * 校验一次工具调用。
     *
     * 规则：`trigger` 匹配「工具名 + 参数 JSON」→ 这条准则适用；
     * 适用时 `required` 必须也匹配，否则算违反。
     * 只有 `trigger` 非空的条目参与判定——否则每条准则都会命中所有调用。
     *
     * 纯函数，不写盘：调用方决定是拒绝（enforce）还是只记录（audit）。
     */
    checkToolCall(text) {
        const blocked = [];
        const violated = [];
        for (const entry of this.active()) {
            if (entry.trigger.trim().length === 0)
                continue;
            if (!entry.enforce && !entry.audit)
                continue;
            const trigger = safeRegex(entry.trigger);
            if (trigger === null || !trigger.test(text))
                continue;
            // required 留空表示「只要触发就算违反」（例如某类操作整体禁止）
            const required = entry.required.trim().length === 0 ? null : safeRegex(entry.required);
            const satisfied = required === null ? false : required.test(text);
            if (satisfied)
                continue;
            violated.push(entry);
            if (entry.enforce)
                blocked.push(entry);
        }
        return { blocked, violated };
    }
    /**
     * 自查清单：勾了「自查」的条目会渲染到注入文本最前面。
     *
     * 内容很少（通常一两条），目的是让模型在动手前显式确认，而不是把长清单塞进上下文。
     */
    renderSelfCheck(now = this.clock()) {
        const list = this.active(now).filter((entry) => entry.guard);
        if (list.length === 0)
            return '';
        const lines = list.map((entry) => `- [${entry.id}] ${entry.content}`).join('\n');
        return `【开工前自查】动手前先确认本次适用哪几条，并在回复里点名；不适用就明说。\n${lines}`;
    }
    /* ------------------------------ 渲染 ------------------------------ */
    /**
     * 渲染成注入文本。
     *
     * 格式照 ACE：`[ctxt-00001] helpful=2 harmful=0 :: 正文`——
     * 模型可以点名引用，我们才能回写计数。
     */
    /**
     * 渲染成注入文本。
     *
     * 分组优先级：**有主题就按主题分组**，没主题退回按 section（约定/坑/状态）。
     *
     * 为什么按主题：调研发现业界主流是「主题路由 + 主题摘要注入」。
     * 按主题分组后，模型能先判断当前任务属于哪个主题，只采用相关准则——
     * 而不是 12 条准则不分场合全塞进来。
     *
     * @param topicName 把 topicId 解析成显示名的回调；不传则按 section 分组。
     */
    render(now = this.clock(), budget, topicName) {
        return this.renderDetailed(now, budget, topicName).text;
    }
    /**
     * 同 render，但额外返回被预算挤掉的条数。
     *
     * 低分条目（helpful−harmful×2 靠后）在预算紧张时会被静默丢弃——
     * 调用方据此在注入文本里补一句「另有 N 条省略」，避免用户以为准则丢了。
     */
    renderDetailed(now = this.clock(), budget, topicName) {
        const maxChars = Math.max(120, Math.round(budget ?? this.maxChars));
        // 证据链断裂的条目不注入——但不是删除，前提恢复后它会自动回来
        const active = this.active(now).filter((entry) => entry.evidence?.status !== 'orphaned');
        if (active.length === 0)
            return { text: '', omitted: 0 };
        const score = (entry) => this.effectiveScore(entry);
        // 用主题分组：每个条目挂在它的第一个主题下；没有主题的进「未归类」
        const groups = new Map();
        for (const entry of active) {
            const topicId = entry.topicIds[0];
            const name = topicId === undefined ? undefined : topicName?.(topicId);
            const key = name ?? (topicId === undefined ? '__inbox__' : topicId);
            const title = name ?? (topicId === undefined ? '未归类' : topicId);
            const group = groups.get(key) ?? { title, list: [] };
            group.list.push(entry);
            groups.set(key, group);
        }
        const blocks = [];
        let used = 0;
        let total = 0;
        for (const group of groups.values()) {
            const list = group.list.sort((a, b) => score(b) - score(a));
            if (list.length === 0)
                continue;
            const lines = [];
            const header = `## ${group.title}`;
            let blockChars = header.length + 1;
            for (const entry of list) {
                if (lines.length >= this.maxPerSection)
                    break;
                if (total >= this.maxEntries)
                    break;
                // 来源等级翻译成措辞：human 直接陈述，agent 标「AI 记录待核实」。
                // auto 不标注——它根本进不了 active，不会出现在这里。
                const originMark = entry.origin === 'agent' ? '（AI 记录，待核实）' : '';
                const evidenceMark = entry.evidence?.status === 'weakened' ? '（证据已部分失效）' : '';
                // 准入标注：只标非「可复用」的——大多数条目没有标记本身就是信息，
                // 「没标记 = 可放心用」，这样也更省预算。
                const hint = this.usageHint(entry);
                const hintMark = hint === 'doubtful' ? '[存疑]' : hint === 'reference' ? '[仅参考]' : '';
                // 未决冲突必须让模型看见——静默选一条等于丢掉分歧
                const conflictMark = entry.conflictGroupId === undefined ? '' : `（与同组条目存在未决分歧，${entry.conflictGroupId}）`;
                const line = entry.when.length > 0
                    ? `- [${entry.id}] helpful=${entry.helpful} harmful=${entry.harmful} :: ${entry.when}：${entry.content}${hintMark}${originMark}${evidenceMark}${conflictMark}`
                    : `- [${entry.id}] helpful=${entry.helpful} harmful=${entry.harmful} :: ${entry.content}${hintMark}${originMark}${evidenceMark}${conflictMark}`;
                if (used + blockChars + line.length + 1 > maxChars) {
                    // 预算不够时，至少保证每组有一条
                    if (lines.length === 0) {
                        const trimmed = line.length > 80 ? `${line.slice(0, 77)}…` : line;
                        lines.push(trimmed);
                        blockChars += trimmed.length + 1;
                        total += 1;
                    }
                    break;
                }
                lines.push(line);
                blockChars += line.length + 1;
                total += 1;
            }
            if (lines.length === 0)
                continue;
            if (used + blockChars > maxChars)
                break;
            blocks.push(`${header}\n${lines.join('\n')}`);
            used += blockChars + 1;
        }
        // 按**实际渲染出来的行数**算省略，不能按 total——被整组丢弃的条目已计过 total，
        // 那样会算成 omitted=0，用户看到「少了条目」却没有任何提示。
        const emitted = blocks.reduce((sum, block) => sum + (block.match(/^- \[ctxt/gm)?.length ?? 0), 0);
        return { text: blocks.join('\n\n'), omitted: Math.max(0, active.length - emitted) };
    }
    /**
     * 把渲染结果包成可注入的段落；空准则本返回空串，由调用方回退 digest。
     *
     * **maxChars 是整段的总预算**，不是正文预算——自查块、标题、尾注都要先扣掉，
     * 否则总长度会超（实测过 619 > 600）。正文按剩余额度渲染。
     */
    renderSection(now = this.clock(), topicName) {
        const selfCheck = this.renderSelfCheck(now);
        const header = '【工作准则】（由记忆蒸馏，累计 helpful/harmful）';
        // 尾注顺带告诉模型怎么回写使用效果——不写这句，分项计数永远是 0。
        const footer = '（用到某条时按 appliedGood/appliedBad/missed 回写；细节调 cognition_recall。）';
        const hasBody = this.active(now).length > 0;
        // 固定开销：各段之间的分隔符 \n\n 也算进去
        const overhead = (selfCheck.length > 0 ? selfCheck.length + 2 : 0) +
            (hasBody ? header.length + 2 + footer.length : 0);
        // 给「另有 N 条省略」预留空间，否则提示自己会把总长顶出预算
        const hintReserve = 32;
        const detail = hasBody
            ? this.renderDetailed(now, this.maxChars - overhead - hintReserve, topicName)
            : { text: '', omitted: 0 };
        const body = detail.text;
        const omittedHint = detail.omitted > 0 ? `（另有 ${detail.omitted} 条准则因预算省略）` : '';
        if (body.length === 0 && selfCheck.length === 0)
            return '';
        const parts = [];
        if (selfCheck.length > 0)
            parts.push(selfCheck);
        if (body.length > 0)
            parts.push(`${header}\n${body}${omittedHint === '' ? '' : `\n${omittedHint}`}`);
        parts.push(footer);
        return parts.join('\n\n');
    }
    /* ------------------------------ 内部 ------------------------------ */
    entryRef(id) {
        return this.data.entries.find((entry) => entry.id === id);
    }
    nextId() {
        this.seq += 1;
        return `ctxt-${String(this.seq).padStart(5, '0')}`;
    }
    markActive(id) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return;
        // 人工确认即晋升一级（auto → agent），但绝不跳到 human——human 只能用户手写
        if (entry.origin === 'auto')
            entry.origin = 'agent';
        entry.status = 'active';
        entry.updatedAt = this.clock();
        // 已有 active 条数超限时，淘汰打分最低的
        while (this.active().length > this.maxEntries) {
            const victim = this.worstEntry();
            if (victim === undefined || victim.id === id)
                break;
            this.markRetired(victim.id, '条目数超限');
        }
    }
    markRetired(id, reason) {
        const entry = this.entryRef(id);
        if (entry === undefined)
            return false;
        entry.status = 'retired';
        entry.note = reason;
        entry.updatedAt = this.clock();
        return true;
    }
    /** 打分最低的 active 条目（helpful − harmful×2，同分取最旧）。 */
    worstEntry() {
        const score = (entry) => this.effectiveScore(entry);
        return this.active()
            .slice()
            .sort((a, b) => score(a) - score(b) || a.updatedAt - b.updatedAt)[0];
    }
}
