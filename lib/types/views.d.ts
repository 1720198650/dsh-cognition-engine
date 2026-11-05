/**
 * src/views.ts — 页面用的只读视图
 *
 * 从插件入口里拆出来的纯展示逻辑：给定当前状态，算出给页面看的 JSON。
 * 不持有状态、不改任何东西，方便单独测。
 */
import type { TemporalMemoryStore } from './memory.ts';
import type { LongHorizonTaskManager } from './task_manager.ts';
export interface DetailDeps {
    memory: TemporalMemoryStore;
    taskManager: LongHorizonTaskManager;
}
/** 核心记忆摘要的字数上限（≈150 tokens）。 */
export declare const CORE_DIGEST_CHARS = 400;
/**
 * 跨会话「核心记忆块」（Letta memory block 的最小实现）。
 *
 * 取全局作用域下按 重要度 × 时近性 排序的前 N 条，压成一段有字数上限的纯文本。
 * 返回空串表示没有可注入的内容。
 */
export declare function buildCoreDigest(memory: TemporalMemoryStore, options?: {
    limit?: number;
    chars?: number;
    now?: number;
}): string;
/** 面板展开时按需拉取的明细（不走模型上下文，只给页面看）。 */
export declare function buildDetail({ memory, taskManager }: DetailDeps): Record<string, unknown>;
