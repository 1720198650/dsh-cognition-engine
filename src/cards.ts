/**
 * src/cards.ts — dshGo 原生工具卡
 *
 * dshGo 的 App 里不执行 client.js，只渲染工具结果上的 `presentationMeta`。
 * 视图是纯 JSON 树，只能用固定组件（stack / metric / text）。
 * 构造失败或超限时返回空对象，dshGo 会自动退回普通结果——绝不影响模型。
 */

export interface CardNode {
  type: string;
  [key: string]: unknown;
}

const MAX_BYTES = 8 * 1024;

function clampText(value: unknown, limit: number): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 从工具返回值里尽力解析出对象；不是 JSON 就返回 null。 */
function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function metric(label: string, value: unknown): CardNode {
  return { type: 'metric', label, value: num(value) };
}

function muted(text: string, limit = 400): CardNode {
  return { type: 'text', text: clampText(text, limit), tone: 'muted' };
}

/** cognition_state：记忆 / 主题 / 待办 三个指标 + 跨会话摘要。 */
function stateCard(data: Record<string, unknown>): CardNode | null {
  const memory = data.memory as Record<string, unknown> | undefined;
  const topics = data.topics as Record<string, unknown> | undefined;
  const tasks = data.tasks as Record<string, unknown> | undefined;
  if (memory === undefined || topics === undefined) return null;
  const children: CardNode[] = [
    metric('记忆', memory.total),
    metric('当前有效', memory.current),
    metric('主题', topics.total),
    metric('待办', tasks?.pending),
  ];
  const digest = data.digest;
  if (typeof digest === 'string' && digest.length > 0) {
    children.push(muted(digest));
  }
  return { type: 'stack', title: '认知引擎状态', children };
}

/** cognition_recall：命中列表。 */
function recallCard(data: Record<string, unknown>): CardNode | null {
  const hits = data.hits;
  if (!Array.isArray(hits)) return null;
  const children: CardNode[] = [metric('命中', hits.length)];
  for (const hit of hits.slice(0, 5)) {
    const row = hit as { content?: unknown; subject?: unknown };
    children.push({
      type: 'text',
      text: `${clampText(row.subject ?? '', 20)}：${clampText(row.content ?? '', 120)}`,
    });
  }
  if (Array.isArray(data.related) && data.related.length > 0) {
    children.push(muted(`另有 ${data.related.length} 条同主题记忆`));
  }
  return { type: 'stack', title: '记忆召回', children };
}

/** cognition_context：跨会话摘要。 */
function contextCard(data: Record<string, unknown>): CardNode | null {
  const digest = data.digest;
  if (typeof digest !== 'string') return null;
  return {
    type: 'stack',
    title: '跨会话记忆',
    children: digest.length === 0 ? [muted('还没有可继承的记忆')] : [muted(digest, 600)],
  };
}

/** cognition_remember：写入确认。 */
function rememberCard(data: Record<string, unknown>): CardNode | null {
  const stored = data.stored as Record<string, unknown> | undefined;
  if (stored === undefined) return null;
  const children: CardNode[] = [
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
export function buildCard(value: unknown): Record<string, unknown> {
  try {
    const data = asObject(value);
    if (data === null) return {};
    const card =
      stateCard(data) ?? recallCard(data) ?? contextCard(data) ?? rememberCard(data) ?? null;
    if (card === null) return {};
    const payload = { 'dsh-go/view': card };
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BYTES) return {};
    return payload;
  } catch {
    return {};
  }
}
