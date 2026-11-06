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
        const personaText = clip(doc.blocks.persona.value.trim(), doc.blocks.persona.limit);
        const humanText = clip(doc.blocks.human.value.trim(), doc.blocks.human.limit);
        if (personaText.length === 0 && humanText.length === 0)
            return '';
        // 总量兜底：human 是次要块，超预算时先压缩它
        const over = personaText.length + humanText.length - doc.budget.total;
        const humanClipped = over > 0 ? clip(humanText, Math.max(0, humanText.length - over)) : humanText;
        const parts = ['## 人格（稳定，不要违背）'];
        if (personaText.length > 0) {
            parts.push(`<persona chars="${personaText.length}/${doc.blocks.persona.limit}">`, personaText, '</persona>');
        }
        if (humanClipped.length > 0) {
            parts.push(`<human chars="${humanClipped.length}/${doc.blocks.human.limit}">`, humanClipped, '</human>');
        }
        return parts.join('\n');
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
        const beforeHash = hashText(block.value);
        const op = block.history.length === 0 ? 'create' : 'replace';
        block.value = proposal.value;
        block.history = [
            ...block.history,
            {
                at: this.clock(),
                by,
                op,
                beforeHash,
                afterHash: hashText(proposal.value),
                ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
            },
        ].slice(-50);
        doc.revision += 1;
        doc.updatedAt = this.clock();
        this.proposals.splice(index, 1);
        this.#saveDocument();
        this.#saveProposals();
        return { ok: true, revision: doc.revision };
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
    #saveDocument() {
        const doc = this.doc;
        if (doc === undefined)
            return;
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
        }
        catch {
            /* 落盘失败不影响内存 */
        }
    }
    #saveProposals() {
        try {
            mkdirSync(dirname(this.proposalPath), { recursive: true });
            writeFileSync(this.proposalPath, JSON.stringify(this.proposals, null, 2) + '\n', 'utf8');
        }
        catch {
            /* 落盘失败不影响内存 */
        }
    }
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
