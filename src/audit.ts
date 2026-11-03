/**
 * src/audit.ts — 追加式审计日志
 *
 * 每次记忆变更写一行 JSONL，只追加不修改，用于回答「这条记忆是谁、什么时候、
 * 通过什么通道写进来的」。文件按大小轮转，避免无限增长。
 *
 * 写入是 fire-and-forget：审计失败绝不能影响主流程。
 */

import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveInPackage } from './util.ts';

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

export class AuditLog {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: AuditLogOptions = {}) {
    this.filePath = options.filePath === undefined ? resolveInPackage('cognition-audit.jsonl') : resolve(options.filePath);
    this.maxBytes = Math.max(64 * 1024, options.maxBytes ?? 5 * 1024 * 1024);
  }

  get path(): string {
    return this.filePath;
  }

  /** 追加一条；永不抛错。 */
  append(event: AuditEvent): void {
    const line = `${JSON.stringify({ ts: Date.now(), ...event })}\n`;
    this.chain = this.chain
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, 'utf8');
        await this.rotateIfNeeded();
      })
      .catch(() => undefined);
  }

  /** 读取最近 N 条（默认 20）。 */
  async tail(limit = 20): Promise<string[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const lines = raw.split('\n').filter((line) => line.trim().length > 0);
      return lines.slice(-Math.max(1, Math.min(limit, 200)));
    } catch {
      return [];
    }
  }

  /** 等待排队中的写入落盘（测试与卸载时用）。 */
  async flush(): Promise<void> {
    await this.chain;
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.filePath);
      if (info.size <= this.maxBytes) return;
      await rename(this.filePath, `${this.filePath}.1`).catch(() => undefined);
    } catch {
      // 文件刚被轮转或不存在，忽略
    }
  }
}
