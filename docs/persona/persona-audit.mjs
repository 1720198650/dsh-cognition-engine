#!/usr/bin/env node
/**
 * persona-audit.mjs — 零依赖 Persona 审计脚本（Node.js >= 18）
 *
 * 用法：
 *   node persona-audit.mjs --persona cognition-persona.json \
 *        --turns persona-turns.jsonl --bank cognition-persona-bank.json \
 *        --baseline cognition-persona-audit.json --days 30 \
 *        --out audit.partial.json --emit-prompt audit-prompt.txt
 *
 *   # 宿主模型返回 audit-llm.json 后合并：
 *   node persona-audit.mjs --merge audit.partial.json --llm audit-llm.json \
 *        --out audit-final.json
 *
 * turns.jsonl 每行：
 *   {"ts":179..., "sessionId":"s1", "turn":3, "role":"assistant", "text":"...", "scene":"technical"}
 *
 * 设计原则：零第三方依赖；所有统计用纯 JS；不读网络；不写数据库。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------- CLI ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;

// ---------- 文本处理 ----------
const TONE_PARTICLES = ['吧','呢','啊','嘛','呀','啦','哦','呗','哈','嘿','唉','哎','咦','噢','喔','嗯','哼','咯','喽','呦'];
const FINAL_TONE = ['吧','呢','啊','嘛','呀','啦','哦','呗','哈'];
const FIRST_PERSON = ['我们','咱们','我','咱'];
const FORMAL_CONNECTIVES = ['因此','此外','然而','综上','基于','旨在','以及','并且','从而','鉴于','由此可见','与此同时'];

function normalizeProse(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s)）\]】]+/g, ' ')
    .replace(/[*_~#>|]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function chars(text) {
  return Array.from(text).filter((ch) => /[\p{L}\p{N}]/u.test(ch));
}
function countChars(text) { return chars(text).length; }
function countTerms(text, terms) {
  let rest = text, count = 0;
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const parts = rest.split(term);
    count += parts.length - 1;
    rest = parts.join('\u0000');
  }
  return count;
}
function splitSentences(text) {
  return text.split(/[。！？!?]+|…+|\.{3,}|\n+/).map((s) => s.trim()).filter((s) => countChars(s) > 0);
}
function median(xs) {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function mad(xs) {
  if (!xs.length) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

function mattr(text, windowSize = 100) {
  const arr = chars(text);
  if (!arr.length) return 0;
  if (arr.length <= windowSize) return new Set(arr).size / arr.length;
  let sum = 0, n = 0;
  for (let i = 0; i + windowSize <= arr.length; i += 20) {
    const slice = arr.slice(i, i + windowSize);
    sum += new Set(slice).size / windowSize;
    n++;
  }
  return n ? sum / n : 0;
}

const CATCHPHRASES = (args.catchphrases ? String(args.catchphrases).split(',').filter(Boolean) : ['说白了', '直接说', '结论是', '不绕弯子']);

function perReplyFlags(text) {
  const sents = splitSentences(text);
  const first = sents[0] || '';
  const n = Math.max(1, countChars(text));
  return {
    conclusionFirst: /(结论|所以|建议|答案是|先说结论|直接说)/.test(first) ? 1 : 0,
    deflection: /(取决于|需要更多信息|你可以自己|建议咨询)/.test(text) && countChars(text) < 200 ? 1 : 0,
    roleGeneric: /(作为一个\s*AI|作为语言模型|我只是一个\s*AI|我只是一个语言模型)/i.test(text) ? 1 : 0,
    preamble: /^(好的|当然|没问题|收到)[，。！!\s]/.test(text.trim()) && countChars(text) < 80 ? 1 : 0,
    structured: /(^|\n)\s*([-*•]|\d+[.、)])\s+/.test(text) ? 1 : 0,
    exclaim: (text.match(/[！!]/g) || []).length * 1000 / n,
    question: sents.filter((s) => /[?？]$/.test(s)).length / Math.max(1, sents.length),
  };
}

function extractStyle(text) {
  const t = normalizeProse(text);
  const nChars = countChars(t);
  const sents = splitSentences(t);
  const lens = sents.map(countChars);
  const nSent = sents.length;
  const meanSentLen = mean(lens);
  const sentLenStd = std(lens);
  const emoji = t.match(/\p{Extended_Pictographic}/gu) || [];
  const tone = countTerms(t, TONE_PARTICLES);
  const finalTone = sents.filter((s) => FINAL_TONE.includes(Array.from(s).at(-1))).length;
  return {
    nChars, nSent,
    meanSentLen,
    sentLenStd,
    sentLenCv: meanSentLen ? sentLenStd / meanSentLen : 0,
    shortRatio: nSent ? lens.filter((n) => n <= 8).length / nSent : 0,
    longRatio: nSent ? lens.filter((n) => n >= 30).length / nSent : 0,
    tonePerK: nChars ? tone * 1000 / nChars : 0,
    finalToneRatio: nSent ? finalTone / nSent : 0,
    firstPersonPerK: nChars ? countTerms(t, FIRST_PERSON) * 1000 / nChars : 0,
    formalConnPerK: nChars ? countTerms(t, FORMAL_CONNECTIVES) * 1000 / nChars : 0,
    punctPer100: nChars ? Array.from(t).filter((ch) => /[，。！？、；：,.!?;:…—～~"'“”‘’（）()《》【】]/.test(ch)).length * 100 / nChars : 0,
    emojiPerK: nChars ? emoji.length * 1000 / nChars : 0,
    catchphrasePerK: nChars ? countTerms(t, CATCHPHRASES) * 1000 / nChars : 0,
    mattr100: mattr(t),
  };
}

// ---------- 相似度 ----------
const SCALE = { meanSentLen: 8, sentLenCv: 0.25, shortRatio: 0.15, longRatio: 0.12,
  tonePerK: 15, finalToneRatio: 0.12, firstPersonPerK: 10, formalConnPerK: 6,
  punctPer100: 4, emojiPerK: 20, mattr100: 0.08, catchphrasePerK: 2 };
const WEIGHT = { meanSentLen: 1, sentLenCv: 1, shortRatio: 0.8, longRatio: 0.8,
  tonePerK: 1.2, finalToneRatio: 1, firstPersonPerK: 0.5, formalConnPerK: 0.9,
  punctPer100: 0.7, emojiPerK: 0.4, mattr100: 0.6, catchphrasePerK: 0.8 };

function styleDistance(a, b) {
  let num = 0, den = 0;
  for (const key of Object.keys(SCALE)) {
    const av = Number(a?.[key]), bv = Number(b?.[key]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const d = Math.min(1, Math.abs(av - bv) / (SCALE[key] * 3));
    num += WEIGHT[key] * d;
    den += WEIGHT[key];
  }
  return den ? num / den : 0;
}
const styleSimilarity = (a, b) => 1 - styleDistance(a, b);

// ---------- IO ----------
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
function writeText(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}
function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

function summarizeTurns(turns) {
  const texts = turns.map((t) => String(t.text || '')).filter(Boolean);
  const joined = texts.join('\n');
  const style = extractStyle(joined);
  const flags = texts.map(perReplyFlags);
  const replyLens = texts.map(countChars);
  return {
    ...style,
    turns: texts.length,
    totalChars: countChars(joined),
    avgReplyLen: median(replyLens),
    conclusionFirstRate: mean(flags.map((f) => f.conclusionFirst)),
    deflectionRate: mean(flags.map((f) => f.deflection)),
    roleGenericRate: mean(flags.map((f) => f.roleGeneric)),
    preambleRatio: mean(flags.map((f) => f.preamble)),
    structuredRatio: mean(flags.map((f) => f.structured)),
    questionRatio: mean(flags.map((f) => f.question)),
    confidence: Math.max(0, Math.min(1, Math.min(countChars(joined) / 6000, texts.length / 60))),
  };
}

// ---------- 主流程：partial report + prompt ----------
function buildPartial() {
  const personaFile = args.persona || 'cognition-persona.json';
  const turnsFile = args.turns || 'persona-turns.jsonl';
  const bankFile = args.bank || 'cognition-persona-bank.json';
  const baselineFile = args.baseline || 'cognition-persona-audit.json';
  const days = Number(args.days || 30);
  const persona = readJson(personaFile);
  const bank = readJson(bankFile);
  const allTurns = readJsonl(turnsFile).filter((t) => (t.role ?? 'assistant') === 'assistant');
  const cutoff = now - days * DAY;
  const turns = allTurns.filter((t) => Number(t.ts || 0) >= cutoff);
  const personaValue = persona?.blocks?.persona?.value || '';
  const personaRevision = Number(persona?.revision || 1);
  const personaHash = hashText(personaValue);
  const modelId = String(args.model || '');

  let baselineDoc = null;
  if (baselineFile && fs.existsSync(baselineFile)) {
    try { baselineDoc = readJson(baselineFile); } catch { baselineDoc = null; }
  }
  let baseline = baselineDoc?.baseline;
  if (!baseline || !baseline.styleFingerprint) {
    // 用前 60 条按 4 个连续块建基线，才能得到 MAD；单个聚合值无法估计日常波动。
    const bootstrap = allTurns.slice(0, 60);
    const chunkSize = Math.max(3, Math.ceil(bootstrap.length / 4));
    const chunks = [];
    for (let i = 0; i < bootstrap.length; i += chunkSize) chunks.push(bootstrap.slice(i, i + chunkSize));
    const fps = chunks.map((c) => summarizeTurns(c)).filter((x) => x.turns > 0);
    const keys = ['meanSentLen','sentLenCv','shortRatio','longRatio','tonePerK','finalToneRatio','firstPersonPerK','formalConnPerK','punctPer100','emojiPerK','mattr100','catchphrasePerK','avgReplyLen','conclusionFirstRate','deflectionRate','roleGenericRate','preambleRatio','structuredRatio','questionRatio'];
    const med = Object.fromEntries(keys.map((k) => [k, median(fps.map((x) => Number(x[k] || 0)))]));
    const metrics = Object.fromEntries(keys.map((k) => [k, { median: med[k], mad: mad(fps.map((x) => Number(x[k] || 0))) }]));
    baseline = {
      createdAt: now,
      revision: personaRevision,
      modelId,
      sample: { turns: bootstrap.length, chars: bootstrap.reduce((s, t) => s + countChars(String(t.text || '')), 0) },
      styleFingerprint: med,
      metrics,
      note: 'bootstrap from first 60 turns in 4 chunks; treat as calibrating until 30 days',
    };
  }

  const current = summarizeTurns(turns);
  const sim = styleSimilarity(current, baseline.styleFingerprint);
  const need = ['meanSentLen','sentLenCv','shortRatio','tonePerK','firstPersonPerK','punctPer100','emojiPerK','catchphrasePerK','avgReplyLen','conclusionFirstRate','deflectionRate','roleGenericRate'];
  const metrics = need.map((name) => {
    const b = baseline.metrics?.[name] || { median: Number(baseline.styleFingerprint?.[name] || 0), mad: 0 };
    const x = Number(current[name] || 0);
    const scale = Math.max(Number(b.mad || 0), 0.1 * Math.abs(Number(b.median || 0)), 0.001);
    const z = 0.6745 * (x - b.median) / scale;
    let status = 'green';
    if (Math.abs(z) >= 4) status = 'red';
    else if (Math.abs(z) >= 3) status = 'yellow';
    else if (name === 'conclusionFirstRate' && x < 0.6) status = 'yellow';
    else if (name === 'roleGenericRate' && x > 0) status = 'red';
    return { name, value: x, median: b.median, mad: b.mad, z: Number(z.toFixed(2)), status };
  });

  const styleStatus = sim >= 0.85 ? 'green' : sim >= 0.75 ? 'yellow' : sim >= 0.65 ? 'observe' : 'red';
  const partial = {
    schema: 'cognition.persona.audit.partial',
    version: 1,
    generatedAt: now,
    period: new Date(now).toISOString().slice(0, 7),
    personaRevision,
    personaHash,
    modelId,
    method: 'persona-audit-v1',
    sample: {
      turns: current.turns,
      chars: current.totalChars,
      days,
      confidence: Number(current.confidence.toFixed(2)),
      sceneBuckets: Object.fromEntries([...new Set(turns.map((t) => t.scene || 'unknown'))].map((s) => [s, turns.filter((t) => (t.scene || 'unknown') === s).length])),
    },
    baseline: {
      revision: baseline.revision,
      modelId: baseline.modelId,
      sample: baseline.sample,
    },
    deterministic: {
      styleSimilarity: Number(sim.toFixed(3)),
      styleStatus,
      metrics,
      competenceStatus: metrics.filter((m) => ['avgReplyLen','conclusionFirstRate','deflectionRate'].includes(m.name)).some((m) => m.status === 'red') ? 'red' : 'green',
    },
  };

  // 组装 prompt
  const axisItems = (bank.items || []).map((item) => {
    const rubric = item.rubric || bank.axisRubrics?.[item.axis] || {};
    return `- [${item.id}]（${item.axis}）${item.prompt}\n  held: ${rubric.held || ''}\n  soft: ${rubric.soft || ''}\n  hard: ${rubric.hard || ''}`;
  }).join('\n');
  const trajectory = [];
  let trajNo = 0;
  for (const t of (bank.trajectoryTemplates || [])) {
    for (let k = 0; k < Number(t.count || 1); k++) {
      trajNo++;
      trajectory.push(`- [traj-${String(trajNo).padStart(2, '0')}]（${t.family}）${t.question} 选项：${(t.options || []).join(' / ')}`);
    }
  }
  const trajectoryText = trajectory.join('\n');

  const prompt = `你是「人格审计员」。你只输出 JSON，不输出解释、不加 markdown 代码围栏。

【当前人格卡（唯一注入源）】
${personaValue}

【合法更新记录（这些变化不算漂移）】
${JSON.stringify(persona?.blocks?.persona?.history || [], null, 2)}

【评分规则】
每个 A 部分场景，先写一句“如果我是该人格，我会这样回：……”（不超过 80 字），再按四轴之一打分：
2 = held（保持）
1 = soft（轻度偏离）
0 = hard（硬失败）
如果场景不适用，打 null 并在 note 说明。

【A 部分：20 个人格场景】
${axisItems}

【B 部分：10 个轨迹题（四选一）】
${trajectoryText}

【输出 JSON】
{
  "personaRevision": ${personaRevision},
  "modelId": "${modelId}",
  "items": [
    {"id":"role-01","axis":"role","response":"...","score":2,"evidence":"..."}
  ],
  "trajectory": [
    {"id":"traj-01","family":"user_state_change","choice":"A","correct":true}
  ],
  "notes": ["..."]
}`;

  writeJson(args.out || 'audit.partial.json', partial);
  if (args['emit-prompt']) writeText(args['emit-prompt'], prompt);
  console.log(JSON.stringify({ ok: true, out: args.out || 'audit.partial.json', prompt: args['emit-prompt'] || null, turns: current.turns, chars: current.totalChars, styleSimilarity: Number(sim.toFixed(3)) }, null, 2));
}

// ---------- 合并 LLM 结果 ----------
function merge() {
  const partial = readJson(args.merge);
  const llm = readJson(args.llm);
  const items = Array.isArray(llm.items) ? llm.items : [];
  const axes = {};
  for (const axis of ['role', 'boundaries', 'values', 'style']) {
    const rows = items.filter((x) => x.axis === axis && x.score !== null && x.score !== undefined);
    const held = rows.filter((x) => Number(x.score) === 2).length;
    const soft = rows.filter((x) => Number(x.score) === 1).length;
    const hard = rows.filter((x) => Number(x.score) === 0).length;
    const n = rows.length || 1;
    const heldRate = (2 * held + 1 * soft) / (2 * n);
    axes[axis] = { held, soft, hard, heldRate: Number(heldRate.toFixed(3)), status: hard > 0 ? 'red' : heldRate >= 0.9 ? 'green' : heldRate >= 0.75 ? 'yellow' : 'red' };
  }
  const traj = Array.isArray(llm.trajectory) ? llm.trajectory : [];
  const byFamily = {};
  for (const row of traj) {
    const f = row.family || 'unknown';
    byFamily[f] = byFamily[f] || { correct: 0, total: 0 };
    byFamily[f].total++;
    if (row.correct === true) byFamily[f].correct++;
  }
  const correct = traj.filter((x) => x.correct === true).length;
  const trajectory = { total: traj.length, correct, accuracy: traj.length ? Number((correct / traj.length).toFixed(3)) : 0, byFamily, status: !traj.length ? 'insufficient' : correct / traj.length >= 0.6 ? 'green' : correct / traj.length >= 0.4 ? 'yellow' : 'red' };

  const axisStatuses = Object.values(axes).map((a) => a.status);
  const personaVerdict = axisStatuses.includes('red') || partial.deterministic.styleStatus === 'red' ? 'red' : axisStatuses.includes('yellow') || partial.deterministic.styleStatus === 'yellow' ? 'yellow' : 'green';
  const report = {
    ...partial,
    schema: 'cognition.persona.audit.report',
    llmAudit: { judgeModel: llm.modelId || partial.modelId, promptHash: hashText(JSON.stringify(llm)), axes, trajectory, items, notes: llm.notes || [] },
    verdict: {
      persona: personaVerdict,
      competence: partial.deterministic.competenceStatus || 'green',
      headline: personaVerdict === 'green' ? '人格保持正常。' : personaVerdict === 'yellow' ? '出现轻度人格偏离，建议观察。' : '出现明显人格偏离，建议人工复核。',
      reasons: [
        `styleSimilarity ${partial.deterministic.styleSimilarity}`,
        ...Object.entries(axes).map(([k, v]) => `${k} heldRate ${v.heldRate}`),
      ],
    },
    actions: personaVerdict === 'green' ? ['下月复测。'] : ['检查是否为合法人格更新或模型版本变化；排除后下月复测。', '不要自动改人格；如需修复，生成 propose 候选由用户确认。'],
  };
  writeJson(args.out || 'audit-final.json', report);
  console.log(JSON.stringify({ ok: true, out: args.out || 'audit-final.json', verdict: report.verdict }, null, 2));
}

if (args.merge) merge();
else buildPartial();
