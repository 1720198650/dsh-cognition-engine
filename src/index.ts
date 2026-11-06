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

import { GapStore } from './gaps.ts';
import { PlaybookEventLog } from './events.ts';
import { InjectionLog, TurnFeedbackTracker, classifyFeedback, extractUserText } from './injection_log.ts';
import type { FeedbackKind } from './injection_log.ts';
import { PersonaStore } from './persona.ts';
import { CpeStore } from './cpe.ts';
import { BudgetStore } from './budget.ts';
import { ShadowStore } from './shadow.ts';
import { shouldReject, summarize } from './notlearn.ts';
import { StyleStore } from './style.ts';
import type { StyleBucket } from './style.ts';
import { TemporalMemoryStore, textSimilarity } from './memory.ts';
import type { TemporalFact } from './memory.ts';
import { JsonStateStore } from './persist.ts';
import { buildDetail, buildCoreDigest } from './views.ts';
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker } from './reflection.ts';
import { assertObjectSchema, dataDir, messageOf, migrateLegacyData, parseMoment } from './util.ts';
import { createTools } from './tools.ts';
import { ProactiveGate } from './proactive.ts';
import { ProactiveStore, scoreScan } from './proactive_scan.ts';
import type { ScanSource } from './proactive_scan.ts';
import { RecallLog, RetrievalEvalStore } from './retrieval.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
import { AuditLog } from './audit.ts';
import { PlaybookStore } from './playbook.ts';
import { TopicStore } from './topics.ts';
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
  /**
   * 可选：解析模型能力。用来查这个模型支持哪些推理档位。
   *
   * 这个能力很关键：当前模型会先吐很长的 reasoning 再吐正文，
   * 推理 token 也计入 maxTokens。不压低推理档位的话，2000 token 会被推理吃光、
   * 正文一个字没有。老版本宿主可能没有这个方法，所以是可选。
   */
  resolveModelInfo?(
    provider: string,
    model: string,
  ): Promise<{ reasoning?: { efforts?: Array<{ id: string; name?: string }>; defaultEffort?: string } } | undefined>;
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
  /** 准则本注入预算（字符），默认 700。 */
  playbookChars?: number;
  /** 准则本条目上限，默认 12。 */
  playbookMaxEntries?: number;
  /**
   * 是否开启自动反馈闭环：用宿主的真实轮次（session/event）记录每轮注入了哪些准则，
   * 并在下一轮用「用户这句话是纠正还是确认」回写 appliedBad / appliedGood。
   *
   * 默认开启。关掉后注入快照与自动回写都停止，只剩手动 `/cognition-engine/feedback`。
   * 关掉的理由只有一个：怀疑正则误判在污染准则证据时，先停下来观察。
   */
  autoFeedback?: boolean;
  /**
   * 巡逻发现逾期任务时，是否自动调用模型做一次三段式复盘。
   *
   * 默认关闭：一次完整复盘 = 3 次模型调用 ≈ 3100 tokens，每 3 小时可能触发一次。
   * 关掉后巡逻仍会写「已超期 N 小时」的提示，只是不烧 token。
   */
  autoReflect?: boolean;
  /**
   * 反思/蒸馏的推理档位。留空 = 自动（选模型声明的最低档）。
   *
   * 设成别的值是省 token / 求质量之间的手动权衡：当前模型默认档位会先吐上万字推理，
   * 且推理 token 与正文共用 maxTokens，档位过高会把正文挤没。
   */
  reflectionEffort?: string;
  /** 多久没更新就算需要催办（小时）。 */
  heartbeatHours?: number;
  /** 后台巡视间隔（小时）。 */
  patrolIntervalHours?: number;
  /** 冷场判定阈值（分钟）。 */
  idleThresholdMinutes?: number;
  /** 主动发言默认只记录不发送。 */
  recordOnly?: boolean;
  /**
   * tasks.json 路径。默认 `~/.dsh/cognition-engine/tasks.json`。
   *
   * 支持 `~`（展开到用户主目录）；相对路径按进程 cwd 解析，跨工作区/跨机器不可靠，
   * 不建议在配置里用相对路径。
   */
  tasksFile?: string;
  /** 记忆的落盘路径，默认 `~/.dsh/cognition-engine/cognition-state.json`。 */
  stateFile?: string;
  /** 准则本的落盘路径，默认 `~/.dsh/cognition-engine/cognition-playbook.json`。 */
  playbookFile?: string;
  /** 主题注册表的落盘路径，默认 `~/.dsh/cognition-engine/cognition-topics.json`。 */
  topicsFile?: string;
  /**
   * 人格块文件路径，默认 `~/.dsh/cognition-engine/cognition-persona.json`。
   *
   * 文件不存在 = 没有人格，注入段不占 token。要启用人格就把 schema 示例拷过去。
   */
  personaFile?: string;
  /** 是否注入人格块（文件存在才生效），默认 true。 */
  personaEnabled?: boolean;
  /**
   * 是否开启风格指纹（S4）。
   *
   * 默认开启，但**只落统计量、不落原文**：记录的是平均句长、语气词频率这类数字，
   * 翻不出「当时说了什么」。要复现原文只能去 session 日志。
   */
  styleEnabled?: boolean;
  /** 风格样本下限（轮数），少于它一律报 insufficient，不给假分数。默认 60。 */
  styleMinTurns?: number;
  /** 风格样本下限（字符数），默认 6000。 */
  styleMinChars?: number;
  /** 自定义口癖（3–5 个），用于算 catchphrasePerK。默认空。 */
  styleCatchphrases?: string[];
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
  Omit<
    CognitionConfig,
    'tasksFile' | 'stateFile' | 'playbookFile' | 'topicsFile' | 'personaFile' | 'lockToken' | 'llmProvider' | 'llmModel'
  >
> & {
  tasksFile?: string;
  stateFile?: string;
  playbookFile?: string;
  topicsFile?: string;
  personaFile?: string;
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
 * 当前行为：
 *   - config.lockToken 显式传字符串 → 用它上锁
 *   - 其他情况（含显式传空串）      → 不上锁
 *
 * 为什么不默认自动生成：早期版本会生成口令写到数据文件旁边，
 * 那对同机进程毫无防护作用，只会把页面自己的写操作挡在门外。
 * 想防同机其他程序读记忆正文，必须自己配一个口令。
 */
function resolveLockToken(config: CognitionConfig): string | null {
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
    playbookChars: Math.max(200, Math.round(numberOr(config.playbookChars, 700))),
    playbookMaxEntries: Math.max(1, Math.round(numberOr(config.playbookMaxEntries, 12))),
    autoFeedback: config.autoFeedback !== false,
    autoReflect: config.autoReflect === true,
    reflectionEffort: config.reflectionEffort ?? '',
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
    playbookFile:
      typeof config.playbookFile === 'string' && config.playbookFile.trim().length > 0
        ? config.playbookFile
        : undefined,
    topicsFile:
      typeof config.topicsFile === 'string' && config.topicsFile.trim().length > 0
        ? config.topicsFile
        : undefined,
    personaFile:
      typeof config.personaFile === 'string' && config.personaFile.trim().length > 0
        ? config.personaFile
        : undefined,
    personaEnabled: config.personaEnabled !== false,
    styleEnabled: config.styleEnabled !== false,
    styleMinTurns: Math.max(5, Math.round(numberOr(config.styleMinTurns, 60))),
    styleMinChars: Math.max(200, Math.round(numberOr(config.styleMinChars, 6000))),
    styleCatchphrases: Array.isArray(config.styleCatchphrases)
      ? config.styleCatchphrases.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 5)
      : [],
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
  return fact;
}


/* ------------------------------------------------------------------ */
/* 插件入口                                                            */
/* ------------------------------------------------------------------ */

export function apply(ctx: PluginContext, rawConfig?: unknown): (() => void) | undefined {
  const config = normalizeConfig(rawConfig);

  const audit = new AuditLog();
  const playbook = new PlaybookStore({
    ...(config.playbookFile === undefined ? {} : { filePath: config.playbookFile }),
    maxChars: config.playbookChars,
    maxEntries: config.playbookMaxEntries,
    // 来源校验：sourceIds 必须真实存在，防止模型臆造出处
    validateSourceIds: (ids) => ids.filter((id) => memory.get(id) !== undefined),
    // 证据链：源记忆必须仍然「活着」——未被取代、未删除、未归档。
    // 只要它变了，依赖它的准则就该知道自己失去了支撑（Doyle TMS）。
    isSourceAlive: (id) => {
      const fact = memory.get(id);
      if (fact === undefined) return false;
      if (fact.deletedAt !== undefined) return false;
      if (fact.supersededAt !== null) return false;
      if (fact.archived) return false;
      return true;
    },
  });
  const topics = new TopicStore({
    ...(config.topicsFile === undefined ? {} : { filePath: config.topicsFile }),
  });

  // 知识缺口：模型卡壳时登记，下次针对性补（P6 学习闭环）
  const gaps = new GapStore();

  // 人格块（S3）：轻人格，文件不存在就等于没启用，注入段不占 token
  const persona = new PersonaStore({
    ...(config.personaFile === undefined ? {} : { filePath: config.personaFile }),
  });

  // 风格指纹（S4）：只落统计量，不落原文
  const styleStore = new StyleStore({
    ...(config.styleMinTurns === undefined ? {} : { minTurns: config.styleMinTurns }),
    ...(config.styleMinChars === undefined ? {} : { minChars: config.styleMinChars }),
  });

  // CPE 回归闸门（S5）：冻结回归集 + 变更闸门
  const cpe = new CpeStore();

  // 学习预算（S6）：每周名额 + 五条停止信号
  const budget = new BudgetStore();
  // shadow 试运行（S6）：先进 shadow 不进注入，够格再转正
  const shadow = new ShadowStore();
  // 主动闸门（S7）：默认 P1 record-only，只记录「本来会提醒什么」
  const proactiveStore = new ProactiveStore();
  // 检索度量（S8）：真实召回日志 + 人工标注的 Top-1/Top-3
  const recallLog = new RecallLog();
  const retrievalEval = new RetrievalEvalStore();

  // 准则事件日志（轻量事件溯源）：只追加，不改主存储
  const ruleEvents = new PlaybookEventLog();
  // 注入快照：记录每轮注入了哪些准则，用于把用户反馈回写到准则。
  // v2 起只由真实轮次（session/event）写入——渲染函数已纯化，面板轮询不再产生任何一行。
  const injectionLog = new InjectionLog();
  const memory = new TemporalMemoryStore({
    halfLifeMs: config.decayHalfLifeHours * HOUR_MS,
    onEvent: (event) => audit.append(event),
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
    // 先把旧位置（插件包根目录）的数据搬到独立数据目录，再加载。
  // 用户数据放代码目录里，任何「清理仓库」都会误伤——这个坑踩过两次。
  const migrated = migrateLegacyData();
  if (migrated.length > 0) {
    ctx.logger?.info?.(
      `cognition-engine: 已将 ${migrated.length} 个数据文件迁到 ${dataDir()}（${migrated.join(', ')}）`,
    );
  }

  playbook.loadSync();
  topics.loadSync();
  gaps.loadSync();
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
  /**
   * 巡逻发现逾期任务时是否自动跑模型复盘。
   *
   * 默认关闭：一次完整三段式复盘 = 3 次模型调用 ≈ 3100 tokens，
   * 每 patrolIntervalHours（默认 3 小时）就可能触发一次，一天最多 8 次。
   * 关掉后巡逻仍会写「已超期 N 小时」的提示，只是不烧 token。
   */
  let autoReflect = config.autoReflect === true;
  /** 反思/蒸馏用的推理档位；空串表示「自动（最低）」。 */
  let reflectionEffort: string = config.reflectionEffort ?? '';
  /** 当前模型声明的档位，启动后异步填充，供页面显示。 */
  let availableEfforts: string[] = [];
  /** 探测一次模型能力，失败就当宿主不支持，不影响主流程。 */
  const refreshEfforts = async (): Promise<void> => {
    const service = ctx.get?.('llm') as LlmService | undefined;
    const { provider, model } = resolveModel();
    if (service === undefined || provider === '' || model === '') return;
    const efforts = await probeEfforts(service, provider, model);
    if (efforts !== null) availableEfforts = efforts;
  };
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

  /**
   * 查询当前模型声明的推理档位，并缓存。
   *
   * 返回 null 表示宿主不提供能力查询（老版本），调用方按默认档位走。
   */
  const probeEfforts = async (
    llm: LlmService,
    provider: string,
    model: string,
  ): Promise<string[] | null> => {
    try {
      if (typeof llm.resolveModelInfo !== 'function') return null;
      const info = await llm.resolveModelInfo(provider, model);
      return (info?.reasoning?.efforts ?? []).map((effort) => effort.id);
    } catch {
      return null;
    }
  };

  /**
   * 决定这次调用用哪个推理档位。
   *
   * `reflectionEffort` 为空表示「自动」——选最低档，因为反思与蒸馏都是
   * 按格式输出结构化结果的任务，不需要长链推理，而推理 token 和正文抢同一个预算。
   */
  const resolveEffort = async (llm: LlmService, provider: string, model: string): Promise<string | undefined> => {
    if (reflectionEffort !== undefined && reflectionEffort !== '') return reflectionEffort;
    const efforts = await probeEfforts(llm, provider, model);
    if (efforts === null || efforts.length === 0) return undefined;
    return efforts.find((id) => /minimal|none|off|low|fast|light/i.test(id)) ?? efforts[0];
  };

  const callRealModel = async (prompt: string, maxTokens = 4000): Promise<string> => {
    const llm = ctx.get?.('llm') as LlmService | undefined;
    if (llm === undefined || typeof llm.stream !== 'function') throw new Error('llm 服务不可用');
    const { provider, model } = resolveModel();
    if (provider === '' || model === '') {
      throw new Error('未找到可用模型：请在 cordis.patch.yml 设 llmProvider / llmModel');
    }

    // 推理档位压到最低：这些任务是格式化的结构化输出，不需要长链推理，
    // 而推理 token 和正文抢同一个 maxTokens 预算。
    const reasoningEffort = await resolveEffort(llm, provider, model);

    let text = '';
    let reasoning = '';
    let hitMaxTokens = false;
    // 诊断用：记录收到过哪些 chunk 类型，空内容时能说清是模型没吐字还是字段名对不上。
    const seen = new Map<string, number>();
    for await (const chunk of llm.stream({
      provider,
      model,
      maxTokens,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      // 单段最多等 90 秒，避免模型卡住把整个反思流程挂死
      signal: AbortSignal.timeout(90_000),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })) {
      const type = String((chunk as { type?: unknown }).type ?? 'unknown');
      seen.set(type, (seen.get(type) ?? 0) + 1);
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
      if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning += chunk.text;
      if (chunk.type === 'finish') {
        if (chunk.reason?.kind === 'error') throw new Error('模型返回错误');
        if (chunk.reason?.kind === 'max-tokens') hitMaxTokens = true;
      }
    }
    if (text.trim().length === 0) {
      // 只出推理不出正文 = 预算被思考过程吃光，不是模型故障。
      if (reasoning.length > 0 || hitMaxTokens) {
        throw new Error(
          `模型只输出了推理过程（${reasoning.length} 字${hitMaxTokens ? '，已触及 maxTokens 上限' : ''}），` +
            `正文被 token 预算截断。已尝试推理档位 ${reasoningEffort ?? '默认'}；调大 maxTokens（当前 ${maxTokens}）后重试。`,
        );
      }
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
      // 有缺口时蒸馏优先针对它们，而不是泛泛归纳
      gaps: gaps.open().map((g) => ({ id: g.id, text: g.text })),
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
    const blocked: Array<Record<string, unknown>> = [];
    for (const candidate of parsed.candidates) {
      // 「八类不学」硬过滤（S6）：无依据 / 含密钥 / 一次性事实 / 环境绑定 直接不进库。
      // soft 命中的照常提交，只是把标记带出去让人看一眼——一刀切会误杀有用内容。
      const verdict = shouldReject(candidate.content, {
        hasUserEvidence: (candidate.sourceIds ?? []).length > 0,
      });
      if (verdict.reject) {
        blocked.push({
          content: candidate.content,
          code: summarize(verdict.hits),
          reason: verdict.hits.filter((hit) => hit.severity === 'hard').map((hit) => hit.reason).join('；'),
        });
        continue;
      }
      // 相对表达（"7d"）与 ISO 日期都由 parseMoment 归一成毫秒；解析不了就当长期有效。
      const validTo = candidate.validUntil === undefined ? null : (parseMoment(candidate.validUntil) ?? null);
      const outcome = playbook.submit({
        section: candidate.section,
        content: candidate.content,
        when: candidate.when,
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
        // soft 标记：超粒度/平手冲突/口误/投机主题，提交了但要标注
        ...(verdict.hits.length === 0 ? {} : { softFlags: summarize(verdict.hits) }),
      });
    }
    await playbook.flush();

    return {
      reflection: parsed.reflection,
      marked,
      candidates: submitted,
      /** 被「八类不学」拦下的候选（含命中原因），让人知道模型想学什么但被拒。 */
      blocked,
      uncoveredMemories: uncovered.length,
      parseFailed: parsed.raw !== undefined,
      // 解析失败时把模型原文前 600 字带出来，否则无法判断是格式问题还是内容问题。
      ...(parsed.raw === undefined
        ? {}
        : {
            rawLength: parsed.raw.length,
            rawTail: parsed.raw.slice(-120),
            rawPreview: parsed.raw.slice(0, 300),
          }),
      stats: playbook.stats(),
    };
  };

  /**
   * 三道约束里的「拦截」与「审计」。
   *
   * 'tools/pre-execute' 是宿主给的真拦截点（waterfall，可返回 { kind: 'deny' }）。
   * 这里做两件事：
   *   - enforce=true 的准则违反 → 直接拒绝这次工具调用
   *   - audit=true   的准则违反 → 记一次违反（不拦），写进条目计数与审计日志
   * 勾了「自查」的条目走提示词，不走事件。
   *
   * 老版本宿主没有事件能力时整段静默跳过，准则本退化为纯提醒。
   */
  const installToolGuards = (): void => {
    const on = (ctx as { on?: (name: string, handler: (...args: never[]) => unknown) => unknown }).on;
    if (typeof on !== 'function') return;

    const handler = async (
      exec: unknown,
      next: () => Promise<unknown>,
    ): Promise<unknown> => {
      // 没有启用任何拦截/审计时直接放行，避免每次调用都走一遍判定
      const stats = playbook.stats();
      if (stats.enforced === 0 && stats.audited === 0) return next();

      const record = exec as { name?: unknown; arguments?: unknown };
      // 「工具名 + 参数 JSON」一起参与匹配：准则可能要判工具名，也可能要判命令内容
      const text = `${String(record.name ?? '')} ${JSON.stringify(record.arguments ?? {})}`;
      const { blocked, violated } = playbook.checkToolCall(text);
      if (violated.length === 0) return next();

      for (const entry of violated) {
        playbook.recordViolation(entry.id);
        audit.append({
          op: 'playbook.violation',
          id: entry.id,
          subject: entry.section,
          origin: 'agent_tool',
          detail: `${entry.enforce ? '已拦截' : '仅记录'}：${String(record.name ?? '')}`,
        });
      }
      void playbook.flush();

      if (blocked.length > 0) {
        const list = blocked.map((entry) => `[${entry.id}] ${entry.content}`).join('；');
        return {
          kind: 'deny',
          reason: `违反准则，调用被拒绝：${list}。补齐后再试，或在设置页停掉这条准则。`,
        };
      }
      return next();
    };

    try {
      on.call(ctx, 'tools/pre-execute', handler);
    } catch (error) {
      ctx.logger?.warn?.(`cognition-engine: 准则拦截注册失败 ${messageOf(error)}`);
    }
  };
  installToolGuards();

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

  /**
   * 计算「本轮注入到系统提示的上下文」。
   *
   * 注入与面板上的「注入来源」共用这一个函数——之前是两套各写一遍的代码，
   * 结果注入段只拼了记忆摘要、统计段却按准则本判断，面板报「正在注入准则本」
   * 而模型实际只看到记忆摘要。这类「显示与实际不一致」的 bug 单靠测试抓不到，
   * 只能靠两者同源来根治。
   *
   * **这个函数必须是纯的**（v0.12.0 修的 bug）：
   * 它有三个调用点——系统提示段（每个 step 都拼一次）、页面 `/state`（面板每 2 秒轮询）、
   * `/injected` 路由。v0.11.0 在函数里顺手写注入快照，结果 88 分钟写了 2432 行，
   * 全是轮询噪声，轮次号变成轮询计数器。现在记录只发生在 `session/event` 的轮次边界上。
   *
   * 优先级：准则本 > 记忆摘要 > 不注入。两者不叠加——ACE 与 DC 都说明
   * 上下文越长越容易稀释信号。
   */
  const renderInjectedContext = (): {
    text: string;
    source: 'playbook' | 'digest' | 'none';
    /** 本轮实际写进提示的准则 id（给轮次跟踪用）。 */
    ruleIds: string[];
    /** 本轮注入的总字符数（含缺口段）。 */
    chars: number;
  } => {
    // 待补缺口很短（通常 0~3 行），接在准则本后面——
    // 它提醒模型「这些是你还不知道的」，避免在同一个地方反复卡壳。
    const gapText = gaps.renderSection();
    const withGaps = (text: string): string => (gapText.length === 0 ? text : `${text}\n\n${gapText}`);

    const detailed = playbook.renderDetailed(undefined, undefined, (id) => topics.get(id)?.name);
    const section = playbook.renderSection(undefined, (id) => topics.get(id)?.name);
    if (section.length > 0) {
      // 只算，不写盘。写盘由 TurnFeedbackTracker 在轮次边界上做。
      const text = withGaps(section);
      return { text, source: 'playbook', ruleIds: [...detailed.ruleIds], chars: text.length };
    }

    const digest = buildCoreDigest(memory);
    if (digest.length > 0) {
      const text = withGaps(`${digest}\n（需要细节时调用 cognition_recall。）`);
      return { text, source: 'digest', ruleIds: [], chars: text.length };
    }
    if (gapText.length > 0) return { text: gapText, source: 'playbook', ruleIds: [], chars: gapText.length };
    return { text: '', source: 'none', ruleIds: [], chars: 0 };
  };

  /**
   * 把一次判定结果回写到**某一轮注入的准则**上。
   *
   * 为什么需要这个：整个「学习」链条原本是断的——
   * 模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己。
   *
   * 判定用规则而不是 LLM：每轮调 LLM 成本太高；正则覆盖明确的纠正/确认，
   * 剩下的靠其他信号补（比如用户直接改代码）。
   *
   * **单次纠正不降级**：累计 appliedBad ≥ 3 且 > appliedGood 才进入 disputed
   * （ReasoningBoost 的结论：判官只有 72.7% 准确，70–90% 噪声下性能不敏感）。
   */
  const applyFeedback = (kind: FeedbackKind, ids: string[], message: string): void => {
    if (kind === 'neutral' || ids.length === 0) return;
    const usageKind = kind === 'correction' ? 'appliedBad' : 'appliedGood';
    const trace = `${kind}: ${message.slice(0, 40)}`;
    for (const id of ids) {
      try {
        playbook.markUsage(id, usageKind, trace);
        ruleEvents.append({ type: 'RuleUsageRecorded', ruleId: id, usage: usageKind, trace, by: 'system' });
      } catch {
        /* 单条失败不影响其余 */
      }
    }
    void playbook.flush();
  };

  /**
   * 手动回写（`POST /cognition-engine/feedback`）：不依赖轮次事件，直接打到最近一轮。
   *
   * 正常的自动闭环走 `session/event`；这个路由留给「事件没挂上」和手工排查两种场景。
   */
  const recordFeedback = (message: string): { kind: string; scored: string[] } => {
    const kind = classifyFeedback(message);
    if (kind === 'neutral') return { kind, scored: [] };
    const latest = injectionLog.latest();
    if (latest === undefined) return { kind, scored: [] };
    const ids = injectionLog.markVerdict(latest.sessionId, latest.turn, kind);
    applyFeedback(kind, ids, message);
    return { kind, scored: ids };
  };

  // 自动反馈闭环：宿主轮次 → 注入快照 → 用户下一轮的反应 → 回写准则证据
  const turnTracker = new TurnFeedbackTracker(injectionLog, {
    injection: () => {
      const rendered = renderInjectedContext();
      return { ruleIds: rendered.ruleIds, chars: rendered.chars };
    },
    onFeedback: (kind, ids, reaction) => applyFeedback(kind, ids, reaction),
  });
  /** 是否真的收到过 session/event：面板用它区分「闭环在跑」和「事件没挂上」。 */
  let turnTrackingSeen = false;
  /** 子代理会话不参与打分：它们的「用户消息」是父代理的任务说明，不是人的反馈。 */
  const subagentSessions = new Set<string>();
  /**
   * 本轮助手输出缓冲（只用于风格统计，写完即丢，不进磁盘）。
   *
   * 为什么要缓冲：`assistant/message` 是**每个 step** 一条，一轮里可能几十条；
   * 风格指针对应的是「这一轮整体怎么说话」，所以按轮累加，`turn/end` 时一次性算完。
   */
  const assistantBuffers = new Map<string, { turn: number; text: string }>();
  /** 最近一次用户轮次开始时间，用于主动闸门的「静默多久」信号。 */
  let lastTurnAtMs = Date.now();
  /** 单轮参与统计的最大字符数：防止超长轮把内存和统计都拖歪。 */
  const MAX_STYLE_CHARS = 12000;

  /**
   * 挂上轮次事件。
   *
   * 为什么用 `session/event` 而不是 `agent/inbox/claimed`：
   * - 它有 `session` 对象，能读到 `session.header.origin` 把子代理排除掉；
   * - turn/start / turn/end / user/message 三类事件都在同一条流上，不用猜时序。
   * 实测时序（session 日志）：turn/start → step/start → system/message →
   * user/message ×N → … → turn/end。
   */
  const installTurnTracking = (): void => {
    if (config.autoFeedback !== true) return;
    const on = (ctx as { on?: (name: string, handler: (...args: never[]) => unknown) => unknown }).on;
    if (typeof on !== 'function') {
      ctx.logger?.warn?.('cognition-engine: 宿主没有事件订阅能力，自动反馈闭环未挂载');
      return;
    }

    const noteSubagent = (info: unknown): void => {
      const id = (info as { id?: unknown } | null | undefined)?.id;
      if (typeof id !== 'string' || id.length === 0) return;
      if (subagentSessions.size >= 500) subagentSessions.clear();
      subagentSessions.add(id);
    };

    const handler = (session: unknown, event: unknown): void => {
      // 监听器抛错会打到会话上：所有异常就地吞掉。
      try {
        const sessionId = (session as { id?: unknown } | null | undefined)?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        turnTrackingSeen = true;
        const header = (session as { header?: { origin?: unknown; delegationDepth?: unknown } } | null | undefined)
          ?.header;
        // 子代理会话不参与打分：它们的「用户消息」是父代理的任务说明，不是人的反馈。
        // 两道判据都用上——origin 是显式标记，delegationDepth 是所有子会话都有的数值。
        if (header?.origin === 'subagent' || subagentSessions.has(sessionId)) return;
        if (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0) return;

        const type = (event as { type?: unknown } | null | undefined)?.type;
        const data = (event as { data?: unknown } | null | undefined)?.data;
        if (type === 'turn/start') {
          const turn = Number((data as { turn?: unknown } | null | undefined)?.turn);
          if (Number.isFinite(turn)) turnTracker.beginTurn(sessionId, turn);
          lastTurnAtMs = Date.now();
          assistantBuffers.delete(sessionId);
        } else if (type === 'user/message') {
          turnTracker.appendUserText(sessionId, extractUserText(data));
        } else if (type === 'assistant/message') {
          if (config.styleEnabled) {
            const message = (data as { message?: unknown; turn?: unknown } | null | undefined)?.message;
            const turn = Number((data as { turn?: unknown } | null | undefined)?.turn);
            const text = extractUserText(message); // 同样的取文本逻辑：只拼 text 块
            if (text.length > 0) {
              const current = assistantBuffers.get(sessionId);
              const base = current !== undefined && current.turn === turn ? current.text : '';
              const merged = base.length >= MAX_STYLE_CHARS ? base : (base + '\n' + text).slice(0, MAX_STYLE_CHARS);
              assistantBuffers.set(sessionId, { turn: Number.isFinite(turn) ? turn : 0, text: merged });
            }
          }
        } else if (type === 'turn/end') {
          // 先算风格（用本轮助手输出），再结束轮次跟踪——顺序反了会丢缓冲
          if (config.styleEnabled) {
            const buffer = assistantBuffers.get(sessionId);
            assistantBuffers.delete(sessionId);
            if (buffer !== undefined && buffer.text.trim().length > 0) {
              try {
                styleStore.record({
                  sessionId,
                  turn: buffer.turn,
                  text: buffer.text,
                  catchphrases: config.styleCatchphrases,
                });
              } catch {
                /* 统计失败不影响会话 */
              }
            }
          }
          turnTracker.endTurn(sessionId);
        }
      } catch {
        /* 事件处理失败不能影响会话 */
      }
    };

    // 统一登记反注册：插件被停用/热重载时必须解绑。
    // 宿主的 ctx.on 本身会随上下文销毁自动解绑，但这里显式登记一层——
    // 否则热重载几次就会有多个监听器同时写同一个日志文件（重复行）。
    const listen = (event: string, listener: (...args: any[]) => unknown): void => {
      try {
        const disposer = on.call(ctx, event, listener);
        if (typeof disposer === 'function') disposers.push(disposer as () => void);
      } catch (error) {
        ctx.logger?.warn?.(`cognition-engine: 订阅 ${event} 失败 ${messageOf(error)}`);
      }
    };

    listen('subagent/start', noteSubagent);
    listen('subagent/end', noteSubagent);
    listen('session/disposed', (session: unknown) => {
      const id = (session as { id?: unknown } | null | undefined)?.id;
      if (typeof id === 'string') {
        turnTracker.forget(id);
        assistantBuffers.delete(id);
      }
    });
    listen('session/event', handler);
    ctx.logger?.info?.('cognition-engine: 自动反馈闭环已挂载（session/event）');
  };
  installTurnTracking();

  /**
   * 记忆变了就重算准则的证据链。
   *
   * 这是「作废会传染」的落点：删一条记忆，依赖它的准则必须知道自己失去了支撑，
   * 而不是继续当作无事发生（那正是 TMS 说的「留下没有主人的下游结论」）。
   */
  const refreshEvidence = (): void => {
    try {
      const changed = playbook.recheckEvidence();
      if (changed.length > 0) {
        ctx.logger?.info?.(`cognition-engine: ${changed.length} 条准则的证据链状态变化（${changed.join(', ')}）`);
        void playbook.flush();
      }
    } catch (error) {
      ctx.logger?.warn?.(`cognition-engine: 证据链重算失败 ${messageOf(error)}`);
    }
  };

  /** 页面可视化用的快照（纯 JSON，客户端每 2 秒拉一次）。 */
  const snapshot = (): Record<string, unknown> => {
    return {
      memory: memory.stats(),
      /** 标记为 test 的事实条数：页面上用来提醒「这些不是真事」。 */
      samples: memory.all().filter((fact) => fact.source === 'test').length,
      tasks: {
        pending: taskManager.get_pending_tasks().length,
        due: taskManager.check_due_tasks().length,
      },
      proactive: {
        pending: proactiveStore.pending().length,
        recordOnly: proactiveStore.phase === 'P1',
        phase: proactiveStore.phase,
        adoptionRate: proactiveStore.adoptionRate(),
        samples: proactiveStore.document.stats.adopted + proactiveStore.document.stats.dismissed,
        rules: proactiveStore.document.rules.filter((rule) => rule.active).length,
      },
      model: (() => {
        const resolved = resolveModel();
        return {
          enabled: reflectionMode !== 'off',
          mode: reflectionMode,
          autoReflect,
          effort: reflectionEffort,
          efforts: availableEfforts,
          provider: resolved.provider,
          model: resolved.model,
          available: resolved.provider !== '' && resolved.model !== '',
        };
      })(),
      locked: lockToken !== null,
      storageFile: basename(stateStore.path),
      playbook: {
        ...playbook.stats(),
        /** 当前注入的是准则本、原始记忆摘要，还是都不注入（与注入段同源）。 */
        injectSource: renderInjectedContext().source,
      },
      /**
       * 自动反馈闭环的体检数据。
       *
       * `tracking` 是关键：false 说明这个进程没收到过 session/event——
       * 要么宿主没有事件能力，要么挂载点变了。观察期先看这一项。
       */
      feedback: {
        enabled: config.autoFeedback === true,
        tracking: turnTrackingSeen,
        ...injectionLog.statistics(),
      },
      persona: {
        present: persona.present,
        chars: persona.usage().rendered,
        revision: persona.document?.revision ?? 0,
        pending: persona.pending().length,
      },
      style: {
        enabled: config.styleEnabled,
        turns: styleStore.sampleSummary().turns,
        status: styleStore.sampleSummary().sufficient ? styleStore.compare().status : 'insufficient',
        chars: styleStore.sampleSummary().chars,
      },
      cpe: {
        cases: cpe.document.holdout.cases.length,
        frozenAt: cpe.document.holdout.frozenAt,
        baseline: cpe.document.baseline?.passRate ?? null,
        status: cpe.document.lastCheck?.status ?? 'insufficient',
      },
      budget: (() => {
        budget.syncActiveRules(playbook.stats().active);
        const status = budget.status();
        return {
          week: status.week,
          quota: status.quota,
          used: status.used,
          remaining: status.remaining,
          paused: status.paused,
          pauseReason: status.pauseReason,
        };
      })(),
      shadow: shadow.stats(),
      retrieval: (() => {
        const overview = recallLog.overview();
        const evaluated = retrievalEval.evaluate(recallIdsOf);
        return {
          logged: overview.total,
          zeroRate: overview.zeroRate,
          cases: evaluated.cases,
          top1: evaluated.top1,
          top3: evaluated.top3,
          status: evaluated.status,
        };
      })(),
      topics: topics.stats(),
      storageWarning: stateStore.warning,
      rules: memory.getRules(),
      updatedAt: Date.now(),
    };
  };

  /** 面板展开时按需拉取的明细（不走模型上下文，只给页面看）。 */
  // 准则本指标也放进 detail：页面页签的数字统一从 detail 取，
  // 之前只放在 /state 里，导致「准则」页签后面永远没有数字。
  const detail = (): Record<string, unknown> => ({
    ...buildDetail({ memory, taskManager }),
    playbook: playbook.stats(),
    topics: {
      list: topics.all(),
      stats: topics.stats(),
      /** 未归类计数：没有 topicIds 的就是未归类。 */
      unclassified: {
        memories: memory.all().filter((f) => f.deletedAt === undefined && f.topicIds.length === 0).length,
        rules: playbook.all().filter((e) => e.status !== 'retired' && e.topicIds.length === 0).length,
      },
    },
  });

  /**
   * CPE 评测用的「准则排名」：按与问题的相似度给**当前生效**准则排序。
   *
   * 为什么不复用准则本的注入排序：注入排序混了有效分、衰减、主题，
   * 用来做「该命中的有没有被挤掉」的回归测试会引入无关波动。
   * 这里只按文本相关度排，测的是检索面，变量单一。
   */
  const ruleRankResolver = (question: string): string[] =>
    playbook
      .all()
      .filter((entry) => entry.status === 'active')
      .map((entry) => ({ id: entry.id, score: textSimilarity(question, entry.content) }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.id);

  /**
   * 收一轮主动扫描的来源数据。全部是可观测计数，不做主观判断。
   *
   * 故意不在这里做任何模型调用：主动闸门每 patrolIntervalHours 跑一次，
   * 一旦掺进 LLM，光是「观察」就变成持续烧 token。
   */
  const collectScanSource = (): ScanSource => {
    // 用 withAge() 而不是 check_due_tasks()：后者的 overdueMs 只对**逾期**任务有意义，
    // 这里要的是「所有未完成任务的真实年龄」，口径和 /detail 完全一致。
    const due = taskManager
      .withAge()
      .filter((task) => task.status !== 'COMPLETED' && task.overdue)
      .map((task) => ({
        id: task.id,
        description: task.description,
        overdueHours: Math.max(0, Math.round(task.ageMs / 3_600_000)),
      }));
    const openGaps = gaps.open().map((gap) => ({ id: gap.id, text: gap.text }));
    const active = playbook.all().filter((entry) => entry.status === 'active');
    const brokenRules = active
      .filter((entry) => entry.evidence?.status === 'orphaned')
      .map((entry) => ({ id: entry.id, content: entry.content }));
    const expiredRules = active
      .filter((entry) => playbook.isExpired(entry))
      .map((entry) => ({ id: entry.id, content: entry.content }));
    return { dueTasks: due, gaps: openGaps, brokenRules, expiredRules };
  };

  const runProactiveScan = (): {
    score: number;
    parts: Record<string, number>;
    items: unknown[];
    canSpeak: { speak: boolean; reason: string };
    phase: string;
  } => {
    const source = collectScanSource();
    const scored = scoreScan({
      pendingDue: source.dueTasks.length,
      unresolvedGaps: source.gaps.length,
      brokenEvidence: source.brokenRules.length,
      expiredRules: source.expiredRules.length,
      silenceMs: Math.max(0, Date.now() - lastTurnAtMs),
    });
    const items = proactiveStore.recordScan(source, scored.score);
    return {
      score: scored.score,
      parts: scored.parts,
      items,
      canSpeak: proactiveStore.canSpeak(scored.score),
      phase: proactiveStore.phase,
    };
  };

  /**
   * 检索评测用的「现算召回」：必须用**当前**记忆库。
   *
   * 为什么不复用历史召回日志：日志里的库和现在不一样，
   * 拿它算指标得到的是「过去的准确率」，回答不了「现在准不准」。
   */
  const recallIdsOf = (query: string): string[] => memory.recall(query, { mode: 'strict' }).map((hit) => hit.fact.id);

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

    // 知识缺口：模型卡壳时登记，下次针对性补
    route('/cognition-engine/gaps', () => ({ gaps: gaps.all(), open: gaps.open(), stats: gaps.stats() }));
    route(
      '/cognition-engine/gaps/add',
      (url) => {
        const text = url.searchParams.get('text') ?? '';
        if (text.trim().length === 0) throw new Error('缺口描述不能为空');
        const context = url.searchParams.get('context');
        const { gap, duplicate } = gaps.add({ text, ...(context === null ? {} : { context }) });
        gaps.flush();
        return { gap, duplicate };
      },
      { method: 'POST' },
    );
    route(
      '/cognition-engine/gaps/resolve',
      (url) => {
        const id = url.searchParams.get('id') ?? '';
        const ok = gaps.resolve(id, url.searchParams.get('by') ?? '人工确认');
        if (ok) {
          gaps.flush();
          // 联动：缺口解决了，相关提醒立刻下线
          proactiveStore.clearByTarget(id, '缺口已补齐');
        }
        return { id, ok };
      },
      { method: 'POST' },
    );

    // 注入快照：最近 N 轮注入了哪些准则
    route('/cognition-engine/injection/recent', (url) => {
      const limit = Number(url.searchParams.get('limit') ?? '10');
      return { recent: injectionLog.recent(Number.isFinite(limit) ? limit : 10), stats: injectionLog.statistics() };
    });

    // 反馈回写：把一个用户回复判成纠正/确认，回写到上一轮注入的准则
    route(
      '/cognition-engine/feedback',
      (url) => {
        const message = url.searchParams.get('message') ?? '';
        if (message.trim().length === 0) throw new Error('message 不能为空');
        return recordFeedback(message);
      },
      { method: 'POST' },
    );

    // 准则事件日志：全部 / 单条准则 / 统计
    route('/cognition-engine/events', (url) => {
      const ruleId = url.searchParams.get('ruleId');
      if (ruleId !== null && ruleId.length > 0) return { ruleId, events: ruleEvents.forRule(ruleId) };
      return { stats: ruleEvents.stats(), recent: ruleEvents.all().slice(-20) };
    });

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
        void stateStore.flush();
        return { cleared: 'memory', removed, memory: memory.stats() };
      },
      { method: 'POST', requireAuth: true },
    );

    // 真模型开关
    route(
      '/cognition-engine/model',
      (url) => {
        // 两个参数各自独立：只传一个时不能把另一个重置掉。
        // （早期写法无条件 normalizeReflectionMode(null)，传 autoReflect 会顺手把引擎关成 off。）
        const mode = url.searchParams.get('mode');
        if (mode !== null) reflectionMode = normalizeReflectionMode(mode);
        const auto = url.searchParams.get('autoReflect');
        if (auto !== null) autoReflect = auto === 'true' || auto === '1';
        // effort 传空串 = 回到「自动（最低）」
        const effort = url.searchParams.get('effort');
        if (effort !== null) reflectionEffort = effort;
        void stateStore.flush();
        const { provider, model } = resolveModel();
        return {
          enabled: reflectionMode !== 'off',
          mode: reflectionMode,
          autoReflect,
          effort: reflectionEffort,
          efforts: availableEfforts,
          provider,
          model,
          available: provider !== '' && model !== '',
        };
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
        const rawTopics = url.searchParams.get('topicIds');
        const task = await taskManager.create_task(description, {
          ...(s === null ? {} : { startAt: Number(s) }),
          ...(e === null ? {} : { endAt: Number(e) }),
          ...(rawTopics === null
            ? {}
            : { topicIds: rawTopics.split(',').map((x) => x.trim()).filter((x) => x.length > 0) }),
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
        proactiveStore.clearByTarget(id, '任务已删除');
        return { id, deleted: true };
      },
      { method: 'POST', requireAuth: explicitLock },
    );


    // 改任务状态（页面上的「开始 / 完成 / 重新打开」）
    route(
      '/cognition-engine/task/status',
      async (url) => {
        const id = url.searchParams.get('id') ?? '';
        const status = url.searchParams.get('status') ?? '';
        if (status !== 'PENDING' && status !== 'IN_PROGRESS' && status !== 'COMPLETED') {
          throw new Error('status 只能是 PENDING / IN_PROGRESS / COMPLETED');
        }
        const clue = url.searchParams.get('clue');
        const task = await taskManager.update_task_progress(
          id,
          status,
          clue === null || clue.trim().length === 0 ? undefined : clue.trim(),
        );
        // 联动：任务状态一变（尤其标记完成），立刻清掉它的待处理提醒。
        // 不这么做就会出现「任务早做完了，提醒还挂着」——用户会以为系统没在看。
        const cleared = proactiveStore.clearByTarget(id, status === 'COMPLETED' ? '任务已完成' : '任务状态已更新');
        return { task, clearedReminders: cleared };
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
        refreshEvidence();
        // 联动：准则的证据链可能因此断裂 → 相关提醒要重算；已恢复则清掉旧的
        if (restore) proactiveStore.clearByTarget(id, '记忆已恢复');
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

    // —— 主题（人定的适用范围键）——
    route('/cognition-engine/topics', () => {
      // 每个主题挂了多条记忆/准则——页面上要显示人话，不是裸 id
      const facts = memory.all().filter((f) => f.deletedAt === undefined);
      const rules = playbook.all().filter((e) => e.status !== 'retired');
      // 取全部任务：已完成的也要能看到，否则点「完成」后任务会凭空消失
      const allTasks = taskManager.all();
      return {
        stats: topics.stats(),
        list: topics.all().map((topic) => {
          const owned = allTasks.filter((task) => (task.topicIds ?? []).includes(topic.id));
          return {
            ...topic,
            memoryCount: facts.filter((f) => f.topicIds.includes(topic.id)).length,
            ruleCount: rules.filter((e) => e.topicIds.includes(topic.id)).length,
            taskCount: owned.length,
            // 主题卡片上直接列出「进行中事项」，任务不再是孤立台账
            tasks: owned.slice(0, 5).map((task) => ({ id: task.id, description: task.description, status: task.status })),
          };
        }),
      unclassified: {
        memories: memory.all().filter((f) => f.deletedAt === undefined && f.topicIds.length === 0).length,
        rules: rules.filter((e) => e.topicIds.length === 0).length,
        },
      };
    });

    route(
      '/cognition-engine/topics/add',
      async (url) => {
        const aliases = (url.searchParams.get('aliases') ?? '')
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a.length > 0);
        const parent = url.searchParams.get('parentId');
        const result = topics.add({
          name: url.searchParams.get('name') ?? '',
          description: url.searchParams.get('description') ?? '',
          aliases,
          parentId: parent === null || parent.length === 0 ? null : parent,
        });
        if (typeof result === 'string') return { accepted: false, reason: result };
        await topics.flush();
        return { accepted: true, topic: result };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    route(
      '/cognition-engine/topics/update',
      async (url) => {
        const id = url.searchParams.get('id') ?? '';
        const name = url.searchParams.get('name');
        const description = url.searchParams.get('description');
        const aliasesRaw = url.searchParams.get('aliases');
        const parentRaw = url.searchParams.get('parentId');
        const ok = topics.update(id, {
          ...(name === null ? {} : { name }),
          ...(description === null ? {} : { description }),
          ...(aliasesRaw === null
            ? {}
            : { aliases: aliasesRaw.split(',').map((a) => a.trim()).filter((a) => a.length > 0) }),
          ...(parentRaw === null ? {} : { parentId: parentRaw.length === 0 ? null : parentRaw }),
        });
        if (!ok) throw new Error('主题更新失败：不存在、重名或父级非法');
        await topics.flush();
        return { id, updated: true };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    route(
      '/cognition-engine/topics/archive',
      async (url) => {
        const id = url.searchParams.get('id') ?? '';
        if (!topics.archive(id)) throw new Error('主题不存在');
        await topics.flush();
        return { id, archived: true };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    route(
      '/cognition-engine/topics/assign',
      async (url) => {
        const targetType = url.searchParams.get('targetType') ?? '';
        const id = url.searchParams.get('id') ?? '';
        const topicIds = (url.searchParams.get('topicIds') ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x.length > 0);
        // 只允许挂到存在且未归档的主题，避免悬空引用
        const valid = topicIds.filter((tid) => topics.get(tid)?.status === 'active');
        if (targetType === 'memory') {
          memory.setTopics(id, valid);
          void stateStore.flush();
          return { targetType, id, topicIds: valid };
        }
        if (targetType === 'rule') {
          if (!playbook.setTopics(id, valid)) throw new Error('准则不存在');
          await playbook.flush();
          return { targetType, id, topicIds: valid };
        }
        if (targetType === 'task') {
          const task = await taskManager.set_meta(id, { topicIds: valid });
          if (task === undefined) throw new Error('任务不存在');
          return { targetType, id, topicIds: valid };
        }
        throw new Error('targetType 只能是 memory / rule / task');
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 只给候选，不落库——主题是人工确认的
    route(
      '/cognition-engine/topics/suggest',
      (url) => {
        const text = url.searchParams.get('text') ?? '';
        return { suggestions: topics.match(text, 3) };
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
        /** 如果这一步触发过 CPE 回归检查，把结果带回去（页面据此解释「为什么被回滚」）。 */
        let gate: unknown;
        /** true 表示「没成功但不是故障」（预算用尽转 shadow / 回归回滚），不要抛 500。 */
        let softFail = false;
        switch (action) {
          case 'accept': {
            // 学习预算（S6）：名额用尽时**转进 shadow 试运行**，而不是硬拒。
            // 这样「想学」和「别污染上下文」两件事都满足。
            budget.syncActiveRules(playbook.stats().active);
            const budgetCheck = budget.canLearn('new');
            if (!budgetCheck.ok) {
              const candidate = playbook.get(id);
              const shadowed = shadow.add({
                text: candidate?.content ?? '',
                subject: candidate?.section ?? '未分类',
                source: 'budget-overflow',
                note: budgetCheck.reason ?? '本周名额已用完',
              });
              ok = playbook.reject(id); // 移出待审，进 shadow 观察
              softFail = true;
              gate = { budget: budgetCheck, shadowId: shadowed.entry?.id ?? null, movedToShadow: true };
              break;
            }
            // CPE 闸门：启用一条新准则前先快照，启用后跑回归集；
            // 掉分超阈值就回滚文件并拒绝本次启用——这是「越学越稳」的落点。
            const snap = cpe.snapshotFiles([playbook.path]);
            ok = playbook.accept(id);
            if (ok) {
              await playbook.flush();
              const check = cpe.check(ruleRankResolver);
              gate = check;
              if (check.status === 'red') {
                cpe.restoreFiles(snap);
                playbook.loadSync();
                cpe.recordIncident({
                  label: `accept ${id}`,
                  before: check.passRate === null || check.delta === null ? null : check.passRate - check.delta,
                  after: check.passRate,
                  dropped: check.delta,
                  rolledBack: true,
                  detail: check.note,
                });
                ok = false;
                softFail = true;
              } else {
                ruleEvents.append({ type: 'RuleAccepted', ruleId: id, by: 'user' });
                budget.consume('new');
              }
            }
            break;
          }
          case 'reject': ok = playbook.reject(id); break;
          case 'retire':
            ok = playbook.retire(id, '手动停用');
            if (ok) {
              ruleEvents.append({ type: 'RuleRetired', ruleId: id, reason: '手动停用', by: 'user' });
              // 停用后这条不再参与注入，关于它的提醒也就没意义了
              proactiveStore.clearByTarget(id, '准则已停用');
            }
            break;
          case 'revive': ok = playbook.revive(id); break;
          case 'revise': {
            const nextContent = url.searchParams.get('content') ?? '';
            ok = playbook.revise(id, nextContent);
            // 修旧也占名额（但不拦：改错比不改好）
            if (ok) {
              budget.consume('revise');
              proactiveStore.clearByTarget(id, '准则已修订');
            }
            break;
          }
          case 'extend': {
            const raw = url.searchParams.get('validTo');
            ok = playbook.extend(id, raw === null ? null : (parseMoment(raw) ?? null));
            if (ok) proactiveStore.clearByTarget(id, '准则已续期');
            break;
          }
          case 'helpful': ok = playbook.mark(id, 'helpful'); break;
          case 'harmful': ok = playbook.mark(id, 'harmful'); break;
          // 永久删除（任意状态）。停用只是不注入，删除是当它没存在过。
          case 'delete':
            ok = playbook.remove(id);
            if (ok) {
              ruleEvents.append({ type: 'RuleRetired', ruleId: id, reason: '人工删除', by: 'user' });
              proactiveStore.clearByTarget(id, '准则已删除');
            }
            break;
          // 人工标记冲突对：自动检测不可靠时用这个
          case 'markConflict': {
            const otherId = url.searchParams.get('otherId') ?? '';
            ok = playbook.markConflict(id, otherId);
            break;
          }
          // 未决冲突的人工裁决：保留哪一条
          case 'resolve': {
            const keepId = url.searchParams.get('keepId') ?? '';
            ok = playbook.resolveConflict(keepId, id, url.searchParams.get('reason') ?? '人工裁决');
            break;
          }
          // 立墓碑：这条本来就错了（区别于被更好的取代）
          case 'revoke':
            ok = playbook.revoke(id, url.searchParams.get('reason') ?? '人工撤销');
            if (ok) ruleEvents.append({ type: 'RuleRevoked', ruleId: id, reason: url.searchParams.get('reason') ?? '人工撤销', by: 'user' });
            break;
          // 分项使用打标：applied / appliedGood / appliedBad / missed / userCorrected
          case 'usage': {
            const kind = url.searchParams.get('kind') ?? '';
            const allowed = ['applied', 'appliedGood', 'appliedBad', 'missed', 'userCorrected'];
            if (!allowed.includes(kind)) throw new Error(`kind 只能是 ${allowed.join(' / ')}`);
            ok = playbook.markUsage(id, kind as 'applied', url.searchParams.get('trace') ?? '');
            break;
          }
          // 设置证据来源（sourceIds）：改完立刻重算证据链
          case 'source': {
            const ids = (url.searchParams.get('sourceIds') ?? '')
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x.length > 0);
            ok = playbook.setSourceIds(id, ids);
            if (ok) refreshEvidence();
            break;
          }
          // 三道约束开关：只改传了的项，没传的保持原值
          case 'flags': {
            const bool = (name: string): boolean | undefined => {
              const value = url.searchParams.get(name);
              return value === null ? undefined : value === 'true' || value === '1';
            };
            const str = (name: string): string | undefined => url.searchParams.get(name) ?? undefined;
            ok = playbook.setFlags(id, {
              guard: bool('guard'),
              enforce: bool('enforce'),
              audit: bool('audit'),
              trigger: str('trigger'),
              required: str('required'),
              when: str('when'),
            });
            break;
          }
          default:
            throw new Error(
              'action 只能是 accept/reject/retire/revive/revise/extend/helpful/harmful/delete/flags',
            );
        }
        if (!ok && !softFail) throw new Error(`准则本操作失败：${action} ${id}`);
        await playbook.flush();
        return { id, action, ok, ...(gate === undefined ? {} : { gate }) };
      },
      { method: 'POST', requireAuth: explicitLock },
    );

    // 当前实际注入到系统提示的内容（排查「面板说有、模型看不到」这类问题用）
    route('/cognition-engine/injected', () => {
      const { text, source } = renderInjectedContext();
      return { source, chars: text.length, text, persona: persona.render() };
    });

    // 人格块（S3）：查看 / 提案 / 确认 / 拒绝。
    // 设计上 agent 只能 propose，只有 confirm 才真的改写——人格被悄悄重写是最难查的退化。
    route('/cognition-engine/persona', () => {
      const doc = persona.document;
      return {
        present: doc !== undefined,
        revision: doc?.revision ?? 0,
        updatedAt: doc?.updatedAt ?? 0,
        path: persona.path,
        usage: persona.usage(),
        render: persona.render(),
        /** 上次写盘失败原因；非空说明「改了但没存下」，不能当成功。 */
        saveError: persona.lastSaveError ?? null,
        /** traits / slots 只做审计，不进注入段（BFI-2 不是文本分类器）。 */
        audit:
          doc === undefined
            ? undefined
            : {
                personaTraits: doc.blocks.persona.traits ?? {},
                personaInteractionStyle: doc.blocks.persona.interactionStyle ?? {},
                humanSlots: doc.blocks.human.slots ?? {},
                humanFacts: doc.blocks.human.facts ?? [],
              },
        history: doc === undefined ? [] : [...doc.blocks.persona.history, ...doc.blocks.human.history].slice(-10),
        /**
         * 原始块内容（编辑页面要用）。
         *
         * 只认 limit / readOnly / lockedPhrases / value 这四项——
         * `traits` / `slots` / `facts` / `history` 一律不在这里返回给编辑框，
         * 免得页面把它们当成可编辑正文写回去。
         */
        blocks:
          doc === undefined
            ? null
            : {
                persona: {
                  value: doc.blocks.persona.value,
                  limit: doc.blocks.persona.limit,
                  readOnly: doc.blocks.persona.readOnly === true,
                  lockedPhrases: doc.blocks.persona.lockedPhrases ?? [],
                },
                human: {
                  value: doc.blocks.human.value,
                  limit: doc.blocks.human.limit,
                  readOnly: doc.blocks.human.readOnly === true,
                  lockedPhrases: doc.blocks.human.lockedPhrases ?? [],
                },
              },
        budget: doc?.budget ?? null,
        pending: persona.pending(),
      };
    });
    // 从零创建人格文件（首次启用走这里；已存在时拒绝，不能当覆盖后门）
    route(
      '/cognition-engine/persona/create',
      (url) =>
        persona.create({
          persona: url.searchParams.get('persona') ?? '',
          human: url.searchParams.get('human') ?? '',
        }),
      { method: 'POST' },
    );

    // CPE 回归闸门（S5）
    route('/cognition-engine/cpe', () => {
      const doc = cpe.document;
      return {
        path: cpe.path,
        thresholds: doc.thresholds,
        holdout: {
          cases: doc.holdout.cases.length,
          frozenAt: doc.holdout.frozenAt,
          neverUsedForGeneration: doc.holdout.neverUsedForGeneration,
          derivedFromRules: doc.holdout.cases.filter((item) => item.derivedFrom === 'rules').length,
        },
        baseline: doc.baseline,
        lastCheck: doc.lastCheck,
        incidents: doc.incidents.slice(-5),
        /** 实时算一遍，不写盘：看一眼当前回归通过率 */
        live: cpe.evaluate(ruleRankResolver),
        saveError: cpe.lastSaveError ?? null,
      };
    });
    route(
      '/cognition-engine/cpe/case',
      (url) => {
        const question = url.searchParams.get('question') ?? '';
        const rules = (url.searchParams.get('rules') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        const note = url.searchParams.get('note');
        return cpe.addCase({ question, expectedRuleIds: rules, ...(note === null ? {} : { note }), by: 'user' });
      },
      { method: 'POST' },
    );
    route(
      '/cognition-engine/cpe/case/remove',
      (url) => ({ id: url.searchParams.get('id') ?? '', ok: cpe.removeCase(url.searchParams.get('id') ?? '') }),
      { method: 'POST' },
    );
    route(
      '/cognition-engine/cpe/seed',
      () => cpe.seedFromRules(playbook.all().filter((entry) => entry.status === 'active').map((entry) => ({ id: entry.id, content: entry.content }))),
      { method: 'POST' },
    );
    route('/cognition-engine/cpe/freeze', () => cpe.freeze(), { method: 'POST' });
    route('/cognition-engine/cpe/unfreeze', () => cpe.unfreeze(), { method: 'POST' });
    route('/cognition-engine/cpe/baseline', () => cpe.measureBaseline(ruleRankResolver), { method: 'POST' });
    route('/cognition-engine/cpe/check', () => cpe.check(ruleRankResolver), { method: 'POST' });

    // 学习预算（S6）
    route('/cognition-engine/budget', () => {
      budget.syncActiveRules(playbook.stats().active);
      return { path: budget.path, ...budget.status(), saveError: budget.lastSaveError ?? null };
    });
    route('/cognition-engine/budget/signals', () => {
      // 只喂能算出来的指标，其余留空（宁可漏报也不误停）
      const stats = playbook.stats();
      const orphaned = playbook.all().filter((entry) => entry.evidence?.status === 'orphaned').length;
      return budget.evaluateSignals({ activeRules: stats.active, orphanedRules: orphaned });
    });
    route('/cognition-engine/budget/pause', (url) => {
      const code = url.searchParams.get('code') ?? 'futile';
      budget.pause({
        code: (['futile', 'still-wrong', 'overcrowded', 'flip-flop', 'idle-quota'].includes(code) ? code : 'futile') as never,
        reason: url.searchParams.get('reason') ?? '手动暂停学习',
        action: 'pause-new',
      });
      return budget.status();
    }, { method: 'POST' });
    route('/cognition-engine/budget/resume', () => {
      budget.resume();
      return budget.status();
    }, { method: 'POST' });

    // shadow 试运行（S6）
    route('/cognition-engine/shadow', () => ({
      path: shadow.path,
      stats: shadow.stats(),
      entries: shadow.all().slice(-30),
      saveError: shadow.lastSaveError ?? null,
    }));
    route('/cognition-engine/shadow/add', (url) => {
      const result = shadow.add({
        text: url.searchParams.get('text') ?? '',
        subject: url.searchParams.get('subject') ?? undefined,
        source: url.searchParams.get('source') ?? 'manual',
      });
      return result;
    }, { method: 'POST' });
    route('/cognition-engine/shadow/record', (url) => {
      const id = url.searchParams.get('id') ?? '';
      const flag = (name: string): boolean => url.searchParams.get(name) === 'true';
      return {
        id,
        ok: shadow.record(id, {
          occurrence: flag('occurrence'),
          hit: flag('hit'),
          helpful: flag('helpful'),
          harmful: flag('harmful'),
        }),
      };
    }, { method: 'POST' });
    route('/cognition-engine/shadow/promote', async (url) => {
      const id = url.searchParams.get('id') ?? '';
      const promoted = shadow.promote(id);
      if (!promoted.ok || promoted.entry === undefined) return promoted;
      // 转正 = 走正常提交路径（仍需人工在准则本里 accept，不绕过审核）
      const outcome = playbook.submit({ section: promoted.entry.subject, content: promoted.entry.text });
      await playbook.flush();
      return { ...promoted, submitted: outcome.accepted, ruleId: outcome.entry?.id ?? null };
    }, { method: 'POST' });
    route('/cognition-engine/shadow/reject', (url) => ({
      id: url.searchParams.get('id') ?? '',
      ok: shadow.reject(url.searchParams.get('id') ?? '', url.searchParams.get('note') ?? undefined),
    }), { method: 'POST' });
    route('/cognition-engine/shadow/sweep', () => ({ expired: shadow.sweepExpired().map((entry) => entry.id) }), { method: 'POST' });

    // 主动闸门（S7）：默认 P1 只记录，不发言
    route('/cognition-engine/proactive', () => {
      const doc = proactiveStore.document;
      return {
        path: proactiveStore.path,
        phase: doc.phase,
        /** P1 永远不发言；这条字段就是给页面「为什么没有主动消息」的解释。 */
        recordOnly: doc.phase === 'P1',
        rules: doc.rules,
        pending: proactiveStore.pending().slice(0, 20),
        stats: { ...doc.stats, adoptionRate: proactiveStore.adoptionRate() },
        /** 下一阶段的门槛，页面直接展示，避免「为什么不能开 P3」的疑问。 */
        gates: { p3MinSamples: 20, p3MinAdoption: 0.7 },
        saveError: proactiveStore.lastSaveError ?? null,
      };
    });
    route('/cognition-engine/proactive/scan', () => runProactiveScan(), { method: 'POST' });
    route('/cognition-engine/proactive/adopt', async (url) => {
      const id = url.searchParams.get('id') ?? '';
      const item = proactiveStore.pending().find((entry) => entry.id === id);
      // 「好，我去处理」= 这件事真的开始做了 → 关联任务标成「进行中」。
      // 只动 pending-due 这一类：缺口/准则那几类没有对应的任务台账。
      let taskUpdated: { id: string; status: string } | null = null;
      if (item !== undefined && item.kind === 'pending-due') {
        try {
          const task = await taskManager.update_task_progress(item.targetId, 'IN_PROGRESS', '从提醒里点「我去处理」');
          if (task !== undefined) taskUpdated = { id: task.id, status: task.status };
        } catch {
          /* 任务可能已被删除：提醒照样标记为已采纳 */
        }
      }
      return { id, ok: proactiveStore.adopt(id), taskUpdated };
    }, { method: 'POST' });
    route('/cognition-engine/proactive/dismiss', async (url) => {
      const id = url.searchParams.get('id') ?? '';
      const item = proactiveStore.pending().find((entry) => entry.id === id);
      // 「不用管」= 这件事不做了 → 关联任务直接删掉（不是标完成：
      // 标完成会让它变成「做过的事」，而用户的意思是「这事我不打算做」）。
      let taskDeleted = false;
      if (item !== undefined && item.kind === 'pending-due') {
        try {
          taskDeleted = await taskManager.delete_task(item.targetId);
        } catch {
          /* 任务已不存在：忽略 */
        }
      }
      return { id, ok: proactiveStore.dismiss(id), taskDeleted };
    }, { method: 'POST' });
    route('/cognition-engine/proactive/phase', (url) => {
      const raw = url.searchParams.get('phase');
      const phase = raw === 'P1' || raw === 'P2' || raw === 'P3' ? raw : 'P1';
      return proactiveStore.setPhase(phase);
    }, { method: 'POST' });
    route('/cognition-engine/proactive/rule', (url) => proactiveStore.addRule(url.searchParams.get('text') ?? ''), { method: 'POST' });
    route('/cognition-engine/proactive/rule/remove', (url) => ({
      id: url.searchParams.get('id') ?? '',
      ok: proactiveStore.removeRule(url.searchParams.get('id') ?? ''),
    }), { method: 'POST' });

    // 检索度量（S8）
    /** 现算召回：评测必须用**当前**记忆库，不能拿历史日志（那时库里没这些条目）。 */
    const recallResolver = recallIdsOf;
    route('/cognition-engine/retrieval', () => ({
      logs: { path: recallLog.path, ...recallLog.overview() },
      eval: { path: retrievalEval.path, minCases: retrievalEval.minCasesRequired, ...retrievalEval.evaluate(recallResolver) },
      saveError: recallLog.lastSaveError ?? retrievalEval.lastSaveError ?? null,
    }));
    route('/cognition-engine/retrieval/log', (url) => {
      const limit = Number(url.searchParams.get('limit') ?? '20');
      return { recent: recallLog.recent(Number.isFinite(limit) ? limit : 20) };
    });
    route('/cognition-engine/retrieval/candidates', (url) => {
      const limit = Number(url.searchParams.get('limit') ?? '20');
      // 给标注工作流用：最近真实查询里还没标过的，附上当时返回了什么
      return { candidates: recallLog.unannotated(retrievalEval.annotatedQueries(), Number.isFinite(limit) ? limit : 20) };
    });
    route('/cognition-engine/retrieval/case', (url) => {
      const expected = (url.searchParams.get('expected') ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      const note = url.searchParams.get('note');
      return retrievalEval.addCase({
        query: url.searchParams.get('query') ?? '',
        expectedIds: expected,
        expectEmpty: url.searchParams.get('expectEmpty') === 'true',
        ...(note === null ? {} : { note }),
        source: 'user',
      });
    }, { method: 'POST' });
    route('/cognition-engine/retrieval/case/remove', (url) => ({
      id: url.searchParams.get('id') ?? '',
      ok: retrievalEval.removeCase(url.searchParams.get('id') ?? ''),
    }), { method: 'POST' });
    route('/cognition-engine/retrieval/evaluate', () => retrievalEval.evaluate(recallResolver), { method: 'POST' });

    // 分维度审计（S9）：不做单一总分，每个维度独立报告并标注评测者是谁
    route('/cognition-engine/audit/dimensions', () => {
      const stats = memory.stats();
      const styleSample = styleStore.sampleSummary();
      const styleCompare = styleStore.compare();
      const cpeCheck = cpe.document.lastCheck;
      const retrieval = retrievalEval.evaluate(recallIdsOf);
      const orphans = memory.orphans();
      const fb = injectionLog.statistics();
      const pStats = proactiveStore.document.stats;

      return {
        generatedAt: Date.now(),
        /** 四个维度各自独立，**故意不给总分**——Anchor 明确反对合成单一分数。 */
        dimensions: [
          {
            key: 'memory',
            title: '记忆质量',
            evaluator: '代码（确定性）',
            status: stats.conflicts > 0 || orphans.length > 0 ? 'attention' : 'ok',
            facts: {
              total: stats.total,
              current: stats.current,
              superseded: stats.superseded,
              conflicts: stats.conflicts,
              orphans: orphans.length,
            },
            /** 能找到「该找到的」吗（需要标注才有数）。 */
            retrieval: { cases: retrieval.cases, top1: retrieval.top1, top3: retrieval.top3, status: retrieval.status },
            note: (() => {
              const parts: string[] = [];
              parts.push(orphans.length > 0 ? `有 ${orphans.length} 条事实的取代者已被删除，永久不生效（可点「修一下」）` : '没有孤儿取代关系');
              // 冲突要说清口径：很多「冲突」其实是同一 subject 下的不同事，不是真矛盾
              if (stats.conflicts > 0) parts.push(`冲突 ${stats.conflicts} 对（同主题下内容不同即算，需人工判断是否真矛盾）`);
              return parts.join('；');
            })(),
          },
          {
            key: 'style',
            title: '说话风格',
            evaluator: '代码（统计量，不存原文）',
            status: styleCompare.status,
            facts: { turns: styleSample.turns, chars: styleSample.chars, similarity: styleCompare.similarity },
            note: styleCompare.note,
          },
          {
            key: 'capability',
            title: '能力回归',
            evaluator: '代码（冻结回归集）',
            status: cpeCheck?.status ?? 'insufficient',
            facts: {
              cases: cpe.document.holdout.cases.length,
              baseline: cpe.document.baseline?.passRate ?? null,
              lastPassRate: cpeCheck?.passRate ?? null,
              incidents: cpe.document.incidents.length,
            },
            note: cpeCheck?.note ?? '还没有跑过检查',
          },
          {
            key: 'feedback',
            title: '反馈与采纳',
            evaluator: '用户（你说了算）',
            status: fb.corrected + fb.confirmed > 0 ? 'ok' : 'insufficient',
            facts: {
              turns: fb.total,
              corrected: fb.corrected,
              confirmed: fb.confirmed,
              adoption: proactiveStore.adoptionRate(),
              samples: pStats.adopted + pStats.dismissed,
            },
            note:
              fb.corrected + fb.confirmed === 0
                ? '还没有收到过明确的「对/不对」，这些数字只表示记录通了，不代表准'
                : `明确反馈 ${fb.corrected + fb.confirmed} 次`,
          },
        ],
      };
    });
    route('/cognition-engine/memory/orphans', () => ({ orphans: memory.orphans() }));
    route('/cognition-engine/memory/repair', () => {
      const repaired = memory.repairOrphans();
      if (repaired > 0) {
        touch();
        refreshEvidence();
      }
      return { repaired };
    }, { method: 'POST' });

    // 八类不学：给候选做个检查（不改数据，只回答「该不该学」）
    route('/cognition-engine/learn/check', (url) => {
      const text = url.searchParams.get('text') ?? '';
      const sourceIds = url.searchParams.get('sourceIds');
      // 只在调用方**明确**说了 sourceIds 时才判「无用户依据」；
      // 不说 = 不知道，不能当成「没有」（否则每句正常准则都会被误拒）。
      const verdict = shouldReject(text, sourceIds === null ? {} : { hasUserEvidence: sourceIds.length > 0 });
      return { text: text.slice(0, 80), reject: verdict.reject, hits: verdict.hits };
    });
    route(
      '/cognition-engine/persona/undo',
      (url) => persona.undo(url.searchParams.get('hash') ?? undefined),
      { method: 'POST' },
    );

    // 风格指纹（S4）：只读统计量，页面/脚本查询用
    route('/cognition-engine/style', (url) => {
      const rawBucket = url.searchParams.get('bucket');
      const bucket: StyleBucket | 'all' =
        rawBucket === 'technical' || rawBucket === 'emotional' || rawBucket === 'casual' ? rawBucket : 'all';
      const rawRecent = Number(url.searchParams.get('recent') ?? '30');
      return {
        enabled: config.styleEnabled,
        path: styleStore.path,
        sample: styleStore.sampleSummary(),
        comparison: styleStore.compare({
          bucket,
          ...(Number.isFinite(rawRecent) ? { recentTurns: rawRecent } : {}),
        }),
        trend: styleStore.trend(12),
        /** 只落统计量、不落原文——这一项写出来是为了让后来人一眼看到边界。 */
        storesRawText: false,
        saveError: styleStore.lastSaveError ?? null,
      };
    });
    route('/cognition-engine/style/baseline', () => styleStore.freezeBaseline(), { method: 'POST' });
    route(
      '/cognition-engine/persona/propose',
      (url) => {
        const raw = url.searchParams.get('label');
        const label = raw === 'human' ? 'human' : 'persona';
        const value = url.searchParams.get('value') ?? '';
        const reason = url.searchParams.get('reason') ?? undefined;
        const by = url.searchParams.get('by') === 'user' ? 'user' : 'agent';
        const result = persona.propose({ label, value, by, ...(reason === undefined ? {} : { reason }) });
        return { ...result, warnings: result.proposal === undefined ? [] : persona.lint(value) };
      },
      { method: 'POST' },
    );
    route(
      '/cognition-engine/persona/confirm',
      (url) => persona.confirm(url.searchParams.get('id') ?? '', 'user'),
      { method: 'POST' },
    );
    route(
      '/cognition-engine/persona/reject',
      (url) => {
        const id = url.searchParams.get('id') ?? '';
        return { id, ok: persona.reject(id) };
      },
      { method: 'POST' },
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
        refreshEvidence();
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
    topics,
    taskManager,
    proactive,
    touch,
    reflection,
    persistReflection: (result) => persistReflection(memory, result),
    tasksReady,
    config,
    refreshEvidence,
    gapRecorder: (text, context) => {
      const { gap, duplicate } = gaps.add({ text, ...(context === undefined ? {} : { context }) });
      if (!duplicate) gaps.flush();
      return { id: gap.id, duplicate, open: gaps.open().length };
    },
    playbookRate: (id, kind, trace) => {
      const ok = playbook.markUsage(id, kind, trace);
      if (ok) void playbook.flush();
      return ok;
    },
    // 这两个之前漏传：导致「本地占位告警」从未出现、准则蒸馏不可用。
    currentReflectionMode: () => reflectionMode,
    distillPlaybook: runDistill,
    // S8：每次真实召回都记一条（只记 id 与分数，不记正文）
    onRecall: (info) => recallLog.record(info),
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
   * 把跨会话上下文挂进系统提示：有生效准则就注入准则本，否则回退到记忆摘要。
   *
   * 每次装配都会调用 text()，内容永远是最新的；两者都为空时返回空串——不占 token。
   * 具体拼什么由 renderInjectedContext 决定，与面板的「注入来源」同源。
   * text() 是纯的：装配多少次都不产生副作用（v0.11.0 在这里写日志，把注入表写成了轮询计数器）。
   */
  const systemPrompt = ctx.get?.('systemPrompt') as SystemPromptHost | undefined;
  if (config.injectMemory && systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    try {
      disposers.push(
        systemPrompt.section({
          name: 'cognition-engine-memory',
          order: 900,
          text: () => renderInjectedContext().text,
        }),
      );
    } catch (error) {
      ctx.logger?.warn?.(`cognition-engine: 系统提示段注册失败: ${messageOf(error)}`);
    }
  }

  /**
   * 人格段挂在最前面（order 100，记忆段是 900）。
   *
   * 顺序有讲究：人格是「谁在说话」，记忆是「知道什么」。
   * 人格放在后面会被长记忆段稀释；放在最前面才能稳定住风格。
   * 文件不存在时 `persona.render()` 返回空串，这个段实际不占任何 token。
   */
  if (config.personaEnabled && systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    try {
      const present = persona.loadSync();
      disposers.push(
        systemPrompt.section({
          name: 'cognition-engine-persona',
          order: 100,
          text: () => persona.render(),
        }),
      );
      ctx.logger?.info?.(present ? 'cognition-engine: 人格段已挂载' : 'cognition-engine: 人格段已就位（暂无人格文件）');
    } catch (error) {
      ctx.logger?.warn?.(`cognition-engine: 人格段注册失败: ${messageOf(error)}`);
    }
  }

  /**
   * 后台巡视：每隔 patrolIntervalHours 检查 tasks.json，
   * 用 ReflectionWorker 在后台宏任务里复盘最久没动的任务，全程不阻塞主线程。
   */
  const patrol = async (): Promise<void> => {
    try {
      await tasksReady;

      // 主动闸门扫描（S7）：放在最前面——即使没有逾期任务也要记录 wouldDo
      try {
        runProactiveScan();
      } catch (error) {
        ctx.logger?.warn?.(`cognition-engine: 主动扫描失败 ${messageOf(error)}`);
      }

      // P1 记忆生命周期：长期没被想起的记忆退出 strict 召回（不删数据）
      const archived = memory.autoArchive({ idleDays: 180, maxActivation: 1 });
      if (archived.length > 0) refreshEvidence();
      if (archived.length > 0) {
        ctx.logger?.info?.(`cognition-engine: 已归档 ${archived.length} 条长期未访问的记忆`);
        touch();
      }

      const due = taskManager.check_due_tasks();
      const target = due[0];
      if (target === undefined) return;
      const overdueHours = Math.round(target.overdueMs / 3_600_000);

      // 自动复盘要花 3 次模型调用（≈3100 tokens），默认不跑。
      // 关掉时仍然写一条提示，「提醒」这个功能保留，只是不烧 token。
      if (!autoReflect || reflectionMode !== 'real') {
        ctx.logger?.info?.(
          `cognition-engine: 巡视发现 ${due.length} 个待催办任务，已记录提示（未开启自动复盘）`,
        );
        await taskManager.update_task_progress(
          target.id,
          target.status,
          `自动巡视：已超期 ${overdueHours} 小时，待处理`,
        );
        return;
      }

      ctx.logger?.info?.(
        `cognition-engine: 巡视发现 ${due.length} 个待催办任务，后台复盘 ${target.id}`,
      );
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

  // 启动后探测一次模型能力，让设置页能列出可选推理档位
  void refreshEfforts();

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
