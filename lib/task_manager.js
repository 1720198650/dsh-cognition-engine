/**
 * src/task_manager.ts — LongHorizonTaskManager
 *
 * 长程任务台账：纯 TypeScript + 原生 fs，零外部依赖。
 * 落盘用「临时文件 + rename」的原子写，避免进程被杀时留下半个 JSON。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveInPackage } from "./util.js";
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];
function isStatus(value) {
    return typeof value === 'string' && STATUSES.includes(value);
}
export class LongHorizonTaskManager {
    filePath;
    clock;
    heartbeatMs;
    readImpl;
    writeImpl;
    tasks = new Map();
    seq = 0;
    loaded = false;
    writeChain = Promise.resolve();
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveInPackage('tasks.json') : resolve(options.filePath);
        this.clock = options.now ?? (() => Date.now());
        this.heartbeatMs = options.heartbeatMs ?? 6 * 60 * 60 * 1000;
        this.readImpl = options.readFileImpl ?? readFile;
        this.writeImpl = options.writeFileImpl ?? writeFile;
    }
    /** tasks.json 的绝对路径，便于告诉用户数据落在哪里。 */
    get path() {
        return this.filePath;
    }
    /** 启动时恢复。文件不存在视为空台账；损坏的 JSON 直接抛错，不静默吞掉。 */
    async load() {
        if (this.loaded)
            return this;
        try {
            const raw = await this.readImpl(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
                for (const task of parsed.tasks) {
                    if (typeof task?.id !== 'string' || !isStatus(task.status))
                        continue;
                    const normalized = {
                        id: task.id,
                        description: String(task.description ?? ''),
                        status: task.status,
                        createdAt: Number(task.createdAt ?? 0),
                        lastUpdatedAt: Number(task.lastUpdatedAt ?? 0),
                        context: Array.isArray(task.context) ? task.context.map(String) : [],
                    };
                    this.tasks.set(normalized.id, normalized);
                    const tail = Number.parseInt(normalized.id.replace(/^task-/, ''), 10);
                    if (Number.isFinite(tail) && tail > this.seq)
                        this.seq = tail;
                }
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT')
                throw error;
        }
        this.loaded = true;
        return this;
    }
    /** 创建任务并落盘。 */
    async create_task(description) {
        const text = description.trim();
        if (text.length === 0)
            throw new Error('create_task: description 不能为空');
        await this.load();
        const now = this.clock();
        const task = {
            id: `task-${++this.seq}`,
            description: text,
            status: 'PENDING',
            createdAt: now,
            lastUpdatedAt: now,
            context: [],
        };
        this.tasks.set(task.id, task);
        await this.persist();
        return { ...task, context: [...task.context] };
    }
    /** 更新进度：状态必填，线索可追加。 */
    async update_task_progress(id, newStatus, newContext) {
        if (!isStatus(newStatus))
            throw new Error(`update_task_progress: 非法状态 ${String(newStatus)}`);
        await this.load();
        const task = this.tasks.get(id);
        if (task === undefined)
            throw new Error(`update_task_progress: 未知任务 ${id}`);
        const clues = newContext === undefined
            ? []
            : (typeof newContext === 'string' ? [newContext] : [...newContext]).filter((item) => item.trim().length > 0);
        const next = {
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
    async delete_task(id) {
        await this.load();
        const existed = this.tasks.delete(id);
        if (existed)
            await this.persist();
        return existed;
    }
    /** 未完成的任务（PENDING / IN_PROGRESS），按创建时间升序。 */
    get_pending_tasks() {
        return this.sorted().filter((task) => task.status !== 'COMPLETED').map(cloneTask);
    }
    /** 全部任务，按创建时间升序。 */
    all() {
        return this.sorted().map(cloneTask);
    }
    get(id) {
        const task = this.tasks.get(id);
        return task === undefined ? undefined : cloneTask(task);
    }
    /**
     * 长程心跳：供外部定时器调用。
     * 返回「超过 heartbeatMs 没有更新」的未完成任务，用于催办。
     */
    check_due_tasks(now = this.clock()) {
        return this.sorted()
            .filter((task) => task.status !== 'COMPLETED')
            .map((task) => ({ ...cloneTask(task), overdueMs: Math.max(0, now - task.lastUpdatedAt) }))
            .filter((task) => task.overdueMs >= this.heartbeatMs);
    }
    /** 手动强制落盘（一般不需要调用）。 */
    async flush() {
        await this.persist();
    }
    sorted() {
        return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }
    /** 串行化写入：临时文件 + rename，保证读者永远看不到半个文件。 */
    persist() {
        const snapshot = { version: 1, tasks: this.sorted().map(cloneTask) };
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
function cloneTask(task) {
    return { ...task, context: [...task.context] };
}
