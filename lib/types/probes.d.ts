/**
 * src/probes.ts — 准入前试跑（P4-2，practice probes）
 *
 * 依据：SkillHone（EMNLP 2026 Industry）——候选技能/准则在采纳前先在一批
 * "练习样本"上跑，用评估侧证据决定收不收；而不是采纳后再靠回滚。
 *
 * 我们的练习样本 = 过去真实回合里**用户明确纠正**的那些话
 * （join：注入日志的 verdict=correction + register 日志的 excerpt）。
 *
 * 判定逻辑（确定性，零模型成本）：
 *   1. 候选准则与某条"纠正"回合的文本重叠 ≥ 阈值 → 认为"这条准则当时会被触发"
 *   2. 该回合是用户纠正 → 记一条反证（说明按这条准则做，当时会被纠正）
 *   3. 反证 ≥ 阈值（默认 2）→ 建议拒收
 *
 * 它不是"证明准则错"，只是"在历史上有 N 次会撞上用户的纠正"。
 */
export interface ProbeTurn {
    sessionId: string;
    turn: number;
    excerpt: string;
    verdict: 'correction' | 'confirmation';
    at?: number;
}
export interface ProbeHit {
    sessionId: string;
    turn: number;
    excerpt: string;
    verdict: 'correction' | 'confirmation';
    overlap: number;
}
export interface ProbeResult {
    triggable: ProbeHit[];
    counterEvidence: number;
    support: number;
    verdict: 'reject' | 'pass' | 'no-data';
    reason: string;
}
/** 重叠度：交集 / 较小集合大小（候选短、回合长时不会被稀释）。 */
export declare function overlapOf(a: string, b: string): number;
export declare function runPracticeProbes(input: {
    candidate: string;
    turns: readonly ProbeTurn[];
    minOverlap?: number;
    maxCounter?: number;
}): ProbeResult;
