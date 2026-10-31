/**
 * src/views.ts — 页面用的只读视图
 *
 * 从插件入口里拆出来的纯展示逻辑：给定当前状态，算出给页面看的 JSON。
 * 不持有状态、不改任何东西，方便单独测。
 */

import { isCurrent } from './memory.ts';
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
export function buildDetail({ memory, graph, mood, taskManager }: DetailDeps): Record<string, unknown> {
  const now = Date.now();

  const memories = memory
    .all()
    .slice()
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, 50)
    .map((fact) => ({
      id: fact.id,
      subject: fact.subject,
      source: fact.source,
      content: fact.content.length > 200 ? `${fact.content.slice(0, 200)}…` : fact.content,
      chars: fact.content.length,
      validFrom: fact.validFrom,
      validTo: fact.validTo,
      supersededBy: fact.supersededBy,
      tags: fact.tags,
      importance: fact.importance,
      activation: Number(fact.activation.toFixed(2)),
      current: isCurrent(fact, now),
    }));

  const schemas = graph.all().map((schema) => ({
    id: schema.id,
    label: schema.label,
    members: schema.members.size,
    polarity: schema.polarity,
    updatedAt: schema.updatedAt,
    neighbors: graph.neighbors(schema.id).length,
  }));

  const tasks = taskManager
    .all()
    .slice()
    .sort((a, b) => {
      const rank = (status: string): number => (status === 'COMPLETED' ? 2 : status === 'IN_PROGRESS' ? 0 : 1);
      return rank(a.status) - rank(b.status) || b.lastUpdatedAt - a.lastUpdatedAt;
    })
    .map((task) => ({
      id: task.id,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt,
      lastUpdatedAt: task.lastUpdatedAt,
      overdueMs: Math.max(0, now - task.lastUpdatedAt),
      context: task.context.slice(-5),
    }));

  return {
    mood: mood.explain(),
    tasks,
    memories,
    schemas,
    communities: graph.summarize(),
    counts: {
      tasks: tasks.filter((task) => task.status !== 'COMPLETED').length,
      memories: memories.length,
      schemas: schemas.length,
    },
    updatedAt: now,
  };
}
