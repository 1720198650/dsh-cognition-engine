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
 *   cognition_state     记忆与图式网络统计
 */

import { randomUUID } from 'node:crypto';

import { TemporalMemoryStore } from './memory.ts';
import type { TemporalFact } from './memory.ts';
import { SchemaGraphManager } from './graph.ts';
import { JsonStateStore } from './persist.ts';
import { buildDetail, buildCoreDigest } from './views.ts';
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker } from './reflection.ts';
import { assertObjectSchema, messageOf } from './util.ts';
import { createTools } from './tools.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';

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

/** 宿主 systemPrompt 服务的最小可用面（只用到 section）。 */
interface PromptSectionLike {
  name: string;
  order: number;
  text: string | ((context: unknown) => string);
}

interface SystemPromptHost {
  section(section: PromptSectionLike): () => void;
}

/** 落盘的整体状态。 */
interface PersistedState {
  version: number;
  facts: TemporalFact[];
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
  /** 是否把跨会话摘要注入系统提示。默认 true；false 时只能靠 cognition_context 手动取。 */
  injectMemory?: boolean;
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
  /** 记忆的落盘路径，默认 <cwd>/cognition-state.json。 */
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
    injectMemory: config.injectMemory !== false,
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
  // —— 落盘：记忆 ——
  const stateStore = new JsonStateStore<PersistedState>({
    ...(config.stateFile === undefined ? {} : { filePath: config.stateFile }),
    serialize: () => ({ version: 1, facts: memory.serialize() }),
    restore: (data) => {
      if (Array.isArray(data.facts)) memory.restore(data.facts);
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
      // 单段最多等 90 秒，避免模型卡住把整个反思流程挂死
      signal: AbortSignal.timeout(90_000),
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
    return {
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
  const detail = (): Record<string, unknown> => buildDetail({ memory, graph, taskManager });

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
      try {
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
      } catch (error) {
        // 路由被别的插件占用：跳过，不能把插件加载搞挂
        ctx.logger?.warn?.(
          `cognition-engine: 路由 ${path} 注册失败（可能与其他插件冲突）: ${messageOf(error)}`,
        );
      }
    };

    route('/cognition-engine/state', () => snapshot());
    route('/cognition-engine/detail', () => detail(), { requireAuth: true });

    /** 读 ?name=true 这类布尔开关。 */
    const flag = (url: URL, name: string): boolean => url.searchParams.get(name) === 'true';

    // 清空：scope = memory / all
    route(
      '/cognition-engine/clear',
      (url) => {
        const scope = url.searchParams.get('scope') ?? 'memory';
        if (scope !== 'memory' && scope !== 'all') {
          throw new Error('scope 只能是 memory / all');
        }
        let removed = 0;
        removed = memory.all().length;
        for (const fact of memory.all()) memory.remove(fact.id);
        graph.reset();
        void stateStore.flush();
        return { cleared: 'memory', removed, memory: memory.stats() };
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

  const toolList = createTools({
    memory,
    graph,
    taskManager,
    proactive,
    touch,
    reflection,
    persistReflection: (result) => persistReflection(memory, graph, result),
    tasksReady,
    config,
  });
  const [remember, recall, forget, reflect, state, cognitionContext, manageLongTask] = toolList;

  for (const definition of [remember, recall, forget, reflect, state, cognitionContext, manageLongTask]) {
    try {
      assertObjectSchema(definition.name, definition.parameters);
      disposers.push(tools.register(definition));
    } catch (error) {
      // 与其他插件重名、或宿主改了 schema 约定：只跳过这一个工具，其余照常注册
      ctx.logger?.warn?.(
        `cognition-engine: 工具 ${definition.name} 注册失败（可能与其他插件重名）: ${messageOf(error)}`,
      );
    }
  }

  /**
   * P0：把跨会话核心记忆挂进系统提示，只在真的有记忆时才产出文本。
   *
   * 每次装配都会调用 text()，内容永远是最新的；没有记忆时返回空串——不占 token。
   */
  const systemPrompt = ctx.get?.('systemPrompt') as SystemPromptHost | undefined;
  if (config.injectMemory && systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    try {
      disposers.push(
        systemPrompt.section({
          name: 'cognition-engine-memory',
          order: 900,
          text: () => {
            const digest = buildCoreDigest(memory);
            if (digest.length === 0) return '';
            return `${digest}\n（需要细节时调用 cognition_recall。）`;
          },
        }),
      );
    } catch (error) {
      ctx.logger?.warn?.(`cognition-engine: 系统提示段注册失败: ${messageOf(error)}`);
    }
  }

  /**
   * 后台巡视：每隔 patrolIntervalHours 检查 tasks.json，
   * 用 ReflectionWorker 在后台宏任务里复盘最久没动的任务，全程不阻塞主线程。
   */
  const patrol = async (): Promise<void> => {
    try {
      await tasksReady;

      // P1 记忆生命周期：长期没被想起的记忆退出 strict 召回（不删数据）
      const archived = memory.autoArchive({ idleDays: 180, maxActivation: 1 });
      if (archived.length > 0) {
        ctx.logger?.info?.(`cognition-engine: 已归档 ${archived.length} 条长期未访问的记忆`);
        touch();
      }

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
