/**
 * src/persona.ts — 轻人格块（S3）
 *
 * 定位：**轻人格，不是角色扮演**。
 *
 * 研究结论（docs/persona-research.md）：
 *   - Assistant Axis：模型越远离默认助手越容易漂向戏剧化人格 → 表达要轻；
 *   - Anchor 倒 U 形（Rahman & Desai 2025）：中等强度的人格表达在
 *     Trust / Likeability / Intention to Adopt 六个维度上优于两端。
 * 所以这里不写「你是一个热情开朗的少女」这种设定，只写：
 *   身份 1 句 / 风格 3 条 if-then / 价值观 3 条 trade-off / 边界 3 条。
 *
 * 四条硬规则（对应 upgrade-plan-v3 §4.3）：
 *   1. `traits` 只做审计、**不注入**——BFI-2 不是文本分类器，光写 trait 没用；
 *   2. `lockedPhrases` 被删或改写 → **拒绝保存**，边界不能被悄悄改；
 *   3. agent 只能 `propose`，用户 `confirm` 才生效；`human` 块 agent 永远不能改；
 *   4. `persona.value` 四段式，总规则 ≤ 5 条。
 *
 * 为什么要有 propose/confirm：人格是最容易被「顺手优化」改坏的东西。
 * 记忆写错了可以删，人格漂了用户只会觉得「它变了」却说不出哪里变了。
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDataFile } from "./util.js";
const DEFAULT_BUDGET = { persona: 600, human: 500, total: 1100 };
/** 硬规则 4 的宽松实现：段落数与规则数上限，不做 NLP。 */
const MAX_VALUE_LINES = 12;
function hashText(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}
/** 文档内容 hash（两个块的值），用来串 revision 链（`parentHash`）。 */
function docHash(doc) {
    return hashText(`${doc.blocks.persona.value}\u0000${doc.blocks.human.value}`);
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function countLines(text) {
    return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}
/**
 * 人格块存储。
 *
 * 零依赖：就是一个 JSON 文件 + 一个提案文件。
 * 文件不存在 = 没有启用人格，`render()` 返回空串，注入段完全不占 token。
 */
export class PersonaStore {
    filePath;
    proposalPath;
    clock;
    doc;
    proposals = [];
    loaded = false;
    /** 最近一次写盘失败原因；成功写盘后清空。 */
    saveError;
    constructor(options = {}) {
        this.filePath =
            options.filePath === undefined ? resolveDataFile('cognition-persona.json') : resolve(options.filePath);
        this.proposalPath =
            options.proposalPath === undefined
                ? resolveDataFile('cognition-persona-proposals.json')
                : resolve(options.proposalPath);
        this.clock = options.now ?? (() => Date.now());
    }
    /** 读文件。文件不存在或格式不对都当作「没有人格」，不抛错。 */
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        try {
            if (existsSync(this.proposalPath)) {
                const raw = JSON.parse(readFileSync(this.proposalPath, 'utf8'));
                if (Array.isArray(raw)) {
                    this.proposals = raw.filter((item) => isRecord(item) && typeof item.id === 'string');
                }
            }
        }
        catch {
            this.proposals = [];
        }
        try {
            if (!existsSync(this.filePath))
                return false;
            const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (!isRecord(raw) || raw.schema !== 'cognition.persona' || !isRecord(raw.blocks))
                return false;
            const blocks = raw.blocks;
            const persona = this.#readBlock(blocks.persona, 'persona');
            const human = this.#readBlock(blocks.human, 'human');
            if (persona === undefined || human === undefined)
                return false;
            this.doc = {
                schema: 'cognition.persona',
                version: 1,
                revision: typeof raw.revision === 'number' ? raw.revision : 1,
                updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : this.clock(),
                budget: this.#readBudget(raw.budget),
                ...(isRecord(raw.meta) ? { meta: raw.meta } : {}),
                blocks: { persona, human },
            };
            return true;
        }
        catch {
            this.doc = undefined;
            return false;
        }
    }
    #readBudget(value) {
        if (!isRecord(value))
            return { ...DEFAULT_BUDGET };
        const pick = (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
            ? Math.max(100, Math.round(value[key]))
            : DEFAULT_BUDGET[key];
        return { persona: pick('persona'), human: pick('human'), total: pick('total') };
    }
    #readBlock(value, label) {
        if (!isRecord(value))
            return undefined;
        if (typeof value.value !== 'string')
            return undefined;
        const budget = DEFAULT_BUDGET[label];
        const limit = typeof value.limit === 'number' && Number.isFinite(value.limit)
            ? Math.max(100, Math.round(value.limit))
            : budget;
        return {
            label,
            ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
            limit,
            ...(value.readOnly === true ? { readOnly: true } : {}),
            value: value.value,
            ...(Array.isArray(value.examples) ? { examples: value.examples.filter((x) => typeof x === 'string') } : {}),
            ...(isRecord(value.traits) ? { traits: value.traits } : {}),
            ...(Array.isArray(value.lockedPhrases)
                ? { lockedPhrases: value.lockedPhrases.filter((x) => typeof x === 'string') }
                : {}),
            ...(isRecord(value.slots) ? { slots: value.slots } : {}),
            ...(Array.isArray(value.facts)
                ? {
                    facts: value.facts
                        .filter((item) => isRecord(item) && typeof item.key === 'string')
                        .map((item) => ({
                        key: String(item.key),
                        value: String(item.value ?? ''),
                        ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}),
                    })),
                }
                : {}),
            ...(isRecord(value.interactionStyle)
                ? { interactionStyle: value.interactionStyle }
                : {}),
            ...(isRecord(value.narrative) ? { narrative: value.narrative } : {}),
            history: Array.isArray(value.history)
                ? value.history.filter((item) => isRecord(item) && typeof item.afterHash === 'string')
                : [],
        };
    }
    get path() {
        return this.filePath;
    }
    get present() {
        this.loadSync();
        return this.doc !== undefined;
    }
    get document() {
        this.loadSync();
        return this.doc;
    }
    /**
     * 渲染要注入的人格段。
     *
     * **traits / slots / history 一律不注入**——它们进上下文只会稀释信号，
     * 还可能变成模型拿来「表演人格」的素材（Anchor 倒 U 形说的就是这件事）。
     */
    render() {
        this.loadSync();
        const doc = this.doc;
        if (doc === undefined)
            return '';
        const personaText = this.#renderBlock(doc.blocks.persona, doc.blocks.persona.limit);
        let humanText = this.#renderBlock(doc.blocks.human, doc.blocks.human.limit);
        if (personaText.length === 0 && humanText.length === 0)
            return '';
        // 总量兜底：human 是次要块，超预算时先压缩它
        const over = personaText.length + humanText.length - doc.budget.total;
        if (over > 0)
            humanText = this.#renderBlock(doc.blocks.human, Math.max(0, doc.blocks.human.limit - over));
        const parts = ['## 人格（稳定，不要违背）'];
        if (personaText.length > 0) {
            parts.push(`<persona chars="${personaText.length}/${doc.blocks.persona.limit}">`, personaText, '</persona>');
        }
        if (humanText.length > 0) {
            parts.push(`<human chars="${humanText.length}/${doc.blocks.human.limit}">`, humanText, '</human>');
        }
        return parts.join('\n');
    }
    /**
     * 渲染单个块，**保证 lockedPhrases 不会被截断**。
     *
     * 上一版直接 `clip(value, limit)`：正文一超预算，尾巴上的「边界：不编造事实…」正好被切掉——
     * 而边界恰恰是最不能丢的一段（丢掉它等于人格里最硬的约束悄悄失效）。
     * 现在先正常截断，发现边界短语缺了就把它压成一行补回去，正文让位。
     */
    #renderBlock(block, limit) {
        if (limit <= 0)
            return '';
        const raw = block.value.trim();
        if (raw.length === 0)
            return '';
        const phrases = (block.lockedPhrases ?? []).filter((phrase) => phrase.length > 0);
        const out = clip(raw, limit);
        if (phrases.length === 0)
            return out;
        const missing = phrases.filter((phrase) => !out.includes(phrase));
        if (missing.length === 0)
            return out;
        // 边界优先：压成一行「边界：a；b；c。」，正文按剩余预算截断
        const guard = `边界：${phrases.join('；')}。`;
        if (guard.length >= limit)
            return guard.slice(0, limit);
        const head = raw.includes('边界') ? raw.slice(0, raw.indexOf('边界')).trim() : raw;
        const room = limit - guard.length - 1;
        const kept = room > 0 ? clip(head, room) : '';
        return kept.length > 0 ? `${kept}\n${guard}` : guard;
    }
    /** 预算占用（页面显示用）。 */
    usage() {
        this.loadSync();
        const doc = this.doc;
        if (doc === undefined) {
            return {
                persona: { chars: 0, limit: DEFAULT_BUDGET.persona },
                human: { chars: 0, limit: DEFAULT_BUDGET.human },
                total: { chars: 0, budget: DEFAULT_BUDGET.total },
                rendered: 0,
            };
        }
        const personaChars = doc.blocks.persona.value.trim().length;
        const humanChars = doc.blocks.human.value.trim().length;
        return {
            persona: { chars: personaChars, limit: doc.blocks.persona.limit },
            human: { chars: humanChars, limit: doc.blocks.human.limit },
            total: { chars: personaChars + humanChars, budget: doc.budget.total },
            rendered: this.render().length,
        };
    }
    /** 硬规则 4 的体检：不合格只给警告，不阻止保存（写作风格不该被程序卡死）。 */
    lint(value) {
        const warnings = [];
        if (countLines(value) > MAX_VALUE_LINES) {
            warnings.push(`段落数 ${countLines(value)} 超过 ${MAX_VALUE_LINES}，人格越写越长会稀释信号`);
        }
        if (!/边界/.test(value))
            warnings.push('缺少「边界」段——没有边界的人格迟早会越界');
        if (!/(当|如果|遇到|处理)/.test(value))
            warnings.push('缺少 if-then 式风格描述（光写形容词模型学不到）');
        return warnings;
    }
    /**
     * 提交一次修改提案。
     *
     * agent 永远不能直接改：硬规则 3。`human` 块对 agent 完全关闭。
     */
    propose(input) {
        this.loadSync();
        const doc = this.doc;
        if (doc === undefined)
            return { rejected: '还没有人格文件，先创建再提提案' };
        if (input.by === 'agent' && input.label === 'human') {
            return { rejected: 'human 块只能由用户修改：agent 不许改用户画像' };
        }
        if (input.by === 'agent' && doc.blocks[input.label].readOnly === true) {
            return { rejected: `${input.label} 块是只读的` };
        }
        const next = input.value.trim();
        if (next.length === 0)
            return { rejected: '内容不能为空' };
        const limit = doc.blocks[input.label].limit;
        if (next.length > limit)
            return { rejected: `超出该块预算 ${next.length}/${limit}` };
        const proposal = {
            id: `prop-${randomUUID().slice(0, 8)}`,
            at: this.clock(),
            by: input.by,
            label: input.label,
            value: next,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
        };
        this.proposals.push(proposal);
        this.#saveProposals();
        return { proposal };
    }
    pending() {
        this.loadSync();
        return [...this.proposals].reverse();
    }
    /** 用户确认提案 → 真正写入。硬规则 2 在这里守门：lockedPhrases 不许丢。 */
    confirm(id, by = 'user') {
        this.loadSync();
        const doc = this.doc;
        if (doc === undefined)
            return { ok: false, reason: '没有已加载的人格文件' };
        const index = this.proposals.findIndex((item) => item.id === id);
        if (index < 0)
            return { ok: false, reason: `找不到提案 ${id}` };
        const proposal = this.proposals[index];
        const block = doc.blocks[proposal.label];
        const missing = (block.lockedPhrases ?? []).filter((phrase) => !proposal.value.includes(phrase));
        if (missing.length > 0) {
            // 违反硬规则 2 的提案永远不可能通过，直接丢掉，避免它一直挂在待办里
            this.proposals.splice(index, 1);
            this.#saveProposals();
            return { ok: false, reason: `锁定的边界被删掉了：${missing.join('、')}——边界不能被悄悄改` };
        }
        const beforeValue = block.value;
        const beforeHash = hashText(beforeValue);
        const parentHash = docHash(doc);
        const op = block.history.length === 0 ? 'create' : 'replace';
        block.value = proposal.value;
        block.history = [
            ...block.history,
            {
                at: this.clock(),
                by,
                op,
                /** 存原文快照，`undo()` 才有东西可退（只有 hash 是回滚不了的）。 */
                before: beforeValue.slice(0, 2000),
                beforeHash,
                afterHash: hashText(proposal.value),
                ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
            },
        ].slice(-50);
        doc.revision += 1;
        doc.updatedAt = this.clock();
        doc.parentHash = parentHash;
        this.proposals.splice(index, 1);
        // 落盘失败必须让调用方知道：否则就是「界面显示改好了，重启发现没了」
        if (!this.#saveDocument()) {
            block.value = beforeValue;
            block.history = block.history.slice(0, -1);
            doc.revision -= 1;
            doc.parentHash = undefined;
            this.proposals.splice(index, 0, proposal);
            return { ok: false, reason: `写入失败，改动已回退：${this.lastSaveError ?? '未知错误'}` };
        }
        this.#saveProposals();
        return { ok: true, revision: doc.revision };
    }
    /**
     * 撤销一次改动，恢复到它的 `before` 快照。
     *
     * 不传 `hash` 就撤销最近一次；传了就撤销那一次（按 `afterHash` 定位）。
     * 可以连续撤：每次都退一格，history 里会追加一条 `reason: 'undo'` 的记录。
     */
    undo(hash) {
        this.loadSync();
        const doc = this.doc;
        if (doc === undefined)
            return { ok: false, reason: '没有已加载的人格文件' };
        for (const label of ['persona', 'human']) {
            const block = doc.blocks[label];
            const pool = [...block.history].reverse();
            const entry = hash === undefined
                ? pool.find((item) => item.before !== undefined)
                : pool.find((item) => item.afterHash === hash && item.before !== undefined);
            if (entry === undefined)
                continue;
            const beforeValue = block.value;
            const parentHash = docHash(doc);
            block.value = entry.before;
            const undoEntry = {
                at: this.clock(),
                by: 'user',
                op: 'replace',
                before: beforeValue.slice(0, 2000),
                beforeHash: hashText(beforeValue),
                afterHash: hashText(block.value),
                reason: 'undo',
            };
            block.history = [...block.history, undoEntry].slice(-50);
            doc.revision += 1;
            doc.updatedAt = this.clock();
            doc.parentHash = parentHash;
            if (!this.#saveDocument()) {
                block.value = beforeValue;
                block.history = block.history.slice(0, -1);
                doc.revision -= 1;
                doc.parentHash = undefined;
                return { ok: false, reason: `写入失败，回滚已撤销：${this.lastSaveError ?? '未知错误'}` };
            }
            return { ok: true, revision: doc.revision, restoredFrom: entry.afterHash };
        }
        return { ok: false, reason: '没有可回滚的快照（history 里没有 before 值）' };
    }
    reject(id) {
        this.loadSync();
        const index = this.proposals.findIndex((item) => item.id === id);
        if (index < 0)
            return false;
        this.proposals.splice(index, 1);
        this.#saveProposals();
        return true;
    }
    /** 直接用文件内容覆盖（迁移/初始化用；不经过提案，调用方必须是用户侧入口）。 */
    replaceDocument(doc) {
        this.doc = doc;
        this.loaded = true;
        this.#saveDocument();
    }
    /**
     * 从零创建人格文件（**只能由用户侧调用**）。
     *
     * 已存在时拒绝——创建不该变成「覆盖旧人格」的后门。
     * `lockedPhrases` 从 `边界：a；b；c。` 这一行自动派生：
     * 用户亲手写下的边界，本来就是他最想守住的东西，创建时就该被锁住。
     */
    create(input) {
        this.loadSync();
        if (this.doc !== undefined)
            return { ok: false, reason: '人格文件已存在，请用编辑保存，不要覆盖重建' };
        const personaValue = input.persona.trim();
        const humanValue = input.human.trim();
        if (personaValue.length === 0)
            return { ok: false, reason: '人格内容不能为空' };
        if (personaValue.length > DEFAULT_BUDGET.persona)
            return { ok: false, reason: `人格超出预算 ${personaValue.length}/${DEFAULT_BUDGET.persona}` };
        if (humanValue.length > DEFAULT_BUDGET.human)
            return { ok: false, reason: `用户画像超出预算 ${humanValue.length}/${DEFAULT_BUDGET.human}` };
        const now = this.clock();
        const doc = {
            schema: 'cognition.persona',
            version: 1,
            revision: 1,
            updatedAt: now,
            budget: { ...DEFAULT_BUDGET },
            blocks: {
                persona: {
                    label: 'persona',
                    displayName: '人格',
                    limit: DEFAULT_BUDGET.persona,
                    readOnly: false,
                    value: personaValue,
                    lockedPhrases: deriveLockedPhrases(personaValue),
                    history: [{ at: now, by: 'user', op: 'create', afterHash: hashText(personaValue) }],
                },
                human: {
                    label: 'human',
                    limit: DEFAULT_BUDGET.human,
                    readOnly: false,
                    value: humanValue,
                    history: [{ at: now, by: 'user', op: 'create', afterHash: hashText(humanValue) }],
                },
            },
        };
        this.doc = doc;
        this.loaded = true;
        if (!this.#saveDocument()) {
            this.doc = undefined;
            return { ok: false, reason: `写入失败：${this.lastSaveError ?? '未知错误'}` };
        }
        return { ok: true, revision: 1 };
    }
    /** 最近一次落盘失败的原因（null = 一切正常）。页面与路由用它暴露「改了但没存下」。 */
    get lastSaveError() {
        return this.saveError;
    }
    #saveDocument() {
        const doc = this.doc;
        if (doc === undefined)
            return true;
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
            this.saveError = undefined;
            return true;
        }
        catch (error) {
            // **不能静默吞**：人格改动如果没落盘，用户会以为已经生效。
            this.saveError = error instanceof Error ? error.message : String(error);
            return false;
        }
    }
    #saveProposals() {
        try {
            mkdirSync(dirname(this.proposalPath), { recursive: true });
            writeFileSync(this.proposalPath, JSON.stringify(this.proposals, null, 2) + '\n', 'utf8');
        }
        catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
        }
    }
}
/**
 * 从 `边界：a；b；c。` 这一行派生锁定短语。
 *
 * 用户亲手写下的边界就是他最想守住的约束，创建时自动锁住，
 * 之后任何提案想删掉它都会被 confirm 拒绝。找不到边界行就返回空数组
 * （不强行猜，也不假装有保护）。
 */
export function deriveLockedPhrases(value) {
    const line = value.split(/\r?\n/).find((item) => /^\s*边界[:：]/.test(item));
    if (line === undefined)
        return [];
    const body = line.replace(/^\s*边界[:：]\s*/, '').replace(/[。.]\s*$/, '');
    return body
        .split(/[；;、]/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 30)
        .slice(0, 5);
}
/** 按字符截断，尽量停在换行边界，末尾加省略号。 */
function clip(text, limit) {
    if (limit <= 0)
        return '';
    if (text.length <= limit)
        return text;
    const head = text.slice(0, Math.max(0, limit - 1));
    const cut = head.lastIndexOf('\n');
    const body = cut > limit * 0.6 ? head.slice(0, cut) : head;
    return `${body}…`;
}
