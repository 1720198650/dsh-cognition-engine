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
import { basename } from 'node:path';

import { TemporalMemoryStore } from './memory.ts';
import type { TemporalFact } from './memory.ts';
import { SchemaGraphManager } from './graph.ts';
import { JsonStateStore } from './persist.ts';
import { buildDetail, buildCoreDigest } from './views.ts';
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker } from './reflection.ts';
import { assertObjectSchema, messageOf, parseMoment } from './util.ts';
import { createTools } from './tools.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
import { AuditLog } from './audit.ts';
import { PlaybookStore } from './playbook.ts';
import { buildDistillPrompt, parseDistillResult } from './distill.ts';

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
/** 反思引擎模式：关闭 / 本地占位 / 真实模型。 */
export type ReflectionMode = 'off' | 'local' | 'real';

export function normalizeReflectionMode(value: unknown): ReflectionMode {
  if (value === 'local' || value === 'real' || value === 'off') return value;
  // 任何无法识别的值都退回关闭——默认产出模板内容比不产出更糟。
  return 'off';
}

interface PersistedState {
  version: number;
  facts: TemporalFact[];
  /** 反思引擎是否使用真实模型（重启后保留）。 */
  /** 反思引擎模式（重启后保留）：off / local / real。 */
  reflectionMode?: string;
  /** 旧字段，仅用于迁移。 */
  realModel?: boolean;
  /** 记忆准入规则（重启后保留）。 */
  rules?: Record<string, boolean>;
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
  /** 准则本注入预算（字符），默认 600。 */
  playbookChars?: number;
  /** 准则本条目上限，默认 12。 */
  playbookMaxEntries?: number;
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
  /** 反思引擎初始模式，默认 off（不开启，避免默认产出误导性输出）。 */
  reflectionMode?: string;
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

/**
 * 解析访问口令。
 *
 * 安全默认值（方案 C）：
 *   - config.lockToken 显式传空串 '' → 主动关闭保护（需自行承担风险）
 *   - config.lockToken 传了字符串   → 用它
 *   - 什么都没传（默认）            → 自动生成并持久化到 `.cognition-token`
 *
 * 默认上锁：同机的其他程序无法读走记忆正文或清空记忆。
 */
function resolveLockToken(config: CognitionConfig): string | null {
  // 只有显式配置了口令才上锁。
  // 早期版本会「默认自动生成口令」，但那个口令就存在数据文件旁边，
  // 对同机进程毫无防护作用，只会把页面自己的写操作挡在门外。
  if (typeof config.lockToken === 'string' && config.lockToken.trim().length > 0) {
    return config.lockToken.trim();
  }
  return null;
}
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
    playbookChars: Math.max(200, Math.round(numberOr(config.playbookChars, 600))),
    playbookMaxEntries: Math.max(1, Math.round(numberOr(config.playbookMaxEntries, 12))),
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
    reflectionMode: normalizeReflectionMode(config.reflectionMode),
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

  const audit = new AuditLog();
  const playbook = new PlaybookStore({
    maxChars: config.playbookChars,
    maxEntries: config.playbookMaxEntries,
    // 来源校验：sourceIds 必须真实存在，防止模型臆造出处
    validateSourceIds: (ids) => ids.filter((id) => memory.get(id) !== undefined),
  });
  const memory = new TemporalMemoryStore({
    halfLifeMs: config.decayHalfLifeHours * HOUR_MS,
    onEvent: (event) => audit.append(event),
  });
  const graph = new SchemaGraphManager({
    assimilateThreshold: config.assimilateThreshold,
    overlapThreshold: config.overlapThreshold,
    communityThreshold: config.communityThreshold,
    maxClusterSize: config.maxClusterSize,
  });
  /** 从存档恢复出来的模式（在 reflectionMode 声明前捕获）。 */
  let restoredReflectionMode: ReflectionMode | undefined;

  // —— 落盘：记忆 ——
  const stateStore = new JsonStateStore<PersistedState>({
    ...(config.stateFile === undefined ? {} : { filePath: config.stateFile }),
    serialize: () => ({ version: 1, facts: memory.serialize(), reflectionMode, rules: { ...memory.getRules() } as Record<string, boolean> }),
    restore: (data) => {
      if (Array.isArray(data.facts)) memory.restore(data.facts);
      if (typeof data.reflectionMode === 'string') restoredReflectionMode = normalizeReflectionMode(data.reflectionMode);
      // 兼容旧存档：realModel: true 等价于 real
      else if (data.realModel === true) restoredReflectionMode = 'real';
      if (data.rules !== undefined) memory.setRules(data.rules as never);
    },
  });
  try {
    playbook.loadSync();
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
  let reflectionMode: ReflectionMode = restoredReflectionMode ?? normalizeReflectionMode(config.reflectionMode);
  /** 上锁口令；null 表示未上锁。 */
  let lockToken: string | null = resolveLockToken(config);
  /** 用户是否显式配置了口令（决定 /detail 是否要鉴权）。 */
  const explicitLock = typeof config.lockToken === 'string' && config.lockToken.trim().length > 0;

  const resolveModel = (): { provider: string; model: string } => {
    if (config.llmProvider !== undefined && config.llmModel !== undefined) {
      return { provider: config.llmProvider, model: config.llmModel };
    }
    const host = ctx.get?.('agentDefaultModel') as DefaultModelHost | undefined;
    const selection = host?.currentSelection?.();
    return { provider: selection?.provider ?? '', model: selection?.model ?? '' };
  };

  const callRealModel = async (prompt: string, maxTokens = 2000): Promise<string> => {
    const llm = ctx.get?.('llm') as LlmService | undefined;
    if (llm === undefined || typeof llm.stream !== 'function') throw new Error('llm 服务不可用');
    const { provider, model } = resolveModel();
    if (provider === '' || model === '') {
      throw new Error('未找到可用模型：请在 cordis.patch.yml 设 llmProvider / llmModel');
    }
    let text = '';
    // 诊断用：记录收到过哪些 chunk 类型，空内容时能说清是模型没吐字还是字段名对不上。
    const seen = new Map<string, number>();
    for await (const chunk of llm.stream({
      provider,
      model,
      // 800 不够：蒸馏输出是完整 JSON，反思 synthesis 也常超；
      // 截断后 JSON 解析失败，解析器只能原样返回半截文本。
      maxTokens,
      // 单段最多等 90 秒，避免模型卡住把整个反思流程挂死
      signal: AbortSignal.timeout(90_000),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })) {
      const type = String((chunk as { type?: unknown }).type ?? 'unknown');
      seen.set(type, (seen.get(type) ?? 0) + 1);
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') throw new Error('模型返回错误');
    }
    if (text.trim().length === 0) {
      const shapes = [...seen.entries()].map(([type, count]) => `${type}×${count}`).join(', ');
      throw new Error(`模型返回空内容（收到 chunk：${shapes.length > 0 ? shapes : '无'}）`);
    }
    return text;
  };

  /**
   * 准则蒸馏：从未被覆盖的记忆里提炼候选，并给现有准则打标记。
   *
   * 不直接改准则——候选进 pending，标记直接生效（标记可以随时改回来，风险低）。
   */
  const runDistill = async (options: { maxCandidates?: number } = {}): Promise<Record<string, unknown>> => {
    if (reflectionMode === 'off') {
      throw new Error('反思引擎未开启：准则蒸馏需要真实模型，请在设置页切到「真实模型」');
    }
    if (reflectionMode === 'local') {
      throw new Error('本地占位引擎无法蒸馏准则：它只会输出固定模板，请切换到「真实模型」');
    }

    // 已被任何准则引用过的记忆不再重复喂给模型
    const referenced = new Set(playbook.all().flatMap((entry) => entry.sourceIds));
    const uncovered = memory
      .all()
      .filter((fact) => fact.deletedAt === undefined && fact.supersededAt === null && !fact.archived)
      .filter((fact) => !referenced.has(fact.id))
      .sort((a, b) => b.importance - a.importance || b.recordedAt - a.recordedAt)
      .slice(0, 20)
      .map((fact) => ({ id: fact.id, subject: fact.subject, content: fact.content }));

    const prompt = buildDistillPrompt({
      entries: playbook.all(),
      memories: uncovered,
      maxCandidates: options.maxCandidates ?? 5,
    });

    const raw = await callRealModel(prompt);
    const parsed = parseDistillResult(raw);

    // 标记直接生效：helpful/harmful 可以再改，风险低
    let marked = 0;
    for (const item of parsed.marks) {
      if (playbook.mark(item.id, item.mark)) marked += 1;
    }

    // 候选进 pending，必须人工审核
    const submitted: Array<Record<string, unknown>> = [];
    for (const candidate of parsed.candidates) {
      // 相对表达（"7d"）与 ISO 日期都由 parseMoment 归一成毫秒；解析不了就当长期有效。
      const validTo = candidate.validUntil === undefined ? null : (parseMoment(candidate.validUntil) ?? null);
      const outcome = playbook.submit({
        section: candidate.section,
        content: candidate.content,
        sourceIds: candidate.sourceIds,
        validTo,
      });
      submitted.push({
        content: candidate.content,
        section: candidate.section ?? '未分类',
        accepted: outcome.accepted,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        ...(outcome.entry === undefined ? {} : { id: outcome.entry.id }),
        ...(validTo === null ? {} : { validTo }),
        ...(outcome.entry?.conflictWith === undefined ? {} : { conflictWith: outcome.entry.conflictWith }),
      });
    }
    await playbook.flush();

    return {
      reflection: parsed.reflection,
      marked,
      candidates: submitted,
      uncoveredMemories: uncovered.length,
      parseFailed: parsed.raw !== undefined,
      // 解析失败时把模型原文前 600 字带出来，否则无法判断是格式问题还是内容问题。
      ...(parsed.raw === undefined ? {} : { rawPreview: parsed.raw.slice(0, 600) }),
      stats: playbook.stats(),
    };
  };

  const reflection = new DialecticalReflectionEngine((prompt, phase) =>
    reflectionMode === 'real'
      ? callRealModel(prompt)
      : reflectionMode === 'local'
        // 不在中间产物上加警示：它会作为下一阶段的输入，会被模型当成正文引用。
        // 警示统一在工具层按模式补。
        ? Promise.resolve(mockLLM.call(prompt, phase))
        : Promise.reject(new Error('反思引擎未开启：请在设置页开启，或直接回答而不调用 cognition_reflect')),
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
      model: (() => {
        const resolved = resolveModel();
        return {
          enabled: reflectionMode !== 'off',
      mode: reflectionMode,
          provider: resolved.provider,
          model: resolved.model,
          available: resolved.provider !== '' && resolved.model !== '',
        };
      })(),
      locked: lockToken !== null,
      storageFile: basename(stateStore.path),
      playbook: {
        ...playbook.stats(),
        /** 当前注入的是准则本、原始记忆摘要，还是都不注入。 */
        injectSource: (() => {
          if (playbook.renderSection().length > 0) return 'playbook';
          return buildCoreDigest(memory).length > 0 ? 'digest' : 'none';
        })(),
      },
      storageWarning: stateStore.warning,
      rules: memory.getRules(),
      updatedAt: Date.now(),
    };
  };

  /** 面板展开时按需拉取的明细（不走模型上下文，只给页面看）。 */
  const detail = (): Record<string, unknown> => buildDetail({ memory, graph, taskManager });

  // 宿主 → 页面 的数据桥：Client 半区 fetch('/cognition-engine/state')
  // 注意：不能放在 /api 前缀下——那条前缀归 API 网关所有，会先被它 401 掉。
  const setupRoutes = (webServer: WebServerHost): void => {
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
            handler: async (request, response) => {
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
                send(response, 200, await produce(new URL(req.url ?? path, 'http://local')));
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
    // 读取记忆默认开放（令牌文件本就可被同机进程读取，锁读取只增加摩擦）；
    // 显式配置 lockToken 时才保护详情。写操作（clear/model/lock）始终需要口令。
    route('/cognition-engine/detail', () => detail(), { requireAuth: explicitLock });

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
        reflectionMode = normalizeReflectionMode(url.searchParams.get('mode'));
        void stateStore.flush();
        const { provider, model } = resolveModel();
        return { enabled: reflectionMode !== 'off', mode: reflectionMode, provider, model, available: provider !== '' && model !== '' };
      },
      { method: 'POST', requireAuth: true },
    );

    // 界面直接新建任务（含时间段）
    route(
      '/cognition-engine/task/create',
      async (url) => {
        const description = (url.searchParams.get('description') ?? '').trim();
        if (description.length === 0) throw new Error('description 不能为空');
        const s = url.searchParams.get('startAt');
        const e = url.searchParams.get('endAt');
        const task = await taskManager.create_task(description, {
          ...(s === null ? {} : { startAt: Number(s) }),
          ...(e === null ? {} : { endAt: Number(e) }),
        });
        return { task };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 调整任务顺序 / 并行
    route(
      '/cognition-engine/task/meta',
      async (url) => {
        const id = url.searchParams.get('id') ?? '';
        const o = url.searchParams.get('order');
        const pl = url.searchParams.get('parallel');
        const task = await taskManager.set_meta(id, {
          ...(o === null ? {} : { order: Number(o) }),
          ...(pl === null ? {} : { parallel: pl === 'true' }),
        });
        if (task === undefined) throw new Error('任务不存在');
        return { task };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 归并同类记忆（手动触发）
    route(
      '/cognition-engine/consolidate',
      () => {
        const groups = memory.consolidate();
        void stateStore.flush();
        return {
          groups: groups.length,
          merged: groups.reduce((sum, group) => sum + group.merged.length, 0),
          detail: groups,
        };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 删除任务
    route(
      '/cognition-engine/task/delete',
      async (url) => {
        const id = url.searchParams.get('id') ?? '';
        const ok = await taskManager.delete_task(id);
        if (!ok) throw new Error('任务不存在');
        return { id, deleted: true };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 删除主题（成员记忆保留）
    route(
      '/cognition-engine/schema/delete',
      (url) => {
        const id = url.searchParams.get('id') ?? '';
        if (!graph.removeSchema(id)) throw new Error('主题不存在');
        void stateStore.flush();
        return { id, deleted: true };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 删除 / 恢复一条记忆（软删除）
    route(
      '/cognition-engine/memory/delete',
      (url) => {
        const id = url.searchParams.get('id') ?? '';
        const restore = url.searchParams.get('restore') === 'true';
        const ok = restore ? memory.restoreDeleted(id) : memory.softDelete(id);
        if (!ok) throw new Error(restore ? '没有可恢复的记忆' : '记忆不存在');
        void stateStore.flush();
        return { id, deleted: !restore };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 手动修正一条记忆
    route(
      '/cognition-engine/memory/update',
      (url) => {
        const id = url.searchParams.get('id') ?? '';
        const content = url.searchParams.get('content');
        const subject = url.searchParams.get('subject');
        const recordedAt = url.searchParams.get('recordedAt');
        const superseded = url.searchParams.get('superseded');
        const fact = memory.updateFact(id, {
          ...(content === null ? {} : { content }),
          ...(subject === null ? {} : { subject }),
          ...(recordedAt === null ? {} : { recordedAt: Number(recordedAt) }),
          ...(superseded === null ? {} : { superseded: superseded === 'true' }),
        });
        if (fact === undefined) throw new Error('记忆不存在');
        void stateStore.flush();
        return {
          id: fact.id,
          content: fact.content,
          recordedAt: fact.recordedAt,
          superseded: fact.supersededAt !== null,
        };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 界面直接写记忆
    route(
      '/cognition-engine/memory/create',
      (url) => {
        const content = (url.searchParams.get('content') ?? '').trim();
        if (content.length === 0) throw new Error('content 不能为空');
        const subject = url.searchParams.get('subject') ?? undefined;
        const fact = memory.ingest({ content, subject, source: 'user', origin: 'ui' });
        graph.ingest(content);
        void stateStore.flush();
        return { id: fact.id, subject: fact.subject };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 记忆准入规则：读 / 改
    route('/cognition-engine/rules', () => ({ rules: memory.getRules() }));
    route(
      '/cognition-engine/rules/set',
      (url) => {
        const patch: Record<string, boolean> = {};
        for (const key of ['transient', 'sensitive', 'injection', 'authority']) {
          const v = url.searchParams.get(key);
          if (v !== null) patch[key] = v === 'true';
        }
        memory.setRules(patch as never);
        void stateStore.flush();
        return { rules: memory.getRules() };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // —— 准则蒸馏 ——
    route(
      '/cognition-engine/playbook/distill',
      async (url) => {
        const raw = url.searchParams.get('maxCandidates');
        const maxCandidates = raw === null ? 5 : Math.max(1, Math.min(10, Number(raw)));
        return runDistill({ maxCandidates: Number.isFinite(maxCandidates) ? maxCandidates : 5 });
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // —— 准则本 ——
    route('/cognition-engine/playbook', () => ({
      stats: playbook.stats(),
      // 带上计算出来的过期标记：页面不用自己算时间，也能正确分组到「已过期」
      entries: playbook.all().map((entry) => ({
        ...entry,
        expired: entry.status === 'active' && playbook.isExpired(entry),
      })),
      rendered: playbook.render(),
    }));

    route(
      '/cognition-engine/playbook/candidate',
      async (url) => {
        const rawValidTo = url.searchParams.get('validTo');
        const outcome = playbook.submit({
          content: url.searchParams.get('content') ?? '',
          section: url.searchParams.get('section') ?? undefined,
          sourceIds: (url.searchParams.get('sourceIds') ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
          validTo: rawValidTo === null ? null : (parseMoment(rawValidTo) ?? null),
        });
        if (outcome.accepted) await playbook.flush();
        return outcome;
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    route(
      '/cognition-engine/playbook/add',
      async (url) => {
        const outcome = playbook.addManual({
          content: url.searchParams.get('content') ?? '',
          section: url.searchParams.get('section') ?? undefined,
        });
        if (outcome.accepted) await playbook.flush();
        return outcome;
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    route(
      '/cognition-engine/playbook/act',
      async (url) => {
        const id = url.searchParams.get('id') ?? '';
        const action = url.searchParams.get('action') ?? '';
        let ok = false;
        switch (action) {
          case 'accept': ok = playbook.accept(id); break;
          case 'reject': ok = playbook.reject(id); break;
          case 'retire': ok = playbook.retire(id, '手动停用'); break;
          case 'revive': ok = playbook.revive(id); break;
          case 'revise': ok = playbook.revise(id, url.searchParams.get('content') ?? ''); break;
          case 'extend': {
            const raw = url.searchParams.get('validTo');
            ok = playbook.extend(id, raw === null ? null : (parseMoment(raw) ?? null));
            break;
          }
          case 'helpful': ok = playbook.mark(id, 'helpful'); break;
          case 'harmful': ok = playbook.mark(id, 'harmful'); break;
          default: throw new Error('action 只能是 accept/reject/retire/revive/revise/helpful/harmful');
        }
        if (!ok) throw new Error(`准则本操作失败：${action} ${id}`);
        await playbook.flush();
        return { id, action, ok };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 审计日志（最近 N 条）
    route(
      '/cognition-engine/audit',
      async (url) => {
        const raw = url.searchParams.get('limit');
        const limit = raw === null ? 20 : Number(raw);
        const lines = await audit.tail(Number.isFinite(limit) ? limit : 20);
        return {
          path: audit.path,
          count: lines.length,
          items: lines.map((line) => {
            try {
              return JSON.parse(line) as Record<string, unknown>;
            } catch {
              return { raw: line };
            }
          }),
        };
      },
    );

    // 快照列表与回滚
    route('/cognition-engine/snapshots', async () => ({ items: await stateStore.listSnapshots() }));
    route(
      '/cognition-engine/snapshot/restore',
      async (url) => {
        const name = url.searchParams.get('name') ?? '';
        const ok = await stateStore.restoreSnapshot(name);
        if (!ok) throw new Error('快照不存在或名称非法');
        stateStore.clearWarning();
        return { restored: name };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 导出：整库记忆（JSON）
    route('/cognition-engine/export', () => ({
      version: 1,
      exportedAt: Date.now(),
      facts: memory.serialize(),
    }));

    // 导入：用请求体里的 JSON 整体替换记忆库
    route(
      '/cognition-engine/import',
      (url) => {
        const raw = url.searchParams.get('payload');
        if (raw === null || raw.length === 0) throw new Error('缺少 payload');
        const parsed = JSON.parse(raw) as { facts?: unknown };
        if (!Array.isArray(parsed.facts)) throw new Error('payload.facts 必须是数组');
        for (const fact of memory.all()) memory.remove(fact.id);
        // 导入的条目统一标成 import 通道，避免外部内容冒充用户陈述
        const imported = (parsed.facts as Array<Record<string, unknown>>).map((fact) => ({
          ...fact,
          origin: 'import',
        }));
        memory.restore(imported as never);
        graph.reset();
        for (const fact of memory.all()) graph.ingest(fact.content);
        void stateStore.flush();
        return { imported: memory.stats().total };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 上锁开关：开启时返回口令，页面用它设置 x-cognition-token
    route(
      '/cognition-engine/lock',
      (url) => {
        lockToken = flag(url, 'enabled') ? (config.lockToken ?? randomUUID()) : null;
        return { locked: lockToken !== null, token: lockToken };
      },
      // 自动生成的口令可自助开关；用户显式配置口令时才要求鉴权
      { method: 'POST', requireAuth: explicitLock },
    );
  };

  const webServer = ctx.get?.('webServer') as WebServerHost | undefined;
  if (webServer !== undefined && typeof webServer.register === 'function') {
    setupRoutes(webServer);
  } else {
    // 宿主启动顺序可能晚于插件：轮询等待 webServer 出现后补注册，避免全部 404
    let tries = 0;
    const waitTimer = setInterval(() => {
      tries += 1;
      const late = ctx.get?.('webServer') as WebServerHost | undefined;
      if (late !== undefined && typeof late.register === 'function') {
        clearInterval(waitTimer);
        try {
          setupRoutes(late);
          ctx.logger?.info?.('cognition-engine: webServer 就绪，HTTP 路由已补注册');
        } catch (error) {
          ctx.logger?.warn?.(`cognition-engine: 路由补注册失败: ${messageOf(error)}`);
        }
      } else if (tries >= 120) {
        clearInterval(waitTimer);
      }
    }, 500);
    waitTimer.unref?.();
    disposers.push(() => clearInterval(waitTimer));
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
    // 这两个之前漏传：导致「本地占位告警」从未出现、准则蒸馏不可用。
    currentReflectionMode: () => reflectionMode,
    distillPlaybook: runDistill,
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
