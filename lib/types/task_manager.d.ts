/**
 * src/task_manager.ts — LongHorizonTaskManager
 *
 * 长程任务台账：纯 TypeScript + 原生 fs，零外部依赖。
 * 落盘用「临时文件 + rename」的原子写，避免进程被杀时留下半个 JSON。
 */
import { readFile, writeFile } from 'node:fs/promises';
export type LongTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
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
export declare class LongHorizonTaskManager {
    private readonly filePath;
    private readonly clock;
    private readonly heartbeatMs;
    private readonly readImpl;
    private readonly writeImpl;
    private readonly tasks;
    private seq;
    private loaded;
    private writeChain;
    constructor(options?: TaskManagerOptions);
    /** tasks.json 的绝对路径，便于告诉用户数据落在哪里。 */
    get path(): string;
    /** 启动时恢复。文件不存在视为空台账；损坏的 JSON 直接抛错，不静默吞掉。 */
    load(): Promise<this>;
    /** 创建任务并落盘。 */
    create_task(description: string, span?: {
        startAt?: number;
        endAt?: number;
        order?: number;
        parallel?: boolean;
        topicIds?: string[];
    }): Promise<LongTask>;
    /** 调整排序号或并行标记（不改状态）。 */
    set_meta(id: string, meta: {
        order?: number;
        parallel?: boolean;
        topicIds?: string[];
    }): Promise<LongTask | undefined>;
    /** 更新进度：状态必填，线索可追加。 */
    update_task_progress(id: string, newStatus: LongTaskStatus, newContext?: string | readonly string[]): Promise<LongTask>;
    /** 删除任务并落盘，返回是否真的删掉了。 */
    delete_task(id: string): Promise<boolean>;
    /** 未完成的任务（PENDING / IN_PROGRESS），按创建时间升序。 */
    get_pending_tasks(): LongTask[];
    /** 全部任务，按创建时间升序。 */
    all(): LongTask[];
    get(id: string): LongTask | undefined;
    /**
     * 长程心跳：供外部定时器调用。
     * 返回「超过 heartbeatMs 没有更新」的未完成任务，用于催办。
     */
    check_due_tasks(now?: number): DueTask[];
    /** 手动强制落盘（一般不需要调用）。 */
    flush(): Promise<void>;
    private sorted;
    /** 串行化写入：临时文件 + rename，保证读者永远看不到半个文件。 */
    private persist;
}
