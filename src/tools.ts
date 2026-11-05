/**
 * src/tools.ts — 七个工具的定义
 *
 * 从 index.ts 拆出来的原因：index.ts 只该负责「接线」（建实例、注册、路由、清理），
 * 工具的参数表和执行体属于另一层关注点，混在一起会让入口文件膨胀到八百多行。
 *
 * 所有工具都是纯函数式定义，状态全部来自 deps，不持有任何自己的状态。
 */

import { TemporalMemoryStore } from './memory.ts';
import type { TopicStore } from './topics.ts';
import type { RecallMode } from './memory.ts';
import { buildCoreDigest } from './views.ts';
import type { DialecticalReflectionEngine } from './reflection.ts';
import type { LongTaskStatus } from './task_manager.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
import { asRecord, optionalString, pick, requireString, textOutput, parseMoment } from './util.ts';

/** 工具定义用到的全部外部依赖。 */
export interface ToolDeps {
  memory: TemporalMemoryStore;
  /** 记忆变更后重算准则证据链（作废会传染）。 */
  refreshEvidence?: () => void;
  /** 登记知识缺口。 */
  gapRecorder?: (text: string, context?: string) => { id: string; duplicate: boolean; open: number };
  /** 分项打标。 */
  playbookRate?: (id: string, kind: 'applied', trace?: string) => boolean;
  /** 主题注册表：用于按主题分组展示矛盾。 */
  topics: TopicStore;
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
  const { memory, topics, refreshEvidence, playbookRate, gapRecorder, taskManager, proactive, reflection, touch, tasksReady, config, currentReflectionMode, distillPlaybook } = deps;
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

      // 重建多级图式层次（CAM 的 run_hierarchy）；图很小，成本可忽略
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

      // 顺藤摸瓜（expand）：把命中记忆的同主题其他记忆一并带出。
      // 联想模式（associative）自动带上这个扩展。
      // 这是"主题是适用范围键"的直接应用——同主题就同场景，值得一起看。
      let related: string[] = [];
      if ((input.expand === true || rawMode === 'associative') && hits.length > 0) {
        const topicIds = new Set(hits.flatMap((hit) => hit.fact.topicIds));
        const hitIds = new Set(hits.map((hit) => hit.fact.id));
        if (topicIds.size > 0) {
          related = memory
            .all()
            .filter((fact) => fact.deletedAt === undefined && !hitIds.has(fact.id))
            .filter((fact) => fact.topicIds.some((id) => topicIds.has(id)))
            .slice(0, 5)
            .map((fact) => fact.content);
        }
      }

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
        query: { type: 'string', description: '要反思的问题；playbook/rate 时随便填。' },
        ruleId: { type: 'string', description: 'rate 用：准则 id。' },
        usageKind: { type: 'string', description: 'rate 用：applied/appliedGood/appliedBad/missed/userCorrected。' },
        action: {
          type: 'string',
          enum: ['reflect', 'playbook', 'rate', 'gap'],
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
      // 分项打标：记到对应分项，而不是笼统 +/-1
      // 卡壳即记：把「我不知道什么」登记下来，下次针对性补
      if (optionalString(input, 'action') === 'gap') {
        const text = optionalString(input, 'query') ?? '';
        if (text.trim().length === 0) throw new Error('gap 需要 query 说明缺什么');
        if (gapRecorder === undefined) throw new Error('缺口登记不可用：插件未初始化');
        const result = gapRecorder(text, optionalString(input, 'draft'));
        touch();
        return JSON.stringify(result);
      }

      if (optionalString(input, 'action') === 'rate') {
        const ruleId = requireString(input, 'ruleId');
        const kind = optionalString(input, 'usageKind') ?? 'applied';
        const allowed = ['applied', 'appliedGood', 'appliedBad', 'missed', 'userCorrected'];
        if (!allowed.includes(kind)) throw new Error(`usageKind 只能是 ${allowed.join(' / ')}`);
        if (playbookRate === undefined) throw new Error('打标不可用：插件未初始化');
        if (!playbookRate(ruleId, kind as 'applied', optionalString(input, 'draft') ?? '')) {
          throw new Error(`准则不存在：${ruleId}`);
        }
        touch();
        return JSON.stringify({ ruleId, usageKind: kind, ok: true });
      }

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
    description: '查看认知引擎状态：记忆库统计、主题分布、待办与跨会话摘要。',
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
          /** 同一 subject 下同时有效的互斥事实（记忆层冲突）。 */
          memoryConflicts: memory.conflicts().map((item) => ({
            subject: item.subject,
            leftId: item.leftId,
            rightId: item.rightId,
          })),
          /**
           * 按主题分组的矛盾：同一主题下的记忆之间存在互斥。
           *
           * 这是原「图式间矛盾边」的重实现——不依赖任何图结构，
           * 直接用 memory.conflicts() 的结果按 topicIds 分组。
           */
          topicTensions: (() => {
            const conflicts = memory.conflicts();
            if (conflicts.length === 0) return [];
            const byId = new Map(memory.all().map((fact) => [fact.id, fact]));
            return topics
              .active()
              .map((topic) => {
                const pairs = conflicts.filter((c) => {
                  const left = byId.get(c.leftId);
                  const right = byId.get(c.rightId);
                  return (
                    left !== undefined &&
                    right !== undefined &&
                    left.topicIds.includes(topic.id) &&
                    right.topicIds.includes(topic.id)
                  );
                });
                return { topicId: topic.id, name: topic.name, count: pairs.length };
              })
              .filter((item) => item.count > 0);
          })(),
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
      // 删了记忆就要重算准则证据链，否则依赖它的准则会变成「没有主人的结论」
      if (removed > 0) refreshEvidence?.();
      touch();
      return JSON.stringify({ removed, memory: memory.stats() });
    },
  };

  const cognitionContext = {
    name: 'cognition_context',
    description: '新会话开头先调：核心记忆摘要 + 各主题下进行中的事。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: textOutput,
    async execute(): Promise<string> {
      const digest = buildCoreDigest(memory);
      // 进行中的事按主题归拢：任务不是独立台账，挂在主题下。
      const pending = tasksReady === undefined ? [] : await tasksReady.then(() => taskManager.get_pending_tasks());
      const byTopic = new Map<string, string[]>();
      for (const task of pending) {
        for (const topicId of task.topicIds ?? []) {
          const list = byTopic.get(topicId) ?? [];
          list.push(task.description);
          byTopic.set(topicId, list);
        }
      }
      const ongoing = [...byTopic.entries()].map(([topicId, items]) => ({
        topic: topics.get(topicId)?.name ?? topicId,
        items,
      }));
      const loose = pending.filter((task) => (task.topicIds ?? []).length === 0).map((task) => task.description);
      return JSON.stringify({
        digest,
        empty: digest.length === 0 && pending.length === 0,
        total: memory.stats().total,
        ...(ongoing.length === 0 ? {} : { ongoing }),
        ...(loose.length === 0 ? {} : { unclassifiedTasks: loose }),
      });
    },
  };

  const manageLongTask = {
    name: 'manage_long_task',
    description:
      '记录跨会话没做完的事，挂到主题下。create/update/list/due/delete。' +
    '用户说「先做一半」「明天继续」或明显要分多轮时用 create，并传 topicIds；一次能说完的小事不要建。',
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
        ...(Array.isArray(input.topicIds)
          ? { topicIds: (input.topicIds as unknown[]).map(String).filter((x) => x.length > 0) }
          : {}),
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