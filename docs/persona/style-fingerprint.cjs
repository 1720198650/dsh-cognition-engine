/**
 * 零依赖中文风格指纹（Node.js >= 18，无第三方包）
 *
 * 用法：
 *   const fp = extractStyle(messagesOrText);       // 单条或多条消息
 *   const sim = styleSimilarity(fpA, fpB);         // 0..1
 *   const d   = styleDistance(fpA, fpB);           // 0..∞（越小越像）
 *
 * 设计要点：
 *   1. 所有频次类指标都按“每千个可计字符”归一，长度不影响；
 *   2. 句长类指标要求至少 8 句，否则 confidence 标记为低；
 *   3. 先剥离代码块、URL、Markdown 标记，避免技术内容污染文风；
 *   4. 不依赖分词：中文字符级统计 + 词表命中，零依赖可运行。
 */

'use strict';

// ---------- 词表（可按用户/场景扩展） ----------
const TONE_PARTICLES = ['吧', '呢', '啊', '嘛', '呀', '啦', '哦', '呗', '哈', '嘿', '唉', '哎', '咦', '噢', '喔', '嗯', '哼', '咯', '喽', '呦'];
const FINAL_TONE = ['吧', '呢', '啊', '嘛', '呀', '啦', '哦', '呗', '哈'];
const FIRST_PERSON = ['我们', '咱们', '我', '咱'];
const SECOND_PERSON = ['你们', '你', '您'];
const FORMAL_CONNECTIVES = ['因此', '此外', '然而', '综上', '基于', '旨在', '以及', '并且', '从而', '鉴于', '由此可见', '与此同时'];
const CASUAL_WORDS = ['搞定', '咋', '啥', '凑合', '差不多', '拉倒', '挺好', '超级', '贼好', '贼快', '整一个', '弄一下'];
const SLANG_WORDS = ['绝了', '好家伙', '笑死', '离谱', '绷不住', '牛', '666', 'emmm', 'awsl', '栓Q', 'yyds', '破防', '真香', '无语', '服了', '可以的'];
const HEDGE_WORDS = ['可能', '也许', '大概', '应该', '似乎', '感觉', '或许', '不一定', '看情况', '估计'];

// ---------- 基础工具 ----------
const RE_CODE_FENCE = /```[\s\S]*?```/g;
const RE_INLINE_CODE = /`[^`\n]*`/g;
const RE_URL = /https?:\/\/[^\s)）\]】]+/g;
const RE_MD_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const RE_MD_MARKS = /[*_~#>|]/g;
const RE_SENT_SPLIT = /[。！？!?]+|…+|\.{3,}|\n+/;
const RE_CHAR = /[\p{L}\p{N}]/u;
const RE_HAN = /\p{Script=Han}/u;
const RE_EMOJI = /\p{Extended_Pictographic}/gu;
const RE_REDUP = /([\u4e00-\u9fff])\1{1,2}/g;
const RE_ERHUA = /([\u4e00-\u9fff])儿/g;

function normalizeProse(text) {
  return String(text ?? '')
    .replace(RE_CODE_FENCE, ' ')
    .replace(RE_INLINE_CODE, ' ')
    .replace(RE_MD_LINK, '$1')
    .replace(RE_URL, ' ')
    .replace(RE_MD_MARKS, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function chars(text) {
  return Array.from(text).filter((ch) => RE_CHAR.test(ch));
}

function countChars(text) {
  return chars(text).length;
}

/** 最长优先匹配，避免“我们”同时命中“我”。 */
function countTerms(text, terms) {
  let rest = text;
  let count = 0;
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const parts = rest.split(term);
    count += parts.length - 1;
    rest = parts.join('\u0000');
  }
  return count;
}

function splitSentences(text) {
  return text
    .split(RE_SENT_SPLIT)
    .map((s) => s.trim())
    .filter((s) => countChars(s) > 0);
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function median(xs) {
  if (!xs.length) return 0;
  const arr = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/** 滑动窗口 TTR（MATTR），窗口默认 100 字，步长 20。 */
function mattr(text, windowSize = 100) {
  const arr = chars(text);
  if (arr.length === 0) return 0;
  if (arr.length <= windowSize) return new Set(arr).size / arr.length;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + windowSize <= arr.length; i += 20) {
    const slice = arr.slice(i, i + windowSize);
    sum += new Set(slice).size / windowSize;
    n += 1;
  }
  return n ? sum / n : 0;
}

// ---------- 核心：提取风格指纹 ----------
function extractStyle(input, options = {}) {
  const messages = Array.isArray(input) ? input : [input];
  const raw = messages.join('\n');
  const text = normalizeProse(raw);
  const arr = chars(text);
  const nChars = arr.length;
  const sents = splitSentences(text);
  const sentLens = sents.map(countChars);
  const nSent = sents.length;
  const perK = (count) => (nChars ? (count * 1000) / nChars : 0);
  const per100 = (count) => (nChars ? (count * 100) / nChars : 0);

  const meanSentLen = mean(sentLens);
  const stdSentLen = std(sentLens);
  const toneCount = countTerms(text, TONE_PARTICLES);
  const finalToneCount = sents.filter((s) => FINAL_TONE.includes(Array.from(s).at(-1))).length;
  const punctCount = Array.from(text).filter((ch) =>
    /[，。！？、；：,.!?;:…—～~"'“”‘’（）()《》【】]/.test(ch)
  ).length;
  const commaCount = (text.match(/[，,、]/g) || []).length;
  const ellipsisCount = (text.match(/…+|\.{3,}/g) || []).length;
  const exclaimCount = (text.match(/[！!]/g) || []).length;
  const questionCount = sents.filter((s) => /[?？]$/.test(s)).length;
  const emojiCount = (text.match(RE_EMOJI) || []).length;
  const emojiSet = new Set(text.match(RE_EMOJI) || []);
  const redupCount = (text.match(RE_REDUP) || []).length;
  const erhuaCount = (text.match(RE_ERHUA) || []).filter((m) => {
    const prev = m[0];
    return !['女', '婴', '孤', '幼', '胎', '少', '男'].includes(prev);
  }).length;
  const msgLens = messages.map((m) => countChars(normalizeProse(m)));

  const fp = {
    // 元信息（不参与距离）
    nChars,
    nSent,
    nMsg: messages.length,
    confidence: Math.max(0, Math.min(1, Math.min(nChars / 300, nSent / 8))),

    // 句长与节奏
    meanSentLen,
    sentLenStd: stdSentLen,
    sentLenCv: meanSentLen ? stdSentLen / meanSentLen : 0,
    shortRatio: nSent ? sentLens.filter((n) => n <= 8).length / nSent : 0,
    longRatio: nSent ? sentLens.filter((n) => n >= 30).length / nSent : 0,
    msgLenMedian: median(msgLens),
    clauseLen: sents.length ? mean(sents.map((s) => {
      const clauses = s.split(/[，,、；;]/).map((c) => countChars(c)).filter((n) => n > 0);
      return clauses.length ? mean(clauses) : countChars(s);
    })) : 0,

    // 语气与用词
    tonePerK: perK(toneCount),
    finalToneRatio: nSent ? finalToneCount / nSent : 0,
    firstPersonPerK: perK(countTerms(text, FIRST_PERSON)),
    secondPersonPerK: perK(countTerms(text, SECOND_PERSON)),
    formalConnPerK: perK(countTerms(text, FORMAL_CONNECTIVES)),
    casualWordPerK: perK(countTerms(text, CASUAL_WORDS)),
    slangPerK: perK(countTerms(text, SLANG_WORDS)),
    hedgePerK: perK(countTerms(text, HEDGE_WORDS)),
    catchphrasePerK: perK(countTerms(text, options.catchphrases || [])),

    // 标点
    punctPer100: per100(punctCount),
    commaPerSent: nSent ? commaCount / nSent : 0,
    ellipsisPerK: perK(ellipsisCount),
    exclaimPerK: perK(exclaimCount),
    questionRatio: nSent ? questionCount / nSent : 0,

    // 表情与形态
    emojiPerK: perK(emojiCount),
    emojiDiversity: emojiCount ? emojiSet.size / emojiCount : 0,
    redupPerK: perK(redupCount),
    erhuaPerK: perK(erhuaCount),
    mattr100: mattr(text),
  };
  return fp;
}

// ---------- 距离与相似度 ----------
// SCALE：每个指标的“可容忍日常波动”（约等于同一人不同天的 1 个标准差经验值）
const SCALE = {
  meanSentLen: 8,
  sentLenCv: 0.25,
  shortRatio: 0.15,
  longRatio: 0.12,
  clauseLen: 6,
  msgLenMedian: 20,
  tonePerK: 15,
  finalToneRatio: 0.12,
  firstPersonPerK: 10,
  secondPersonPerK: 10,
  formalConnPerK: 6,
  casualWordPerK: 10,
  slangPerK: 8,
  hedgePerK: 8,
  catchphrasePerK: 15,
  punctPer100: 4,
  commaPerSent: 0.5,
  ellipsisPerK: 6,
  exclaimPerK: 6,
  questionRatio: 0.1,
  emojiPerK: 20,
  emojiDiversity: 0.3,
  redupPerK: 10,
  erhuaPerK: 5,
  mattr100: 0.08,
};

// 权重：越稳定、越难伪装的指标权重越高；易受平台/输入法/话题影响的权重低。
const WEIGHT = {
  meanSentLen: 1.0,
  sentLenCv: 1.0,
  shortRatio: 0.8,
  longRatio: 0.8,
  clauseLen: 0.6,
  msgLenMedian: 0.4,
  tonePerK: 1.2,
  finalToneRatio: 1.0,
  firstPersonPerK: 0.5, // 话题影响大，降低权重
  secondPersonPerK: 0.4,
  formalConnPerK: 0.9,
  casualWordPerK: 0.8,
  slangPerK: 0.6,
  hedgePerK: 0.6,
  catchphrasePerK: 0.8,
  punctPer100: 0.7,
  commaPerSent: 0.6,
  ellipsisPerK: 0.5,
  exclaimPerK: 0.5,
  questionRatio: 0.6,
  emojiPerK: 0.4,
  emojiDiversity: 0.2,
  redupPerK: 0.8,
  erhuaPerK: 0.3,
  mattr100: 0.6,
};

/** 可容忍上限：约 3 个“日常波动”。超过就按 1 计，避免单个维度支配结果。 */
const SPAN_FACTOR = 3;

/**
 * 有界加权距离：0 = 完全一样，1 = 每个维度都超出容忍上限。
 * 相比欧氏距离，单个异常维度（如某次突然用了很多 emoji）不会淹没其他维度。
 */
function styleDistance(a, b) {
  let num = 0;
  let den = 0;
  for (const key of Object.keys(SCALE)) {
    const av = Number(a?.[key]);
    const bv = Number(b?.[key]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const span = SCALE[key] * SPAN_FACTOR;
    const d = Math.min(1, Math.abs(av - bv) / span);
    num += WEIGHT[key] * d;
    den += WEIGHT[key];
  }
  return den ? num / den : 0;
}

/** 1 = 完全一样；0.80 以上同风格；0.65 以下明显漂移（需按个人基线校准）。 */
function styleSimilarity(a, b) {
  return 1 - styleDistance(a, b);
}

/** 返回差异贡献最大的前 n 个维度，便于解释“哪里不像”。 */
function topStyleDiffs(a, b, n = 3) {
  const rows = [];
  for (const key of Object.keys(SCALE)) {
    const av = Number(a?.[key]);
    const bv = Number(b?.[key]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const span = SCALE[key] * SPAN_FACTOR;
    const contribution = (WEIGHT[key] * Math.min(1, Math.abs(av - bv) / span));
    rows.push({ key, a: av, b: bv, contribution });
  }
  const den = rows.reduce((s, r) => s + WEIGHT[r.key], 0) || 1;
  return rows
    .sort((x, y) => y.contribution - x.contribution)
    .slice(0, n)
    .map((r) => ({ ...r, contribution: Number((r.contribution / den).toFixed(3)) }));
}

// ---------- 基线/漂移判断 ----------
/**
 * 用最近 N 条指纹建立基线，判断新指纹是否漂移。
 * @param {object[]} history 至少 10 条历史指纹
 * @param {object} current 当前指纹
 * @returns {{similarity:number, baseline:object, alert:boolean, reason:string}}
 */
function compareToBaseline(history, current) {
  const valid = history.filter((x) => x && x.confidence >= 0.5);
  if (valid.length < 8 || !current || current.confidence < 0.5) {
    return { similarity: 0, baseline: null, alert: false, reason: '样本不足，低置信度，不报警' };
  }
  const medianFp = {};
  for (const key of Object.keys(SCALE)) {
    medianFp[key] = median(valid.map((x) => Number(x[key]) || 0));
  }
  const sim = styleSimilarity(medianFp, current);
  const dists = valid.map((x) => styleDistance(medianFp, x));
  const medDist = median(dists);
  const mad = median(dists.map((d) => Math.abs(d - medDist)));
  const threshold = Math.max(0.45, medDist + 3 * Math.max(mad, 0.05));
  const d = styleDistance(medianFp, current);
  return {
    similarity: sim,
    baseline: medianFp,
    alert: d > threshold,
    reason: d > threshold ? `距离 ${d.toFixed(2)} > 阈值 ${threshold.toFixed(2)}` : `距离 ${d.toFixed(2)} 正常`,
  };
}

module.exports = {
  extractStyle,
  styleDistance,
  styleSimilarity,
  topStyleDiffs,
  compareToBaseline,
  splitSentences,
  countTerms,
  SCALE,
  WEIGHT,
};
