/**
 * src/persist.ts — 原子 JSON 快照存储
 *
 * 与 task_manager 同一套写盘策略：临时文件 + rename，写入串行化，
 * 变更后延迟合并（debounce），避免每写一条记忆就落一次盘。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface JsonStoreOptions<T> {
  filePath?: string;
  /** 变更后延迟多久落盘，默认 300ms。 */
  debounceMs?: number;
  serialize: () => T;
  restore: (data: T) => void;
}

export class JsonStateStore<T> {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private readonly serialize: () => T;
  private readonly restore: (data: T) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: JsonStoreOptions<T>) {
    this.filePath = resolve(options.filePath ?? 'cognition-state.json');
    this.debounceMs = Math.max(0, options.debounceMs ?? 300);
    this.serialize = options.serialize;
    this.restore = options.restore;
  }

  get path(): string {
    return this.filePath;
  }

  /** 启动时恢复；文件不存在返回 false。损坏的 JSON 会抛错，不静默吞掉。 */
  async load(): Promise<boolean> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.restore(JSON.parse(raw) as T);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** 同步恢复，用于插件加载阶段——避免工具在异步恢复完成前读到空库。 */
  loadSync(): boolean {
    try {
      this.restore(JSON.parse(readFileSync(this.filePath, 'utf8')) as T);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** 标记有变更，延迟合并写盘。 */
  schedule(): void {
    if (this.closed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** 立即写盘（卸载前调用）。 */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const payload = `${JSON.stringify(this.serialize(), null, 2)}\n`;
    const target = this.filePath;
    const temp = `${target}.tmp`;
    this.chain = this.chain.then(async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temp, payload, 'utf8');
      await rename(temp, target);
    });
    return this.chain;
  }

  /** 删除落盘文件（清空数据时用）。 */
  async remove(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(async () => {
      await rm(this.filePath, { force: true });
    });
    await this.chain;
  }

  /** 停止接收新的写盘请求（插件卸载时调用）。 */
  close(): void {
    this.closed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
