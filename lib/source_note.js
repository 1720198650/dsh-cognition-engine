/** 送进模型的正文字数上限：头部给背景与问题，尾部给结论，中间可能只是实验细节。 */
const HEAD_CHARS = 8000;
const TAIL_CHARS = 3000;
/**
 * 提炼前的前置校验：太短或压根不是正文的资料，不调模型。
 *
 * 为什么必须拦：2026-11-18 实测，用户把两个**文件路径**粘进收件箱（26/42 字），
 * 模型照样一本正经地提炼出「仅有文件路径不能作为归档依据」这类假结论——
 * 看着像知识，其实是把"资料缺失"包装成了原则。宁可不提炼。
 *
 * 阈值 800 字：同一天那篇 328 字的散文被提炼成 4 条"结论"，全是可以从任何文字里
 * 套出来的空话。短资料不需要结论，只需要能检索到原文。
 */
export const MIN_DISTILL_CHARS = 800;
export function distillSkipReason(text) {
    const clean = text.trim();
    if (clean.length === 0)
        return '正文是空的';
    if (clean.length < MIN_DISTILL_CHARS) {
        return `正文只有 ${clean.length} 字，太短：只存原文供检索，不提炼结论`;
    }
    // 单行盘符路径 / UNC 路径：这是"填了路径没读文件"的典型形态
    if (/^([a-zA-Z]:[\\/]|\\\\|~[\\/]|\/)/.test(clean) && !/[。！？；\n]/.test(clean)) {
        return '看起来是一个文件路径，不是文件内容：请用「按路径导入」或「选择文件…」';
    }
    return null;
}
export function excerptForNote(text) {
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (clean.length <= HEAD_CHARS + TAIL_CHARS)
        return { text: clean, truncated: false };
    const head = clean.slice(0, HEAD_CHARS);
    const tail = clean.slice(clean.length - TAIL_CHARS);
    return { text: `${head}\n\n……（中间省略 ${clean.length - HEAD_CHARS - TAIL_CHARS} 字，直接跳到结尾）……\n\n${tail}`, truncated: true };
}
export function buildSourceNotePrompt(input) {
    const maxPoints = Math.max(1, input.maxPoints ?? 5);
    const excerpt = excerptForNote(input.text);
    const topics = (input.topics ?? []).filter((name) => name.trim().length > 0).slice(0, 30);
    const topicLine = topics.length === 0
        ? '（暂无已有主题，自己起一个 2~6 字的主题名）'
        : `已有主题（能对应就沿用，对应不上再自己起 2~6 字的新名）：${topics.join('、')}`;
    const prompt = [
        '你在做资料归档。把下面这份资料压成结构化条目，供以后按需检索。',
        '',
        '要求：',
        `1. summary：≤300 字，说清这份资料在解决什么问题、核心结论是什么。不要客套，不要复述标题。`,
        `2. points：${maxPoints} 条以内的可复用结论，每条 1~2 句。要求脱离原文也成立，不要出现「本文」「作者」这类指代。`,
        '3. topic：一个 2~6 字的主题名。',
        '',
        topicLine,
        '',
        '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
        '{"summary":"...","points":["...","..."],"topic":"..."}',
        '',
        '资料标题：' + input.title,
        '资料正文：',
        excerpt.text,
    ].join('\n');
    return { prompt, truncated: excerpt.truncated };
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter((item) => item.length > 0);
}
/**
 * 解析模型输出。宽容到"能从一堆废话里抠出 JSON"，但不猜内容：
 * 解析不出来就把原文塞进 error，调用方落成 failed，用户可重试。
 */
export function parseSourceNote(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start)
        throw new Error('模型没有输出 JSON：' + raw.slice(0, 120).replace(/\s+/g, ' '));
    let parsed;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    }
    catch {
        throw new Error('模型输出的 JSON 解析失败：' + raw.slice(start, start + 160).replace(/\s+/g, ' '));
    }
    if (parsed === null || typeof parsed !== 'object')
        throw new Error('模型输出的 JSON 不是对象');
    const record = parsed;
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    const points = asStringArray(record.points);
    const topic = typeof record.topic === 'string' && record.topic.trim().length > 0 ? record.topic.trim().slice(0, 12) : undefined;
    if (summary.length === 0)
        throw new Error('模型没有给出 summary');
    if (points.length === 0)
        throw new Error('模型没有给出 points');
    return { summary: summary.slice(0, 400), points: points.slice(0, 8), ...(topic === undefined ? {} : { topic }) };
}
/**
 * 模型不可用时的兜底：从原文里抽前几句当摘要，状态标 failed 让用户知道不是真提炼。
 * 有总比"什么都没有"强——检索块已经可用，摘要只是锦上添花。
 */
export function fallbackNote(input) {
    const clean = input.text.replace(/\s+/g, ' ').trim();
    return {
        sourceId: input.sourceId,
        at: input.at,
        status: 'failed',
        title: input.title,
        summary: clean.slice(0, 200),
        points: [],
        error: input.error,
    };
}
