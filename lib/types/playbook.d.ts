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
    retire(id: string, reason?: string): boolean;
    revive(id: string): boolean;
    /** 编辑条目：旧内容进 history，不原地丢弃。 */
    revise(id: string, content: string): boolean;
    /** 记录一次使用反馈（ACE 的双向计数）。 */
    mark(id: string, kind: 'helpful' | 'harmful', amount?: number): boolean;
    /**
     * 渲染成注入文本。
     *
     * 格式照 ACE：`[ctxt-00001] helpful=2 harmful=0 :: 正文`——
     * 模型可以点名引用，我们才能回写计数。
     */
    render(now?: number): string;
    /** 把渲染结果包成可注入的段落；空准则本返回空串，由调用方回退 digest。 */
    renderSection(now?: number): string;
    private entryRef;
    private nextId;
    private markActive;
    private markRetired;
    /** 打分最低的 active 条目（helpful − harmful×2，同分取最旧）。 */
    private worstEntry;
}
