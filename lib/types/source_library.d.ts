export interface SourceBlock {
    /** `blk-<sourceId>-<ord>`，确定性 id：同一条来源重复索引不会产生新记录 */
    id: string;
    sourceId: string;
    /** 在来源里的顺序（0 起） */
    ord: number;
    at: number;
    chars: number;
    text: string;
}
export type SourceNoteStatus = 'pending' | 'ready' | 'failed' | 'skipped' | 'suspicious';
export interface SourceNote {
    sourceId: string;
    at: number;
    status: SourceNoteStatus;
    title: string;
    /** 2~6 字主题名，尽量命中已有主题 */
    topic?: string;
    /** ≤300 字：这份资料在解决什么问题、结论是什么 */
    summary: string;
    /** 3~6 条可复用结论，每条独立成立 */
    points: string[];
    /** 与 points 一一对应的原文引文（逐字照抄，用来做外部锚核对） */
    quotes?: string[];
    /** 失败原因（status='failed' 时有值） */
    error?: string;
    /** 提炼产物里再扫出来的可疑标记（status='suspicious' 时有值） */
    flags?: string[];
}
/** 表格形状（分隔符 / 表头 / 数据行），不是表格返回 null。 */
export declare function detectTableShape(text: string): {
    delimiter: string;
    header: string;
    rows: string[];
} | null;
export declare function chunkText(text: string, options?: {
    target?: number;
    max?: number;
}): string[];
/** 去标点小写后的 bigram 集合：中文按双字、英文按双字母，够用且不需要分词器。 */
export declare function bigrams(text: string): Set<string>;
/**
 * 给一个块打分：中文走 bigram 覆盖率，纯英文按整词命中。
 *
 * 为什么要分两条路：英文长块里 "ablative" 的 7 个 bigram（ab/bl/la/at/ti/iv/ve）
 * 几乎在任何一段英文里都能凑齐，覆盖率全是 1.00 —— 等于没筛。整词命中才有区分度。
 */
export declare function scoreQuery(query: string, text: string): number;
export interface SourceHit {
    id: string;
    sourceId: string;
    title: string;
    ord: number;
    score: number;
    text: string;
}
/**
 * 一条"资料"如果整个正文只是一行文件路径，它不该参与检索。
 *
 * 2026-11-18 实测：用户把 `D:\下载\...固定资产投资.xls` 这条路径粘进收件箱，
 * 之后查「固定资产投资」第一名是这条 26 字的路径，真正的表排第二——噪声盖住了内容。
 */
export declare function isPathOnlyBlock(text: string): boolean;
export declare class SourceLibrary {
    readonly blocksFile: string;
    readonly notesFile: string;
    private readonly clock;
    private blockCache;
    private noteCache;
    constructor(options: {
        blocksFile: string;
        notesFile: string;
        now?: () => number;
    });
    private loadBlocks;
    private loadNotes;
    private saveNotes;
    /** 索引一条来源（幂等：同 sourceId 已经有块就跳过）。 */
    indexSource(source: {
        id: string;
        title: string;
        content: string;
    }, options?: {
        target?: number;
        max?: number;
    }): {
        sourceId: string;
        blocks: number;
        skipped: boolean;
    };
    blocksOf(sourceId: string): SourceBlock[];
    /**
     * 从资料库里删掉一条来源的块索引与摘要（来源账本不动，哈希链不会断）。
     *
     * 为什么需要：误粘的路径、导入失败的残片会长期占着检索位和列表行。
     * SoMem 的账本是只追加的证据层，删除只能发生在"派生视图"上——这正是块和摘要所在的层。
     */
    deleteSource(sourceId: string): {
        sourceId: string;
        blocks: number;
        note: boolean;
    };
    note(sourceId: string): SourceNote | undefined;
    setPending(sourceId: string, title: string): SourceNote;
    saveNote(note: SourceNote): SourceNote;
    notes(): SourceNote[];
    /** 收件页要显示的一行摘要：块数 + 摘要状态。 */
    describe(sourceId: string | undefined): {
        blocks: number;
        note: SourceNote | null;
    };
    /**
     * 检索：bigram 覆盖率打分，按来源去重上限 `perSource`，总字符不超过 `maxChars`。
     *
     * 命中率门槛 0.15 与准入/冲突检测同一个量级：低于它基本都是"共用几个常见字"。
     */
    search(query: string, options?: {
        k?: number;
        maxChars?: number;
        perSource?: number;
        minScore?: number;
    }): SourceHit[];
    stats(): {
        blocks: number;
        notes: number;
        ready: number;
        failed: number;
        skipped: number;
        sources: number;
    };
}
