#!/usr/bin/env node
/**
 * scripts/sediment-inspect.mjs — 沉积层自检（只读，命令行专用）
 *
 * 为什么单独做一个命令行工具：
 *   面板**故意**不显示 4 个参数值（宪章：参数一露出来就被对象化）。
 *   但你要"知道它到底有没有在动"，就必须有一个能看的通道。
 *   所以把它放在命令行：看得见、但不在产品界面里。
 *
 * 用法：node scripts/sediment-inspect.mjs [文件路径]
 * 默认读 %USERPROFILE%/.dsh/cognition-engine/cognition-sediment.jsonl
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file =
  process.argv[2] ?? join(homedir(), '.dsh', 'cognition-engine', 'cognition-sediment.jsonl');

const DIMS = ['retention', 'caution', 'openness', 'attachment'];
const ZERO = '0'.repeat(64);

function canonical(e) {
  const d = e.delta;
  return [
    e.prevHash, String(e.seq), String(e.at), e.kind, e.subject,
    e.from ?? '', e.to ?? '', Number(e.tension).toFixed(6),
    [d.retention, d.caution, d.openness, d.attachment].map((x) => Number(x).toFixed(6)).join(','),
  ].join('|');
}
const hashEvent = (e) => createHash('sha256').update(canonical(e)).digest('hex');

if (!existsSync(file)) {
  console.log(`文件不存在：${file}`);
  console.log('→ 说明还没有任何"翻案"事件。这是空库的正常状态，不是故障。');
  console.log('  事件只由真实取代产生（cognition_remember 带 supersedes，或面板「标记取代」）。');
  process.exit(0);
}

const lines = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n').filter((x) => x.trim() !== '');
const events = [];
let brokenAt = null;
let prev = ZERO;
for (const [index, line] of lines.entries()) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    brokenAt = brokenAt ?? index;
    break;
  }
  events.push(e);
  if (brokenAt === null) {
    const expect = hashEvent({ ...e, prevHash: prev });
    if (e.prevHash !== prev || e.hash !== expect) brokenAt = e.seq;
    else prev = e.hash;
  }
}

const dims = { retention: 0.5, caution: 0.5, openness: 0.5, attachment: 0.5 };
const dir = { retention: 0, caution: 0, openness: 0, attachment: 0 };
let tensions = 0;
for (const e of events) {
  for (const dim of DIMS) {
    const d = Number(e.delta?.[dim] ?? 0);
    if (d !== 0) {
      const sign = Math.sign(d);
      if (dir[dim] === 0) dir[dim] = sign;
      dims[dim] = Number(Math.min(1, Math.max(0, dims[dim] + d)).toFixed(6));
    }
  }
  if (e.kind === 'tension') tensions += 1;
}

console.log(`文件：${file}`);
console.log(`事件：${events.length} 条（其中翻案 ${tensions} 条）`);
console.log(`哈希链：${brokenAt === null ? '完整 ✓' : `断在 seq=${brokenAt} ✗`}`);
console.log('四维当前值（相对中性 0.5 的偏移）：');
for (const dim of DIMS) {
  const v = dims[dim];
  const delta = (v - 0.5) * 100;
  const bar = '█'.repeat(Math.min(20, Math.round(Math.abs(delta))));
  console.log(`  ${dim.padEnd(11)} ${v.toFixed(4)}  ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%  ${bar}`);
}
const moved = DIMS.filter((dim) => Math.abs(dims[dim] - 0.5) > 1e-9);
console.log(moved.length === 0 ? '→ 四维仍是中性：目前没有任何经历留下痕迹。' : `→ 已发生偏移：${moved.join(' / ')}`);
if (events.length > 0) {
  console.log('\n最近 5 条：');
  for (const e of events.slice(-5)) {
    console.log(`  seq=${e.seq} ${e.kind} ${e.subject} tension=${e.tension} ${JSON.stringify(e.delta)}`);
  }
}
