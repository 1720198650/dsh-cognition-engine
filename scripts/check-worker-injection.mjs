#!/usr/bin/env node
/**
 * scripts/check-worker-injection.mjs — 验证 superagent 的「执行器会话」是否吃到了准则本注入
 *
 * 为什么需要它：认知引擎是 host 级插件，`systemPrompt.section` 是全局的，
 * 结构上应该对所有会话（含 preset 驱动的 worker）生效。但要真确认，
 * 只能去看 worker 会话的系统提示里到底有没有那段【工作准则】。
 *
 * 用法（在跑 superagent 的那台机器上，默认 WSL）：
 *
 *   node scripts/check-worker-injection.mjs
 *   node scripts/check-worker-injection.mjs --home /root/.dsh --since 2026-11-08
 *
 * 退出码：0 = 至少有一个 worker 会话带注入；1 = 没有（或没有 worker 会话）。
 *
 * 注意：DSH 的 session 日志是**多帧 zstd 追加**，Node 的 zstdDecompressSync 只解第一帧，
 * 所以这里按 magic（28 B5 2F FD）切帧逐帧解。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const home = flag('home', process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh'));
const sessionsDir = join(home, 'sessions');
const since = flag('since', '');
const MARKERS = ['【工作准则】', 'cognition-engine-persona', 'cognition-engine-memory'];

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decompressAll(path) {
  const buf = readFileSync(path);
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) starts.push(i);
  }
  let text = '';
  for (let k = 0; k < starts.length; k += 1) {
    const frame = buf.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buf.length);
    try {
      text += zlib.zstdDecompressSync(frame).toString('utf8');
    } catch {
      /* 分片坏了就跳过，不影响其它帧 */
    }
  }
  return text;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (name === 'session.v4.jsonl.zstd' && p.includes('worker')) out.push({ path: p, mtime: st.mtime });
  }
  return out;
}

if (!existsSync(sessionsDir)) {
  console.log(`没有 sessions 目录：${sessionsDir}`);
  console.log('提示：用 --home <DSH_HOME> 指定，例如 --home /root/.dsh');
  process.exit(1);
}

let files = walk(sessionsDir);
if (since.length > 0) {
  const cutoff = new Date(since).getTime();
  if (Number.isFinite(cutoff)) files = files.filter((f) => f.mtime.getTime() >= cutoff);
}

if (files.length === 0) {
  console.log('没有找到任何 worker 会话日志。');
  console.log('→ 说明 superagent 还没跑过执行器会话；需要先有一个真工单。');
  process.exit(1);
}

console.log(`找到 ${files.length} 个 worker 会话日志，检查注入标记…\n`);
let hit = 0;
for (const file of files) {
  let text;
  try {
    text = decompressAll(file.path);
  } catch (error) {
    console.log(`  ? ${file.path}\n    解压失败：${error.message}`);
    continue;
  }
  const found = MARKERS.filter((m) => text.includes(m));
  const size = Math.round(text.length / 1024);
  console.log(`  ${found.length > 0 ? '✓' : '✗'} ${file.path}  (${size}K)`);
  if (found.length > 0) {
    hit += 1;
    console.log(`      命中：${found.join(' / ')}`);
  }
}

console.log('');
if (hit > 0) {
  console.log(`结论：${hit}/${files.length} 个 worker 会话带准则本注入 ✓`);
  process.exit(0);
}
console.log('结论：worker 会话里**没有**准则本注入 ✗');
console.log('排查顺序：① 该 profile 的 cordis.patch.yml 里有没有 cognition-engine 这一行；');
console.log('          ② 该会话是否在插件安装之前就启动了（看目录的 mtime）；');
console.log('          ③ worker preset 有没有用 complete: true 顶掉全局 section。');
process.exit(1);
