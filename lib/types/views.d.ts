/**
 * src/views.ts — 页面用的只读视图
 *
 * 从插件入口里拆出来的纯展示逻辑：给定当前状态，算出给页面看的 JSON。
 * 不持有状态、不改任何东西，方便单独测。
 */
import type { TemporalMemoryStore } from './memory.ts';
import type { SchemaGraphManager } from './graph.ts';
import type { MoodStateMachine } from './mood.ts';
import type { LongHorizonTaskManager } from './task_manager.ts';
export interface DetailDeps {
    memory: TemporalMemoryStore;
    graph: SchemaGraphManager;
    mood: MoodStateMachine;
    taskManager: LongHorizonTaskManager;
}
/** 面板展开时按需拉取的明细（不走模型上下文，只给页面看）。 */
export declare function buildDetail({ memory, graph, mood, taskManager }: DetailDeps): Record<string, unknown>;
