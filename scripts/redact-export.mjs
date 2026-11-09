#!/usr/bin/env node
/**
 * scripts/redact-export.mjs — 把认知引擎的数据导出成可以安全分享的版本
 *
 * 为什么需要：arXiv:2608.09867 实测从公开仓库的 315,320 个推理块里解出了
 * 367 条 PII 和 182 个凭据。会话日志/审计日志本身就是隐私事故源，
 * 直接贴给别人或提 issue 就是把私人内容开源。
 *
 * 做法：只保留结构（时间、id、subject、来源、分数），正文替换成
 * 前 N 个字符 + 长度，便于对方判断"是什么类型的问题"，但看不出内容。
 *
 * 用法：
 *   node scripts/redact-export.mjs <数据目录> <输出目录> [--keep 8]
 * 例：
 *   node scripts/redact-export.mjs ~/.dsh/cognition-engine ./redacted
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const keepIndex = args.indexOf('--keep');
const keep = keepIndex >= 0 ? Math.max(0, Number(args[keepIndex + 1]) || 0) : 8;
const positional = args.filter((arg, index) => !arg.startsWith('--') && index !== keepIndex + 1);
const sourceDir = positional[0] ?? join(homedir(), '.dsh', 'cognition-engine');
const outDir = positional[1] ?? join(process.cwd(), 'redacted');

/** 正文类字段：这些一律打码。 */
const TEXT_KEYS = new Set(['content', 'text', 'persona', 'human', 'body', 'message', 'excerpt', 'summary', 'note']);

function redactText(value) {
  const text = String(value);
  if (text.length <= keep) return `[${text.length} 字已隐去]`;
  return `${text.slice(0, keep)}…[共 ${text.length} 字，其余已隐去]`;
}

function redactValue(value, key) {
  if (typeof value === 'string') {
    // 只有正文字段打码；id/subject/source/mode 这类结构化字段保留，否则导出来没用
    return TEXT_KEYS.has(key) ? redactText(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = redactValue(childValue, childKey);
    return out;
  }
  return value;
}

mkdirSync(outDir, { recursive: true });
const files = readdirSync(sourceDir).filter((name) => /^cognition-.*\.jsonl?$/.test(name));
if (files.length === 0) {
  console.log(`没有找到 cognition-*.json(l) 文件：${sourceDir}`);
  process.exit(1);
}

let totalLines = 0;
for (const name of files) {
  const input = join(sourceDir, name);
  const output = join(outDir, basename(name).replace(/\.jsonl?$/, '.redacted.jsonl'));
  const raw = readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const redacted = lines.map((line) => {
    try {
      const parsed = JSON.parse(line);
      return JSON.stringify(redactValue(parsed, ''));
    } catch {
      // 解析失败的（半行/损坏）直接丢掉，不要原样带出去
      return JSON.stringify({ redacted: true, note: '无法解析，已丢弃原文' });
    }
  });
  writeFileSync(output, redacted.join('\n') + '\n', 'utf8');
  console.log(`  ${name} → ${basename(output)}  (${lines.length} 行)`);
  totalLines += lines.length;
}
console.log(`\n完成：${files.length} 个文件，${totalLines} 行，正文保留前 ${keep} 字。输出目录：${outDir}`);
