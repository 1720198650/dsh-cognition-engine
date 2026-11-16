/**
 * src/wiki_incremental.ts — wiki 增量维护（P1-shadow）
 *
 * 依据：
 * - LLM Wiki 模式（Karpathy 2026；Beyond RAG: LLM Wikis as Living Semantic Memory）：
 *   wiki 是"被增量编译、持续维护"的产物，不是每次重新摘要。
 * - CROW 的三个操作 Ingest / Query / Lint：我们对应 rebuild / 附注 / dreaming。
 * - 差分视图维护（differential dataflow）：只有 key 变了才重算。
 * - lobu 的 human-owned field 模式：人工改过的字段自动写入被阻塞，进审批队列。
 * - SSGM（arXiv:2603.11768）：反复全量摘要会语义漂移 → 所以只做 patch。
 *
 * 本文件保持纯函数，便于单测；磁盘写入由 WikiStore.save 负责。
 */
import { createHash } from 'node:crypto';
import { buildWiki } from "./wiki.js";
const SECTION_TITLES = {
    stance: '现行口径',
    avoid: '该避开',
    done: '完成判定',
    open: '未决问题',
};
export const SECTION_ORDER = ['stance', 'avoid', 'done', 'open'];
/** 来源事实指纹：内容/取代关系/重要度任一变化，哈希就变。 */
export function digestFacts(facts) {
    const out = {};
    for (const fact of facts) {
        const payload = [fact.content, fact.supersededBy ?? '', String(fact.importance)].join('|');
        out[fact.id] = createHash('sha256').update(payload).digest('hex').slice(0, 16);
    }
    return out;
}
export function diffDigest(prev, next) {
    const before = prev ?? {};
    const added = [];
    const changed = [];
    const removed = [];
    for (const [id, hash] of Object.entries(next)) {
        if (before[id] === undefined)
            added.push(id);
        else if (before[id] !== hash)
            changed.push(id);
    }
    for (const id of Object.keys(before)) {
        if (next[id] === undefined)
            removed.push(id);
    }
    return { added, removed, changed, total: added.length + removed.length + changed.length };
}
/** 按固定结构把分节拼成 markdown（与 buildWiki 的格式保持一致）。 */
export function renderWikiMarkdown(topicName, sections) {
    const parts = [`# ${topicName}`, ''];
    let wrote = false;
    for (const key of SECTION_ORDER) {
        const lines = sections[key] ?? [];
        if (lines.length === 0)
            continue;
        parts.push(`## ${SECTION_TITLES[key]}`, ...lines, '');
        wrote = true;
    }
    if (!wrote)
        parts.push('（这个主题还没有足够材料，先不写。）');
    return parts.join('\n');
}
/**
 * 增量更新一页。
 *
 * 三条硬规则：
 * 1. **没有变化就不写文件**（changed=false，调用方据此跳过 save，mtime 不变）；
 * 2. **人工改过的节不覆盖**，只进 suggestions；
 * 3. 每次更新后仍检查 1.0× 体积上限。
 */
export function updateWikiIncrementally(input) {
    const nextDigest = digestFacts(input.facts);
    const diff = diffDigest(input.prev?.digest, nextDigest);
    const edited = new Set((input.prev?.editedSections ?? []));
    if (input.prev !== undefined && diff.total === 0) {
        return { changed: false, page: { ...input.prev, digest: nextDigest }, diff, suggestions: [] };
    }
    const fresh = buildWiki({
        topicId: input.topicId,
        topicName: input.topicName,
        facts: input.facts,
        ...(input.rules === undefined ? {} : { rules: input.rules }),
        ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
        ...(input.now === undefined ? {} : { now: input.now }),
    });
    const sections = {
        stance: [...fresh.sections.stance],
        avoid: [...fresh.sections.avoid],
        done: [...fresh.sections.done],
        open: [...fresh.sections.open],
    };
    const suggestions = [];
    if (input.prev !== undefined) {
        for (const key of edited) {
            const oldLines = input.prev.sections[key] ?? [];
            if (oldLines.join('\n') !== (sections[key] ?? []).join('\n'))
                suggestions.push(key);
            sections[key] = [...oldLines];
        }
    }
    let markdown = renderWikiMarkdown(input.topicName, sections);
    const cap = Math.max(fresh.sourceBytes, 300);
    let trimmed = fresh.trimmed;
    while (markdown.length > cap && sections.stance.length > 1) {
        sections.stance = sections.stance.slice(0, -1);
        markdown = renderWikiMarkdown(input.topicName, sections);
        trimmed = true;
    }
    if (trimmed)
        markdown += '\n\n（wiki 已按 1.0× 上限裁剪，完整内容见原始记忆。）';
    const page = {
        topicId: input.topicId,
        topicName: input.topicName,
        updatedAt: input.now ?? Date.now(),
        sections,
        markdown,
        bytes: markdown.length,
        sourceBytes: fresh.sourceBytes,
        trimmed,
        digest: nextDigest,
        editedSections: [...edited],
    };
    return { changed: true, page, diff, suggestions };
}
