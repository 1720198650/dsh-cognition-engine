/**
 * src/shadow.ts — shadow 试运行（S6）
 *
 * 新学到的东西先进 shadow：**保留在库里、但不注入系统提示**。
 * 用一段时间（默认 21 天）看它到底有没有被用上、有没有帮上忙，
 * 够了才转正。这解决一个具体的失败：模型偶尔冒出一条「听起来很对」的准则，
 * 直接进注入段就污染了每一轮上下文，而且很难说清是哪天开始变差的。
 *
 * 转正条件（对齐 docs/upgrade-plan-v3.md §7.3）：
 *   命中 ≥ 3 次且 helpful ≥ harmful
 * 到期条件：21 天零命中 → expired
 *
 * 本模块只存数据与状态机，**不参与注入渲染**——这是它的定义性质，不是遗漏。
 */
export type ShadowVerdict = null | 'promoted' | 'expired' | 'rejected';
export interface ShadowEntry {
    id: string;
    subject: string;
    text: string;
    /** 来源：user-correction / distill / budget-overflow / manual */
    source: string;
    createdAt: number;
    expiresAt: number;
    /** 被检索到的次数。 */
    occurrences: number;
    /** 被判定「用上了」的次数。 */
    hits: number;
    helpful: number;
    harmful: number;
    verdict: ShadowVerdict;
    note?: string;
}
export interface ShadowDoc {
    schema: 'cognition.shadow';
    version: 1;
    entries: ShadowEntry[];
}
export interface ShadowStoreOptions {
    filePath?: string;
    now?: () => number;
    /** 默认存活天数。 */
    ttlDays?: number;
}
export declare class ShadowStore {
    #private;
    private readonly filePath;
    private readonly clock;
    private readonly ttlDays;
    private doc;
    private loaded;
    private saveError;
    constructor(options?: ShadowStoreOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    /** 在册的（未定论的）条目。 */
    active(): ShadowEntry[];
    all(): ShadowEntry[];
    /** 放一条进 shadow。 */
    add(input: {
        text: string;
        subject?: string;
        source?: string;
        note?: string;
    }): {
        entry?: ShadowEntry;
        rejected?: string;
    };
    /**
     * 记一次使用结果。
     *
     * `occurrence` = 被检索到（不管用没用上）；`hit` = 确实用上了；
     * `helpful` / `harmful` = 用户反馈的方向。
     */
    record(id: string, update: {
        occurrence?: boolean;
        hit?: boolean;
        helpful?: boolean;
        harmful?: boolean;
    }): boolean;
    /** 是否够格转正：命中 ≥3 且 helpful ≥ harmful。 */
    canPromote(entry: ShadowEntry): boolean;
    /**
     * 转正：把条目交还给调用方（由它写进准则本），并标 promoted。
     *
     * 这里不直接依赖 playbook，是为了让 shadow 不绑死在准则本上——
     * 将来记忆条目也能走同一条试运行通道。
     */
    promote(id: string): {
        ok: boolean;
        entry?: ShadowEntry;
        reason?: string;
    };
    reject(id: string, note?: string): boolean;
    /** 扫描到期：21 天零命中 → expired。返回本次到期的条目。 */
    sweepExpired(): ShadowEntry[];
    stats(): {
        active: number;
        promoted: number;
        expired: number;
        rejected: number;
        readyToPromote: number;
    };
}
