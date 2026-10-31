/**
 * src/persist.ts — 原子 JSON 快照存储
 *
 * 与 task_manager 同一套写盘策略：临时文件 + rename，写入串行化，
 * 变更后延迟合并（debounce），避免每写一条记忆就落一次盘。
 */
export interface JsonStoreOptions<T> {
    filePath?: string;
    /** 变更后延迟多久落盘，默认 300ms。 */
    debounceMs?: number;
    serialize: () => T;
    restore: (data: T) => void;
}
export declare class JsonStateStore<T> {
    private readonly filePath;
    private readonly debounceMs;
    private readonly serialize;
    private readonly restore;
    private timer;
    private chain;
    private closed;
    constructor(options: JsonStoreOptions<T>);
    get path(): string;
    /** 启动时恢复；文件不存在返回 false。损坏的 JSON 会抛错，不静默吞掉。 */
    load(): Promise<boolean>;
    /** 同步恢复，用于插件加载阶段——避免工具在异步恢复完成前读到空库。 */
    loadSync(): boolean;
    /** 标记有变更，延迟合并写盘。 */
    schedule(): void;
    /** 立即写盘（卸载前调用）。 */
    flush(): Promise<void>;
    /** 删除落盘文件（清空数据时用）。 */
    remove(): Promise<void>;
    /** 停止接收新的写盘请求（插件卸载时调用）。 */
    close(): void;
}
