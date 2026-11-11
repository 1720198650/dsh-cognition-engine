/**
 * src/sediment_judge.ts — 语义判定层（M1）
 *
 * 为什么单独一个文件：判定是**语义**问题，状态转移是**确定性**问题，
 * 两者混在一起就没法分别测。这里只做三件纯函数的事：
 *   1. 拼判定提示词（只给两段原文 + 主题 + 理由，不给结论）
 *   2. 解析模型返回（严格 JSON，容错抽第一个花括号块）
 *   3. 校验（类别合法、置信度夹到 0..1、证据截断）
 *
 * 依据：docs/m0-findings.md —— 真实语料上规则召回 0/3，语义判定必须交给模型；
 * 但模型判定必须**冻结进事件**（重放不重算），否则哈希链会断。
 */
import type { SedimentClass, SedimentJudge } from './sediment.ts';

export const SEDIMENT_CLASSES: readonly SedimentClass[] = [
  'reversal',
  'narrowing',
  'reframe',
  'extension',
  'supplement',
];

const MAX_EVIDENCE = 120;

export interface JudgePromptInput {
  subject: string;
  oldText: string;
  newText: string;
  reason?: string;
}

/**
 * 判定提示词。
 *
 * 刻意要求「引用原文片段」：没有证据的判定无法复核，
 * 而复核是这套东西唯一的价值所在。
 */
export function buildJudgePrompt(input: JudgePromptInput): string {
  return [
    '你在做一件很窄的事：判断「新的说法」相对「旧的说法」是什么关系。只看这两段文字，不要联想。',
    '',
    `主题：${input.subject}`,
    `旧说法：${input.oldText}`,
    `新说法：${input.newText}`,
    ...(input.reason === undefined || input.reason.trim() === ''
      ? []
      : [`取代理由（人写的，可能为空或不准确）：${input.reason}`]),
    '',
    '从下面五类里选一类：',
    '- reversal：新说法否定了旧说法（例：旧"用 SQLite" → 新"不引入 SQLite"）',
    '- narrowing：旧说法被加上限定，范围变窄（例：加"仅限"、"必须"、"只用于"）',
    '- reframe：整段被重写，结论未必翻转，但旧表述不再单独成立',
    '- extension：旧说法被加内容但没被否定（例：四步变六步，前四步还在）',
    '- supplement：只是补了无关细节，旧说法照旧成立',
    '',
    '只输出一个 JSON 对象，不要解释，不要代码块：',
    '{"class":"五类之一","confidence":0到1的小数,',
    ' "evidenceFrom":"旧说法里最能说明关系的一段原文（不超过60字）",',
    ' "evidenceTo":"新说法里最能说明关系的一段原文（不超过60字）"}',
    '',
    'confidence 表示你对这个类别的确定程度，不是"这段文字有多重要"。判不准就给 0.4~0.55。',
  ].join('\n');
}

function isClass(value: unknown): value is SedimentClass {
  return typeof value === 'string' && (SEDIMENT_CLASSES as readonly string[]).includes(value);
}

function clip(text: string, limit = MAX_EVIDENCE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * 解析模型返回。**容错但严格**：
 * - 允许外面包代码块或多余文字，只抽第一个 {...} 块
 * - 类别不合法 / 置信度不是数 → 返回 null（调用方按 fail-closed 处理）
 * - 证据缺失 → 用原文兜底并降置信（证据不全的判定不该有高置信）
 */
export function parseJudgeResponse(raw: string, model: string, fallback: JudgePromptInput): SedimentJudge | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isClass(parsed.class)) return null;
  const confidenceRaw = Number(parsed.confidence);
  if (!Number.isFinite(confidenceRaw)) return null;
  let confidence = Math.min(1, Math.max(0, confidenceRaw));
  const evidenceFrom = typeof parsed.evidenceFrom === 'string' ? clip(parsed.evidenceFrom) : '';
  const evidenceTo = typeof parsed.evidenceTo === 'string' ? clip(parsed.evidenceTo) : '';
  if (evidenceFrom.length === 0 || evidenceTo.length === 0) confidence = Math.min(confidence, 0.5);
  return {
    class: parsed.class,
    confidence: Number(confidence.toFixed(3)),
    evidenceFrom: evidenceFrom.length > 0 ? evidenceFrom : clip(fallback.oldText),
    evidenceTo: evidenceTo.length > 0 ? evidenceTo : clip(fallback.newText),
    model,
  };
}
