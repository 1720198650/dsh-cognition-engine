export type StanceKind = 'goal' | 'prefer' | 'forbid';
export interface StanceItem {
    id: string;
    kind: StanceKind;
    text: string;
    /**
     * 只对 forbid 有意义：候选/记忆里出现这些词就算违反。
     * 必须谨慎填——过宽的词会误杀正常内容。
     */
    deny?: string[];
    active: boolean;
    /** 从哪来的：用户原话 / 已有准则 id / 人工 */
    origin: string;
    createdAt: number;
    updatedAt: number;
}
export declare class StanceStore {
    readonly filePath: string;
    private readonly clock;
    private data;
    constructor(options: {
        filePath: string;
        now?: () => number;
    });
    private load;
    private persist;
    add(input: {
        kind: StanceKind;
        text: string;
        deny?: string[];
        origin?: string;
    }): StanceItem;
    remove(id: string): boolean;
    list(activeOnly?: boolean): StanceItem[];
    /**
     * 违反判据检查：候选/记忆文本命中任一 active forbid 的 deny 词即算违反。
     *
     * 只做**明确词命中**，不做语义推断——宁可漏判也不误杀正常内容。
     */
    violates(text: string): {
        violates: boolean;
        rule?: StanceItem;
        word?: string;
    };
    /**
     * 渲染成注入段：目标在前、判据在后。限额 chars，超了按顺序截。
     *
     * 不打分、不排序、不给"倾向"——顺序就是添加顺序，人能预测。
     */
    render(maxChars?: number): string;
}
