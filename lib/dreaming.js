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
import { textSimilarity } from "./memory.js";
/** 只对「还活着的」事实做整合分析。 */
function liveFacts(facts) {
    return facts.filter((fact) => fact.supersededAt === null && fact.deletedAt === undefined && fact.archived !== true);
}
export function runDreaming(input) {
    const threshold = input.duplicateThreshold ?? 0.82;
    const now = input.now ?? Date.now();
    const items = [];
    const facts = liveFacts(input.facts);
    // 1) 同主题下高度相似的活事实 → 合并建议
    const bySubject = new Map();
    for (const fact of facts) {
        const list = bySubject.get(fact.subject) ?? [];
        list.push(fact);
        bySubject.set(fact.subject, list);
    }
    for (const [subject, list] of bySubject) {
        for (let i = 0; i < list.length; i += 1) {
            for (let j = i + 1; j < list.length; j += 1) {
                const a = list[i];
                const b = list[j];
                if (a.content.trim() === b.content.trim())
                    continue; // 完全一样是 hash 去重，不归这里
                const similarity = textSimilarity(a.content, b.content);
                if (similarity < threshold)
                    continue;
                items.push({
                    kind: 'duplicate-live',
                    severity: 'medium',
                    subject,
                    ids: [a.id, b.id],
                    message: `同主题两条活事实相似度 ${(similarity * 100).toFixed(0)}%：「${a.content.slice(0, 24)}…」/「${b.content.slice(0, 24)}…」`,
                    suggestion: 'merge-or-supersede',
                });
            }
        }
    }
    // 2) 准则没挂主题（会影响主题隔离注入，让无关准则被一起塞进去）
    for (const rule of input.rules) {
        if (rule.status !== 'active')
            continue;
        if (rule.topicIds.length > 0)
            continue;
        items.push({
            kind: 'untopiced-rule',
            severity: 'low',
            subject: rule.section,
            ids: [rule.id],
            message: `准则 ${rule.id}（${rule.section}）还没挂主题，主题隔离注入时会被当成通用准则`,
            suggestion: 'assign-topic',
        });
    }
    // 3) 证据链全断的准则
    for (const rule of input.rules) {
        if (rule.status !== 'active')
            continue;
        if (rule.evidenceStatus !== 'orphaned')
            continue;
        items.push({
            kind: 'orphan-evidence',
            severity: 'high',
            subject: rule.section,
            ids: [rule.id],
            message: `准则 ${rule.id} 的来源记忆已全部失效，但它还在生效`,
            suggestion: 'review-or-retire',
        });
    }
    const counts = {};
    for (const item of items)
        counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    // 严重度高在前，同级按主题聚在一起
    const rank = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.subject.localeCompare(b.subject));
    return {
        generatedAt: now,
        counts,
        items,
        scanned: { facts: facts.length, rules: input.rules.length, topics: input.topicCount },
    };
}
