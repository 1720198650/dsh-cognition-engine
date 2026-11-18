/**
 * src/deepresearch.ts — 「深研」：像子代理调研那样学，而不是把一篇资料压成摘要。
 *
 * 区别（用户 2026-11-18 指出，我认）：
 *   快学 = 拿一篇资料压成 3~6 条结论，不核对，产出物是"事实条目"。
 *   深研 = 带着一个问题去查 → 多源 → **交叉核对** → 产出带出处、带反例、带边界的知识条目。
 *
 * 本文件只放确定性部分：结论归一化、跨源归并、交叉核对、提示词与解析。
 * 检索、抓取、模型调用在 index.ts 里。
 */

/** 结论归一化后的比较键：去标点、去空白、小写。 */
export function conclusionKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** bigram 集合，用来判断两条结论是不是"同一件事的不同说法"。 */
function bigrams(text: string): Set<string> {
  const clean = conclusionKey(text);
  const out = new Set<string>();
  for (let i = 0; i + 1 < clean.length; i += 1) out.add(clean.slice(i, i + 2));
  return out;
}

/** 两条结论的相似度（bigram 覆盖率，取较小者方向，避免长句压短句）。 */
export function conclusionSimilarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const gram of ga) if (gb.has(gram)) hit += 1;
  return hit / Math.min(ga.size, gb.size);
}

export interface Claim {
  /** 结论（可改写） */
  conclusion: string;
  /** 支撑它的原文引文（逐字） */
  quote: string;
  /** 哪个来源（sourceId 或 URL） */
  source: string;
}

export interface Cluster {
  /** 归一化后的簇代表（最长的那条结论） */
  conclusion: string;
  /** 支持它的独立来源（去重后） */
  sources: string[];
  /** 每条来源的引文 */
  quotes: string[];
  /** ≥2 个独立来源 = 可交叉核对通过 */
  verified: boolean;
  /** 反例/边界（模型给出则合并） */
  counter?: string;
  boundary?: string;
}

/**
 * 跨源归并：把"同一件事的不同说法"合成一簇，再看有几个独立来源。
 *
 * 硬规则（这是"深研"和"快学"的分界线）：**只有 1 个来源的结论标 verified=false**。
 * 宁可少留，也不要让单篇资料的话冒充"多源印证过的知识"。
 */
export function crossCheck(claims: readonly Claim[], similarityThreshold = 0.6): Cluster[] {
  const clusters: Cluster[] = [];
  for (const claim of claims) {
    const hit = clusters.find((cluster) => conclusionSimilarity(cluster.conclusion, claim.conclusion) >= similarityThreshold);
    if (hit === undefined) {
      clusters.push({ conclusion: claim.conclusion, sources: [claim.source], quotes: [claim.quote], verified: false });
      continue;
    }
    if (!hit.sources.includes(claim.source)) hit.sources.push(claim.source);
    if (claim.quote.length > 0 && !hit.quotes.includes(claim.quote)) hit.quotes.push(claim.quote);
    // 结论取更长的那个：信息量更大，且避免被短句覆盖
    if (claim.conclusion.length > hit.conclusion.length) hit.conclusion = claim.conclusion;
    if (hit.sources.length >= 2) hit.verified = true;
  }
  return clusters.sort((a, b) => Number(b.verified) - Number(a.verified) || b.sources.length - a.sources.length);
}

/** 深研提示词：要结论、要逐字引文、要反例。 */
export function buildDeepClaimPrompt(input: { question: string; title: string; text: string; maxClaims?: number }): string {
  const maxClaims = Math.max(1, input.maxClaims ?? 4);
  return [
    '你在为一篇资料做事实抽取。用户的问题是：' + input.question,
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"claims":[{"conclusion":"一句可复用结论","quote":"原文里逐字照抄的一句支撑句"}]}',
    '',
    '要求：',
    `- claims 最多 ${maxClaims} 条；只要**直接回答问题**的结论，不要复述背景。`,
    '- quote 必须从下面正文里**逐字照抄**至少 12 个字；抄不出原句的结论不要写。',
    '- 资料没讲到这个问题的任何一面，就输出 {"claims":[]}，不要编。',
    '',
    '资料标题：' + input.title,
    '正文：',
    input.text
  ].join('\n');
}

/** 解析模型输出（宽容到能从废话里抠 JSON，但不猜内容）。 */
export function parseDeepClaims(raw: string): Array<{ conclusion: string; quote: string }> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (!Array.isArray(parsed.claims)) return [];
    const out: Array<{ conclusion: string; quote: string }> = [];
    for (const item of parsed.claims) {
      if (item === null || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const conclusion = typeof row.conclusion === 'string' ? row.conclusion.replace(/\s+/g, ' ').trim() : '';
      const quote = typeof row.quote === 'string' ? row.quote.replace(/\s+/g, ' ').trim() : '';
      if (conclusion.length >= 8 && quote.length >= 12) out.push({ conclusion, quote });
    }
    return out;
  } catch {
    return [];
  }
}

export interface ResearchRecord {
  id: string;
  at: number;
  question: string;
  /** 每个来源抓了多少字、抽了几条 */
  sources: Array<{ sourceId: string; url: string; chars: number; claims: number }>;
  /** 交叉核对后的答案簇（逐源作答再归并） */
  clusters: AnswerCluster[];
  /** 交叉核对通过的条数 / 总条数 */
  verified: number;
  total: number;
  failures: Array<{ url: string; reason: string }>;
  /** 结论状态：verified / divergent（互斥）/ insufficient_sources（来源太少）/ no_agreement（无人一致） */
  status?: ResearchStatus;
  /** claim 表（每条挂 support 与出处） */
  claims?: ClaimRow[];
}

/** 一个来源对"同一个问题"的回答（逐源作答，才能横向比）。 */
export interface AnswerRecord {
  source: string;
  /** 直接回答问题的句子（≤200 字） */
  answer: string;
  /** 支撑这句回答的逐字引文 */
  quote: string;
  /** 这个来源到底有没有回答问题 */
  relevant: boolean;
}

export interface AnswerCluster {
  answer: string;
  sources: string[];
  quotes: string[];
  /** 有几个独立来源给出同一个回答 */
  agreement: number;
  /** 几个来源里有一致的 / 总共给出回答的 */
  ratio: number;
  verified: boolean;
}

/**
 * 「同一个问题逐源作答 → 比答案」的提示词。
 *
 * 这是重做的核心：旧版让每篇各抽各的结论，不同网页讲不同侧面，永远凑不出同义结论
 * （实测 5 篇 13 条 0 条通过）。改成对**同一个问题**作答，答案才有可比性。
 */
export function buildAnswerPrompt(input: { question: string; title: string; text: string }): string {
  return [
    '你在读一篇资料，用户的问题是：' + input.question,
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
    '{"relevant":true,"answer":"用一句话直接回答上面的问题","quote":"原文里逐字照抄、能支撑这句回答的一段"}',
    '',
    '要求：',
    '- answer ≤120 字，必须是**对问题的回答**，不是资料摘要、不是背景介绍。',
    '- quote 必须逐字照抄至少 12 个字，且真的支持 answer。',
    '- 如果这篇资料压根没回答这个问题，输出 {"relevant":false,"answer":"","quote":""}。',
    '',
    '资料标题：' + input.title,
    '正文：',
    input.text
  ].join('\n');
}

/** 解析逐源作答输出。 */
export function parseAnswer(raw: string): AnswerRecord {
  const empty: AnswerRecord = { source: '', answer: '', quote: '', relevant: false };
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return empty;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const answer = typeof parsed.answer === 'string' ? parsed.answer.replace(/\s+/g, ' ').trim() : '';
    const quote = typeof parsed.quote === 'string' ? parsed.quote.replace(/\s+/g, ' ').trim() : '';
    const relevant = parsed.relevant !== false && answer.length >= 6 && quote.length >= 12;
    return { source: '', answer, quote, relevant };
  } catch {
    return empty;
  }
}

/**
 * 答案归并：把表达同一结论的答案合成一簇。
 *
 * 判定分两档（依据 docs/l4-deepresearch.md）：
 *   - 便宜档：字符级 token-F1 + 数字/否定词硬规则；
 *     ≥0.55 判同一，0.40~0.55 灰区（交给上层用一次 LLM 三分类），<0.40 判不同。
 *   - 阈值是初值，要用 30~50 对人工标注扫描后标定；这里先不假装它准。
 * 硬规则不变：只有 1 个独立来源的答案 verified=false。
 */
export const SAME_THRESHOLD = 0.55;
export const GREY_THRESHOLD = 0.4;

/** 字符级 token-F1（中文按字、英文按词）。 */
export function tokenF1(a: string, b: string): number {
  const tokens = (text: string): string[] => {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const chars = [...conclusionKey(text)];
    return words.length > 0 ? [...words, ...chars] : chars;
  };
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const countB = new Map<string, number>();
  for (const token of tb) countB.set(token, (countB.get(token) ?? 0) + 1);
  let common = 0;
  for (const token of ta) {
    const left = countB.get(token) ?? 0;
    if (left > 0) {
      common += 1;
      countB.set(token, left - 1);
    }
  }
  const precision = common / ta.length;
  const recall = common / tb.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/** 抽数字（含百分数、小数），用来发现"数值互相矛盾"。 */
export function digitsOf(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?%?/g) ?? [];
}

/**
 * 只认"禁止/不许"这类**极性词**，不认裸「不」字。
 *
 * 第一版把裸「不」当否定：`其余保留` vs `其他保留不动` 被误判成"一方否定"，
 * 0.79 的 F1 硬被判成不同（2026-11-18 实测）。中文里「不动」「不变」是词内否定，不是判断否定。
 */
const PROHIBITIONS = /(不要|不能|禁止|不得|别再|不许|never|must not|cannot|don't)/i;

export type PairVerdict = 'same' | 'grey' | 'different';

/**
 * 两条答案的关系判定。
 *
 * 数字冲突、否定相反 → 直接判 different（这类分歧不该被相似度抹平）；
 * 其余按 token-F1 分三档。
 */
export function judgeAnswerPair(a: string, b: string): { verdict: PairVerdict; f1: number; reason: string } {
  const f1 = tokenF1(a, b);
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (da.length > 0 && db.length > 0) {
    const sameDigits = da.some((value) => db.includes(value));
    if (!sameDigits) return { verdict: 'different', f1, reason: '数值不一致（' + da.join(',') + ' vs ' + db.join(',') + '）' };
  }
  const negA = PROHIBITIONS.test(a);
  const negB = PROHIBITIONS.test(b);
  if (negA !== negB && f1 >= GREY_THRESHOLD) {
    return { verdict: 'different', f1, reason: '一方带否定、另一方不带，不敢判同一' };
  }
  if (f1 >= SAME_THRESHOLD) return { verdict: 'same', f1, reason: 'token-F1 ' + f1.toFixed(2) };
  if (f1 >= GREY_THRESHOLD) return { verdict: 'grey', f1, reason: 'token-F1 ' + f1.toFixed(2) + '（灰区，需二次判定）' };
  return { verdict: 'different', f1, reason: 'token-F1 ' + f1.toFixed(2) };
}

export function crossCheckAnswers(answers: readonly AnswerRecord[], threshold = SAME_THRESHOLD): AnswerCluster[] {
  return mergeAnswers(answers, threshold).clusters;
}

/** 归并结果连同"灰区待判"的配对一起返回，供上层做一次 LLM 三分类。 */
export function mergeAnswers(
  answers: readonly AnswerRecord[],
  threshold = SAME_THRESHOLD,
): { clusters: AnswerCluster[]; greyPairs: Array<{ a: string; b: string; fa: number; fb: number }> } {
  const usable = answers.filter((item) => item.relevant && item.answer.length > 0 && item.quote.length >= 12);
  const totalAnswered = usable.length;
  const clusters: AnswerCluster[] = [];
  const greyPairs: Array<{ a: string; b: string; fa: number; fb: number }> = [];
  for (const item of usable) {
    let hit: AnswerCluster | undefined;
    for (const cluster of clusters) {
      const verdict = judgeAnswerPair(cluster.answer, item.answer);
      if (verdict.verdict === 'same' || (verdict.verdict === 'grey' && threshold < SAME_THRESHOLD)) {
        hit = cluster;
        break;
      }
      if (verdict.verdict === 'grey' && greyPairs.length < 7) greyPairs.push({ a: cluster.answer, b: item.answer, fa: -1, fb: -1 });
    }
    if (hit === undefined) {
      clusters.push({ answer: item.answer, sources: [item.source], quotes: [item.quote], agreement: 1, ratio: 0, verified: false });
      continue;
    }
    if (!hit.sources.includes(item.source)) hit.sources.push(item.source);
    if (!hit.quotes.includes(item.quote)) hit.quotes.push(item.quote);
    if (item.answer.length > hit.answer.length) hit.answer = item.answer;
    hit.agreement = hit.sources.length;
    if (hit.agreement >= 2) hit.verified = true;
  }
  for (const cluster of clusters) cluster.ratio = totalAnswered === 0 ? 0 : cluster.agreement / totalAnswered;
  clusters.sort((a, b) => Number(b.verified) - Number(a.verified) || b.agreement - a.agreement);
  return { clusters, greyPairs };
}

/** 灰区三分类提示词：一次判多对，控制调用次数。 */
export function buildTriagePrompt(pairs: ReadonlyArray<{ a: string; b: string }>): string {
  return [
    '判断下面每一对回答说的是不是同一件事。只输出 JSON，不要解释：',
    '{"verdicts":["same","different","contradict"]}',
    '',
    '三档含义：same = 同一结论的不同说法；different = 讲的是不同的事；contradict = 同一件事但互相矛盾（例如数值不同、一正一反）。',
    '条数必须与输入一致，顺序对应。',
    '',
    ...pairs.map((pair, index) => `[${index + 1}] A: ${pair.a}\n    B: ${pair.b}`)
  ].join('\n');
}

/** 解析三分类；解析不出来就全判 different（保守：不合并）。 */
export function parseTriage(raw: string, expected: number): Array<'same' | 'different' | 'contradict'> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return Array.from({ length: expected }, () => 'different' as const);
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const list = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
    const out: Array<'same' | 'different' | 'contradict'> = [];
    for (let i = 0; i < expected; i += 1) {
      const value = String(list[i] ?? 'different');
      out.push(value === 'same' ? 'same' : value === 'contradict' ? 'contradict' : 'different');
    }
    return out;
  } catch {
    return Array.from({ length: expected }, () => 'different' as const);
  }
}

export type ResearchStatus = 'verified' | 'divergent' | 'insufficient_sources' | 'no_agreement';

/**
 * 结论状态：只有"一致"才叫 verified，其余三种要分开报，不能都塞一句"未找到"。
 *
 * 文献（docs/l4-deepresearch.md）要求：检索失败、无人作答、无一致、来源互斥分开说。
 */
export function researchStatus(input: { verified: number; answeredSources: number; clusters: number; hasContradiction?: boolean }): ResearchStatus {
  if (input.verified > 0) return 'verified';
  if (input.answeredSources < 2) return 'insufficient_sources';
  if (input.hasContradiction === true) return 'divergent';
  return 'no_agreement';
}

export interface ClaimRow {
  claim: string;
  /** 断言级支撑：每条挂一个来源与可核对引文 */
  support: Array<{ source: string; quote: string }>;
  agreement: number;
  ratio: number;
  status: 'verified' | 'single_source' | 'contradicted';
}

/** 产出结构：claim 表，而不是一段长报告。 */
export function toClaimTable(clusters: readonly AnswerCluster[]): ClaimRow[] {
  return clusters.map((cluster) => ({
    claim: cluster.answer,
    support: cluster.sources.map((source, index) => ({ source, quote: cluster.quotes[index] ?? cluster.quotes[0] ?? '' })),
    agreement: cluster.agreement,
    ratio: cluster.ratio,
    status: cluster.verified ? 'verified' : cluster.sources.length > 1 ? 'contradicted' : 'single_source',
  }));
}
