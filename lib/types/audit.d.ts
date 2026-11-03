/**
 * src/audit.ts — 追加式审计日志
 *
 * 每次记忆变更写一行 JSONL，只追加不修改，用于回答「这条记忆是谁、什么时候、
 * 通过什么通道写进来的」。文件按大小轮转，避免无限增长。
 *
 * 写入是 fire-and-forget：审计失败绝不能影响主流程。
 */
export interface AuditEvent {
    /** 操作类型：remember / forget / update / delete / restore / consolidate / clear / import。 */
    op: string;
    id?: string;
    subject?: string;
    /** 内容指纹，不存原文，避免审计日志变成第二份记忆库。 */
    hash?: string;
    source?: string;
    origin?: string;
    detail?: string;
}
export interface AuditLogOptions {
    filePath?: string;
    /** 单文件上限，超过就轮转成 .1。默认 5MB。 */
    maxBytes?: number;
}
export declare class AuditLog {
    private readonly filePath;
    private readonly maxBytes;
    private chain;
    constructor(options?: AuditLogOptions);
    get path(): string;
    /** 追加一条；永不抛错。 */
    append(event: AuditEvent): void;
    /** 读取最近 N 条（默认 20）。 */
    tail(limit?: number): Promise<string[]>;
    /** 等待排队中的写入落盘（测试与卸载时用）。 */
    flush(): Promise<void>;
    private rotateIfNeeded;
}
