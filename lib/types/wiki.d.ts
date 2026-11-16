export interface WikiSourceFact {
    id: string;
    content: string;
    importance: number;
    supersededBy?: string | null;
    supersedeReason?: string;
}
export interface WikiSourceTask {
    description: string;
    status: string;
    evidence?: string;
}
export interface WikiSourceRule {
    id: string;
    content: string;
    boundaryEnvs?: string[];
}
export interface WikiSections {
    /** 现行口径：当前仍然有效、且下次要遵守的结论。 */
    stance: string[];
    /** 该避开：被推翻过的旧做法（带原因）。 */
    avoid: string[];
    /** 完成判定：做到什么程度算完。 */
    done: string[];
    /** 未决问题。 */
    open: string[];
}
export interface WikiPage {
    topicId: string;
    topicName: string;
    updatedAt: number;
    sections: WikiSections;
    markdown: string;
    bytes: number;
    sourceBytes: number;
    /** 是否因超预算被裁剪过 */
    trimmed: boolean;
    /** 增量维护用：来源事实指纹（factId → 内容哈希）。 */
    digest?: Record<string, string>;
    /** 被人工改过的小节名；自动更新不许碰。 */
    editedSections?: string[];
}
/**
 * 生成 wiki 正文。
 *
 * 纯函数：相同输入必得相同输出（时间戳除外），便于测试与重算。
 */
export declare function buildWiki(input: {
    topicId: string;
    topicName: string;
    facts: readonly WikiSourceFact[];
    rules?: readonly WikiSourceRule[];
    tasks?: readonly WikiSourceTask[];
    now?: number;
}): WikiPage;
/** 目录式 wiki 存储：`<dir>/<topicId>.md` + `<topicId>.json`（存结构化分节）。 */
export declare class WikiStore {
    readonly dir: string;
    constructor(dir: string);
    private file;
    private metaFile;
    save(page: WikiPage): WikiPage;
    read(topicId: string): WikiPage | undefined;
    list(): WikiPage[];
    /** 只保留最近 3 份备份，避免目录越堆越大。 */
    private pruneBackups;
    /** 供注入用的短摘录：只取前几行，绝不把整页塞进上下文。 */
    excerpt(topicId: string, limit?: number): string;
}
