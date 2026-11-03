/**
 * src/topics.ts — 主题注册表
 *
 * 主题不是「自动聚类的结果」，而是**人定的适用范围键**：
 *
 *   记忆 —— 发生过什么
 *   准则 —— 应该怎么做
 *   主题 —— 这条记忆/这条准则适用于哪类任务   ← 本文件
 *
 * 为什么不做自动聚类（调研结论，见 docs/topic-research.md）：
 *   - 自动聚类的收益在 10² 条记忆规模下无任何论文证据
 *   - 独立复现（SubtleMemory）显示结构化记忆 70% vs 原文直灌 85.4%
 *   - 业界只有 Graphiti 做真社区，且是内部结构、不可编辑、重建会删旧社区
 *   - 可编辑的主题**几乎都是人定的容器**（Memobase slots / Letta blocks / Cognee NodeSets）
 *
 * 所以这里是「受控词表 + 人工维护 + LLM 只建议不落库」。
 */
/** 未归类的虚拟主题：不落库，任何没有 topicIds 的记忆/准则都归到它。 */
export declare const INBOX_TOPIC = "t_inbox";
export declare const INBOX_NAME = "\u672A\u5F52\u7C7B";
export interface Topic {
    id: string;
    name: string;
    /** 一句话说明这个主题管什么，用于自动匹配。 */
    description: string;
    /** 别名：匹配时一起看（「发版」「release」「publish」）。 */
    aliases: string[];
    /** 最多两层：null 表示顶层。 */
    parentId: string | null;
    status: 'active' | 'archived';
    createdBy: 'user' | 'llm';
    createdAt: number;
    updatedAt: number;
}
export interface TopicFile {
    version: number;
    revision: number;
    updatedAt: number;
    topics: Topic[];
}
export interface TopicStoreOptions {
    filePath?: string;
    now?: () => number;
    /** 主题总数上限，防止无限膨胀。默认 50。 */
    maxTopics?: number;
}
export interface TopicStats {
    total: number;
    active: number;
    archived: number;
    /** 顶层主题数（parentId === null）。 */
    roots: number;
}
export declare class TopicStore {
    private readonly filePath;
    private readonly snapshotDir;
    private readonly clock;
    private readonly maxTopics;
    private data;
    private seq;
    constructor(options?: TopicStoreOptions);
    get path(): string;
    loadSync(): boolean;
    load(): Promise<boolean>;
    private restore;
    flush(): Promise<void>;
    private snapshot;
    all(): Topic[];
    active(): Topic[];
    get(id: string): Topic | undefined;
    stats(): TopicStats;
    /**
     * 按文本找主题。
     *
     * 故意做得很笨：名字/别名**整词命中**优先，其次是描述里的关键词。
     * 不做相似度打分——主题是要人工确认的，匹配只是给候选。
     */
    match(text: string, limit?: number): Array<{
        topic: Topic;
        score: number;
        how: 'name' | 'alias' | 'description';
    }>;
    add(input: {
        name: string;
        description?: string;
        aliases?: string[];
        parentId?: string | null;
        createdBy?: 'user' | 'llm';
    }): Topic | string;
    update(id: string, patch: {
        name?: string;
        description?: string;
        aliases?: string[];
        parentId?: string | null;
        status?: 'active' | 'archived';
    }): boolean;
    /**
     * 删除主题。
     *
     * 不物理删除，改为归档：记忆/准则上的 topicIds 可能还引用它，
     * 直接删会让引用悬空。归档后不参与匹配，但历史仍可查。
     */
    archive(id: string): boolean;
    /** 硬删除：只有在确认没有引用后才用（调用方负责检查）。 */
    remove(id: string): boolean;
    private nextId;
}
/** 把 topicIds 规范成去重数组；空值返回 undefined（表示落在未归类）。 */
export declare function normalizeTopicIds(value: unknown): string[] | undefined;
