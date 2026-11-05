/**
 * src/persist.ts — 原子 JSON 快照存储
 *
 * 写盘策略：临时文件 + rename（原子替换），写入串行化，变更后延迟合并（debounce）。
 *
 * 数据安全三件套：
 *   1. 跨进程写锁——用 O_EXCL 创建 .lock 文件，避免两个 DSH 实例同时写导致内容交错；
 *   2. 校验和——落盘后写一个 .sha256 侧车文件，加载时校验，检测到损坏就隔离而不是静默使用；
 *   3. 快照——每次覆盖前把上一版复制到 .snapshots/，保留最近若干份，可回滚。
 *
 * 局限（有意为之，写进 README）：锁只防「同时写坏」，不防「后写覆盖」。
 * 两个实例各自持有一份内存快照时，后写的会盖掉先写的。这里用 mtime 检测这种覆盖
 * 并通过 storageWarning 告知页面，但不做自动合并——自动合并需要领域知识，
 * 放在调用方的 merge 钩子里才安全。
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
    private readonly checksumPath;
    private readonly lockPath;
    private readonly snapshotDir;
    private readonly debounceMs;
    private readonly serialize;
    private readonly restore;
    private timer;
    private chain;
    private closed;
    /** 上次成功写入/加载时磁盘文件的 mtime，用于检测别的实例的写入。 */
    private lastDiskMtimeMs;
    /** 最近一次检测到的并发覆盖告警（页面展示用）。 */
    private storageWarning;
    constructor(options: JsonStoreOptions<T>);
    get path(): string;
    /** 检测到的并发写入告警；空串表示没有。 */
    get warning(): string;
    clearWarning(): void;
    /** 启动时恢复；文件不存在返回 false。损坏的文件会备份后按空库启动，绝不阻断加载。 */
    load(): Promise<boolean>;
    /** 同步恢复，用于插件加载阶段——避免工具在异步恢复完成前读到空库。 */
    loadSync(): boolean;
    /**
     * 校验和比对。侧车不存在时按「旧版存档」放行，避免升级后打不开旧数据。
     */
    private verifyChecksum;
    /** 把损坏的文件挪到一边，留档可查，同时让插件能正常启动。 */
    private quarantine;
    /** 标记有变更，延迟合并写盘。 */
    schedule(): void;
    /** 立即写盘（卸载前调用）。 */
    flush(): Promise<void>;
    /** 删除落盘文件（清空数据时用）。 */
    remove(): Promise<void>;
    /** 列出可用快照，最新的在前。 */
    listSnapshots(): Promise<Array<{
        name: string;
        at: number;
        bytes: number;
    }>>;
    /** 把某个快照恢复到当前文件（先给当前文件再存一份快照，避免回滚本身丢数据）。 */
    restoreSnapshot(name: string): Promise<boolean>;
    /** 停止接收新的写盘请求（插件卸载时调用）。 */
    close(): void;
    /** 用 O_EXCL 原子建锁；拿不到就退避重试，僵死锁直接清掉。 */
    private withLock;
    /** 磁盘文件在我们上次读写之后被改过 → 说明别的实例写过，记一条告警。 */
    private detectConcurrentWrite;
    private rememberDiskMtime;
    /** 覆盖前留一份上一版；只保留最近 MAX_SNAPSHOTS 份。 */
    private snapshotPrevious;
}
