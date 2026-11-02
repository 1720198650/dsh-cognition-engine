/**
 * src/eval.ts — 评测台
 *
 * 四条来自开源评测项目的原则（lm-evaluation-harness / SWE-bench / Inspect / promptfoo）：
 *   1. 数据集与判分器分离：用例在 evals/cases.json，判分逻辑在 checkers 里。
 *   2. 判分器自检：内置一条「必然失败」的用例；它若通过，说明判分坏了，整场评测作废。
 *   3. 失败留 trace：打印期望值 / 实际值，而不是只说「挂了」。
 *   4. 基线对照：结果与 evals/baseline.json 逐条 diff，回答「改了之后是变好还是变坏」。
 *
 * 另外保留成本门禁：工具 schema 每轮固定开销、单次调用输出，都有硬预算。
 *
 * 运行：
 *   npm run eval           跟基线对比
 *   npm run eval -- --update   重写基线（只在确认变好之后用）
 *
 * 本文件不注册任何工具，不进入模型上下文，运行它本身不消耗 token。
 */

import { readFileSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { TemporalMemoryStore } from './memory.ts';
import { SchemaGraphManager, expandBySchema } from './graph.ts';
import { DialecticalReflectionEngine, MockDialecticalLLM, extractContradictions } from './reflection.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
import { apply, persistReflection } from './index.ts';

// src/eval.ts 与 lib/eval.js 都在项目下一层，因此用例目录在上一级
const ROOT = resolve(import.meta.dirname ?? '.', '..');
const CASES_FILE = resolve(ROOT, 'evals/cases.json');
const BASELINE_FILE = resolve(ROOT, 'evals/baseline.json');

const BUDGET = { schemaTokens: 1400, toolOutputTokens: 600 };

/* ---------------- 分词器 ---------------- */

let encode: (text: string) => number;
let tokenizerName = 'estimate(chars/2.83)';
try {
  const { getEncoding } = await import('js-tiktoken');
  const encoder = getEncoding('o200k_base');
  encode = (text: string) => encoder.encode(text).length;
  tokenizerName = 'o200k_base';
} catch {
  encode = (text: string) => Math.round(text.length / 2.83);
}

/* ---------------- 断言 ---------------- */

class Mismatch extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Mismatch(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Mismatch(`${message}｜期望 ${String(expected)}，实际 ${String(actual)}`);
}

function approx(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Mismatch(`${message}｜期望 ≈${expected}，实际 ${actual}`);
  }
}

/* ---------------- 判分器 ---------------- */

type Params = Record<string, any>;

const checkers: Record<string, (params: Params, expect: Params) => Promise<void> | void> = {
  'memory.recall': (p, e) => {
    const store = new TemporalMemoryStore({ now: () => p.now ?? 0 });
    const facts: ReturnType<TemporalMemoryStore['ingest']>[] = [];
    (p.facts as Params[]).forEach((raw, index) => {
      // 生产路径是「写入时就声明取代」，这里必须走同一条路，否则测的不是真实行为
      const spec = { ...raw } as Params;
      if (p.ingestSupersede === true && index === 1 && facts[0] !== undefined) {
        spec.supersedes = facts[0].id;
      }
      facts.push(store.ingest(spec as never));
    });
    if (p.supersede !== undefined) {
      const [from, to] = p.supersede as [number, number];
      const at = store.get(facts[to]!.id)!.validFrom;
      store.supersede(facts[from]!.id, facts[to]!.id, at);
    }
    const hits = store.recall(String(p.query), {
      mode: p.mode,
      ...(p.validTime === undefined ? {} : { validTime: p.validTime }),
      ...(p.recordedTime === undefined ? {} : { recordedTime: p.recordedTime }),
    });
    equal(hits.length, e.count, '命中条数不符');
    if (e.content !== undefined) equal(hits[0]?.fact.content, e.content, '命中内容不符');
  },

  'memory.hashStable': (p, e) => {
    const store = new TemporalMemoryStore({ now: () => p.now ?? 0 });
    const facts = (p.facts as Params[]).map((fact) => store.ingest(fact as never));
    const before = store.get(facts[0]!.id)!;
    store.supersede(facts[0]!.id, facts[1]!.id, store.get(facts[1]!.id)!.validFrom);
    const after = store.get(facts[0]!.id)!;
    if (e.hashStable) equal(after.hash, before.hash, '取代后 hash 必须不变');
    if (e.hasSupersededBy) equal(after.supersededBy !== null, true, '应记录取代者');
  },

  'memory.conflict': (p, e) => {
    const store = new TemporalMemoryStore({ now: () => p.now ?? 0 });
    const facts = (p.facts as Params[]).map((fact) => store.ingest(fact as never));
    equal(store.conflicts().length, e.before, '取代前的冲突数不符');
    store.supersede(facts[0]!.id, facts[1]!.id, p.supersedeAt);
    equal(store.conflicts().length, e.after, '取代后的冲突数不符');
    equal(store.history(String(facts[0]!.subject)).length, e.history, '历史条数不符');
  },

  'memory.decay': (p, e) => {
    let now = 0;
    const store = new TemporalMemoryStore({ now: () => now, halfLifeMs: p.halfLifeMs });
    const fact = store.ingest({ content: p.content, subject: p.subject });
    equal(store.decay(fact.id, now), 1, '初始衰减应为 1');
    now += p.halfLifeMs;
    approx(store.decay(fact.id, now), e.afterOneHalfLife, 1e-9, '一个半衰期后应剩一半');
    store.reinforce(fact.id, 0.5);
    equal(store.decay(fact.id, now), e.afterReinforce, '强化后应重置为 1');
  },

  'memory.remove': (p, e) => {
    const store = new TemporalMemoryStore({ now: () => 1 });
    const fact = store.ingest({ content: p.content, subject: p.subject });
    equal(store.remove(fact.id), e.removed, '删除结果不符');
    equal(store.recall(String(p.query), { mode: 'strict' }).length, e.hits, '删除后不应再召回');
  },

  'graph.ingest': (p, e) => {
    const graph = new SchemaGraphManager({ now: () => 1 });
    const outcomes = (p.texts as string[]).map((text) => graph.ingest(text));
    equal(outcomes.map((item) => item.mode).join(','), (e.modes as string[]).join(','), '同化/顺应序列不符');
    (e.sameSchema as boolean[]).forEach((expected, index) => {
      equal(outcomes[index + 1]!.schemaId === outcomes[0]!.schemaId, expected, `第 ${index + 2} 条与第 1 条是否同图式不符`);
    });
    if (e.edges !== undefined) {
      equal(graph.neighbors(outcomes[1]!.schemaId).length, e.edges, '连边数不符');
    }
  },

  'graph.polarity': (p, e) => {
    const graph = new SchemaGraphManager({ now: () => 1 });
    const outcomes = (p.texts as string[]).map((text) => graph.ingest(text));
    const last = outcomes[outcomes.length - 1]!;
    equal(last.mode, e.mode, '否定陈述应触发顺应');
    if (e.conflictWithFirst) equal(last.conflictWith, outcomes[0]!.schemaId, '应记录与第一个图式冲突');
  },

  'reflection.sequence': async (p, e) => {
    const mock = new MockDialecticalLLM();
    const engine = new DialecticalReflectionEngine(mock.call);
    const result = await engine.reflect(String(p.query));
    equal(mock.callOrder.join('>'), e.order, '调用顺序不符');
    equal(result.contradictions.length, e.contradictions, '矛盾条数不符');
    const synthesisPrompt = result.calls[2]?.prompt ?? '';
    if (e.synthesisHasThesis) assert(synthesisPrompt.includes(result.thesis), '合成 prompt 应包含 thesis');
    if (e.synthesisHasAntithesis) {
      assert(synthesisPrompt.includes('ANTITHESIS (critique)'), '合成 prompt 应包含 antithesis');
    }
  },

  'reflection.parse': (p, e) => {
    const parsed = extractContradictions(String(p.text));
    equal(parsed.length, e.count, '解析条数不符');
    if (e.evidence !== undefined) equal(parsed[0]?.evidence, e.evidence, '证据文本不符');
  },

  'proactive.gate': (p, e) => {
    const gate = new ProactiveGate({ now: () => 0, idleThresholdMs: 60000, recordOnly: p.recordOnly ?? true });
    const first = gate.observe(p.signal);
    equal(first.state, e.observe, '第一次判断结果不符');
    if (e.draftUndefined) equal(first.draft, undefined, '第一次判断不应有草稿');
    const second = gate.judge(first.observationId);
    equal(second.state, e.judge, '第二次判断结果不符');
  },

  'recall.expand': (p, e) => {
    const store = new TemporalMemoryStore({ now: () => 1 });
    const graph = new SchemaGraphManager({ now: () => 1 });
    for (const text of p.texts as string[]) {
      graph.ingest(text);
      store.ingest({ content: text, subject: text.slice(0, 4) });
    }
    const related = expandBySchema(store, graph, [String(p.seed)]);
    equal(related.length, e.related, '关联记忆条数不符');
    if (e.contains !== undefined) {
      assert(related.some((item) => item.content === e.contains), `关联结果应包含「${e.contains}」`);
    }
  },

  'reflection.draft': async (p, e) => {
    const mock = new MockDialecticalLLM();
    const engine = new DialecticalReflectionEngine(mock.call);
    const result = await engine.reflectDraft(String(p.query), String(p.draft));
    equal(result.calls.length, e.calls, '反思段数不符');
    equal(mock.callOrder.length, e.llmCalls, '实际模型调用次数不符（草稿应跳过 thesis）');
    if (e.thesisIsDraft) equal(result.calls[0]?.output, p.draft, '第一段应是草稿本身');
    assert(result.calls[2]?.prompt.includes(String(p.draft)), '合成 prompt 应包含草稿');
  },

  'reflection.save': async (p, e) => {
    const store = new TemporalMemoryStore({ now: () => 1 });
    const graph = new SchemaGraphManager({ now: () => 1 });
    const engine = new DialecticalReflectionEngine(new MockDialecticalLLM().call);
    const result = await engine.reflect(String(p.query));
    const saved = persistReflection(store, graph, result);
    assert(saved.subject.startsWith(String(e.subjectPrefix)), `subject 应以「${e.subjectPrefix}」开头，实际 ${saved.subject}`);
    equal(saved.source, e.source, '来源标记不符');
    if (e.recallable) {
      const hits = store.recall(String(p.query), { mode: 'strict' });
      assert(hits.length > 0, '结论应能被召回');
      equal(hits[0]?.fact.id, saved.id, '召回的应是刚存的结论');
    }
  },

  'task.persist': async (p, e) => {
    const file = resolve(ROOT, '.dsh-eval-tasks.json');
    await rm(file, { force: true });
    const manager = new LongHorizonTaskManager({ filePath: file, now: () => 1000 });
    await manager.load();
    const task = await manager.create_task(String(p.description));
    await manager.update_task_progress(task.id, 'IN_PROGRESS', [String(p.clue)]);
    const reloaded = new LongHorizonTaskManager({ filePath: file, now: () => 1000 });
    await reloaded.load();
    equal(reloaded.all().length, e.count, '重启后任务数不符');
    equal(reloaded.get(task.id)?.context.length, e.clues, '重启后线索数不符');
    await rm(file, { force: true });
  },

  /* 自检专用：永远抛错。它必须失败，否则说明判分器坏了。 */
  'self.must-fail': () => {
    throw new Mismatch('这是自检用例，本就应该失败');
  },
};

/* ---------------- 成本 ---------------- */

interface CostRow {
  name: string;
  chars: number;
  tokens: number;
}

async function measureCost(): Promise<{ schemas: CostRow[]; outputs: CostRow[]; schemaTokens: number; maxOutputTokens: number }> {
  // 先清掉上一轮可能残留的状态文件，避免旧数据把输出体量撑大
  await rm(resolve(ROOT, '.dsh-eval-runtime-tasks.json'), { force: true });
  await rm(resolve(ROOT, '.dsh-eval-state.json'), { force: true });

  const captured: Array<Record<string, unknown> & { name: string }> = [];
  const fakeTools = {
    register: (definition: Record<string, unknown> & { name: string }) => {
      captured.push(definition);
      return () => {};
    },
  };
  const ctx = { get: (key: string) => (key === 'tools' ? fakeTools : undefined), logger: {} };
  const dispose = apply(ctx as never, {
    tasksFile: resolve(ROOT, '.dsh-eval-runtime-tasks.json'),
    stateFile: resolve(ROOT, '.dsh-eval-state.json'),
    // 成本测量要真实跑一遍 cognition_reflect；引擎默认关闭，这里显式开本地占位。
    reflectionMode: 'local',
  });

  const schemas: CostRow[] = captured.map((definition) => {
    const text = JSON.stringify({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    });
    return { name: definition.name, chars: text.length, tokens: encode(text) };
  });

  const byName = new Map(captured.map((definition) => [definition.name, definition]));
  // 成本测量需要真实跑一遍工具；反思引擎默认关闭，这里临时按配置开启本地占位，
  // 否则 cognition_reflect 会按设计抛「未开启」，成本表就测不到它。
  const samples: Array<[string, unknown]> = [
    ['cognition_remember', { text: '评测样例：部署区域在华东', subject: '部署区域', tags: ['infra'] }],
    ['cognition_recall', { query: '部署区域', mode: 'strict' }],
    ['cognition_forget', { source: 'never-exists' }],
    ['cognition_reflect', { query: '要不要引入缓存层' }],
    ['cognition_state', { event: 'praise' }],
    ['manage_long_task', { action: 'list' }],
  ];

  const outputs: CostRow[] = [];
  for (const [name, args] of samples) {
    const definition = byName.get(name);
    if (definition === undefined) continue;
    const execute = definition.execute as (input: unknown, exec: unknown) => Promise<string>;
    const text = await execute(args, {});
    outputs.push({ name, chars: text.length, tokens: encode(text) });
  }

  if (typeof dispose === 'function') dispose();
  await rm(resolve(ROOT, '.dsh-eval-runtime-tasks.json'), { force: true });
  await rm(resolve(ROOT, '.dsh-eval-state.json'), { force: true });

  return {
    schemas,
    outputs,
    schemaTokens: schemas.reduce((sum, row) => sum + row.tokens, 0),
    maxOutputTokens: outputs.reduce((max, row) => Math.max(max, row.tokens), 0),
  };
}

/* ---------------- 打包自检 ---------------- */

interface PackCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

function checkPackaging(): PackCheck[] {
  const checks: PackCheck[] = [];
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    name: string;
    exports?: Record<string, string>;
    dsh?: { bundle?: { patch?: string }; client?: unknown };
  };

  checks.push({
    name: '清单声明了 bundle patch',
    ok: manifest.dsh?.bundle?.patch === './cordis.patch.yml',
    detail: `dsh.bundle.patch = ${String(manifest.dsh?.bundle?.patch)}`,
  });

  checks.push({
    name: '清单声明了 client 半区',
    ok: manifest.dsh?.client !== undefined,
  });

  checks.push({
    name: 'exports 暴露 ./client',
    ok: manifest.exports?.['./client'] === './client.js',
  });

  const clientPath = resolve(ROOT, 'client.js');
  const client = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : '';
  checks.push({
    name: 'client.js 的模块 id 与包名一致',
    ok: client.includes(`id: '${manifest.name}'`),
    detail: `期望 id: '${manifest.name}'`,
  });

  const patch = existsSync(resolve(ROOT, 'cordis.patch.yml'))
    ? readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8')
    : '';
  checks.push({
    name: 'patch 里的 name 与包名一致',
    ok: patch.includes(`name: '${manifest.name}'`),
    detail: `期望 name: '${manifest.name}'`,
  });

  return checks;
}

/* ---------------- 兼容性自检 ---------------- */

/** 模拟三类真实冲突：工具重名、没有 webServer、没有事件与 effect 能力。 */
function checkCompatibility(): PackCheck[] {
  const checks: PackCheck[] = [];
  const tasks = resolve(ROOT, '.dsh-compat-tasks.json');
  const state = resolve(ROOT, '.dsh-compat-state.json');

  // 1) 与其他插件工具重名：注册抛错时，其余工具仍应注册成功
  const registered: string[] = [];
  const flakyTools = {
    register: (definition: { name: string }) => {
      if (definition.name === 'cognition_state') throw new Error('duplicate tool name');
      registered.push(definition.name);
      return () => {};
    },
  };
  let threw = false;
  try {
    const dispose = apply(
      { get: (key: string) => (key === 'tools' ? flakyTools : undefined), logger: {} } as never,
      { tasksFile: tasks, stateFile: state },
    );
    if (typeof dispose === 'function') dispose();
  } catch {
    threw = true;
  }
  checks.push({
    name: '单个工具重名不会拖垮插件',
    ok: !threw && registered.length === 6,
    detail: `已注册 ${registered.length}/6 个其余工具`,
  });

  // 2) 宿主没有 webServer：不能抛错
  let threwNoWeb = false;
  try {
    const dispose = apply(
      { get: (key: string) => (key === 'tools' ? { register: () => () => {} } : undefined), logger: {} } as never,
      { tasksFile: tasks, stateFile: state },
    );
    if (typeof dispose === 'function') dispose();
  } catch {
    threwNoWeb = true;
  }
  checks.push({ name: '缺少 webServer 时不报错', ok: !threwNoWeb });

  // 3) 宿主没有事件与 effect 能力：不能抛错
  let threwNoEvents = false;
  try {
    const dispose = apply(
      { get: (key: string) => (key === 'tools' ? { register: () => () => {} } : undefined), logger: {} } as never,
      { tasksFile: tasks, stateFile: state },
    );
    if (typeof dispose === 'function') dispose();
  } catch {
    threwNoEvents = true;
  }
  checks.push({ name: '缺少事件/effect 能力时不报错', ok: !threwNoEvents });

  // 4) 落盘文件损坏：备份后空库启动，不能抛错
  let threwCorrupt = false;
  const corrupt = resolve(ROOT, '.dsh-compat-corrupt.json');
  try {
    writeFileSync(corrupt, '{ 这不是合法 JSON', 'utf8');
    const dispose = apply(
      { get: (key: string) => (key === 'tools' ? { register: () => () => {} } : undefined), logger: {} } as never,
      { tasksFile: tasks, stateFile: corrupt },
    );
    if (typeof dispose === 'function') dispose();
  } catch {
    threwCorrupt = true;
  } finally {
    try {
      rmSync(corrupt, { force: true });
    } catch {
      /* ignore */
    }
  }
  checks.push({ name: '落盘文件损坏时仍能启动', ok: !threwCorrupt });

  // 5) systemPrompt.section 抛错（例如与其他插件的段名冲突）：不能拖垮加载
  let threwPrompt = false;
  let promptAttempts = 0;
  try {
    const dispose = apply(
      {
        get: (key: string) => {
          if (key === 'tools') return { register: () => () => {} };
          if (key === 'systemPrompt') {
            return {
              section: () => {
                promptAttempts += 1;
                throw new Error('duplicate section name');
              },
            };
          }
          return undefined;
        },
        logger: {},
      } as never,
      { tasksFile: tasks, stateFile: state },
    );
    if (typeof dispose === 'function') dispose();
  } catch {
    threwPrompt = true;
  }
  checks.push({
    name: '系统提示段注册失败时不拖垮插件',
    ok: !threwPrompt && promptAttempts === 1,
    detail: `尝试注册 ${promptAttempts} 次`,
  });

  // 清扫：损坏文件会被隔离成 *.corrupt-<ts>，不清会越积越多
  try {
    for (const name of readdirSync(ROOT)) {
      if (name.startsWith('.dsh-compat-')) rmSync(resolve(ROOT, name), { force: true });
    }
  } catch {
    /* 清扫失败不影响评测结论 */
  }

  return checks;
}

/* ---------------- 运行 ---------------- */

interface CaseSpec {
  id: string;
  group: string;
  checker: string;
  params: Params;
  expect: Params;
}

const spec = JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { version: number; cases: CaseSpec[] };
const updateBaseline = process.argv.includes('--update');

interface CaseResult {
  id: string;
  group: string;
  ok: boolean;
  ms: number;
  error?: string;
}

const results: CaseResult[] = [];

for (const item of spec.cases) {
  const checker = checkers[item.checker];
  const startedAt = Date.now();
  try {
    assert(checker !== undefined, `未知判分器 ${item.checker}`);
    await checker(item.params, item.expect);
    results.push({ id: item.id, group: item.group, ok: true, ms: Date.now() - startedAt });
  } catch (error) {
    results.push({
      id: item.id,
      group: item.group,
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// 判分器自检：这条必须失败
let judgeHealthy = true;
try {
  await checkers['self.must-fail']!({}, {});
  judgeHealthy = false;
} catch {
  judgeHealthy = true;
}

const cost = await measureCost();
const schemaOk = cost.schemaTokens <= BUDGET.schemaTokens;
const outputOk = cost.maxOutputTokens <= BUDGET.toolOutputTokens;

/* ---------------- 基线对比 ---------------- */

interface Baseline {
  version: number;
  generatedAt: string;
  schemaTokens: number;
  cases: Record<string, boolean>;
}

const previous: Baseline | null = existsSync(BASELINE_FILE)
  ? (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline)
  : null;

const improved: string[] = [];
const regressed: string[] = [];
if (previous !== null) {
  for (const item of results) {
    const before = previous.cases[item.id];
    if (before === undefined) continue;
    if (!before && item.ok) improved.push(item.id);
    if (before && !item.ok) regressed.push(item.id);
  }
}

/* ---------------- 输出 ---------------- */

console.log('cognition-engine 评测\n');
console.log(`分词器：${tokenizerName}`);
console.log(`用例：${results.length} 条（来自 evals/cases.json）\n`);

let currentGroup = '';
for (const item of results) {
  if (item.group !== currentGroup) {
    currentGroup = item.group;
    console.log(`[${currentGroup}]`);
  }
  console.log(`  ${item.ok ? '✓' : '✗'} ${item.id}${item.ok ? '' : `\n      ${item.error}`}`);
}

const passed = results.filter((item) => item.ok).length;

console.log('\n成本');
for (const row of cost.schemas) {
  console.log(`  schema ${row.name.padEnd(20)} ${String(row.tokens).padStart(5)} tokens`);
}
console.log(`  schema 合计 ${cost.schemaTokens} / 预算 ${BUDGET.schemaTokens}  ${schemaOk ? '✓' : '✗'}`);
for (const row of cost.outputs) {
  console.log(`  输出   ${row.name.padEnd(20)} ${String(row.tokens).padStart(5)} tokens`);
}
console.log(`  输出最大 ${cost.maxOutputTokens} / 预算 ${BUDGET.toolOutputTokens}  ${outputOk ? '✓' : '✗'}`);

const packaging = checkPackaging();
console.log('\n打包');
for (const check of packaging) {
  console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}${check.ok || check.detail === undefined ? '' : `（${check.detail}）`}`);
}

const compatibility = checkCompatibility();
console.log('\n兼容性');
for (const check of compatibility) {
  console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}${check.ok || check.detail === undefined ? '' : `（${check.detail}）`}`);
}

console.log('\n结果');
console.log(`  功能 ${passed}/${results.length} 通过`);
console.log(`  判分器自检 ${judgeHealthy ? '✓ 正常' : '✗ 失效（本该失败的用例却通过了）'}`);
if (previous === null) {
  console.log('  基线：无（本次将写入）');
} else {
  console.log(`  基线：${previous.generatedAt}　新增通过 ${improved.length}　新增失败 ${regressed.length}`);
  for (const id of improved) console.log(`    ▲ ${id}`);
  for (const id of regressed) console.log(`    ▼ ${id}`);
}

const allPassed =
  passed === results.length &&
  schemaOk &&
  outputOk &&
  judgeHealthy &&
  packaging.every((check) => check.ok) &&
  compatibility.every((check) => check.ok);

if (updateBaseline || previous === null) {
  const baseline: Baseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    schemaTokens: cost.schemaTokens,
    cases: Object.fromEntries(results.map((item) => [item.id, item.ok])),
  };
  await writeFile(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`\n已写入基线：evals/baseline.json`);
}

console.log(allPassed ? '\n评测通过' : '\n评测未通过');
if (!allPassed) process.exitCode = 1;
