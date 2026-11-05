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
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { resolveDataFile } from "./util.js";
/** 同时保留的快照份数。 */
const MAX_SNAPSHOTS = 5;
/** 锁文件超过这个时间视为僵死（持锁进程已崩）。 */
const LOCK_STALE_MS = 30_000;
/** 拿锁的最长等待。 */
const LOCK_WAIT_MS = 5_000;
function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export class JsonStateStore {
    filePath;
    checksumPath;
    lockPath;
    snapshotDir;
    debounceMs;
    serialize;
    restore;
    timer = null;
    chain = Promise.resolve();
    closed = false;
    /** 上次成功写入/加载时磁盘文件的 mtime，用于检测别的实例的写入。 */
    lastDiskMtimeMs = 0;
    /** 最近一次检测到的并发覆盖告警（页面展示用）。 */
    storageWarning = '';
    constructor(options) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-state.json') : resolve(options.filePath);
        this.checksumPath = `${this.filePath}.sha256`;
        this.lockPath = `${this.filePath}.lock`;
        this.snapshotDir = join(dirname(this.filePath), '.snapshots');
        this.debounceMs = Math.max(0, options.debounceMs ?? 300);
        this.serialize = options.serialize;
        this.restore = options.restore;
    }
    get path() {
        return this.filePath;
    }
    /** 检测到的并发写入告警；空串表示没有。 */
    get warning() {
        return this.storageWarning;
    }
    clearWarning() {
        this.storageWarning = '';
    }
    /** 启动时恢复；文件不存在返回 false。损坏的文件会备份后按空库启动，绝不阻断加载。 */
    async load() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            if (!(await this.verifyChecksum(raw))) {
                this.quarantine();
                return false;
            }
            this.restore(JSON.parse(raw));
            await this.rememberDiskMtime();
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
            const raw = readFileSync(this.filePath, 'utf8');
            // 同步路径不校验 checksum：加载阶段宁可先起来，也不要因为校验失败丢光数据。
            // 校验失败的情况交给下一次 load()/写入前的检测。
            this.restore(JSON.parse(raw));
            try {
                const st = statSyncLite(this.filePath);
                if (st !== null)
                    this.lastDiskMtimeMs = st;
            }
            catch {
                /* 读不到 mtime 不影响加载 */
            }
            return true;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return false;
            this.quarantine();
            return false;
        }
    }
    /**
     * 校验和比对。侧车不存在时按「旧版存档」放行，避免升级后打不开旧数据。
     */
    async verifyChecksum(raw) {
        let expected;
        try {
            expected = (await readFile(this.checksumPath, 'utf8')).trim();
        }
        catch {
            return true;
        }
        return expected.length === 0 || expected === sha256(raw);
    }
    /** 把损坏的文件挪到一边，留档可查，同时让插件能正常启动。 */
    quarantine() {
        const stamp = Date.now();
        try {
            renameSync(this.filePath, `${this.filePath}.corrupt-${stamp}`);
        }
        catch {
            // 备份失败也不能抛：加载阶段必须活着
        }
        try {
            renameSync(this.checksumPath, `${this.checksumPath}.corrupt-${stamp}`);
        }
        catch {
            // 侧车可能本来就不存在
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
            await this.withLock(async () => {
                await this.detectConcurrentWrite();
                await this.snapshotPrevious();
                await writeFile(temp, payload, 'utf8');
                await rename(temp, target);
                await writeFile(this.checksumPath, sha256(payload), 'utf8');
                await this.rememberDiskMtime();
            });
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
            await this.withLock(async () => {
                await rm(this.filePath, { force: true });
                await rm(this.checksumPath, { force: true });
                this.lastDiskMtimeMs = 0;
            });
        })
            .catch(() => {
            // 删除失败同样不能变成未捕获拒绝
        });
        await this.chain;
    }
    /** 列出可用快照，最新的在前。 */
    async listSnapshots() {
        try {
            const names = await readdir(this.snapshotDir);
            const prefix = `${basename(this.filePath)}.`;
            const out = [];
            for (const name of names) {
                if (!name.startsWith(prefix) || !name.endsWith('.json'))
                    continue;
                const full = join(this.snapshotDir, name);
                try {
                    const st = await stat(full);
                    out.push({ name, at: st.mtimeMs, bytes: st.size });
                }
                catch {
                    /* 快照可能刚被清理 */
                }
            }
            return out.sort((a, b) => b.at - a.at);
        }
        catch {
            return [];
        }
    }
    /** 把某个快照恢复到当前文件（先给当前文件再存一份快照，避免回滚本身丢数据）。 */
    async restoreSnapshot(name) {
        if (name.includes('/') || name.includes('\\') || !name.endsWith('.json'))
            return false;
        const full = join(this.snapshotDir, name);
        let raw;
        try {
            raw = await readFile(full, 'utf8');
        }
        catch {
            return false;
        }
        await this.chain;
        this.chain = this.chain
            .then(async () => {
            await this.withLock(async () => {
                await this.snapshotPrevious();
                const temp = `${this.filePath}.tmp`;
                await writeFile(temp, raw, 'utf8');
                await rename(temp, this.filePath);
                await writeFile(this.checksumPath, sha256(raw), 'utf8');
                await this.rememberDiskMtime();
            });
            this.restore(JSON.parse(raw));
        })
            .catch(() => {
            /* 回滚失败不抛，由调用方按返回值/后续读取判断 */
        });
        await this.chain;
        return true;
    }
    /** 停止接收新的写盘请求（插件卸载时调用）。 */
    close() {
        this.closed = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    /* ------------------------------ 内部 ------------------------------ */
    /** 用 O_EXCL 原子建锁；拿不到就退避重试，僵死锁直接清掉。 */
    async withLock(fn) {
        await mkdir(dirname(this.lockPath), { recursive: true });
        const deadline = Date.now() + LOCK_WAIT_MS;
        for (;;) {
            try {
                const handle = await open(this.lockPath, 'wx');
                try {
                    await fn();
                    return;
                }
                finally {
                    await handle.close().catch(() => undefined);
                    await rm(this.lockPath, { force: true }).catch(() => undefined);
                }
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                // 持锁进程可能已经崩了：超过 LOCK_STALE_MS 视为僵死
                try {
                    const st = await stat(this.lockPath);
                    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                        await rm(this.lockPath, { force: true });
                        continue;
                    }
                }
                catch {
                    continue;
                }
                if (Date.now() > deadline) {
                    throw new Error('写锁超时：另一个实例正在写入，请稍后重试');
                }
                await sleep(50);
            }
        }
    }
    /** 磁盘文件在我们上次读写之后被改过 → 说明别的实例写过，记一条告警。 */
    async detectConcurrentWrite() {
        if (this.lastDiskMtimeMs === 0)
            return;
        try {
            const st = await stat(this.filePath);
            if (st.mtimeMs > this.lastDiskMtimeMs + 1) {
                this.storageWarning = '检测到其他 DSH 实例修改过记忆文件，本次写入可能覆盖了它的改动。建议只开一个实例，或先导出备份。';
            }
        }
        catch {
            // 文件不存在（首次写入）不算冲突
        }
    }
    async rememberDiskMtime() {
        try {
            const st = await stat(this.filePath);
            this.lastDiskMtimeMs = st.mtimeMs;
        }
        catch {
            this.lastDiskMtimeMs = 0;
        }
    }
    /** 覆盖前留一份上一版；只保留最近 MAX_SNAPSHOTS 份。 */
    async snapshotPrevious() {
        try {
            await stat(this.filePath);
        }
        catch {
            return; // 还没有文件，无需快照
        }
        try {
            await mkdir(this.snapshotDir, { recursive: true });
            const name = `${basename(this.filePath)}.${Date.now()}.json`;
            await copyFile(this.filePath, join(this.snapshotDir, name));
            const list = await this.listSnapshots();
            for (const old of list.slice(MAX_SNAPSHOTS)) {
                await rm(join(this.snapshotDir, old.name), { force: true }).catch(() => undefined);
            }
        }
        catch {
            // 快照失败不应阻断写入
        }
    }
}
/** 只取 mtime，失败返回 null（同步路径用）。 */
function statSyncLite(path) {
    try {
        return statSync(path).mtimeMs;
    }
    catch {
        return null;
    }
}
