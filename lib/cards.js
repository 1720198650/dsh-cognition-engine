/**
 * src/cards.ts — dshGo 原生工具卡
 *
 * dshGo 的 App 里不执行 client.js，只渲染工具结果上的 `presentationMeta`。
 * 视图是纯 JSON 树，只能用固定组件（stack / metric / text）。
 * 构造失败或超限时返回空对象，dshGo 会自动退回普通结果——绝不影响模型。
 */
const MAX_BYTES = 8 * 1024;
function clampText(value, limit) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
/** 从工具返回值里尽力解析出对象；不是 JSON 就返回 null。 */
function asObject(value) {
    if (typeof value === 'object' && value !== null)
        return value;
    if (typeof value !== 'string')
        return null;
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const parsed = JSON.parse(value.slice(start, end + 1));
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    }
    catch {
        return null;
    }
}
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function metric(label, value) {
    return { type: 'metric', label, value: num(value) };
}
function muted(text, limit = 400) {
    return { type: 'text', text: clampText(text, limit), tone: 'muted' };
}
/** cognition_state：记忆 / 图式 / 待办 三个指标 + 跨会话摘要。 */
function stateCard(data) {
    const memory = data.memory;
    const graph = data.graph;
    const tasks = data.tasks;
    if (memory === undefined || graph === undefined)
        return null;
    const children = [
        metric('记忆', memory.total),
        metric('当前有效', memory.current),
        metric('图式', graph.schemas),
        metric('待办', tasks?.pending),
    ];
    const digest = data.digest;
    if (typeof digest === 'string' && digest.length > 0) {
        children.push(muted(digest));
    }
    return { type: 'stack', title: '认知引擎状态', children };
}
/** cognition_recall：命中列表。 */
function recallCard(data) {
    const hits = data.hits;
    if (!Array.isArray(hits))
        return null;
    const children = [metric('命中', hits.length)];
    for (const hit of hits.slice(0, 5)) {
        const row = hit;
        children.push({
            type: 'text',
            text: `${clampText(row.subject ?? '', 20)}：${clampText(row.content ?? '', 120)}`,
        });
    }
    if (Array.isArray(data.related) && data.related.length > 0) {
        children.push(muted(`另有 ${data.related.length} 条图式关联`));
    }
    return { type: 'stack', title: '记忆召回', children };
}
/** cognition_context：跨会话摘要。 */
function contextCard(data) {
    const digest = data.digest;
    if (typeof digest !== 'string')
        return null;
    return {
        type: 'stack',
        title: '跨会话记忆',
        children: digest.length === 0 ? [muted('还没有可继承的记忆')] : [muted(digest, 600)],
    };
}
/** cognition_remember：写入确认。 */
function rememberCard(data) {
    const stored = data.stored;
    if (stored === undefined)
        return null;
    const children = [
        { type: 'text', text: `已写入 ${clampText(stored.id ?? '', 24)}` },
    ];
    const conflicts = data.conflicts;
    if (Array.isArray(conflicts) && conflicts.length > 0) {
        children.push(muted(`注意：与 ${conflicts.length} 条旧事实冲突`));
    }
    return { type: 'stack', title: '写入记忆', children };
}
/**
 * 统一入口：按返回值形状挑卡片。
 * 认不出来就返回空对象——dshGo 会退回普通工具结果。
 */
export function buildCard(value) {
    try {
        const data = asObject(value);
        if (data === null)
            return {};
        const card = stateCard(data) ?? recallCard(data) ?? contextCard(data) ?? rememberCard(data) ?? null;
        if (card === null)
            return {};
        const payload = { 'dsh-go/view': card };
        if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BYTES)
            return {};
        return payload;
    }
    catch {
        return {};
    }
}
