/**
 * src/events.ts — 准则事件日志（轻量事件溯源）
 *
 * 定位：**只追加事件，不改主存储**。
 *
 * 为什么不做完整事件溯源：Microsoft Azure 架构中心明确警告——
 * 「Event sourcing is a complex pattern... costly to migrate to or from...
 *  For most systems and most parts of the traditional data management is sufficient.」
 * 我们的准则是「低频、高价值、需要审计」的典型场景，适合事件溯源；
 * 但整个插件还在早期，全盘改造风险太高。
 *
 * 所以：cognition-playbook.json 仍是主存储，事件流是「带意图的完整日志」。
 * 将来真要时间旅行，事件已经在了，只差把 JSON 改成纯派生态。
 *
 * 六条设计规则（来自 Azure 文档的六个坑）：
 *   1. 捕获意图而非状态：RuleRetired{reason} 而不是 StatusChanged{to}
 *   2. 不可变：改内容用 RuleUpdated 带 before/after，不原地改
 *   3. 版本演进：每条带 v，将来用 upcasting
 *   4. 排序：seq 单调递增 + at 时间戳双保险
 *   5. 幂等：消费端记 lastSeq，重复跳过
 *   6. 个人数据外置：事件只存 ruleId + 摘要，不存记忆原文
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDataFile } from "./util.js";
/**
 * 准则事件日志。
 *
 * 追加写（appendFileSync），读时一次性加载——几百条事件只有几十 KB。
 * 不做快照：事件还少，重放一秒钟能跑几千次。
 */
export class PlaybookEventLog {
    filePath;
    clock;
    events = [];
    loaded = false;
    nextSeq = 1;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-playbook-events.jsonl') : resolve(options.filePath);
        this.clock = options.now ?? (() => Date.now());
    }
    /** 从磁盘加载（文件不存在是正常的）。 */
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        try {
            if (!existsSync(this.filePath))
                return false;
            const text = readFileSync(this.filePath, 'utf8');
            const rows = [];
            for (const line of text.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed.length === 0)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    // 幂等：重复 seq 只保留第一条
                    if (typeof parsed.seq === 'number' && parsed.seq > 0)
                        rows.push(parsed);
                }
                catch {
                    // 单行坏了跳过，不影响其余
                }
            }
            // 按 seq 排序（幂等），去重
            const seen = new Set();
            this.events = rows
                .sort((a, b) => a.seq - b.seq)
                .filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)));
            this.nextSeq = this.events.length === 0 ? 1 : this.events[this.events.length - 1].seq + 1;
            return true;
        }
        catch {
            return false;
        }
    }
    /** 追加一条事件。返回带 seq 的完整事件。 */
    append(input) {
        this.loadSync();
        const event = { ...input, seq: this.nextSeq, v: 1, at: this.clock() };
        this.nextSeq += 1;
        this.events.push(event);
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8');
        }
        catch {
            // 落盘失败不影响内存
        }
        return event;
    }
    /** 全部事件（按 seq 升序）。 */
    all() {
        this.loadSync();
        return this.events;
    }
    /** 某个准则的全部事件。 */
    forRule(ruleId) {
        this.loadSync();
        return this.events.filter((e) => 'ruleId' in e && e.ruleId === ruleId);
    }
    /** 某个时间点之前的事件。 */
    upTo(at) {
        this.loadSync();
        return this.events.filter((e) => e.at <= at);
    }
    /** 统计。 */
    stats() {
        this.loadSync();
        const byType = {};
        for (const e of this.events)
            byType[e.type] = (byType[e.type] ?? 0) + 1;
        return { total: this.events.length, byType };
    }
    /** 文件的绝对路径，供调试用。 */
    get path() {
        return this.filePath;
    }
}
