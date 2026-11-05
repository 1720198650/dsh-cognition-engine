/**
 * src/distill.ts — 准则蒸馏
 *
 * 把「记忆」提炼成「准则」，并给现有准则打使用标记。
 *
 * 设计依据：
 *   - ACE (ICLR 2026)：Reflector 输出固定 5 字段 JSON；Curator 只产候选，
 *     合并/去重/淘汰交给确定性代码（playbook.ts 的 submit）。
 *   - Dynamic Cheatsheet (EACL 2026)：DC-∅ 对照说明「换成任何项目都成立的套话」增益为零，
 *     所以提示词里必须硬性要求「携带私有信息」。
 *   - Reflexion (NeurIPS 2023)：反思要落到「下次怎么做」，不是「这次为什么错」。
 *
 * 本文件只负责「提示词 + 解析」，不调用模型，也不写盘。
 */
import type { PlaybookEntry } from './playbook.ts';
/** Reflector 的固定五字段（照 ACE）。 */
export interface DistillReflection {
    reasoning: string;
    errorIdentification: string;
    rootCauseAnalysis: string;
    correctApproach: string;
    keyInsight: string;
}
export interface DistillMark {
    id: string;
    mark: 'helpful' | 'harmful';
}
export interface DistillCandidate {
    section?: string;
    content: string;
    sourceIds?: string[];
    /** 阶段性有效的准则：ISO 日期或相对表达（"7d" / "2026-12-31"）；长期有效则不填。 */
    validUntil?: string;
    /** 何时适用（自然语言，如「发布版本时」）。 */
    when?: string;
}
export interface DistillResult {
    reflection: DistillReflection;
    marks: DistillMark[];
    candidates: DistillCandidate[];
    /** 解析失败时的原始输出，便于排查。 */
    raw?: string;
}
export interface DistillInput {
    /** 现有准则（含 id 与计数），给模型做取舍参考。 */
    entries: readonly PlaybookEntry[];
    /** 尚未被任何准则引用的记忆。 */
    memories: ReadonlyArray<{
        id: string;
        subject: string;
        content: string;
    }>;
    /** 预算提示：最多产出多少条候选。 */
    maxCandidates?: number;
    /** 项目约定摘要（AGENTS.md），用于避免生成与之冲突的准则。 */
    projectRules?: string;
    /**
     * 待补的知识缺口（P6 学习闭环）。
     *
     * 有缺口时，蒸馏要**优先针对它们**产出候选——这比泛泛归纳已有记忆有价值得多：
     * 泛泛归纳只能重组已知，针对缺口才是真的在学习新东西。
     */
    gaps?: ReadonlyArray<{
        id: string;
        text: string;
    }>;
}
export declare function buildDistillPrompt(input: DistillInput): string;
/**
 * 解析蒸馏输出。
 *
 * 模型经常给 markdown 围栏或前后加解释文字，这里用 tryParseJson 兜住；
 * 完全解析不出来时返回空结果并带上 raw，让上层能提示用户「模型没按格式回答」。
 */
export declare function parseDistillResult(text: string): DistillResult;
