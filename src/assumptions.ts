/**
 * src/assumptions.ts — 「假设台账」：抓住模型自己下的、用户还没确认的假设
 *
 * ## 为什么需要
 *
 * 依据：arXiv:2505.06120《LLMs Get Lost In Multi-Turn Conversation》——
 * 多轮比单轮平均掉 **39%**，掉的主要不是能力而是**可靠性**；
 * 机制是「模型早轮就自作假设并急于给最终解，然后过度依赖那个解；一旦走错就不回头」。
 *
 * 我们能做的最便宜的一件事：把模型自己下的假设**显式列出来**，下一轮摆在它面前，
 * 让它确认或撤回；用户说「不对」时直接清空。这不是让模型更聪明，是让它别在错的假设上越走越远。
 *
 * ## 边界
 *
 * - 纯内存、按会话隔离，不落盘（会话结束即消失，不会变成"记忆"污染长期存储）。
 * - 只记录**有歧义信号**的句子（"按…理解"/"我默认"/"应该是…"），不记录正常陈述。
 * - 最多 3 条，每条 80 字，避免自己变成新的上下文膨胀源。
 */

export interface Assumption {
  id: string;
  text: string;
  at: number;
}

/** 触发词：这些句式出现在助手话里，通常意味着它替用户做了决定。 */
const PATTERNS: RegExp[] = [
  /(?:按照?|依据|根据)[^，。；！？\n]{0,12}(?:理解|意思|惯例|习惯|要求)/,
  /我(?:先|就|暂时)?(?:假设|默认|理解为|当作|认为是)/,
  /(?:应该|想必|估计|大概)是[^，。；！？\n]{2,40}/,
  /(?:你可能|你大概|你的意思)(?:是|想|要)[^，。；！？\n]{2,40}/,
];

/** 明显不是假设的句子（自问自答、礼貌话），避免噪声。 */
const NEGATIVE = /^(?:好的|收到|明白|稍等|让我看看|我觉得可以)/;

const MAX_ITEMS = 3;
const MAX_CHARS = 80;
const MIN_CHARS = 8;

/**
 * 从一段助手输出里抽「假设句」。纯函数，便于测试。
 *
 * 返回去重后的片段（同一条假设在多段输出里重复出现只留一次）。
 */
export function extractAssumptions(text: string): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const out: string[] = [];
  // 按句子切：中文句号、问号、叹号、分号、换行
  const sentences = text.split(/[。！？；\n]+/);
  for (const raw of sentences) {
    const sentence = raw.trim().replace(/^[-*·\s]+/, '');
    if (sentence.length < MIN_CHARS) continue;
    if (NEGATIVE.test(sentence)) continue;
    if (!PATTERNS.some((pattern) => pattern.test(sentence))) continue;
    const clipped = sentence.length > MAX_CHARS ? `${sentence.slice(0, MAX_CHARS)}…` : sentence;
    if (!out.includes(clipped)) out.push(clipped);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** 按会话维护假设列表。纯内存。 */
export class AssumptionLedger {
  private readonly bySession = new Map<string, Assumption[]>();
  private seq = 0;

  /** 从一段助手输出里抽取并登记；返回新增条数。 */
  observe(sessionId: string, assistantText: string, now = Date.now()): number {
    const found = extractAssumptions(assistantText);
    if (found.length === 0) return 0;
    const list = this.bySession.get(sessionId) ?? [];
    let added = 0;
    for (const text of found) {
      if (list.some((item) => item.text === text)) continue;
      this.seq += 1;
      list.push({ id: `asm-${this.seq}`, text, at: now });
      added += 1;
    }
    // 只留最近的 MAX_ITEMS 条（旧的被新的挤掉，避免无限长）
    if (list.length > MAX_ITEMS) list.splice(0, list.length - MAX_ITEMS);
    if (list.length > 0) this.bySession.set(sessionId, list);
    return added;
  }

  list(sessionId: string): Assumption[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  count(sessionId: string): number {
    return this.bySession.get(sessionId)?.length ?? 0;
  }

  /** 用户明确纠正时调用：把台账清空（那些假设已被否掉）。 */
  clear(sessionId: string): number {
    const n = this.bySession.get(sessionId)?.length ?? 0;
    this.bySession.delete(sessionId);
    return n;
  }

  /** 渲染成注入段；空则返回空串（不占 token）。 */
  render(sessionId: string): string {
    const list = this.bySession.get(sessionId) ?? [];
    if (list.length === 0) return '';
    const lines = list.map((item, index) => `${index + 1}. ${item.text}`);
    return [
      '【本会话我尚未确认的假设】（如果哪条不对，直接说，我撤回并按你的来。）',
      ...lines,
    ].join('\n');
  }
}
