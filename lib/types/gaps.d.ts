/**
 * src/gaps.ts — 知识缺口（「我不知道」的登记簿）
 *
 * 为什么要有这个：
 * 现在的准则是**离线蒸馏**出来的——从已有记忆里归纳结论。
 * 但真正该学的东西往往出现在**卡壳的那一刻**：模型想不起来、查不到、只能猜。
 * 那一刻的缺口如果不记，下次还会在同一个地方卡住。
 *
 * 风识（dsh-engram-relay）的「自动补卡」验证了这个模式有效：
 * 不会 → 求助 → 查不到 → 当场补卡 → 下次就有。
 * 它自己也有当日上限（5 张）防噪声，我们同理。
 *
 * 与准则本的区别：
 *   准则 = 「已经学会的」
 *   缺口 = 「还没学会但知道该学的」
 */
export interface CognitionGap {
    id: string;
    /** 缺口描述：缺的是什么知识。 */
    text: string;
    /** 当时在做什么（上下文），便于日后判断这个缺口还在不在。 */
    context?: string;
    /** 关联主题。 */
    topicIds: string[];
    createdAt: number;
    /** 已填补的时间；有值表示已解决。 */
    resolvedAt: number | null;
    /** 用什么补上的（记忆 id / 准则 id / 说明）。 */
    resolvedBy?: string;
}
export interface GapOptions {
    filePath?: string;
    now?: () => number;
}
export declare class GapStore {
    private readonly filePath;
    private readonly clock;
    private gaps;
    private nextSeq;
    private dirty;
    constructor(options?: GapOptions);
    /** 从磁盘加载（文件不存在是正常的）。 */
    loadSync(): boolean;
    /** 落盘（有变化才写）。 */
    flush(): void;
    /** 登记一个缺口。同文本的未解决缺口不重复记。 */
    add(input: {
        text: string;
        context?: string;
        topicIds?: string[];
    }): {
        gap: CognitionGap;
        duplicate: boolean;
    };
    /** 标记为已填补。 */
    resolve(id: string, by: string): boolean;
    /** 所有未解决的缺口，新的在前。 */
    open(): CognitionGap[];
    all(): readonly CognitionGap[];
    get(id: string): CognitionGap | undefined;
    stats(): {
        open: number;
        resolved: number;
        total: number;
    };
    /**
     * 渲染成注入用的清单。
     *
     * 只在有待补缺口时出现，且很短——它提醒模型「这些是你还不知道的」，
     * 而不是占满预算。
     */
    renderSection(budget?: number): string;
}
