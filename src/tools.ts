/**
 * src/tools.ts — 七个工具的定义
 *
 * 从 index.ts 拆出来的原因：index.ts 只该负责「接线」（建实例、注册、路由、清理），
 * 工具的参数表和执行体属于另一层关注点，混在一起会让入口文件膨胀到八百多行。
 *
 * 所有工具都是纯函数式定义，状态全部来自 deps，不持有任何自己的状态。
 */

import { TemporalMemoryStore } from './memory.ts';
import type { RecallMode } from './memory.ts';
import { SchemaGraphManager, expandBySchema } from './graph.ts';
import { buildCoreDigest } from './views.ts';
import type { DialecticalReflectionEngine } from './reflection.ts';
import type { LongTaskStatus } from './task_manager.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
import { asRecord, optionalString, pick, requireString, textOutput, parseMoment } from './util.ts';

/** 工具定义用到的全部外部依赖。 */
export interface ToolDeps {
  memory: TemporalMemoryStore;
  graph: SchemaGraphManager;
  taskManager: LongHorizonTaskManager;
  proactive: ProactiveGate;
  reflection: DialecticalReflectionEngine;
  touch: () => void;
  persistReflection: (result: { query: string; synthesis: string }) => { id: string; subject: string };
  tasksReady: Promise<unknown>;
  config: { heartbeatHours: number; patrolIntervalHours: number };
  /** 读取当前反思引擎模式（off / local / real）。 */
  currentReflectionMode?: () => string;
  /** 准则蒸馏：从记忆提炼候选并给现有准则打标。 */
  distillPlaybook?: (options: { maxCandidates?: number }) => Promise<Record<string, unknown>>;
  /** 读取当前反思引擎模式（off / local / real）。 */
  reflectionMode?: () => string;
}

type IngestInputLike = Parameters<TemporalMemoryStore['ingest']>[0];
type RecallOptionsLike = Parameters<TemporalMemoryStore['recall']>[1];

export function createTools(deps: ToolDeps) {
  const { memory, graph, taskManager, proactive, reflection, touch, tasksReady, config, currentReflectionMode, distillPlaybook } = deps;
  const remember = {
    name: 'cognition_remember',
    description:
      '写入双时态记忆；supersedes 取代旧事实（保留 id/hash，可历史召回）。返回 id、hash、残留冲突。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', description: '事实原文。' },
        subject: { type: 'string', description: '主题键，默认取冒号前短语。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
        importance: { type: 'number', description: '重要度 0..1。' },
        validFrom: { type: 'number', description: '开始为真的 Unix 毫秒。' },
        supersedes: { type: 'string', description: '被取代的旧事实 id。' },
        source: {
          type: 'string',
          description: '来源：user/agent/test/imported，默认 agent。',
        },
        kind: {
          type: 'string',
          enum: ['fact', 'correction'],
          description: 'correction = 纠正记录，会自动置顶到跨会话摘要。',
        },
        scope: {
          type: 'string',
          enum: ['global', 'workspace', 'session'],
          description: '作用域，默认 global；session 自动绑定当前会话。',
        },
      },
    },
    output: textOutput,
    async execute(args: unknown, exec?: unknown): Promise<string> {
      const input = asRecord(args);
      const text = requireString(input, 'text');
      const scopeValue = (optionalString(input, 'scope') ?? 'global') as 'global' | 'workspace' | 'session';
      const agentId = (exec as { agent?: { id?: string } } | undefined)?.agent?.id;
      const kind = optionalString(input, 'kind') ?? 'fact';
      const isCorrection = kind === 'correction';
      const rawTags = Array.isArray(input.tags) ? (input.tags as string[]) : [];
      const mergedTags = isCorrection ? Array.from(new Set(['correction', ...rawTags])) : rawTags;
      const rawImportance = typeof input.importance === 'number' ? input.importance : undefined;
      const fact = memory.ingest({
        content: text,
        source: optionalString(input, 'source') ?? 'agent',
      // 工具通道由代码钉死，调用方无法伪造
      origin: 'agent_tool',
        ...pick(input, ['subject', 'validFrom', 'supersedes']),
        ...(mergedTags.length > 0 ? { tags: mergedTags } : {}),
        importance: isCorrection ? Math.max(0.85, rawImportance ?? 0) : rawImportance,
        scope: scopeValue,
        ...(scopeValue === 'session' && agentId !== undefined ? { sessionId: agentId } : {}),
      } as IngestInputLike);

      graph.ingest(text);
      // 重建多级图式层次（CAM 的 run_hierarchy）；图很小，成本可忽略
      graph.buildHierarchy();
      touch();

      return JSON.stringify({
        stored: {
          id: fact.id,
          subject: fact.subject,
          hash: fact.hash,
          validFrom: fact.validFrom,
          validTo: fact.validTo,
          recordedAt: fact.recordedAt,
        },
        superseded: optionalString(input, 'supersedes') ?? null,
        conflicts: memory.conflicts(),
        memory: memory.stats(),
      });
    },
  };

  const recall = {
    name: 'cognition_recall',
    description:
      '召回记忆。strict 当前真值 / historical 该时刻为真 / belief 当时已知 / associative 联想（不过滤时间）。render 走 Inline&Spill，expand 按图式带关联。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: '检索语句。' },
        mode: {
          type: 'string',
          enum: ['strict', 'historical', 'belief', 'associative'],
          description: '口径，默认 strict。',
        },
        validTime: {
          type: ['number', 'string'],
          description:
            'historical 的时刻。可给人话："3天前" / "昨天" / "2026-11-01" / "2小时前"；也可给毫秒。不给则取当前时刻。',
        },
        recordedTime: {
          type: ['number', 'string'],
          description:
            'belief 的时刻（那时我已知什么）。格式同 validTime。',
        },
        limit: { type: 'number', description: '条数，默认 5。' },
        subject: { type: 'string', description: '限定主题。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签（全含）。' },
        render: { type: 'boolean', description: '近期给正文，久远只给 ID。' },
        inlineChars: { type: 'number', description: 'render 单条上限，默认 240。' },
        expand: { type: 'boolean', description: '带出同图式关联。' },
        scope: {
          type: 'string',
          enum: ['all', 'global', 'workspace', 'session'],
          description: '作用域，默认 all。',
        },
      },
    },
    output: textOutput,
    async execute(args: unknown, exec?: unknown): Promise<string> {
      const input = asRecord(args);
      const query = requireString(input, 'query');
      const rawMode = optionalString(input, 'mode') ?? 'strict';
      if (rawMode !== 'strict' && rawMode !== 'historical' && rawMode !== 'belief' && rawMode !== 'associative') {
        throw new Error('mode 只能是 strict / historical / belief / associative');
      }
      const agentId = (exec as { agent?: { id?: string } } | undefined)?.agent?.id;
      const options = {
        mode: rawMode as RecallMode,
        ...pick(input, ['limit', 'subject', 'tags', 'inlineChars', 'scope']),
        ...(parseMoment(input.validTime) === undefined ? {} : { validTime: parseMoment(input.validTime) }),
        ...(parseMoment(input.recordedTime) === undefined ? {} : { recordedTime: parseMoment(input.recordedTime) }),
        ...(agentId === undefined ? {} : { sessionId: agentId }),
      } as RecallOptionsLike;

      if (input.render === true) return JSON.stringify(memory.render(query, options));
      const hits = memory.recall(query, options);

      // 联想模式用 Personalized PageRank 重排（HippoRAG，arXiv:2405.14831）：
      // 把命中图式当种子，让相关度沿图传播，隔一层但相关的记忆也能浮上来。
      if (rawMode === 'associative' && hits.length > 1) {
        const seeds = [...new Set(hits.flatMap((hit) => graph.schemasForText(hit.fact.content)))];
        const ranks = graph.personalizedPageRank(seeds);
        if (ranks.size > 0) {
          const boost = (content: string): number => {
            const ids = graph.schemasForText(content);
            return ids.reduce((max, id) => Math.max(max, ranks.get(id) ?? 0), 0);
          };
          hits.sort((a, b) => b.score + 2 * boost(b.fact.content) - (a.score + 2 * boost(a.fact.content)));
        }
      }

      // 图式接进召回：把命中项所在图式的其他成员一并带出（GraphRAG 的社区扩展思路）
      // 联想模式自动带上图式扩展（LongMemory 的 associative recall 会混合图关联信号）
      const related =
        input.expand === true || rawMode === 'associative'
          ? expandBySchema(memory, graph, hits.map((hit) => hit.fact.content))
          : [];

      // 召回会给命中项加激活量（"用进废退"的入口）。这些改动必须落盘，
      // 否则重启后 activation 回到旧值，"越常用越牢"只在内存里成立一次。
      if (hits.length > 0) touch();

      return JSON.stringify(
        {
          mode: rawMode,
          count: hits.length,
          ...(related.length === 0 ? {} : { related }),
          hits: hits.map((hit) => ({
            id: hit.fact.id,
            subject: hit.fact.subject,
            content: hit.fact.content,
            score: Number(hit.score.toFixed(4)),
            similarity: Number(hit.similarity.toFixed(4)),
            decay: Number(hit.decay.toFixed(4)),
            validFrom: hit.fact.validFrom,
            validTo: hit.fact.validTo,
            supersededBy: hit.fact.supersededBy,
          })),
        });
    },
  };

  const reflect = {
    name: 'cognition_reflect',
    description:
      '三段式辩证反思：THESIS → 对抗性 ANTITHESIS（CONTRADICTION/EVIDENCE 成对）→ SYNTHESIS，严格串行。给 draft 则跳过第一步；save 存结论。action=playbook 时改为「准则蒸馏」：从记忆提炼跨会话可复用的工作准则，候选进待审队列（需真实模型）。默认关闭，设置页开启。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: '要反思的问题。action=playbook 时可写「蒸馏准则」之类。' },
        action: {
          type: 'string',
          enum: ['reflect', 'playbook'],
          description:
            'playbook = 从记忆里提炼可复用的工作准则（需要真实模型，候选进待审）；默认 reflect = 三段式辩证反思。',
        },
        draft: { type: 'string', description: '已有回答；给了就跳过第一步，直接批评并合成。' },
        save: { type: 'boolean', description: '把 synthesis 存成记忆（subject=结论:问题）。' },
      },
    },
    output: textOutput,
    async execute(args: unknown): Promise<string> {
      const input = asRecord(args);
      const query = requireString(input, 'query');

      // 准则蒸馏：一条独立用途，不走三段式
      if (optionalString(input, 'action') === 'playbook') {
        if (distillPlaybook === undefined) throw new Error('准则蒸馏不可用：插件未初始化');
        const result = await distillPlaybook({ maxCandidates: 5 });
        touch();
        return JSON.stringify(result);
      }

      const draft = optionalString(input, 'draft');
      const result =
        draft === undefined
          ? await reflection.reflect(query)
          : await reflection.reflectDraft(query, draft);
      const saved = input.save === true ? deps.persistReflection(result) : undefined;
      if (saved !== undefined) touch();
      // 只回真正有用的四块：transcript 会把三段再抄一遍，phases 恒为固定顺序，durationMs 对模型无用。
      return JSON.stringify({
        query: result.query,
        ...(currentReflectionMode?.() === 'local'
          ? { warning: '⚠️ 本地占位输出：未调用模型，内容为固定模板，不可作为判断依据' }
          : {}),
        thesis: result.thesis,
        contradictions: result.contradictions,
        synthesis: result.synthesis,
        ...(saved === undefined ? {} : { saved: { id: saved.id, subject: saved.subject } }),
      });
    },
  };

  const state = {
    name: 'cognition_state',
    description: '查看认知引擎状态：记忆库统计、图式网络统计、待办与跨会话摘要。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: textOutput,
    async execute(): Promise<string> {
      return JSON.stringify(
        {
          memory: memory.stats(),
          graph: { ...graph.stats(), levels: graph.hierarchy().length },
          /** 互相矛盾的图式对（类型化边的直接产物）。 */
          tensions: graph.tensions(),
          /** 同一主题下同时有效的互斥事实（记忆层冲突，不一定形成图式边）。 */
          memoryConflicts: memory.conflicts().map((item) => ({
            subject: item.subject,
            leftId: item.leftId,
            rightId: item.rightId,
          })),
          /** 跨会话核心记忆块（≤400 字）。 */
          digest: buildCoreDigest(memory),
          tasks: {
            pending: taskManager.get_pending_tasks().length,
            due: taskManager.check_due_tasks().length,
          },
          proactive: {
            pending: proactive.pending().length,
            recordOnly: proactive.isRecordOnly,
          },
        });
    },
  };

  const forget = {
    name: 'cognition_forget',
    description:
      '删除记忆，用于纠正错误或清理测试数据。至少给一个条件：id 单条 / source 按来源批量（如 test、reflection）/ subject 按主题批量。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '事实 id。' },
        source: { type: 'string', description: '来源，如 test / reflection / agent。' },
        subject: { type: 'string', description: '主题。' },
      },
    },
    output: textOutput,
    async execute(args: unknown): Promise<string> {
      const input = asRecord(args);
      const id = optionalString(input, 'id');
      const source = optionalString(input, 'source');
      const subject = optionalString(input, 'subject');
      if (id === undefined && source === undefined && subject === undefined) {
        throw new Error('cognition_forget 需要至少一个条件：id / source / subject');
      }
      let removed = 0;
      if (id !== undefined) removed += memory.remove(id) ? 1 : 0;
      if (source !== undefined) removed += memory.removeBySource(source);
      if (subject !== undefined) removed += memory.removeBySubject(subject);
      touch();
      return JSON.stringify({ removed, memory: memory.stats() });
    },
  };

  const cognitionContext = {
    name: 'cognition_context',
    description: '读取跨会话核心记忆（≤400 字的摘要）。新会话开头先调它，能想起之前定下的事。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: textOutput,
    async execute(): Promise<string> {
      const digest = buildCoreDigest(memory);
      return JSON.stringify({
        digest,
        empty: digest.length === 0,
        total: memory.stats().total,
      });
    },
  };

  const manageLongTask = {
    name: 'manage_long_task',
    description:
      '长程任务台账（落盘、重启恢复）。create / update / list / due / delete；后台定时巡视复盘。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'list', 'due', 'delete'],
          description: '操作。',
        },
        description: { type: 'string', description: 'create：任务目标。' },
        id: { type: 'string', description: 'update / delete：任务 id。' },
        status: {
          type: 'string',
          enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'],
          description: 'update：新状态。',
        },
        context: { type: 'string', description: 'update：追加线索，换行分隔。' },
        startAt: { type: 'number', description: 'create：任务开始时间（毫秒）。' },
        order: { type: 'number', description: 'create：排序号，小的在前。' },
        parallel: { type: 'boolean', description: 'create：是否与相邻任务并行推进。' },
      },
    },
    output: textOutput,
    async execute(args: unknown): Promise<string> {
      await tasksReady;
      const input = asRecord(args);
      const action = requireString(input, 'action');

      switch (action) {
        case 'create': {
          const task = await taskManager.create_task(requireString(input, 'description'), {
        ...(typeof input.startAt === 'number' ? { startAt: input.startAt } : {}),
        ...(typeof input.endAt === 'number' ? { endAt: input.endAt } : {}),
        ...(typeof input.order === 'number' ? { order: input.order } : {}),
        ...(typeof input.parallel === 'boolean' ? { parallel: input.parallel } : {}),
      });
          return JSON.stringify({ task, store: taskManager.path });
        }
        case 'update': {
          const id = requireString(input, 'id');
          const rawStatus = requireString(input, 'status');
          if (rawStatus !== 'PENDING' && rawStatus !== 'IN_PROGRESS' && rawStatus !== 'COMPLETED') {
            throw new Error('status 只能是 PENDING / IN_PROGRESS / COMPLETED');
          }
          const clue = optionalString(input, 'context');
          const task = await taskManager.update_task_progress(
            id,
            rawStatus as LongTaskStatus,
            clue === undefined ? undefined : clue.split(/\r?\n/),
          );
          return JSON.stringify({ task, store: taskManager.path });
        }
        case 'list': {
          return JSON.stringify(
            {
              pending: taskManager.get_pending_tasks(),
              all: taskManager.all(),
              store: taskManager.path,
            });
        }
        case 'due': {
          return JSON.stringify(
            {
              heartbeatHours: config.heartbeatHours,
              due: taskManager.check_due_tasks(),
            });
        }
        case 'delete': {
          const id = requireString(input, 'id');
          const removed = await taskManager.delete_task(id);
          return JSON.stringify({ removed, store: taskManager.path });
        }
        default: {
          throw new Error(`未知 action：${action}`);
        }
      }
    },
  };

  return [remember, recall, forget, reflect, state, cognitionContext, manageLongTask] as const;
}