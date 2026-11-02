/**
 * src/persist.ts — 原子 JSON 快照存储
 *
 * 与 task_manager 同一套写盘策略：临时文件 + rename，写入串行化，
 * 变更后延迟合并（debounce），避免每写一条记忆就落一次盘。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveInPackage } from "./util.js";
export class JsonStateStore {
    filePath;
    debounceMs;
    serialize;
    restore;
    timer = null;
    chain = Promise.resolve();
    closed = false;
    constructor(options) {
        this.filePath = options.filePath === undefined ? resolveInPackage('cognition-state.json') : resolve(options.filePath);
        this.debounceMs = Math.max(0, options.debounceMs ?? 300);
        this.serialize = options.serialize;
        this.restore = options.restore;
    }
    get path() {
        return this.filePath;
    }
    /** 启动时恢复；文件不存在返回 false。损坏的文件会备份后按空库启动，绝不阻断加载。 */
    async load() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            this.restore(JSON.parse(raw));
            return true;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return false;
            this.quarantine();
            return false;
        }
    }
    /** 同步恢复，用于插件加载阶段——避免工具在异步恢复完成前读到空库。 */
    loadSync() {
        try {
            this.restore(JSON.parse(readFileSync(this.filePath, 'utf8')));
            return true;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return false;
            this.quarantine();
            return false;
        }
    }
    /** 把损坏的文件挪到一边，留档可查，同时让插件能正常启动。 */
    quarantine() {
        try {
            renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        }
        catch {
            // 备份失败也不能抛：加载阶段必须活着
        }
    }
    /** 标记有变更，延迟合并写盘。 */
    schedule() {
        if (this.closed)
            return;
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, this.debounceMs);
        this.timer.unref?.();
    }
    /** 立即写盘（卸载前调用）。 */
    flush() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const payload = `${JSON.stringify(this.serialize(), null, 2)}\n`;
        const target = this.filePath;
        const temp = `${target}.tmp`;
        this.chain = this.chain
            .then(async () => {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(temp, payload, 'utf8');
            await rename(temp, target);
        })
            .catch(() => {
            // 写盘失败（磁盘满、并发 rename 竞争等）不能变成未捕获拒绝，
            // 否则会以 unhandledRejection 形式终止宿主进程。
        });
        return this.chain;
    }
    /** 删除落盘文件（清空数据时用）。 */
    async remove() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.chain = this.chain
            .then(async () => {
            await rm(this.filePath, { force: true });
        })
            .catch(() => {
            // 删除失败同样不能变成未捕获拒绝
        });
        await this.chain;
    }
    /** 停止接收新的写盘请求（插件卸载时调用）。 */
    close() {
        this.closed = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
