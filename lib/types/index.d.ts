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
import { TemporalMemoryStore } from './memory.ts';
import type { TemporalFact } from './memory.ts';
interface ToolHost {
    register(definition: unknown): () => void;
}
/** 落盘的整体状态。 */
/** 反思引擎模式：关闭 / 本地占位 / 真实模型。 */
export type ReflectionMode = 'off' | 'local' | 'real';
export declare function normalizeReflectionMode(value: unknown): ReflectionMode;
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
    /**
     * dsh-superagent 的 HTTP 地址。默认 `http://127.0.0.1:3082`（WSL 里那个）。
     *
     * 面板的「超级代理」页签靠它做只读镜像。**不可达只是显示未连接，不影响本插件任何功能**。
     */
    superagentBaseUrl?: string;
    /** 请求 superagent 的超时（毫秒），默认 3000——对面在 WSL，不能把面板拖住。 */
    superagentTimeoutMs?: number;
    /**
     * 派活用的仓库 `owner/name`。设了之后面板能直接生成「新建 Issue」链接；
     * 不设就只生成可复制的派单文本。**不存任何 GitHub 凭据**——派活走你自己已登录的浏览器。
     */
    superagentRepo?: string;
    /**
     * **只读注入模式**：只把「准则本 + 人格」注册成提示段，别的一概不做。
     *
     * 为什么需要：dsh-superagent 的 preset 会话（执行器）**不继承 host 级 `systemPrompt.section`**，
     * 实测确认（同一个 profile 里标准预设会话有注入、执行器预设没有）。要让它吃到注入，
     * 必须把插件再挂进那个 preset。但挂完整插件会在同一个数据目录上产生第二个实例、
     * 两份内存快照互相覆盖——所以挂的是这个只读模式：
     * **不注册工具、不注册 HTTP 路由、不启动巡视、不写任何文件**，只出提示段。
     */
    injectionOnly?: boolean;
    /** 上锁时使用的固定口令；不设则每次上锁随机生成。 */
    lockToken?: string;
    /** 真模型：显式指定 provider / model，不设则跟随当前默认模型。 */
    llmProvider?: string;
    llmModel?: string;
    /** 启动时是否直接启用真模型。 */
    /** 反思引擎初始模式，默认 off（不开启，避免默认产出误导性输出）。 */
    reflectionMode?: string;
}
export declare const name = "cognition-engine";
/** 需要 tools 服务才能注册工具。 */
export declare const inject: string[];
/**
 * 反思回写记忆（Generative Agents 的闭环）：把 synthesis 存成一条可召回的记忆，
 * 并让结论也进图式网络，这样以后 expand 能把相关结论带出来。
 */
export declare function persistReflection(memory: TemporalMemoryStore, result: {
    query: string;
    synthesis: string;
}): TemporalFact;
export declare function apply(ctx: PluginContext, rawConfig?: unknown): (() => void) | undefined;
export {};
