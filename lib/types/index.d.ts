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
import { SchemaGraphManager } from './graph.ts';
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
export declare const name = "cognition-engine";
/** 需要 tools 服务才能注册工具。 */
export declare const inject: string[];
/**
 * 反思回写记忆（Generative Agents 的闭环）：把 synthesis 存成一条可召回的记忆，
 * 并让结论也进图式网络，这样以后 expand 能把相关结论带出来。
 */
export declare function persistReflection(memory: TemporalMemoryStore, graph: SchemaGraphManager, result: {
    query: string;
    synthesis: string;
}): TemporalFact;
export declare function apply(ctx: PluginContext, rawConfig?: unknown): (() => void) | undefined;
export {};
