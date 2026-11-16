#!/usr/bin/env node
/**
 * scripts/fish-observe.mjs — M2：只读观察 dsh-fish（或任意 event-sourced agent）
 *
 * 设计原则：
 *   1. **只读**。绝不写对方目录里的任何文件；想留锚点请用 --anchor-out 指到别处。
 *   2. **不改对方行为**。算哈希、算统计，不注入、不调用对方任何接口。
 *   3. **不猜 schema**。字段名按常见候选逐个试，缺了就跳过并在报告里说明。
 *
 * 它能证明什么：
 *   - "从我们第一次观察到第 N 条起，这段历史没有被改过"（自己算的哈希链）
 *   - 事件量、沉默率、重复率——用来判断"她到底在长还是在空转"
 * 它**不能**证明：
 *   - 对方的判定是否合理（那是语义问题，不是哈希能管的）
 *
 * 用法：
 *   node scripts/fish-observe.mjs                       # 默认 ~/.dsh-fish
 *   node scripts/fish-observe.mjs --dir <目录> [--json] [--anchor-out <文件>]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const out = { dir: join(homedir(), '.dsh-fish'), json: false, anchorOut: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--dir') out.dir = argv[++i];
    else if (arg === '--anchor-out') out.anchorOut = argv[++i];
  }
  return out;
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toMs(value) {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir);
const eventsFile = join(dir, 'events.jsonl');

if (!existsSync(eventsFile)) {
  const report = {
    ok: false,
    dir,
    reason: existsSync(dir) ? '目录存在但没有 events.jsonl' : '目录不存在（这台机器上还没装 dsh-fish）',
    hint: '装上之后用 --dir 指向它的数据目录即可；本工具只读，不会创建任何文件。',
  };
  console.log(args.json ? JSON.stringify(report, null, 2) : `${report.reason}\n${report.hint}`);
  process.exit(0);
}

const lines = readFileSync(eventsFile, 'utf8')
  .replace(/^\uFEFF/, '')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

// ——— 自己的哈希链（与对方无关，独立可校验）———
let prev = '0'.repeat(64);
const chain = [];
for (const line of lines) {
  const hash = createHash('sha256').update(prev).update('|').update(line).digest('hex');
  chain.push(hash);
  prev = hash;
}

// ——— 统计 ———
const events = [];
let badLines = 0;
for (const line of lines) {
  try {
    events.push(JSON.parse(line));
  } catch {
    badLines += 1;
  }
}

const kindOf = (event) => {
  const value = pick(event, ['kind', 'type', 'event', 'op', 'action', 'name']);
  return typeof value === 'string' ? value : 'unknown';
};
const timeOf = (event) => toMs(pick(event, ['ts', 'at', 'time', 'createdAt', 'timestamp', 'date']));
const textOf = (event) => {
  const value = pick(event, ['content', 'text', 'body', 'message', 'summary', 'judgement']);
  return typeof value === 'string' ? value : '';
};

const kinds = new Map();
const byDay = new Map();
const textHashes = new Map();
let withTime = 0;
for (const event of events) {
  const kind = kindOf(event);
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  const ms = timeOf(event);
  if (ms !== undefined) {
    withTime += 1;
    const day = new Date(ms).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const text = textOf(event);
  if (text.length >= 8) {
    const normalized = text.replace(/\s+/g, '');
    const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 10);
    textHashes.set(digest, (textHashes.get(digest) ?? 0) + 1);
  }
}

const days = [...byDay.keys()].sort();
let silenceDays = 0;
let spanDays = 0;
if (days.length > 0) {
  const start = new Date(days[0] + 'T00:00:00Z').getTime();
  const end = new Date(days[days.length - 1] + 'T00:00:00Z').getTime();
  spanDays = Math.round((end - start) / 86400000) + 1;
  silenceDays = Math.max(0, spanDays - days.length);
}
const repeated = [...textHashes.values()].filter((count) => count > 1);
const repeatedEvents = repeated.reduce((sum, count) => sum + (count - 1), 0);

const report = {
  ok: true,
  dir,
  events: lines.length,
  parsed: events.length,
  badLines,
  chain: {
    length: chain.length,
    head: chain[chain.length - 1] ?? '0'.repeat(64),
    tail: chain[0] ?? '0'.repeat(64),
  },
  span: {
    firstDay: days[0] ?? null,
    lastDay: days[days.length - 1] ?? null,
    spanDays,
    silenceDays,
    eventsWithTime: withTime,
  },
  kinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
  repetition: {
    duplicatedTexts: repeated.length,
    extraRepeats: repeatedEvents,
    repeatRate: events.length === 0 ? 0 : Number((repeatedEvents / events.length).toFixed(3)),
  },
  note: '只读观测：哈希链由本工具独立计算，与对方实现无关；不改变对方任何文件。',
};

if (args.anchorOut !== undefined) {
  writeFileSync(
    resolve(args.anchorOut),
    JSON.stringify({ dir, events: report.events, head: report.chain.head, at: Date.now() }, null, 2),
    'utf8',
  );
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`观察目录：${dir}`);
  console.log(`事件：${report.events} 条（可解析 ${report.parsed}，坏行 ${report.badLines}）`);
  console.log(`哈希锚：${report.chain.head.slice(0, 16)}…（长度 ${report.chain.length}）`);
  if (days.length > 0) {
    console.log(`时间跨度：${report.span.firstDay} → ${report.span.lastDay}，共 ${spanDays} 天，空白 ${silenceDays} 天`);
  } else {
    console.log('时间跨度：事件里没有可识别的时间字段');
  }
  const kindLine = Object.entries(report.kinds)
    .map(([kind, count]) => `${kind}=${count}`)
    .join('  ');
  console.log(`类型分布：${kindLine || '（无）'}`);
  console.log(`重复：${report.repetition.duplicatedTexts} 段文本重复出现，冗余 ${report.repetition.extraRepeats} 条（${(report.repetition.repeatRate * 100).toFixed(1)}%）`);
  if (args.anchorOut !== undefined) console.log(`锚点已写到：${resolve(args.anchorOut)}`);
  console.log('\n（只读：没有修改对方任何文件。）');
}
