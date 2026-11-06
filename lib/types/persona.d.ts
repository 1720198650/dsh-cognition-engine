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
/** 单块历史记录（revision 之外的第二条追溯线）。 */
export interface PersonaHistoryEntry {
    at: number;
    by: 'user' | 'agent' | 'system';
    op: 'create' | 'replace' | 'reset';
    beforeHash?: string;
    afterHash: string;
    /**
     * 改动前的**原文快照**。
     *
     * 只有 hash 是回滚不了的——上一版只存 hash，用户说「刚才那次改坏了」时无从恢复。
     * 这里存快照，`undo()` 才有东西可退。上限 2000 字符足够覆盖 800 的块预算。
     */
    before?: string;
    reason?: string;
}
/** human 块的结构化画像条目（Memobase 式 profile slot，只审计不注入）。 */
export interface PersonaFact {
    key: string;
    value: string;
    confidence?: number;
}
/** 一个块（人格 / 用户画像）。 */
export interface PersonaBlockRecord {
    label: 'persona' | 'human';
    displayName?: string;
    /** 这个块最多注入多少字符。 */
    limit: number;
    /** true 时 agent 连 propose 都不允许。 */
    readOnly?: boolean;
    value: string;
    examples?: string[];
    /** 只做审计，**不注入**。0.2 / 0.5 / 0.8 三档，不写伪精度。 */
    traits?: Record<string, number>;
    /** 删掉或改写即拒绝保存。 */
    lockedPhrases?: string[];
    /** human 块的结构化画像（Memobase 式 slot），**不注入**，留给检索用。 */
    slots?: Record<string, unknown>;
    /** 结构化画像条目（与 slots 并存：schema 早先定的名字是 facts）。 */
    facts?: PersonaFact[];
    /** 交互风格数值（只审计，**不注入**）。 */
    interactionStyle?: Record<string, number>;
    narrative?: Record<string, string>;
    history: PersonaHistoryEntry[];
}
/** persona 文件整体。 */
export interface PersonaDocument {
    schema: 'cognition.persona';
    version: 1;
    revision: number;
    updatedAt: number;
    /** 上一次 revision 的内容 hash，串成可回溯的修订链。 */
    parentHash?: string;
    budget: {
        persona: number;
        human: number;
        total: number;
    };
    meta?: {
        notes?: string;
        tags?: string[];
    };
    blocks: {
        persona: PersonaBlockRecord;
        human: PersonaBlockRecord;
    };
}
/** 待确认的修改提案。 */
export interface PersonaProposal {
    id: string;
    at: number;
    by: 'agent' | 'user';
    label: 'persona' | 'human';
    value: string;
    reason?: string;
}
export interface PersonaStoreOptions {
    filePath?: string;
    proposalPath?: string;
    now?: () => number;
}
/**
 * 人格块存储。
 *
 * 零依赖：就是一个 JSON 文件 + 一个提案文件。
 * 文件不存在 = 没有启用人格，`render()` 返回空串，注入段完全不占 token。
 */
export declare class PersonaStore {
    #private;
    private readonly filePath;
    private readonly proposalPath;
    private readonly clock;
    private doc;
    private proposals;
    private loaded;
    /** 最近一次写盘失败原因；成功写盘后清空。 */
    private saveError;
    constructor(options?: PersonaStoreOptions);
    /** 读文件。文件不存在或格式不对都当作「没有人格」，不抛错。 */
    loadSync(): boolean;
    get path(): string;
    get present(): boolean;
    get document(): PersonaDocument | undefined;
    /**
     * 渲染要注入的人格段。
     *
     * **traits / slots / history 一律不注入**——它们进上下文只会稀释信号，
     * 还可能变成模型拿来「表演人格」的素材（Anchor 倒 U 形说的就是这件事）。
     */
    render(): string;
    /** 预算占用（页面显示用）。 */
    usage(): {
        persona: {
            chars: number;
            limit: number;
        };
        human: {
            chars: number;
            limit: number;
        };
        total: {
            chars: number;
            budget: number;
        };
        rendered: number;
    };
    /** 硬规则 4 的体检：不合格只给警告，不阻止保存（写作风格不该被程序卡死）。 */
    lint(value: string): string[];
    /**
     * 提交一次修改提案。
     *
     * agent 永远不能直接改：硬规则 3。`human` 块对 agent 完全关闭。
     */
    propose(input: {
        label: 'persona' | 'human';
        value: string;
        by: 'agent' | 'user';
        reason?: string;
    }): {
        proposal?: PersonaProposal;
        rejected?: string;
    };
    pending(): PersonaProposal[];
    /** 用户确认提案 → 真正写入。硬规则 2 在这里守门：lockedPhrases 不许丢。 */
    confirm(id: string, by?: 'user' | 'system'): {
        ok: boolean;
        reason?: string;
        revision?: number;
    };
    /**
     * 撤销一次改动，恢复到它的 `before` 快照。
     *
     * 不传 `hash` 就撤销最近一次；传了就撤销那一次（按 `afterHash` 定位）。
     * 可以连续撤：每次都退一格，history 里会追加一条 `reason: 'undo'` 的记录。
     */
    undo(hash?: string): {
        ok: boolean;
        reason?: string;
        revision?: number;
        restoredFrom?: string;
    };
    reject(id: string): boolean;
    /** 直接用文件内容覆盖（迁移/初始化用；不经过提案，调用方必须是用户侧入口）。 */
    replaceDocument(doc: PersonaDocument): void;
    /** 最近一次落盘失败的原因（null = 一切正常）。页面与路由用它暴露「改了但没存下」。 */
    get lastSaveError(): string | undefined;
}
