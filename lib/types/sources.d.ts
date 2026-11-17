export interface SourceRecord {
    id: string;
    at: number;
    kind: 'paste' | 'file' | 'web';
    title: string;
    content: string;
    contentHash: string;
    prevHash: string;
    hash: string;
    /** 来源地址或本机路径（可空） */
    locator?: string;
}
export declare class SourceStore {
    readonly filePath: string;
    private readonly clock;
    private records;
    constructor(options: {
        filePath: string;
        now?: () => number;
    });
    private load;
    /** 追加一条不可变来源，返回 id。 */
    append(input: {
        kind: 'paste' | 'file' | 'web';
        title: string;
        content: string;
        locator?: string;
    }): SourceRecord;
    get(id: string): SourceRecord | undefined;
    list(limit?: number): SourceRecord[];
    /** 校验内容哈希 + 链。任何一条被改，从该点起断。 */
    verify(): {
        ok: boolean;
        total: number;
        brokenAt: string | null;
    };
}
