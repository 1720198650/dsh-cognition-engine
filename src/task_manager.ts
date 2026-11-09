/**
 * src/task_manager.ts — LongHorizonTaskManager
 *
 * 长程任务台账：纯 TypeScript + 原生 fs，零外部依赖。
 * 落盘用「临时文件 + rename」的原子写，避免进程被杀时留下半个 JSON。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveDataFile, resolveUserPath } from './util.ts';

export type LongTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * 标 COMPLETED 是否缺证据。
 *
 * 依据：ACL 2026 最佳论文《The Imperfective Paradox in Large Language Models》(689)——
 * 模型对目标导向事件系统性幻觉"已经完成"，即使文本明确说没完成。
 * 所以「完成」这个状态必须被外部证据解锁，否则只是自我感觉。
 *
 * 只要求 ≥8 个字，是为了挡住"做完了""ok"这类无信息量的答复，不是搞形式审查。
 */
export function completionNeedsEvidence(status: LongTaskStatus, evidence: string | undefined): boolean {
  if (status !== 'COMPLETED') return false;
  return (evidence ?? '').trim().length < 8;
}

export interface LongTask {
  id: string;
  /** 任务目标。 */
  description: string;
  status: LongTaskStatus;
  createdAt: number;
  lastUpdatedAt: number;
  /** 线索：每次更新追加一条。 */
  context: string[];
  /** 任务开始时间（用户可自定义），毫秒。 */
  startAt?: number;
  /** 兼容字段：不再作为截止时间使用（任务改为提醒式）。 */
  endAt?: number;
  /** 手动排序号，小的在前。 */
  order?: number;
  /** 是否与相邻任务并行推进。 */
  parallel?: boolean;
  /**
   * 归属主题（多对多）。空 = 未归类。
   *
   * 任务不再是独立台账，而是主题下的「进行中事项」——
   * 打开某主题就能看到它有哪些事没做完。
   */
  topicIds?: string[];
}

export interface DueTask extends LongTask {
  /** 距上次更新已经过去多久（毫秒）。 */
  overdueMs: number;
}

/**
 * 带实时逾期时长的任务视图（`/detail` 与主动扫描共用）。
 *
 * 为什么单独一个类型：`LongTask` 本身**不含** `overdueMs`，
 * 之前 `/detail` 直接把 `LongTask` 序列化出去，前端读到的 `overdueMs` 是 undefined，
 * 于是「逾期 N 小时」这类文案拿不到真实数字。
 */
export interface TaskWithAge extends LongTask {
  /** 距上次更新过去多久（毫秒）。**所有任务都有**，未逾期的也在里面。 */
  ageMs: number;
  /** 是否已经超过心跳阈值。 */
  overdue: boolean;
}

export interface TaskManagerOptions {
  /** tasks.json 的位置，默认 `~/.dsh/cognition-engine/tasks.json`。 */
  filePath?: string;
  now?: () => number;
  /** 多久没更新就算需要催办，默认 6 小时。 */
  heartbeatMs?: number;
  /** 注入点，测试可以替换成内存实现。 */
  readFileImpl?: typeof readFile;
  writeFileImpl?: typeof writeFile;
}

interface TaskFile {
  version: 1;
  tasks: LongTask[];
}

const STATUSES: readonly LongTaskStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

function isStatus(value: unknown): value is LongTaskStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export class LongHorizonTaskManager {
  private readonly filePath: string;
  private readonly clock: () => number;
  private readonly heartbeatMs: number;
  private readonly readImpl: typeof readFile;
  private readonly writeImpl: typeof writeFile;
  private readonly tasks = new Map<string, LongTask>();
  private seq = 0;
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: TaskManagerOptions = {}) {
    this.filePath = options.filePath === undefined ? resolveDataFile('tasks.json') : resolveUserPath(options.filePath);
    this.clock = options.now ?? (() => Date.now());
    this.heartbeatMs = options.heartbeatMs ?? 6 * 60 * 60 * 1000;
    this.readImpl = options.readFileImpl ?? readFile;
    this.writeImpl = options.writeFileImpl ?? writeFile;
  }

  /** tasks.json 的绝对路径，便于告诉用户数据落在哪里。 */
  get path(): string {
    return this.filePath;
  }

  /** 启动时恢复。文件不存在视为空台账；损坏的 JSON 直接抛错，不静默吞掉。 */
  async load(): Promise<this> {
    if (this.loaded) return this;
    try {
      const raw = await this.readImpl(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as TaskFile;
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
        for (const task of parsed.tasks) {
          if (typeof task?.id !== 'string' || !isStatus(task.status)) continue;
          const normalized: LongTask = {
            id: task.id,
            description: String(task.description ?? ''),
            status: task.status,
            createdAt: Number(task.createdAt ?? 0),
            lastUpdatedAt: Number(task.lastUpdatedAt ?? 0),
            context: Array.isArray(task.context) ? task.context.map(String) : [],
            // 可选字段必须显式带上：之前这里是白名单，导致 startAt / endAt /
            // order / parallel / topicIds 每次重启都被丢掉（任务排序和主题归属无声消失）。
            ...(typeof task.startAt === 'number' ? { startAt: task.startAt } : {}),
            ...(typeof task.endAt === 'number' ? { endAt: task.endAt } : {}),
            ...(typeof task.order === 'number' ? { order: task.order } : {}),
            ...(typeof task.parallel === 'boolean' ? { parallel: task.parallel } : {}),
            ...(Array.isArray(task.topicIds)
              ? { topicIds: task.topicIds.map(String).filter((x) => x.length > 0) }
              : {}),
          };
          this.tasks.set(normalized.id, normalized);
          const tail = Number.parseInt(normalized.id.replace(/^task-/, ''), 10);
          if (Number.isFinite(tail) && tail > this.seq) this.seq = tail;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
    this.loaded = true;
    return this;
  }

  /** 创建任务并落盘。 */
  async create_task(
    description: string,
    span?: { startAt?: number; endAt?: number; order?: number; parallel?: boolean; topicIds?: string[] },
  ): Promise<LongTask> {
    const text = description.trim();
    if (text.length === 0) throw new Error('create_task: description 不能为空');
    await this.load();

    const now = this.clock();
    const task: LongTask = {
      id: `task-${++this.seq}`,
      description: text,
      status: 'PENDING',
      createdAt: now,
      lastUpdatedAt: now,
      context: [],
      ...(span?.startAt === undefined ? {} : { startAt: span.startAt }),
      ...(span?.endAt === undefined ? {} : { endAt: span.endAt }),
      ...(span?.order === undefined ? {} : { order: span.order }),
      ...(span?.parallel === undefined ? {} : { parallel: span.parallel }),
      ...(span?.topicIds === undefined ? {} : { topicIds: [...new Set(span.topicIds.filter((x) => x.length > 0))] }),
    };
    this.tasks.set(task.id, task);
    await this.persist();
    return { ...task, context: [...task.context] };
  }

  /** 调整排序号或并行标记（不改状态）。 */
  async set_meta(
    id: string,
    meta: { order?: number; parallel?: boolean; topicIds?: string[] },
  ): Promise<LongTask | undefined> {
    await this.load();
    const task = this.tasks.get(id);
    if (task === undefined) return undefined;
    if (meta.order !== undefined) task.order = meta.order;
    if (meta.parallel !== undefined) task.parallel = meta.parallel;
    if (meta.topicIds !== undefined) {
      task.topicIds = [...new Set(meta.topicIds.filter((x) => x.length > 0))];
    }
    task.lastUpdatedAt = this.clock();
    await this.persist();
    return cloneTask(task);
  }

  /** 更新进度：状态必填，线索可追加。 */
  async update_task_progress(
    id: string,
    newStatus: LongTaskStatus,
    newContext?: string | readonly string[],
  ): Promise<LongTask> {
    if (!isStatus(newStatus)) throw new Error(`update_task_progress: 非法状态 ${String(newStatus)}`);
    await this.load();

    const task = this.tasks.get(id);
    if (task === undefined) throw new Error(`update_task_progress: 未知任务 ${id}`);

    const clues = newContext === undefined
      ? []
      : (typeof newContext === 'string' ? [newContext] : [...newContext]).filter((item) => item.trim().length > 0);

    const next: LongTask = {
      ...task,
      status: newStatus,
      lastUpdatedAt: this.clock(),
      context: [...task.context, ...clues],
    };
    this.tasks.set(id, next);
    await this.persist();
    return { ...next, context: [...next.context] };
  }

  /** 删除任务并落盘，返回是否真的删掉了。 */
  async delete_task(id: string): Promise<boolean> {
    await this.load();
    const existed = this.tasks.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  /** 未完成的任务（PENDING / IN_PROGRESS），按创建时间升序。 */
  get_pending_tasks(): LongTask[] {
    return this.sorted().filter((task) => task.status !== 'COMPLETED').map(cloneTask);
  }

  /** 全部任务，按创建时间升序。 */
  all(): LongTask[] {
    return this.sorted().map(cloneTask);
  }

  get(id: string): LongTask | undefined {
    const task = this.tasks.get(id);
    return task === undefined ? undefined : cloneTask(task);
  }

  /**
   * 带实时逾期的任务视图：`/detail` 用它，主动扫描也用它。
   *
   * 统一在**一个地方**算 ageMs/overdue，避免「列表页一套算法、扫描器另一套」——
   * 两套算法迟早会漂，然后就出现「页面说逾期 32 小时、提醒说逾期 29 小时」。
   */
  withAge(now: number = this.clock()): TaskWithAge[] {
    return this.sorted().map((task) => {
      const ageMs = Math.max(0, now - task.lastUpdatedAt);
      return { ...cloneTask(task), ageMs, overdue: task.status !== 'COMPLETED' && ageMs >= this.heartbeatMs };
    });
  }

  /**
   * 长程心跳：供外部定时器调用。
   * 返回「超过 heartbeatMs 没有更新」的未完成任务，用于催办。
   */
  check_due_tasks(now: number = this.clock()): DueTask[] {
    return this.sorted()
      .filter((task) => task.status !== 'COMPLETED')
      .map((task) => ({ ...cloneTask(task), overdueMs: Math.max(0, now - task.lastUpdatedAt) }))
      .filter((task) => task.overdueMs >= this.heartbeatMs);
  }

  /** 手动强制落盘（一般不需要调用）。 */
  async flush(): Promise<void> {
    await this.persist();
  }

  private sorted(): LongTask[] {
    return [...this.tasks.values()].sort((a, b) => {
      const ao = a.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.createdAt - b.createdAt;
    });
  }

  /** 串行化写入：临时文件 + rename，保证读者永远看不到半个文件。 */
  private persist(): Promise<void> {
    const snapshot: TaskFile = { version: 1, tasks: this.sorted().map(cloneTask) };
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    const target = this.filePath;
    const temp = `${target}.tmp`;

    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(target), { recursive: true });
      await this.writeImpl(temp, payload, 'utf8');
      await rename(temp, target);
    });
    return this.writeChain;
  }
}

function cloneTask(task: LongTask): LongTask {
  return { ...task, context: [...task.context] };
}
