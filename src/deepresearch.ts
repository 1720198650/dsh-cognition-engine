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
  clusters: Cluster[];
  /** 交叉核对通过的条数 / 总条数 */
  verified: number;
  total: number;
  failures: Array<{ url: string; reason: string }>;
}
