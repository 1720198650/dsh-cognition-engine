/**
 * src/dreaming.ts — 离线整合（dreaming）第一版：纯规则，不调模型
 *
 * ## 依据
 *
 * Anthropic《The components of agent memory》(2026)：记忆分四层
 * （转录 → 笔记 → 表示/wiki → 注入层），层与层之间靠 **dreaming** 打通——
 * 用闲置算力回头看，做三件事：
 *   1. **对账改错**：拿笔记去跟原始转录核对，改掉记错的地方；
 *   2. **合并重复**：把散落同一件事的多条笔记合成一条；
 *   3. **上浮/下沉**：该进注入层的顶上去，细节沉到下层留链接。
 *
 * ## 这一版只做「检测 + 出建议」，绝不自动改数据
 *
 * 理由和内建纪律一致：自动改写判错就污染（Mem0 式全自动的风险）。
 * 所以这里只产出**报告**，写进 cognition-dream.json，由人（或面板）采纳。
 *
 * 零依赖：只用现成的 textSimilarity / subject 分桶。
 */
export type DreamKind = 'duplicate-live' | 'conflict' | 'untopiced-rule' | 'orphan-evidence';
export interface DreamItem {
    kind: DreamKind;
    severity: 'high' | 'medium' | 'low';
    subject: string;
    /** 涉及的 id（事实或准则）。 */
    ids: string[];
    /** 一句话说明，直接给人看。 */
    message: string;
    /** 建议动作，机器可读。 */
    suggestion: string;
}
export interface DreamReport {
    generatedAt: number;
    /** 统计：各项检出数。 */
    counts: Record<string, number>;
    items: DreamItem[];
    /** 扫描规模，便于判断报告是否有意义。 */
    scanned: {
        facts: number;
        rules: number;
        topics: number;
    };
}
export interface DreamFact {
    id: string;
    subject: string;
    content: string;
    supersededAt: number | null;
    deletedAt?: number;
    archived?: boolean;
}
export interface DreamRule {
    id: string;
    section: string;
    content: string;
    status: string;
    topicIds: readonly string[];
    evidenceStatus?: string;
}
export interface DreamInput {
    facts: readonly DreamFact[];
    rules: readonly DreamRule[];
    topicCount: number;
    /** 相似度阈值：高于它才算「可能重复」。默认 0.82。 */
    duplicateThreshold?: number;
    now?: number;
}
export declare function runDreaming(input: DreamInput): DreamReport;
