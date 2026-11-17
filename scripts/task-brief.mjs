#!/usr/bin/env node
/**
 * scripts/task-brief.mjs — 命令行生成任务简报（P5）
 *
 * 用法：
 *   node scripts/task-brief.mjs "把 11.16 的相片整理成 docx"
 *   node scripts/task-brief.mjs "任务" --completion "六步全过并留证据"
 *
 * 读 ~/.dsh/cognition-engine 下的真实数据；纯确定性，不调模型。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildTaskBrief } from '../lib/brief.js';

const args = process.argv.slice(2);
const task = args[0];
if (task === undefined || task.trim().length === 0) {
  console.log('用法: node scripts/task-brief.mjs "任务描述" [--completion "完成标准"]');
  process.exit(1);
}
const cIdx = args.indexOf('--completion');
const completion = cIdx >= 0 ? args[cIdx + 1] : undefined;

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
const topicDoc = readJson('cognition-topics.json') ?? {};
// 主题命中：名字或别名出现在任务里，就把该主题的事实优先带进来
const preferredSubjects = (topicDoc.topics ?? [])
  .filter((topic) => topic.status !== 'archived')
  .filter((topic) => [topic.name, ...(topic.aliases ?? [])].some((name) => typeof name === 'string' && name.length > 0 && task.includes(name)))
  .flatMap((topic) => [topic.name, ...(topic.aliases ?? [])]);
const book = readJson('cognition-playbook.json') ?? {};
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
  .map((e) => ({
    id: e.id,
    content: e.content,
    section: e.section,
    boundaryEnvs: e.boundaryEnvs ?? [],
  }));

const result = buildTaskBrief({ task, facts, rules, preferredSubjects, ...(completion === undefined ? {} : { completion }) });
console.log(result.markdown);
console.error(`\n[${result.chars} 字；选入事实 ${result.picked.facts.length} 条、准则 ${result.picked.rules.length} 条]`);
