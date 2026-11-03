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
import { tryParseJson } from "./reflection.js";
/* ------------------------------------------------------------------ */
/* 提示词                                                               */
/* ------------------------------------------------------------------ */
export function buildDistillPrompt(input) {
    const maxCandidates = input.maxCandidates ?? 5;
    const playbookText = input.entries.length === 0
        ? '（当前没有准则）'
        : input.entries
            .filter((entry) => entry.status === 'active' || entry.status === 'pending')
            .map((entry) => `[${entry.id}] helpful=${entry.helpful} harmful=${entry.harmful} :: ${entry.content}`)
            .join('\n');
    const memoryText = input.memories.length === 0
        ? '（没有未覆盖的记忆）'
        : input.memories
            .map((item) => `- [${item.id}] 主题：${item.subject}｜内容：${item.content}`)
            .join('\n');
    const projectBlock = input.projectRules === undefined || input.projectRules.trim().length === 0
        ? ''
        : `\n## 项目已声明的约定（不得生成与之冲突的准则）\n${input.projectRules.trim().slice(0, 800)}\n`;
    return `你是「准则蒸馏器」。任务：从记忆里提炼跨会话可复用的工作准则，并给现有准则打使用标记。

## 现有准则
${playbookText}

## 尚未被任何准则引用的记忆
${memoryText}
${projectBlock}
## 什么叫「准则」
一条准则必须能直接改变下一步动作，例如「发版前跑完整流程」。

**反例**（这些不要写）：
- 「认真检查代码」「注意边界情况」「遵循最佳实践」——换成任何项目都成立，等于没说
- 「v0.8.0 已发布到 npm」——这是事实，属于记忆，不是准则
- 「项目有 747 个文件」——具体数据，很快过期

**判断口诀**：这条换成别的项目还成立吗？成立就别写。

## 输出要求（只输出 JSON，不要任何解释文字）

{
  "reasoning": "为什么这些记忆值得/不值得变成准则",
  "error_identification": "现有准则里哪些可能是错的或过时的（没有就写无）",
  "root_cause_analysis": "造成这些错误的原因",
  "correct_approach": "应该怎么调整",
  "key_insight": "一句话总结这轮蒸馏的收获",
  "marks": [{ "id": "ctxt-00001", "mark": "helpful" }],
  "candidates": [
    { "section": "约定", "content": "12-60 字的祈使句", "sourceIds": ["mem-xxxxxx"], "validUntil": "2026-12-31" }
  ]
}

## 硬性规则
1. 只输出 JSON，前后不要有任何文字。
2. section 只能是「约定」「坑」「状态」三者之一。
3. content 长度 12–60 个字符，必须是祈使句。
4. candidates 最多 ${maxCandidates} 条；没有值得提炼的就给空数组。
5. sourceIds 必须来自上面列出的记忆 id，不许编造。
5b. **validUntil 只在准则是阶段性的时候填**（例如「本周先用 A 方案」「这个阶段别动 B」）。
    格式用 ISO 日期（例如 2026-12-31），或相对表达（例如 7d 表示 7 天后）。
    **长期有效的准则不要填这个字段**——宁可留空，也不要乱猜日期。
6. **只输出候选，不要输出任何「删除」「修改」指令**——改删由代码和人工决定。
7. marks 只在你有明确理由时给，没有就给空数组；不要为了凑数乱标。
8. **五个反思字段必须简短**：reasoning ≤ 80 字，其余每个 ≤ 50 字，key_insight ≤ 40 字——写长了会挤掉 candidates。
9. 用中文回答。`;
}
/* ------------------------------------------------------------------ */
/* 解析                                                                 */
/* ------------------------------------------------------------------ */
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * 解析蒸馏输出。
 *
 * 模型经常给 markdown 围栏或前后加解释文字，这里用 tryParseJson 兜住；
 * 完全解析不出来时返回空结果并带上 raw，让上层能提示用户「模型没按格式回答」。
 */
export function parseDistillResult(text) {
    const empty = {
        reflection: {
            reasoning: '',
            errorIdentification: '',
            rootCauseAnalysis: '',
            correctApproach: '',
            keyInsight: '',
        },
        marks: [],
        candidates: [],
    };
    const parsed = tryParseJson(text);
    if (parsed === null)
        return { ...empty, raw: text };
    const reflection = {
        reasoning: asString(parsed['reasoning']),
        errorIdentification: asString(parsed['error_identification']),
        rootCauseAnalysis: asString(parsed['root_cause_analysis']),
        correctApproach: asString(parsed['correct_approach']),
        keyInsight: asString(parsed['key_insight']),
    };
    const marks = [];
    const rawMarks = parsed['marks'];
    if (Array.isArray(rawMarks)) {
        for (const item of rawMarks) {
            const record = item;
            const id = asString(record.id);
            const mark = asString(record.mark);
            if (id.length === 0)
                continue;
            if (mark !== 'helpful' && mark !== 'harmful')
                continue;
            marks.push({ id, mark });
        }
    }
    const candidates = [];
    const rawCandidates = parsed['candidates'];
    if (Array.isArray(rawCandidates)) {
        for (const item of rawCandidates) {
            const record = item;
            const content = asString(record.content);
            if (content.length === 0)
                continue;
            const validUntil = asString(record.validUntil);
            candidates.push({
                section: asString(record.section) || undefined,
                content,
                sourceIds: Array.isArray(record.sourceIds) ? record.sourceIds.map(String) : undefined,
                ...(validUntil.length === 0 ? {} : { validUntil }),
            });
        }
    }
    return { reflection, marks, candidates };
}
