/**
 * src/index.ts — cognition-engine 的 DSH（Cordis）插件总入口
 *
 * 导出形式：`export function apply(ctx, config)` + `export const inject = ['tools']`。
 * 插件在 apply 里用 ctx.effect 注册四个工具，并返回清理函数，符合 DSH 插件生命周期约定。
 *
 * 四个工具：
 *   cognition_remember  写入一条双时态记忆（可指定 validFrom / supersedes）
 *   cognition_recall    按 strict / historical / belief 三种时间口径召回
 *   cognition_reflect   三段式辩证反思（thesis → antithesis → synthesis，串行三次）
 *   cognition_state     心情状态条 + 记忆与图式网络统计
 */

import { randomUUID } from 'node:crypto';

import { TemporalMemoryStore } from './memory.ts';
import type { TemporalFact } from './memory.ts';
import { SchemaGraphManager, expandBySchema } from './graph.ts';
import { MoodStateMachine } from './mood.ts';
import type { MoodEvent, MoodLabel, MoodState } from './mood.ts';
import { JsonStateStore } from './persist.ts';
import { buildDetail, buildCoreDigest } from './views.ts';
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker } from './reflection.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
import type { LongTaskStatus } from './task_manager.ts';
import type { RecallMode } from './memory.ts';

/* ------------------------------------------------------------------ */
/* 宿主最小接口（不引入任何运行时依赖）                                 */
/* ------------------------------------------------------------------ */

interface ToolHost {
  register(definition: unknown): () => void;
}

/** 宿主 HTTP 载体：只用到 register(route)，避免引入 node:http 类型依赖。 */
interface WebResponseLike {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: string): void;
}

interface WebRouteLike {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (request: unknown, response: WebResponseLike) => void | Promise<void>;
}

interface WebServerHost {
  register(route: WebRouteLike): () => void;
}

/** 宿主 llm 服务的最小可用面（只用到 stream）。 */
interface LlmStreamChunk {
  type: string;
  text?: string;
  reason?: { kind?: string };
}

interface LlmService {
  stream(options: Record<string, unknown>): AsyncIterable<LlmStreamChunk>;
}

interface ModelSelectionLike {
  provider?: string;
  model?: string;
}

interface DefaultModelHost {
  currentSelection?(): ModelSelectionLike;
}

/** 落盘的整体状态。 */
interface PersistedState {
  version: number;
  facts: TemporalFact[];
  mood: MoodState;
}

interface PluginLogger {
  info?(message: string): void;
  warn?(message: string): void;
  debug?(message: string): void;
}

interface PluginContext {
  tools?: ToolHost;
  get?(name: string): unknown;
  effect?(callback: () => () => void): unknown;
  /** 事件订阅（agent/pre-step 等）。 */
  on?(event: string, listener: (...args: any[]) => unknown): () => void;
  logger?: PluginLogger;
}

/** 插件配置（来自 cordis.patch.yml 的 config，全部可选）。 */
export interface CognitionConfig {
  decayHalfLifeHours?: number;
  strictThreshold?: number;
  assimilateThreshold?: number;
  overlapThreshold?: number;
  communityThreshold?: number;
  maxClusterSize?: number;
  energyDrainPerMinute?: number;
  initialEnergy?: number;
  initialFavorability?: number;
  /** 多久没更新就算需要催办（小时）。 */
  heartbeatHours?: number;
  /** 后台巡视间隔（小时）。 */
  patrolIntervalHours?: number;
  /** 冷场判定阈值（分钟）。 */
  idleThresholdMinutes?: number;
  /** 主动发言默认只记录不发送。 */
  recordOnly?: boolean;
  /** tasks.json 路径，默认 <cwd>/tasks.json。 */
  tasksFile?: string;
  /** 记忆与心情的落盘路径，默认 <cwd>/cognition-state.json。 */
  stateFile?: string;
  /** 上锁时使用的固定口令；不设则每次上锁随机生成。 */
  lockToken?: string;
  /** 真模型：显式指定 provider / model，不设则跟随当前默认模型。 */
  llmProvider?: string;
  llmModel?: string;
  /** 启动时是否直接启用真模型。 */
  useRealModel?: boolean;
}

type ResolvedConfig = Required<
  Omit<CognitionConfig, 'tasksFile' | 'stateFile' | 'lockToken' | 'llmProvider' | 'llmModel'>
> & {
  tasksFile?: string;
  stateFile?: string;
  lockToken?: string;
  llmProvider?: string;
  llmModel?: string;
};

export const name = 'cognition-engine';

/** 需要 tools 服务才能注册工具。 */
export const inject = ['tools'];

const HOUR_MS = 60 * 60 * 1000;
const MOOD_EVENTS: readonly MoodEvent[] = [
  'praise',
  'insult',
  'success',
  'failure',
  'conflict',
  'rest',
  'ignore',
];

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeConfig(raw: unknown): ResolvedConfig {
  const config = (raw ?? {}) as CognitionConfig;
  return {
    decayHalfLifeHours: numberOr(config.decayHalfLifeHours, 168),
    strictThreshold: numberOr(config.strictThreshold, 0.12),
    assimilateThreshold: numberOr(config.assimilateThreshold, 0.55),
    overlapThreshold: numberOr(config.overlapThreshold, 0.42),
    communityThreshold: numberOr(config.communityThreshold, 0.3),
    maxClusterSize: Math.max(1, Math.round(numberOr(config.maxClusterSize, 8))),
    energyDrainPerMinute: numberOr(config.energyDrainPerMinute, 1.5),
    initialEnergy: numberOr(config.initialEnergy, 70),
    initialFavorability: numberOr(config.initialFavorability, 0),
    heartbeatHours: Math.max(0.01, numberOr(config.heartbeatHours, 6)),
    patrolIntervalHours: Math.max(0.01, numberOr(config.patrolIntervalHours, 3)),
    idleThresholdMinutes: Math.max(0.1, numberOr(config.idleThresholdMinutes, 5)),
    recordOnly: config.recordOnly !== false,
    tasksFile:
      typeof config.tasksFile === 'string' && config.tasksFile.trim().length > 0
        ? config.tasksFile
        : undefined,
    stateFile:
      typeof config.stateFile === 'string' && config.stateFile.trim().length > 0
        ? config.stateFile
        : undefined,
    lockToken:
      typeof config.lockToken === 'string' && config.lockToken.trim().length > 0
        ? config.lockToken
        : undefined,
    llmProvider:
      typeof config.llmProvider === 'string' && config.llmProvider.trim().length > 0
        ? config.llmProvider
        : undefined,
    llmModel:
      typeof config.llmModel === 'string' && config.llmModel.trim().length > 0
        ? config.llmModel
        : undefined,
    useRealModel: config.useRealModel === true,
  };
}

function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 统一把 unknown 异常转成一行文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 从 agent/pre-step 的 payload 里取最后一条用户消息的纯文本。 */
function latestUserText(payload: unknown): string {
  const messages = (payload as { messages?: unknown[] } | undefined)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const last = messages[messages.length - 1] as { content?: unknown };
  if (typeof last?.content === 'string') return last.content;
  if (!Array.isArray(last?.content)) return '';
  return last.content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join(' ');
}

const textOutput = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ],
};

/**
 * 反思回写记忆（Generative Agents 的闭环）：把 synthesis 存成一条可召回的记忆，
 * 并让结论也进图式网络，这样以后 expand 能把相关结论带出来。
 */
export function persistReflection(
  memory: TemporalMemoryStore,
  graph: SchemaGraphManager,
  result: { query: string; synthesis: string },
): TemporalFact {
  const subject = `结论:${result.query}`.slice(0, 60);
  const fact = memory.ingest({
    content: result.synthesis,
    subject,
    tags: ['reflection'],
    // 用独立来源标记，便于一次性清理：cognition_forget({ source: 'reflection' })
    source: 'reflection',
    importance: 0.6,
  });
  graph.ingest(result.synthesis);
  return fact;
}

/**
 * 注册期自检：`parameters` 必须是以 `type: 'object'` 为根的 JSON Schema。
 *
 * 宿主会把 parameters 原样透传给模型 API，不校验根形状；一旦写成裸属性表，
 * 每个请求都会被判为 `got 'type: null'` 而整轮失败，且报错不指向具体插件。
 * 这里提前抛错，把故障限制在插件加载阶段。
 */
function assertObjectSchema(name: string, parameters: unknown): void {
  if (parameters === undefined) return;
  const root = parameters as { type?: unknown; properties?: unknown };
  if (root.type !== 'object' || typeof root.properties !== 'object' || root.properties === null) {
    throw new Error(
      `cognition-engine: 工具 ${name} 的 parameters 必须是 { type: 'object', properties: {...}, required: [...] }，裸属性表会被模型 API 拒绝`,
    );
  }
}

/** 只取调用方真正给的字段，避免一长串 `...(x === undefined ? {} : { x })`。 */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

type IngestInputLike = Parameters<TemporalMemoryStore['ingest']>[0];
type RecallOptionsLike = Parameters<TemporalMemoryStore['recall']>[1];

/* ------------------------------------------------------------------ */
/* 插件入口                                                            */
/* ------------------------------------------------------------------ */

export function apply(ctx: PluginContext, rawConfig?: unknown): (() => void) | undefined {
  const config = normalizeConfig(rawConfig);

  const memory = new TemporalMemoryStore({ halfLifeMs: config.decayHalfLifeHours * HOUR_MS });
  const graph = new SchemaGraphManager({
    assimilateThreshold: config.assimilateThreshold,
    overlapThreshold: config.overlapThreshold,
    communityThreshold: config.communityThreshold,
    maxClusterSize: config.maxClusterSize,
  });
  const mood = new MoodStateMachine({
    energy: config.initialEnergy,
    favorability: config.initialFavorability,
    energyDrainPerMinute: config.energyDrainPerMinute,
  });
  // —— 落盘：记忆 + 心情 ——
  const stateStore = new JsonStateStore<PersistedState>({
    ...(config.stateFile === undefined ? {} : { filePath: config.stateFile }),
    serialize: () => ({ version: 1, facts: memory.serialize(), mood: mood.serialize() }),
    restore: (data) => {
      if (Array.isArray(data.facts)) memory.restore(data.facts);
      if (data.mood !== undefined) mood.restore(data.mood);
    },
  });
  try {
    if (stateStore.loadSync()) {
      ctx.logger?.info?.(`cognition-engine: 已从磁盘恢复 ${memory.size} 条记忆`);
    }
  } catch (error) {
    ctx.logger?.warn?.(`cognition-engine: 状态恢复失败 ${messageOf(error)}`);
  }
  /** 任何写入之后调用一次，合并延迟落盘。 */
  const touch = (): void => stateStore.schedule();

  // —— 真模型开关 ——
  const mockLLM = new MockDialecticalLLM();
  let useRealModel = config.useRealModel;
  /** 上锁口令；null 表示未上锁。 */
  let lockToken: string | null = config.lockToken ?? null;

  const resolveModel = (): { provider: string; model: string } => {
    if (config.llmProvider !== undefined && config.llmModel !== undefined) {
      return { provider: config.llmProvider, model: config.llmModel };
    }
    const host = ctx.get?.('agentDefaultModel') as DefaultModelHost | undefined;
    const selection = host?.currentSelection?.();
    return { provider: selection?.provider ?? '', model: selection?.model ?? '' };
  };

  const callRealModel = async (prompt: string): Promise<string> => {
    const llm = ctx.get?.('llm') as LlmService | undefined;
    if (llm === undefined || typeof llm.stream !== 'function') throw new Error('llm 服务不可用');
    const { provider, model } = resolveModel();
    if (provider === '' || model === '') {
      throw new Error('未找到可用模型：请在 cordis.patch.yml 设 llmProvider / llmModel');
    }
    let text = '';
    for await (const chunk of llm.stream({
      provider,
      model,
      maxTokens: 800,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') throw new Error('模型返回错误');
    }
    if (text.trim().length === 0) throw new Error('模型返回空内容');
    return text;
  };

  const reflection = new DialecticalReflectionEngine((prompt, phase) =>
    useRealModel ? callRealModel(prompt) : Promise.resolve(mockLLM.call(prompt, phase)),
  );
  const worker = new ReflectionWorker(reflection, 1);
  const proactive = new ProactiveGate({
    idleThresholdMs: config.idleThresholdMinutes * 60_000,
    recordOnly: config.recordOnly,
  });
  const taskManager = new LongHorizonTaskManager({
    ...(config.tasksFile === undefined ? {} : { filePath: config.tasksFile }),
    heartbeatMs: config.heartbeatHours * 60 * 60 * 1000,
  });
  const tasksReady = taskManager.load().catch((error: unknown) => {
    ctx.logger?.warn?.(
      `cognition-engine: tasks.json 恢复失败 ${messageOf(error)}`,
    );
  });

  const tools = (ctx.get?.('tools') ?? ctx.tools) as ToolHost | undefined;
  if (tools === undefined || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('cognition-engine: 未找到 tools 服务，插件未注册任何工具');
    return undefined;
  }

  let disposed = false;
  const disposers: Array<() => void> = [];

  /** 页面可视化用的快照（纯 JSON，客户端每 2 秒拉一次）。 */
  const snapshot = (): Record<string, unknown> => {
    const current = mood.snapshot();
    return {
      mood: {
        energy: current.energy,
        favorability: current.favorability,
        label: current.mood,
        bar: current.bar,
      },
      memory: memory.stats(),
      /** 标记为 test 的事实条数：页面上用来提醒「这些不是真事」。 */
      samples: memory.all().filter((fact) => fact.source === 'test').length,
      graph: graph.stats(),
      tasks: {
        pending: taskManager.get_pending_tasks().length,
        due: taskManager.check_due_tasks().length,
      },
      proactive: {
        pending: proactive.pending().length,
        recordOnly: proactive.isRecordOnly,
      },
      storage: { state: stateStore.path, tasks: taskManager.path },
      model: (() => {
        const resolved = resolveModel();
        return {
          enabled: useRealModel,
          provider: resolved.provider,
          model: resolved.model,
          available: resolved.provider !== '' && resolved.model !== '',
        };
      })(),
      locked: lockToken !== null,
      updatedAt: Date.now(),
    };
  };

  /** 面板展开时按需拉取的明细（不走模型上下文，只给页面看）。 */
  const detail = (): Record<string, unknown> => buildDetail({ memory, graph, mood, taskManager });

  // 宿主 → 页面 的数据桥：Client 半区 fetch('/cognition-engine/state')
  // 注意：不能放在 /api 前缀下——那条前缀归 API 网关所有，会先被它 401 掉。
  const webServer = ctx.get?.('webServer') as WebServerHost | undefined;
  if (webServer !== undefined && typeof webServer.register === 'function') {
    const send = (response: WebResponseLike, status: number, body: unknown): void => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body));
    };

    /** 上锁后，受保护路由要求 x-cognition-token 请求头。 */
    const authorized = (request: unknown): boolean => {
      if (lockToken === null) return true;
      const headers = (request as { headers?: Record<string, string | string[] | undefined> }).headers ?? {};
      const raw = headers['x-cognition-token'];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return value === lockToken;
    };

    /** 注册一条路由：统一方法校验、鉴权与错误转换，避免每个 handler 各写一份。 */
    const route = (
      path: string,
      produce: (url: URL) => unknown,
      options: { method?: 'GET' | 'POST'; requireAuth?: boolean } = {},
    ): void => {
      const method = options.method ?? 'GET';
      const requireAuth = options.requireAuth === true;
      disposers.push(
        webServer.register({
          kind: 'exact',
          path,
          handler: (request, response) => {
            try {
              const req = request as { method?: string; url?: string };
              if ((req.method ?? 'GET').toUpperCase() !== method) {
                send(response, 405, { error: 'method not allowed' });
                return;
              }
              if (requireAuth && !authorized(request)) {
                send(response, 401, { error: 'unauthorized' });
                return;
              }
              send(response, 200, produce(new URL(req.url ?? path, 'http://local')));
            } catch (error) {
              send(response, 500, { error: messageOf(error) });
            }
          },
        }),
      );
    };

    route('/cognition-engine/state', () => snapshot());
    route('/cognition-engine/detail', () => detail(), { requireAuth: true });

    /** 读 ?name=true 这类布尔开关。 */
    const flag = (url: URL, name: string): boolean => url.searchParams.get(name) === 'true';

    // 清空：scope = memory / mood / all
    route(
      '/cognition-engine/clear',
      (url) => {
        const scope = url.searchParams.get('scope') ?? 'memory';
        if (scope !== 'memory' && scope !== 'mood' && scope !== 'all') {
          throw new Error('scope 只能是 memory / mood / all');
        }
        let removed = 0;
        if (scope !== 'mood') {
          removed = memory.all().length;
          for (const fact of memory.all()) memory.remove(fact.id);
          graph.reset();
        }
        if (scope !== 'memory') mood.reset();
        void stateStore.flush();
        return { cleared: scope, removed, memory: memory.stats() };
      },
      { method: 'POST', requireAuth: true },
    );

    // 真模型开关
    route(
      '/cognition-engine/model',
      (url) => {
        useRealModel = flag(url, 'enabled');
        const { provider, model } = resolveModel();
        return { enabled: useRealModel, provider, model, available: provider !== '' && model !== '' };
      },
      { method: 'POST', requireAuth: true },
    );

    // 上锁开关：开启时返回口令，页面用它设置 x-cognition-token
    route(
      '/cognition-engine/lock',
      (url) => {
        lockToken = flag(url, 'enabled') ? (config.lockToken ?? randomUUID()) : null;
        return { locked: lockToken !== null, token: lockToken };
      },
      { method: 'POST', requireAuth: true },
    );
  }

  const remember = {
    name: 'cognition_remember',
    description:
      '写入一条双时态记忆。用 supersedes 取代旧事实：旧事实闭合 validTo/supersededAt，保留 id 与 hash，仍可历史召回。返回 id、hash 与残留冲突。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', description: '事实原文。' },
        subject: { type: 'string', description: '冲突检测的主题键，省略取冒号前短语。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
        importance: { type: 'number', description: '重要度 0..1。' },
        sentiment: { type: 'number', description: '情绪值 -1.0 ~ 1.0，默认 0。' },
        validFrom: { type: 'number', description: '开始为真的 Unix 毫秒。' },
        supersedes: { type: 'string', description: '被取代的旧事实 id。' },
        source: {
          type: 'string',
          description: '来源：user / agent（默认）/ test（测试数据）/ imported。',
        },
        scope: {
          type: 'string',
          enum: ['global', 'workspace', 'session'],
          description: '作用域，默认 global。session 时自动绑定当前会话。',
        },
      },
    },
    output: textOutput,
    async execute(args: unknown, exec?: unknown): Promise<string> {
      const input = asRecord(args);
      const text = requireString(input, 'text');
      const scopeValue = (optionalString(input, 'scope') ?? 'global') as 'global' | 'workspace' | 'session';
      const agentId = (exec as { agent?: { id?: string } } | undefined)?.agent?.id;
      const fact = memory.ingest({
        content: text,
        source: optionalString(input, 'source') ?? 'agent',
        ...pick(input, ['subject', 'tags', 'importance', 'sentiment', 'validFrom', 'supersedes']),
        scope: scopeValue,
        ...(scopeValue === 'session' && agentId !== undefined ? { sessionId: agentId } : {}),
      } as IngestInputLike);

      // 写入发生点 = 情绪联动点：取代旧事实 → CONFLICT 15；图式语义冲突 → CONFLICT 10
      const graphOutcome = graph.ingest(text);
      if (fact.onConflictTriggered) mood.applyEvent('CONFLICT', 15);
      if (graphOutcome.cognitiveDissonance) mood.applyEvent('CONFLICT', 10);
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
      '按时间口径召回：strict 当前真值 / historical 指定时刻为真（含已取代）/ belief 当时已知。render 走 Inline&Spill，expand 按图式带出关联。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: '检索语句。' },
        mode: {
          type: 'string',
          enum: ['strict', 'historical', 'belief'],
          description: '口径，默认 strict。',
        },
        validTime: { type: 'number', description: 'historical 的「那时」，Unix 毫秒。' },
        recordedTime: { type: 'number', description: 'belief 的「那时」，Unix 毫秒。' },
        limit: { type: 'number', description: '条数上限，默认 5。' },
        subject: { type: 'string', description: '限定主题。' },
        tags: { type: 'array', items: { type: 'string' }, description: '限定标签（全含）。' },
        render: { type: 'boolean', description: 'Inline&Spill：近期给正文，久远只给 ID。' },
        inlineChars: { type: 'number', description: 'render 单条上限，默认 240。' },
        expand: { type: 'boolean', description: '按图式带出同簇其他记忆（related）。' },
        scope: {
          type: 'string',
          enum: ['all', 'global', 'workspace', 'session'],
          description: '作用域过滤，默认 all。',
        },
      },
    },
    output: textOutput,
    async execute(args: unknown, exec?: unknown): Promise<string> {
      const input = asRecord(args);
      const query = requireString(input, 'query');
      const rawMode = optionalString(input, 'mode') ?? 'strict';
      if (rawMode !== 'strict' && rawMode !== 'historical' && rawMode !== 'belief') {
        throw new Error('mode 只能是 strict / historical / belief');
      }
      const agentId = (exec as { agent?: { id?: string } } | undefined)?.agent?.id;
      const options = {
        mode: rawMode as RecallMode,
        ...pick(input, ['validTime', 'recordedTime', 'limit', 'subject', 'tags', 'inlineChars', 'scope']),
        ...(agentId === undefined ? {} : { sessionId: agentId }),
      } as RecallOptionsLike;

      if (input.render === true) return JSON.stringify(memory.render(query, options));
      const hits = memory.recall(query, options);

      // 图式接进召回：把命中项所在图式的其他成员一并带出（GraphRAG 的社区扩展思路）
      const related =
        input.expand === true
          ? expandBySchema(memory, graph, hits.map((hit) => hit.fact.content))
          : [];

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
      '三段式辩证反思：THESIS → 对抗性 ANTITHESIS（CONTRADICTION/EVIDENCE 成对）→ SYNTHESIS，严格串行。给 draft 则跳过第一步；save 存结论。默认离线推理器，设置页可切真模型。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: '要反思的问题。' },
        draft: { type: 'string', description: '已有回答；给了就跳过第一步，直接批评并合成。' },
        save: { type: 'boolean', description: '把 synthesis 存成记忆（subject=结论:问题）。' },
      },
    },
    output: textOutput,
    async execute(args: unknown): Promise<string> {
      const input = asRecord(args);
      const query = requireString(input, 'query');
      const draft = optionalString(input, 'draft');
      const result =
        draft === undefined
          ? await reflection.reflect(query)
          : await reflection.reflectDraft(query, draft);
      const saved = input.save === true ? persistReflection(memory, graph, result) : undefined;
      if (saved !== undefined) touch();
      // 只回真正有用的四块：transcript 会把三段再抄一遍，phases 恒为固定顺序，durationMs 对模型无用。
      return JSON.stringify({
        query: result.query,
        thesis: result.thesis,
        contradictions: result.contradictions,
        synthesis: result.synthesis,
        ...(saved === undefined ? {} : { saved: { id: saved.id, subject: saved.subject } }),
      });
    },
  };

  const state = {
    name: 'cognition_state',
    description:
      '查看认知引擎状态：心情状态条、记忆库统计、图式网络统计。可用 event 施加一次心情事件。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        event: {
          type: 'string',
          enum: [...MOOD_EVENTS],
          description: '施加一次心情事件。',
        },
        intensity: { type: 'number', description: '力度倍数，默认 1。' },
      },
    },
    output: textOutput,
    async execute(args: unknown): Promise<string> {
      const input = asRecord(args);
      const event = optionalString(input, 'event');
      if (event !== undefined) {
        if (!MOOD_EVENTS.includes(event as MoodEvent)) {
          throw new Error(`event 只能是 ${MOOD_EVENTS.join(' / ')}`);
        }
        mood.apply(event as MoodEvent, optionalNumber(input, 'intensity') ?? 1);
        touch();
      }
      const current = mood.snapshot();
      return JSON.stringify(
        {
          mood: {
            bar: current.bar,
            statusBar: mood.getStatusBar(),
            label: current.mood as MoodLabel,
            emotion: current.emotion,
            energy: current.energy,
            favorability: current.favorability,
          },
          memory: memory.stats(),
          graph: graph.stats(),
          communities: graph.summarize(),
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
      '长程任务台账（tasks.json 落盘，重启恢复）。create 建任务 / update 改状态加线索 / list 查看 / due 查超时未更新 / delete 删除。后台每几小时自动巡视并复盘。',
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
      },
    },
    output: textOutput,
    async execute(args: unknown): Promise<string> {
      await tasksReady;
      const input = asRecord(args);
      const action = requireString(input, 'action');

      switch (action) {
        case 'create': {
          const task = await taskManager.create_task(requireString(input, 'description'));
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

  for (const definition of [remember, recall, forget, reflect, state, cognitionContext, manageLongTask]) {
    assertObjectSchema(definition.name, definition.parameters);
    disposers.push(tools.register(definition));
  }

  /**
   * agent/pre-step：模型每一步开始前做一次被动结算与情绪联动。
   * 不能阻断流程——任何异常都吞掉，最后必须 return next()。
   */
  const onPreStep = ctx.on?.(
    'agent/pre-step',
    async (payload: unknown, next: () => Promise<unknown>) => {
      try {
        const now = Date.now();

        // 1) 最近 1 小时写入的记忆条数
        const recentMemoryCount = memory
          .all()
          .filter((fact) => now - fact.recordedAt <= 3_600_000).length;

        // 2) 懒结算
        mood.settleTime(now, recentMemoryCount);

        // 3) 用最后一条用户消息做召回，带出怀旧与情绪批次
        const query = latestUserText(payload);
        if (query.length > 0) {
          const meta = memory.recallWithMeta(query, { mode: 'strict', limit: 5 });
          if (meta.isNostalgic) mood.applyEvent('NOSTALGIA', 5);
          if (meta.sentimentSum !== 0) mood.applyEvent('SENTIMENT_BATCH', meta.sentimentSum);
        }

        touch();
      } catch {
        // 情绪联动失败不能影响主流程
      }
      return next();
    },
  );
  if (typeof onPreStep === 'function') disposers.push(onPreStep);

  /**
   * 后台巡视：每隔 patrolIntervalHours 检查 tasks.json，
   * 用 ReflectionWorker 在后台宏任务里复盘最久没动的任务，全程不阻塞主线程。
   */
  const patrol = async (): Promise<void> => {
    try {
      await tasksReady;
      const due = taskManager.check_due_tasks();
      const target = due[0];
      if (target === undefined) return;
      ctx.logger?.info?.(
        `cognition-engine: 巡视发现 ${due.length} 个待催办任务，后台复盘 ${target.id}`,
      );
      const overdueHours = Math.round(target.overdueMs / 3_600_000);
      const result = await worker.submit(
        `长程任务「${target.description}」已 ${overdueHours} 小时没有更新，下一步应该推进什么`,
      );
      const firstLine = (result.synthesis.split(/\r?\n/)[0] ?? '').slice(0, 200);
      await taskManager.update_task_progress(target.id, target.status, `自动巡视：${firstLine}`);
    } catch (error) {
      ctx.logger?.warn?.(
        `cognition-engine: 巡视失败 ${messageOf(error)}`,
      );
    }
  };

  const timer = setInterval(() => {
    void patrol();
  }, config.patrolIntervalHours * 3_600_000);
  timer.unref?.();

  const disposeAll = (): void => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    stateStore.close();
    void stateStore.flush();
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // 卸载阶段忽略单个工具的反注册异常
      }
    }
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAll);
  }
  ctx.logger?.info?.(
    'cognition-engine: 已注册 cognition_remember / cognition_recall / cognition_forget / cognition_reflect / cognition_state / manage_long_task',
  );
  return disposeAll;
}
