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
export declare const PLAYBOOK_SECTIONS: readonly ["约定", "坑", "状态", "未分类"];
export type PlaybookSection = (typeof PLAYBOOK_SECTIONS)[number];
export type PlaybookStatus = 'active' | 'pending' | 'retired' | 'expired';
/** 条目的历史版本（revise 时保留，不原地覆盖）。 */
export interface PlaybookHistoryEntry {
    content: string;
    replacedAt: number;
}
export interface PlaybookEntry {
    id: string;
    section: PlaybookSection;
    content: string;
    /** ACE 式双向计数：一个条目既可能被证明有用，也可能误导过。 */
    helpful: number;
    harmful: number;
    /** 来自哪几条记忆（证据链）；手动条目为空。 */
    sourceIds: string[];
    /** 何时生效；null 表示不限。 */
    validFrom: number | null;
    /** 何时失效；null 表示长期有效。P3 才会自动生成。 */
    validTo: number | null;
    status: PlaybookStatus;
    createdAt: number;
    updatedAt: number;
    note: string;
    history: PlaybookHistoryEntry[];
    /** 与哪条准则疑似冲突（入库时检测，人工裁决）。 */
    conflictWith?: string;
    /** 自查：渲染进「开工前自查」清单，要求模型动手前先点名适用项。 */
    guard: boolean;
    /** 拦截：工具调用前校验，违反则直接拒绝执行。需要 trigger + required。 */
    enforce: boolean;
    /** 审计：命中但未拦截时记一次违反，写进审计日志与计数。 */
    audit: boolean;
    /**
     * 拦截/审计的触发条件（正则）。工具名 + 参数 JSON 匹配它才认为「这条准则适用」。
     * 例：`npm\s+publish`。留空则这条的拦截/审计不生效——否则每条准则都会命中所有调用。
     */
    trigger: string;
    /**
     * 适用时「必须满足」的条件（正则）。触发匹配了但它没匹配 → 违反。
     * 例：`--registry`。
     */
    required: string;
    /**
     * 归属主题（多对多）。空 = 未归类。
     * 用于「按任务只注入相关准则」——这是主题层对准则本最直接的收益。
     */
    topicIds: string[];
    /** 累计违反次数。 */
    violations: number;
    /** 最近一次违反时间；从未违反为 null。 */
    lastViolationAt: number | null;
}
export interface PlaybookFile {
    version: number;
    revision: number;
    updatedAt: number;
    entries: PlaybookEntry[];
}
/** 待合并的候选（由 Reflector/Curator 产生，或人工新增）。 */
export interface PlaybookCandidate {
    section?: string;
    content: string;
    sourceIds?: string[];
    validTo?: number | null;
}
export interface MergeOutcome {
    accepted: boolean;
    /** 被接受时是新建条目；命中重复则为空。 */
    entry?: PlaybookEntry;
    reason?: string;
    /** 与哪条已有条目重复。 */
    duplicateOf?: string;
}
export interface PlaybookOptions {
    filePath?: string;
    now?: () => number;
    /** 注入预算（字符）。默认 600。 */
    maxChars?: number;
    /** 条目数上限。默认 12。 */
    maxEntries?: number;
    /** 每个 section 的条数上限。默认 5。 */
    maxPerSection?: number;
    /**
     * 去重阈值（余弦）。
     *
     * 注意：ACE 报告的 0.90 是**稠密向量**口径，不能直接搬。
     * 我们用字二元组词频余弦，实测标定点：
     *   完全相同 1.000 / 只差几个字 0.759 / 同义改写 0.694
     *   / 意思相同措辞不同 0.522 / 无关 0.000
     * 所以取 0.70——能拦住"只差几个字"和"同义改写"，又不至于把无关条目误判成重复。
     */
    dedupeThreshold?: number;
    /** 校验来源 id 是否真实存在；不提供则跳过校验。 */
    validateSourceIds?: (ids: readonly string[]) => string[];
}
export interface PlaybookStats {
    active: number;
    pending: number;
    retired: number;
    expired: number;
    chars: number;
    /** 带冲突标记的条数。 */
    conflicted: number;
    /** 累计违反次数。 */
    violationsTotal: number;
    /** 勾了自查 / 拦截 / 审计的生效条数。 */
    guarded: number;
    enforced: number;
    audited: number;
    helpfulTotal: number;
    harmfulTotal: number;
}
export declare class PlaybookStore {
    private readonly filePath;
    private readonly snapshotDir;
    private readonly clock;
    private readonly maxChars;
    private readonly maxEntries;
    private readonly maxPerSection;
    private readonly dedupeThreshold;
    private readonly validateSourceIds;
    private data;
    private seq;
    constructor(options?: PlaybookOptions);
    get path(): string;
    /** 启动时恢复；文件不存在或损坏都按空准则本启动，绝不阻断插件加载。 */
    loadSync(): boolean;
    load(): Promise<boolean>;
    private restore;
    flush(): Promise<void>;
    private snapshot;
    all(): PlaybookEntry[];
    get(id: string): PlaybookEntry | undefined;
    /** 生效中的条目：status=active 且未被 validTo 判过期。 */
    active(now?: number): PlaybookEntry[];
    pending(): PlaybookEntry[];
    stats(): PlaybookStats;
    isExpired(entry: PlaybookEntry, now?: number): boolean;
    /**
     * 提交一个候选。
     *
     * 这里就是 ACE 说的 "lightweight, non-LLM logic"：
     * 去重、长度、分节、来源、套话全部由代码判定，模型只负责提议。
     */
    submit(candidate: PlaybookCandidate): MergeOutcome;
    /**
     * 冲突检测：同 section + 内容相近 + 一方有否定词。
     *
     * 不做自动裁决——自动合并就是另一种「整篇重写」，会悄悄丢掉差异。
     * 只标记，交给人工在审核界面并排看。
     */
    detectConflict(content: string, section: PlaybookSection): string | undefined;
    /** 已过期的条目（status 仍是 active，但 validTo 已过）。 */
    expired(now?: number): PlaybookEntry[];
    /** 延长有效期（复核后确认继续有效）。 */
    extend(id: string, validTo: number | null): boolean;
    /** 人工直接新增（跳过审核，直接 active）。 */
    addManual(input: {
        section?: string;
        content: string;
        validTo?: number | null;
    }): MergeOutcome;
    accept(id: string): boolean;
    reject(id: string): boolean;
    /**
     * 永久删除一条准则（任意状态）。
     *
     * 和 retire 的区别：停用是「不再注入但留着记录」，删除是「当它没存在过」。
     * 删除前 flush() 会先留快照，所以还能从 .snapshots/ 找回来。
     */
    remove(id: string): boolean;
    retire(id: string, reason?: string): boolean;
    revive(id: string): boolean;
    /** 编辑条目：旧内容进 history，不原地丢弃。 */
    revise(id: string, content: string): boolean;
    /** 记录一次使用反馈（ACE 的双向计数）。 */
    mark(id: string, kind: 'helpful' | 'harmful', amount?: number): boolean;
    /**
     * 设置某条准则的三道约束开关。
     *
     * 默认全关：准则本身就是给模型的提醒，强制是例外而非常态。
     */
    setFlags(id: string, flags: {
        guard?: boolean;
        enforce?: boolean;
        audit?: boolean;
        trigger?: string;
        required?: string;
    }): boolean;
    /** 设置归属主题（多对多，空数组 = 未归类）。 */
    setTopics(id: string, topicIds: string[]): boolean;
    /** 记一次违反。 */
    recordViolation(id: string, now?: number): boolean;
    /**
     * 校验一次工具调用。
     *
     * 规则：`trigger` 匹配「工具名 + 参数 JSON」→ 这条准则适用；
     * 适用时 `required` 必须也匹配，否则算违反。
     * 只有 `trigger` 非空的条目参与判定——否则每条准则都会命中所有调用。
     *
     * 纯函数，不写盘：调用方决定是拒绝（enforce）还是只记录（audit）。
     */
    checkToolCall(text: string): {
        blocked: PlaybookEntry[];
        violated: PlaybookEntry[];
    };
    /**
     * 自查清单：勾了「自查」的条目会渲染到注入文本最前面。
     *
     * 内容很少（通常一两条），目的是让模型在动手前显式确认，而不是把长清单塞进上下文。
     */
    renderSelfCheck(now?: number): string;
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
    render(now?: number, budget?: number, topicName?: (id: string) => string | undefined): string;
    /**
     * 同 render，但额外返回被预算挤掉的条数。
     *
     * 低分条目（helpful−harmful×2 靠后）在预算紧张时会被静默丢弃——
     * 调用方据此在注入文本里补一句「另有 N 条省略」，避免用户以为准则丢了。
     */
    renderDetailed(now?: number, budget?: number, topicName?: (id: string) => string | undefined): {
        text: string;
        omitted: number;
    };
    /**
     * 把渲染结果包成可注入的段落；空准则本返回空串，由调用方回退 digest。
     *
     * **maxChars 是整段的总预算**，不是正文预算——自查块、标题、尾注都要先扣掉，
     * 否则总长度会超（实测过 619 > 600）。正文按剩余额度渲染。
     */
    renderSection(now?: number, topicName?: (id: string) => string | undefined): string;
    private entryRef;
    private nextId;
    private markActive;
    private markRetired;
    /** 打分最低的 active 条目（helpful − harmful×2，同分取最旧）。 */
    private worstEntry;
}
