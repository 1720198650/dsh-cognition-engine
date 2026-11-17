#!/usr/bin/env node
/**
 * scripts/scan-sensitive.mjs — 敏感内容扫描（P4-3）
 *
 * 用途：子代理写调研/复盘报告、或任何要对外发送的文本，先扫一遍。
 * 只报"可能敏感"的片段和行号，**不修改文件**。
 *
 * 规则（都来自实际踩过的坑）：
 *   - 变电站名/电压等级：某X变、XXkV、XX变电站
 *   - 项目/期次目录：2026工作、XX期、工程编号
 *   - 个人标识：手机号、身份证、邮箱
 *   - 具体读数与回路号：越限/0.03A/5412 这类可定位到现场的编号
 *   - 账号与凭据：token、cookie、密码、api key
 *
 * 用法：
 *   node scripts/scan-sensitive.mjs <文件或目录> [...]
 *   node scripts/scan-sensitive.mjs -           # 从 stdin 读
 *   --json                                      # 机器可读
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const RULES = [
  { name: '变电站名', re: /[\u4e00-\u9fa5]{2,4}变电站/g, hint: '具体站名 → 换成「某站」' },
  { name: '电压等级+站名', re: /\d{2,3}\s*kV\s*[\u4e00-\u9fa5]{2,6}(?:变|变电站)?/gi, hint: '具体电压与站名 → 概括说' },
  { name: '工程期次目录', re: /\d{4}\s*工作|\d{1,2}\.\d{1,2}\s*期/g, hint: '具体日期/期次 → 用「某期」' },
  { name: '手机号', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, hint: '手机号 → 删除' },
  { name: '身份证', re: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, hint: '身份证 → 删除' },
  { name: '邮箱', re: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, hint: '邮箱 → 删除或脱敏' },
  { name: '凭据', re: /(token|cookie|password|passwd|api[_-]?key|secret)\s*[:=]\s*\S{6,}/gi, hint: '凭据 → 绝不外发' },
  { name: '现场读数/回路号', re: /(越限|剩余电流|0\.0\d{2}\s*A|\b\d{4}\s*(?:号|回路)\b)/g, hint: '可定位现场的读数/编号 → 概括' },
  { name: '私有路径', re: /[A-Za-z]:\\{1,2}(?:Users|dshgz|minmaxgz|ws)[^\s"'）)]*/g, hint: '本机路径 → 删除' },
];

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.jsonl', '.ts', '.js', '.mjs', '.yml', '.yaml', '.csv', '.log']);

function collect(target, out) {
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'lib') continue;
      collect(join(target, name), out);
    }
    return;
  }
  if (TEXT_EXT.has(extname(target).toLowerCase())) out.push(target);
}

function scanText(text, file) {
  const hits = [];
  const lines = text.split('\n');
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        hits.push({ file, line: i + 1, rule: rule.name, match: m[0].slice(0, 40), hint: rule.hint });
        if (m[0].length === 0) break;
      }
    }
  }
  return hits;
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const targets = args.filter((a) => a !== '--json');

let hits = [];
if (targets.length === 1 && targets[0] === '-') {
  hits = scanText(readFileSync(0, 'utf8'), '<stdin>');
} else {
  const files = [];
  for (const t of targets) collect(t, files);
  for (const f of files) {
    try {
      hits = hits.concat(scanText(readFileSync(f, 'utf8'), f));
    } catch {
      /* 二进制/无权限跳过 */
    }
  }
}

if (json) {
  console.log(JSON.stringify({ count: hits.length, hits }, null, 2));
} else {
  if (hits.length === 0) {
    console.log('✓ 没发现敏感片段。（注意：正则只能拦常见形态，不能替代人看一遍）');
  } else {
    console.log(`发现 ${hits.length} 处可能的敏感片段：`);
    for (const h of hits.slice(0, 50)) {
      console.log(`  ${h.file}:${h.line}  [${h.rule}] ${h.match}  → ${h.hint}`);
    }
    if (hits.length > 50) console.log(`  …还有 ${hits.length - 50} 处`);
  }
}
process.exitCode = hits.length === 0 ? 0 : 2;
