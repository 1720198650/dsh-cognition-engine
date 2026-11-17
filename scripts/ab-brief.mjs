#!/usr/bin/env node
/**
 * scripts/ab-brief.mjs — P5 简报的离线 A/B（信息覆盖），零模型成本
 *
 * 说明：真正的"任务成功率 A/B"要跑 20 个子代理任务，成本高。
 * 这里先做**信息覆盖 A/B**：给定 10 个真实任务 + 人工金标准（该带哪几条事实），
 * 比较「简报」与「全量注入」的覆盖率与体积。这是必要不充分条件：
 *   覆盖不到 = 一定没用；覆盖到 = 还需要真实 A/B 才能证明有用。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildTaskBrief } from '../lib/brief.js';

const dir = join(homedir(), '.dsh', 'cognition-engine');
const readJson = (file) => {
  const p = join(dir, file);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
};

const state = readJson('cognition-state.json') ?? {};
const book = readJson('cognition-playbook.json') ?? {};
const topicDoc = readJson('cognition-topics.json') ?? {};

const facts = (state.facts ?? [])
  .filter((f) => f.deletedAt === undefined && !f.supersededBy)
  .map((f) => ({
    id: f.id,
    subject: f.subject,
    content: f.content,
    importance: f.importance ?? 0.5,
    supersededBy: f.supersededBy ?? null,
  }));
const rules = (book.entries ?? [])
  .filter((e) => e.status === 'active')
  .map((e) => ({ id: e.id, content: e.content, section: e.section, boundaryEnvs: e.boundaryEnvs ?? [] }));

const CASES = [
  { task: '发版前要做哪些事', gold: ['mem-18-4498ec', 'mem-7-249d46', 'mem-17-f31119'] },
  { task: 'npm 上怎么安装和发布这个插件', gold: ['mem-16-c72656', 'mem-47-b9e155', 'mem-7-249d46'] },
  { task: '相片文档怎么排版', gold: ['mem-55-7b4cd5'] },
  { task: '网盘存档有什么规则', gold: ['mem-54-d3b8fc'] },
  { task: '为什么插件不能引入 SQLite', gold: ['mem-12-a62507'] },
  { task: 'DSH 插件的 slot 怎么注册', gold: ['mem-35-6202b1', 'mem-46-091e75'] },
  { task: '插件市场更新报 ERR_PNPM_UNEXPECTED_STORE 怎么修', gold: ['mem-48-64c62b'] },
  { task: 'superagent 跑在哪里、端口是多少', gold: ['mem-45-4c60db'] },
  { task: '数据文件放哪、怎么保护', gold: ['mem-22-e97d48'] },
  { task: '我在隐私和署名上有什么要求', gold: ['mem-50-faa162', 'mem-49-c5d358'] },
];

const fullChars = facts.reduce((sum, f) => sum + f.content.length, 0);

let hitTotal = 0;
let goldTotal = 0;
let briefCharsTotal = 0;
const rows = [];

for (const item of CASES) {
  const preferredSubjects = (topicDoc.topics ?? [])
    .filter((topic) => topic.status !== 'archived')
    .filter((topic) =>
      [topic.name, ...(topic.aliases ?? [])].some(
        (name) => typeof name === 'string' && name.length > 0 && item.task.includes(name),
      ),
    )
    .flatMap((topic) => [topic.name, ...(topic.aliases ?? [])]);

  const brief = buildTaskBrief({ task: item.task, facts, rules, preferredSubjects });
  const picked = new Set(brief.picked.facts.map((p) => p.id));
  const hit = item.gold.filter((id) => picked.has(id));
  hitTotal += hit.length;
  goldTotal += item.gold.length;
  briefCharsTotal += brief.chars;
  rows.push({
    task: item.task,
    gold: item.gold.length,
    hit: hit.length,
    missing: item.gold.filter((id) => !picked.has(id)),
    chars: brief.chars,
  });
}

console.log('任务'.padEnd(38), '金标准', '命中', '简报字数');
for (const row of rows) {
  console.log(row.task.padEnd(36), String(row.gold).padStart(4), String(row.hit).padStart(4), String(row.chars).padStart(6));
  if (row.missing.length > 0) console.log('    漏：' + row.missing.join(', '));
}

const recall = goldTotal === 0 ? 0 : hitTotal / goldTotal;
console.log('\n覆盖率（召回）：', `${hitTotal}/${goldTotal} = ${(recall * 100).toFixed(1)}%`);
console.log('平均简报字数：', Math.round(briefCharsTotal / CASES.length));
console.log('全量注入字数（23 条事实正文合计）：', fullChars, '→ 简报约为其', `${((briefCharsTotal / CASES.length / fullChars) * 100).toFixed(1)}%`);
console.log('准则入选：', rules.filter((r) => (r.boundaryEnvs ?? []).length > 0).length, '条候选可用（当前有边界的准则数）');
