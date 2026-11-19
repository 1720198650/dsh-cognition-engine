/**
 * src/autorevise.ts — 自动修订的"安全内核"：先存档、再改、必标注、可回滚。
 *
 * 用户 2026-11-18 授权自动修订，但附了三条硬条件：
 *   ① 面板有开关；② 修改要标注；③ **修改前要有存档**。
 * 这个文件只管 ②③（①在 settings 里），而且刻意做成三件事分离：
 *
 *   1. 门槛（shouldAutoRevise）：纯函数，不碰数据。宁可少改，不可乱改。
 *   2. 存档（RevisionLog）：append-only JSONL，先写存档再改数据；改失败也要留痕。
 *   3. 标注（AUTO_MARK）：写进内容里，而不是只在渲染时加前缀——
 *      渲染前缀会丢（换个界面就没了），写进内容才跟数据一起走。
 *
 * 为什么"先存档再改"：自动修订是唯一一种会让插件自己改自己判断的机制，
 * 出错时用户需要的是"能回到改之前"，而不是"看日志猜之前是什么"。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** 渲染层用：给自动修订过的条目加个可见标记（不进数据）。 */
export function revisionBadge(meta) {
    if (meta === undefined)
        return '';
    if (meta.origin === 'auto_revise')
        return '[自动修订] ';
    return '';
}
/** 每天自动修订上限——**经验值，未标定**（audit-evidence.md 判为无来源）。 */
export const MAX_REVISIONS_PER_DAY = 5;
/** 冷却小时数——**经验值，未标定**。 */
export const COOLDOWN_HOURS = 24;
/**
 * 自动修订门槛（依据 docs/l3-autorevise.md）。
 *
 * 最重要的一条不是阈值，而是**触发只能来自外部信号**：
 * Huang et al. 2024 实测，没有外部反馈的自我修订轮数越多越差
 * （GPT-3.5 GSM8K 75.9→74.7，Llama-2 CommonSenseQA 62.0→36.5）。
 * 所以这里没有"自查"这条路：没有你的明确纠正，就只提建议、不自改。
 *
 *   1. 你明确纠正过（≥1 次）→ 可以改；
 *   2. 只是"资料说要这样"→ 不改内容，只提候选（本函数直接拒绝）；
 *   3. 24 小时冷却、每天最多 5 次。
 * 阈值强度：第 1 条有实验支持（Huang 2024 外部反馈），第 3 条是工程取值。
 */
export function shouldAutoRevise(input) {
    if (!input.autoReviseEnabled)
        return { allow: false, reason: '自动修订开关是关的' };
    if (!input.userSaidSo) {
        return { allow: false, reason: '没有你的明确纠正：自查和资料不该让我自己改自己（只提建议）' };
    }
    if (input.counterEvidence < 1) {
        return { allow: false, reason: '没有一条可核对的纠正内容' };
    }
    if (input.hoursSinceLastRevision < COOLDOWN_HOURS) {
        return { allow: false, reason: `冷却期内（上次修订 ${input.hoursSinceLastRevision.toFixed(1)} 小时前，至少要 ${COOLDOWN_HOURS} 小时）` };
    }
    if ((input.todayCount ?? 0) >= MAX_REVISIONS_PER_DAY) {
        return { allow: false, reason: `今天已经自动改了 ${input.todayCount} 次，到上限 ${MAX_REVISIONS_PER_DAY} 了` };
    }
    return { allow: true, reason: '你明确纠正过 + 过冷却期 + 未到当天上限' };
}
/** 兼容旧调用：不再往内容里写前缀，原样返回（标注改在数据字段与渲染层）。 */
export function markAuto(content) {
    return content.trim();
}
/** 兼容旧调用：内容里没有前缀了，去掉历史前缀即可。 */
export function unmarkAuto(content) {
    return content.replace(/^\[自动修订\]\s*/, '').trim();
}
/** append-only 修订存档。 */
export class RevisionLog {
    filePath;
    clock;
    cache;
    constructor(options) {
        this.filePath = options.filePath;
        this.clock = options.now ?? (() => Date.now());
    }
    load() {
        if (this.cache !== undefined)
            return this.cache;
        this.cache = [];
        if (!existsSync(this.filePath))
            return this.cache;
        for (const line of readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            try {
                this.cache.push(JSON.parse(trimmed));
            }
            catch {
                continue; // 坏行只跳过这一行，别把后面全丢了
            }
        }
        return this.cache;
    }
    /**
     * 先存档。返回存档记录；调用方拿到它之后才去改数据。
     *
     * 注意顺序：**存档写盘成功才返回**，写不进去就抛错让调用方放弃修订——
     * 宁可这次不改，也不能出现"改了但没存档"。
     */
    backup(input) {
        const records = this.load();
        const record = {
            id: `rev-${records.length + 1}`,
            at: this.clock(),
            target: input.target,
            targetId: input.targetId,
            before: input.before,
            after: input.after,
            reason: input.reason,
            diagnosis: input.diagnosis,
            by: input.by,
        };
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
        records.push(record);
        return record;
    }
    list(limit = 30) {
        return [...this.load()].reverse().slice(0, Math.max(1, limit));
    }
    /** 某个目标上次被改是什么时候（算冷却期用）。 */
    lastAt(targetId) {
        let latest;
        for (const record of this.load()) {
            if (record.targetId !== targetId)
                continue;
            if (latest === undefined || record.at > latest)
                latest = record.at;
        }
        return latest;
    }
    markUndone(id) {
        // JSONL 只追加：回滚标记写成新记录（type 里带 undone），不改老行
        const records = this.load();
        const target = records.find((record) => record.id === id);
        if (target === undefined)
            throw new Error('没有这条修订记录：' + id);
        const marker = { ...target, id: `${id}-undo`, at: this.clock(), undone: true, by: 'user' };
        mkdirSync(dirname(this.filePath), { recursive: true });
        appendFileSync(this.filePath, `${JSON.stringify(marker)}\n`, 'utf8');
        records.push(marker);
    }
}
