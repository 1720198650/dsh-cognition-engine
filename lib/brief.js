/**
 * src/brief.ts — 任务简报生成器（P5，确定性版）
 *
 * 定位：**给子代理 / 超级代理的一份工作集，不进主上下文。**
 * 因此它不需要"概念边界长期稳定"（那是 C0 卡住的原因），只需要"这件活够用"。
 *
 * 结构依据：arXiv:2611.05306 附录 A — 好的压缩不是摘要历史，而是为下一步执行挑的简报：
 *   ① 任务原文 ② 当前意图与下一步 ③ 与未来执行相关的工件 ④ 完成判定标准
 *
 * 硬约束：
 *   - **每条都必须带 id**，能 recall 展开（否则无法核对，等于又编一遍）
 *   - 纯确定性：检索 + 模板拼装，零模型调用
 *   - 总长 ≤ maxChars（默认 800）
 */
import { textSimilarity } from "./memory.js";
const clip = (text, limit) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
};
export function buildTaskBrief(input) {
    const maxFacts = input.maxFacts ?? 8;
    const maxRules = input.maxRules ?? 3;
    const maxChars = input.maxChars ?? 800;
    const minRelevance = input.minRelevance ?? 0.15;
    const notes = [];
    const live = input.facts.filter((fact) => (fact.supersededBy ?? null) === null);
    const dead = input.facts.filter((fact) => (fact.supersededBy ?? null) !== null);
    // 事实打分：与任务的相关性为主，重要度与主题命中为辅
    const scoredFacts = live
        .map((fact) => {
        const base = textSimilarity(input.task, `${fact.subject} ${fact.content}`);
        // 主题命中优先：用户说"发版"，事实主题是"发版频率"，字面不一定像，但它就是相关的
        // 主题命中（名字/别名）之外，再加一层"事实主题出现在任务里"：
        // 中文里主题常带后缀（"隐私边界"），用户只会说"隐私"，所以用前两个字兜底。
        const subjectHit = (input.preferredSubjects ?? []).some((name) => name.length > 0 && (fact.subject.includes(name) || name.includes(fact.subject))) ||
            input.task.includes(fact.subject) ||
            (fact.subject.length >= 2 && input.task.includes(fact.subject.slice(0, 2)));
        const relevance = subjectHit ? Math.max(base, 0.5) : base;
        const score = relevance * 0.7 + Math.min(1, fact.importance) * 0.2 + (input.task.includes(fact.subject) ? 0.1 : 0);
        return { fact, relevance, score: Number(score.toFixed(3)) };
    })
        .sort((a, b) => b.score - a.score);
    // 先按「相关性」过滤：纯重要度高但毫不相干的，不该占位置
    let pickedFacts = scoredFacts.filter((item) => item.relevance > minRelevance).slice(0, maxFacts);
    if (pickedFacts.length === 0) {
        pickedFacts = live
            .slice()
            .sort((a, b) => b.importance - a.importance)
            .slice(0, Math.min(3, maxFacts))
            .map((fact) => ({ fact, relevance: 0, score: 0 }));
        if (pickedFacts.length > 0)
            notes.push('任务与现有事实无明显相关，按重要度取了前几条（供参考，不是结论）');
    }
    else if (pickedFacts.length < 3) {
        notes.push('相关事实很少，简报可能不完整——缺的部分请调 cognition_recall');
    }
    // 准则：只取有边界的活跃准则，按相关性排
    const scoredRules = (input.rules ?? [])
        .filter((rule) => (rule.boundaryEnvs ?? []).length > 0)
        .map((rule) => ({
        rule,
        score: Number((textSimilarity(input.task, rule.content) * 0.8 + (input.task.includes(rule.section ?? '') ? 0.2 : 0)).toFixed(3)),
    }))
        .filter((item) => item.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxRules);
    // 该避开：与入选事实同主题、已失效的旧口径
    const subjects = new Set(pickedFacts.map((item) => item.fact.subject));
    const avoid = dead
        .filter((fact) => subjects.has(fact.subject))
        .slice(0, 3)
        .map((fact) => {
        const target = input.facts.find((candidate) => candidate.id === fact.supersededBy);
        const reason = (fact.supersedeReason ?? '').trim();
        return `- 旧口径（勿用）：${clip(fact.content, 60)}${target === undefined ? '' : ` → 现为：${clip(target.content, 50)}`}${reason === '' ? '' : `（原因：${clip(reason, 30)}）`}`;
    });
    const render = (facts, rules, withAvoid, withWiki) => {
        const parts = ['## 任务', clip(input.task, 200), ''];
        if (input.completion !== undefined && input.completion.trim().length > 0) {
            parts.push('## 完成判定', `- ${clip(input.completion, 120)}`, '');
        }
        parts.push('## 相关事实（可直接用，需要细节调 cognition_recall）');
        if (facts.length === 0)
            parts.push('- （无）');
        for (const { fact } of facts)
            parts.push(`- [${fact.id}] ${clip(fact.content, 90)}`);
        parts.push('');
        if (rules.length > 0) {
            parts.push('## 适用准则（含适用边界，超出边界不要套用）');
            for (const { rule } of rules) {
                parts.push(`- [${rule.id}] ${clip(rule.content, 80)}（不适用于：${(rule.boundaryEnvs ?? []).join('、')}）`);
            }
            parts.push('');
        }
        if (withAvoid && avoid.length > 0) {
            parts.push('## 该避开（已被推翻的旧口径）', ...avoid, '');
        }
        if (withWiki && input.wikiExcerpt !== undefined && input.wikiExcerpt.trim().length > 0) {
            parts.push('## 主题附注', clip(input.wikiExcerpt, 160), '');
        }
        if (notes.length > 0) {
            parts.push('## 提醒', ...notes.map((note) => `- ${note}`), '');
        }
        return parts.join('\n').trimEnd();
    };
    // 逐级降级：先去掉 wiki，再去掉 avoid，再砍事实条数
    let facts = pickedFacts;
    let markdown = render(facts, scoredRules, true, true);
    if (markdown.length > maxChars)
        markdown = render(facts, scoredRules, true, false);
    if (markdown.length > maxChars)
        markdown = render(facts, scoredRules, false, false);
    while (markdown.length > maxChars && facts.length > 1) {
        facts = facts.slice(0, -1);
        markdown = render(facts, scoredRules, false, false);
    }
    if (markdown.length > maxChars) {
        markdown = `${markdown.slice(0, Math.max(0, maxChars - 1))}…`;
        notes.push('简报已按上限截断');
    }
    return {
        markdown,
        picked: {
            facts: facts.map((item) => ({ id: item.fact.id, score: item.score })),
            rules: scoredRules.map((item) => ({ id: item.rule.id, score: item.score })),
        },
        chars: markdown.length,
        notes,
    };
}
