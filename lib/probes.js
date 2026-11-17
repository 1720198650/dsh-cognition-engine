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
/** 字符二元组集合（中文短文本比词更稳）。 */
function bigrams(text) {
    const clean = text.replace(/[\s\u3000]+/g, '').replace(/[，。；：！？、,.!?;:"'“”‘’（）()【】\[\]]/g, '');
    const out = new Set();
    for (let i = 0; i + 1 < clean.length; i += 1)
        out.add(clean.slice(i, i + 2));
    return out;
}
/** 重叠度：交集 / 较小集合大小（候选短、回合长时不会被稀释）。 */
export function overlapOf(a, b) {
    const A = bigrams(a);
    const B = bigrams(b);
    if (A.size === 0 || B.size === 0)
        return 0;
    let hit = 0;
    for (const gram of A)
        if (B.has(gram))
            hit += 1;
    return hit / Math.min(A.size, B.size);
}
export function runPracticeProbes(input) {
    const minOverlap = input.minOverlap ?? 0.3;
    const maxCounter = input.maxCounter ?? 2;
    if (input.turns.length === 0) {
        return {
            triggable: [],
            counterEvidence: 0,
            support: 0,
            verdict: 'no-data',
            reason: '没有可用的练习样本（历史上还没有"用户纠正 + 有原话"的回合）',
        };
    }
    const triggable = [];
    for (const turn of input.turns) {
        const overlap = overlapOf(input.candidate, turn.excerpt);
        if (overlap < minOverlap)
            continue;
        triggable.push({
            sessionId: turn.sessionId,
            turn: turn.turn,
            excerpt: turn.excerpt.slice(0, 80),
            verdict: turn.verdict,
            overlap: Number(overlap.toFixed(3)),
        });
    }
    const counterEvidence = triggable.filter((hit) => hit.verdict === 'correction').length;
    const support = triggable.filter((hit) => hit.verdict === 'confirmation').length;
    if (counterEvidence >= maxCounter) {
        return {
            triggable,
            counterEvidence,
            support,
            verdict: 'reject',
            reason: `在 ${counterEvidence} 个"用户纠正"的回合上会被触发；按这条准则做，当时都会被纠正`,
        };
    }
    return {
        triggable,
        counterEvidence,
        support,
        verdict: 'pass',
        reason: triggable.length === 0
            ? '历史回合里没找到会触发它的场面（没证据，不等于正确）'
            : `命中 ${triggable.length} 个回合：纠正 ${counterEvidence} / 确认 ${support}，未达拒收阈值 ${maxCounter}`,
    };
}
