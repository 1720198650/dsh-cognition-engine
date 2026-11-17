/**
 * src/sources.ts — 不可变来源账本（照 SoMem 的 Source 层）
 *
 * SoMem（arXiv:2611.11929）的要点：**Source 只追加、永不修改**；
 * 所有后来的"改写"都发生在 Topic 文档里，Source 只作为证据被引用。
 *
 * 我们照这个做：
 *   - 每次导入（粘贴/文件）→ 一条 Source 记录，带内容哈希 + 前一条哈希（链）
 *   - 候选（inbox）只是"待整理的指针"，指向 Source
 *   - 采用后事实 tag 里带 `src:<id>`，wiki 的条目再指向事实 → 三者串成证据链
 *
 * 零依赖：JSONL + sha256。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
const ZERO = '0'.repeat(64);
function hashOf(prev, payload) {
    return createHash('sha256').update(prev).update('|').update(payload).digest('hex');
}
export class SourceStore {
    filePath;
    clock;
    records;
    constructor(options) {
        this.filePath = options.filePath;
        this.clock = options.now ?? (() => Date.now());
    }
    load() {
        if (this.records !== undefined)
            return this.records;
        this.records = [];
        if (!existsSync(this.filePath))
            return this.records;
        for (const line of readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            try {
                this.records.push(JSON.parse(trimmed));
            }
            catch {
                break; // 坏行停下，verify 会报告
            }
        }
        return this.records;
    }
    /** 追加一条不可变来源，返回 id。 */
    append(input) {
        const records = this.load();
        const prevHash = records.length === 0 ? ZERO : records[records.length - 1].hash;
        const contentHash = createHash('sha256').update(input.content).digest('hex');
        const draft = {
            id: `src-${records.length + 1}`,
            at: this.clock(),
            kind: input.kind,
            title: input.title.slice(0, 80),
            content: input.content,
            contentHash,
            prevHash,
            ...(input.locator === undefined ? {} : { locator: input.locator }),
        };
        const payload = [
            draft.id,
            String(draft.at),
            draft.kind,
            draft.title,
            draft.contentHash,
            draft.locator ?? '',
        ].join('|');
        const record = { ...draft, hash: hashOf(prevHash, payload) };
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
        records.push(record);
        return record;
    }
    get(id) {
        return this.load().find((record) => record.id === id);
    }
    list(limit = 50) {
        return this.load().slice(-Math.max(1, limit));
    }
    /** 校验内容哈希 + 链。任何一条被改，从该点起断。 */
    verify() {
        const records = this.load();
        let prev = ZERO;
        for (const record of records) {
            const payload = [
                record.id,
                String(record.at),
                record.kind,
                record.title,
                record.contentHash,
                record.locator ?? '',
            ].join('|');
            const expect = hashOf(prev, payload);
            const contentOk = createHash('sha256').update(record.content).digest('hex') === record.contentHash;
            if (record.prevHash !== prev || record.hash !== expect || !contentOk) {
                return { ok: false, total: records.length, brokenAt: record.id };
            }
            prev = record.hash;
        }
        return { ok: true, total: records.length, brokenAt: null };
    }
}
