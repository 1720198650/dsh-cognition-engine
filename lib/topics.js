/**
 * src/topics.ts — 主题注册表
 *
 * 主题不是「自动聚类的结果」，而是**人定的适用范围键**：
 *
 *   记忆 —— 发生过什么
 *   准则 —— 应该怎么做
 *   主题 —— 这条记忆/这条准则适用于哪类任务   ← 本文件
 *
 * 为什么不做自动聚类（调研结论，见 docs/topic-research.md）：
 *   - 自动聚类的收益在 10² 条记忆规模下无任何论文证据
 *   - 独立复现（SubtleMemory）显示结构化记忆 70% vs 原文直灌 85.4%
 *   - 业界只有 Graphiti 做真社区，且是内部结构、不可编辑、重建会删旧社区
 *   - 可编辑的主题**几乎都是人定的容器**（Memobase slots / Letta blocks / Cognee NodeSets）
 *
 * 所以这里是「受控词表 + 人工维护 + LLM 只建议不落库」。
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { cosine, tokenize } from "./memory.js";
import { resolveDataFile } from "./util.js";
/* ------------------------------------------------------------------ */
/* 类型                                                                 */
/* ------------------------------------------------------------------ */
/** 未归类的虚拟主题：不落库，任何没有 topicIds 的记忆/准则都归到它。 */
export const INBOX_TOPIC = 't_inbox';
export const INBOX_NAME = '未归类';
/* ------------------------------------------------------------------ */
/* 常量                                                                 */
/* ------------------------------------------------------------------ */
const MAX_SNAPSHOTS = 5;
const NAME_MAX = 20;
const DESC_MAX = 80;
/* ------------------------------------------------------------------ */
/* 主体                                                                 */
/* ------------------------------------------------------------------ */
export class TopicStore {
    filePath;
    snapshotDir;
    clock;
    maxTopics;
    data = { version: 1, revision: 0, updatedAt: 0, topics: [] };
    seq = 0;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined
            ? resolveDataFile('cognition-topics.json')
            : resolve(options.filePath);
        this.snapshotDir = join(dirname(this.filePath), '.snapshots', 'topics');
        this.clock = options.now ?? (() => Date.now());
        this.maxTopics = Math.max(1, options.maxTopics ?? 50);
    }
    get path() {
        return this.filePath;
    }
    /* ------------------------------ 读写 ------------------------------ */
    loadSync() {
        try {
            this.restore(JSON.parse(readFileSync(this.filePath, 'utf8')));
            return true;
        }
        catch {
            this.data = { version: 1, revision: 0, updatedAt: 0, topics: [] };
            return false;
        }
    }
    async load() {
        try {
            this.restore(JSON.parse(await readFile(this.filePath, 'utf8')));
            return true;
        }
        catch {
            this.data = { version: 1, revision: 0, updatedAt: 0, topics: [] };
            return false;
        }
    }
    restore(file) {
        const list = Array.isArray(file.topics) ? file.topics : [];
        this.data = {
            version: 1,
            revision: Number(file.revision ?? 0),
            updatedAt: Number(file.updatedAt ?? 0),
            topics: list
                .filter((topic) => typeof topic?.name === 'string' && topic.name.trim().length > 0)
                .map((topic) => ({
                id: String(topic.id ?? ''),
                name: String(topic.name).trim().slice(0, NAME_MAX),
                description: typeof topic.description === 'string' ? topic.description.slice(0, DESC_MAX) : '',
                aliases: Array.isArray(topic.aliases) ? topic.aliases.map(String).filter((a) => a.length > 0) : [],
                parentId: topic.parentId === null || topic.parentId === undefined ? null : String(topic.parentId),
                status: topic.status === 'archived' ? 'archived' : 'active',
                createdBy: topic.createdBy === 'llm' ? 'llm' : 'user',
                createdAt: Number(topic.createdAt ?? 0),
                updatedAt: Number(topic.updatedAt ?? 0),
            })),
        };
        this.seq = this.data.topics.reduce((max, topic) => {
            const match = /^t_(\d+)$/.exec(topic.id);
            return match === null ? max : Math.max(max, Number(match[1]));
        }, 0);
    }
    async flush() {
        await this.snapshot();
        this.data.revision += 1;
        this.data.updatedAt = this.clock();
        const payload = `${JSON.stringify(this.data, null, 2)}\n`;
        const temp = `${this.filePath}.tmp`;
        try {
            await mkdir(dirname(this.filePath), { recursive: true });
            await writeFile(temp, payload, 'utf8');
            await rename(temp, this.filePath);
        }
        catch {
            // 写盘失败不能变成未捕获拒绝
        }
    }
    async snapshot() {
        try {
            await stat(this.filePath);
        }
        catch {
            return;
        }
        try {
            await mkdir(this.snapshotDir, { recursive: true });
            const { copyFile } = await import('node:fs/promises');
            await copyFile(this.filePath, join(this.snapshotDir, `${basename(this.filePath)}.${Date.now()}.json`));
            const names = (await readdir(this.snapshotDir)).filter((item) => item.endsWith('.json')).sort();
            for (const old of names.slice(0, Math.max(0, names.length - MAX_SNAPSHOTS))) {
                await rm(join(this.snapshotDir, old), { force: true }).catch(() => undefined);
            }
        }
        catch {
            // 快照失败不影响写入
        }
    }
    /* ------------------------------ 查询 ------------------------------ */
    all() {
        return this.data.topics.map((topic) => ({ ...topic }));
    }
    active() {
        return this.data.topics.filter((topic) => topic.status === 'active').map((topic) => ({ ...topic }));
    }
    get(id) {
        const topic = this.data.topics.find((item) => item.id === id);
        return topic === undefined ? undefined : { ...topic };
    }
    stats() {
        const roots = this.data.topics.filter((topic) => topic.parentId === null).length;
        return {
            total: this.data.topics.length,
            active: this.data.topics.filter((topic) => topic.status === 'active').length,
            archived: this.data.topics.filter((topic) => topic.status === 'archived').length,
            roots,
        };
    }
    /**
     * 按文本找主题。
     *
     * 故意做得很笨：名字/别名**整词命中**优先，其次是描述里的关键词。
     * 不做相似度打分——主题是要人工确认的，匹配只是给候选。
     */
    match(text, limit = 3) {
        const haystack = text.toLowerCase();
        const own = tokenize(haystack);
        const out = [];
        for (const topic of this.active()) {
            if (haystack.includes(topic.name.toLowerCase())) {
                out.push({ topic, score: 3, how: 'name' });
                continue;
            }
            const alias = topic.aliases.find((item) => item.length > 0 && haystack.includes(item.toLowerCase()));
            if (alias !== undefined) {
                out.push({ topic, score: 2, how: 'alias' });
                continue;
            }
            if (topic.description.length > 0) {
                // 描述用字二元组余弦：整词包含太严（「版本发布与回滚」匹配不到「版本回滚」），
                // 0.2 是实测能吃到同义改写的阈值，只当候选分，不自动归类。
                if (cosine(own, tokenize(topic.description)) >= 0.2) {
                    out.push({ topic, score: 1, how: 'description' });
                }
            }
        }
        return out.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    /* ------------------------------ 增删改 ------------------------------ */
    add(input) {
        const name = (input.name ?? '').trim().slice(0, NAME_MAX);
        if (name.length === 0)
            return '主题名不能为空';
        if (this.data.topics.some((topic) => topic.name === name))
            return `主题「${name}」已存在`;
        if (this.data.topics.length >= this.maxTopics)
            return `主题数已达上限 ${this.maxTopics}`;
        if (input.parentId !== undefined && input.parentId !== null) {
            const parent = this.get(input.parentId);
            if (parent === undefined)
                return '父主题不存在';
            if (parent.parentId !== null)
                return '主题最多两层';
        }
        const now = this.clock();
        const topic = {
            id: this.nextId(),
            name,
            description: (input.description ?? '').trim().slice(0, DESC_MAX),
            aliases: (input.aliases ?? []).map((a) => a.trim()).filter((a) => a.length > 0).slice(0, 8),
            parentId: input.parentId ?? null,
            status: 'active',
            createdBy: input.createdBy ?? 'user',
            createdAt: now,
            updatedAt: now,
        };
        this.data.topics.push(topic);
        return { ...topic };
    }
    update(id, patch) {
        const topic = this.data.topics.find((item) => item.id === id);
        if (topic === undefined)
            return false;
        if (patch.name !== undefined) {
            const name = patch.name.trim().slice(0, NAME_MAX);
            if (name.length === 0)
                return false;
            if (this.data.topics.some((item) => item.id !== id && item.name === name))
                return false;
            topic.name = name;
        }
        if (patch.description !== undefined)
            topic.description = patch.description.trim().slice(0, DESC_MAX);
        if (patch.aliases !== undefined) {
            topic.aliases = patch.aliases.map((a) => a.trim()).filter((a) => a.length > 0).slice(0, 8);
        }
        if (patch.parentId !== undefined) {
            if (patch.parentId !== null && this.get(patch.parentId) === undefined)
                return false;
            topic.parentId = patch.parentId;
        }
        if (patch.status !== undefined)
            topic.status = patch.status;
        topic.updatedAt = this.clock();
        return true;
    }
    /**
     * 删除主题。
     *
     * 不物理删除，改为归档：记忆/准则上的 topicIds 可能还引用它，
     * 直接删会让引用悬空。归档后不参与匹配，但历史仍可查。
     */
    archive(id) {
        return this.update(id, { status: 'archived' });
    }
    /** 硬删除：只有在确认没有引用后才用（调用方负责检查）。 */
    remove(id) {
        const index = this.data.topics.findIndex((topic) => topic.id === id);
        if (index < 0)
            return false;
        this.data.topics.splice(index, 1);
        return true;
    }
    nextId() {
        this.seq += 1;
        return `t_${String(this.seq).padStart(3, '0')}`;
    }
}
/** 把 topicIds 规范成去重数组；空值返回 undefined（表示落在未归类）。 */
export function normalizeTopicIds(value) {
    if (!Array.isArray(value))
        return undefined;
    const ids = [...new Set(value.map(String).filter((id) => id.length > 0))];
    return ids.length === 0 ? undefined : ids;
}
