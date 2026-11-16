/**
 * src/wiki.ts — 主题 wiki（P1「附注版」）
 *
 * 定位（见 docs/UPGRADE-PLAN.md P1-wiki）：
 *   - **不参与检索排序**：只在命中某条事实之后，作为附注补充"下次用得上"的信息；
 *   - **不是编年史**：只写 4 节——现行口径 / 该避开 / 完成判定 / 未决问题；
 *   - **体积上限 1.0×**：wiki 总字数不得超过其来源事实字数之和（Anthropic：wiki 比原文还大 = 抽象失败）。
 *
 * 依据：arXiv:2611.05306 附录 A——好的压缩不是"忠实摘要历史"，而是"为下一步执行挑的简报"。
 * 零依赖：只用 node:fs / node:path。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const clip = (text, limit) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
};
/**
 * 生成 wiki 正文。
 *
 * 纯函数：相同输入必得相同输出（时间戳除外），便于测试与重算。
 */
export function buildWiki(input) {
    const live = input.facts.filter((fact) => (fact.supersededBy ?? null) === null);
    const dead = input.facts.filter((fact) => (fact.supersededBy ?? null) !== null);
    const sourceBytes = input.facts.reduce((sum, fact) => sum + fact.content.length, 0);
    const stance = live
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .map((fact) => `- ${clip(fact.content, 160)}（${fact.id}）`);
    const avoid = dead.map((fact) => {
        const liveTarget = input.facts.find((candidate) => candidate.id === fact.supersededBy);
        const target = liveTarget === undefined ? '' : ` → 现为：${clip(liveTarget.content, 80)}`;
        const reason = (fact.supersedeReason ?? '').trim();
        return `- 旧说法：${clip(fact.content, 100)}${target}${reason === '' ? '' : `（原因：${clip(reason, 40)}）`}`;
    });
    const done = (input.tasks ?? [])
        .filter((task) => task.status === 'COMPLETED')
        .map((task) => `- 已完成：${clip(task.description, 80)}${task.evidence === undefined ? '' : `（证据：${clip(task.evidence, 40)}）`}`);
    const open = (input.tasks ?? [])
        .filter((task) => task.status !== 'COMPLETED' && task.status !== 'EXPIRED')
        .map((task) => `- ${clip(task.description, 100)}（${task.status}）`);
    for (const rule of input.rules ?? []) {
        if ((rule.boundaryEnvs ?? []).length === 0)
            continue;
        // 有边界的准则放"完成判定"附近会让语义混乱，这里只借边界信息提示"别越界"
        done.push(`- 相关准则：${clip(rule.content, 80)}（不适用于：${rule.boundaryEnvs.join('、')}）`);
    }
    const render = (sections) => {
        const parts = [`# ${input.topicName}`, ''];
        const push = (title, lines) => {
            if (lines.length === 0)
                return;
            parts.push(`## ${title}`, ...lines, '');
        };
        push('现行口径', sections.stance);
        push('该避开', sections.avoid);
        push('完成判定', sections.done);
        push('未决问题', sections.open);
        if (parts.length === 2)
            parts.push('（这个主题还没有足够材料，先不写。）');
        return parts.join('\n');
    };
    // 上限：1.0× 来源；来源极短（<300 字）时给 300 字地板，否则标题都放不下
    const cap = Math.max(sourceBytes, 300);
    let sections = { stance, avoid, done, open };
    let markdown = render(sections);
    let trimmed = false;
    // 体积上限：1.0× 来源事实。超了就裁「现行口径」的尾部（保留高重要度的），并显式标注被裁。
    while (markdown.length > cap && sections.stance.length > 1) {
        sections = { ...sections, stance: sections.stance.slice(0, -1) };
        markdown = render(sections);
        trimmed = true;
    }
    if (trimmed)
        markdown += `\n\n（wiki 已按 1.0× 上限裁剪，完整内容见原始记忆。）`;
    if (markdown.length > cap && sourceBytes > 0) {
        // 极端情况：连一条都放不下（来源极短）——只留标题与说明
        markdown = `# ${input.topicName}\n\n（来源事实太短，wiki 不生成正文；直接读原始记忆。）`;
        trimmed = true;
    }
    return {
        topicId: input.topicId,
        topicName: input.topicName,
        updatedAt: input.now ?? Date.now(),
        sections,
        markdown,
        bytes: markdown.length,
        sourceBytes,
        trimmed,
    };
}
/** 目录式 wiki 存储：`<dir>/<topicId>.md` + `<topicId>.json`（存结构化分节）。 */
export class WikiStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    file(topicId) {
        return join(this.dir, `${topicId.replace(/[^\w.-]/g, '_')}.md`);
    }
    metaFile(topicId) {
        return join(this.dir, `${topicId.replace(/[^\w.-]/g, '_')}.json`);
    }
    save(page) {
        mkdirSync(this.dir, { recursive: true });
        const target = this.file(page.topicId);
        // 覆盖前留一份 .bak-时间戳：自动更新出错时可回退（不删数据）
        if (existsSync(target)) {
            try {
                writeFileSync(target.replace(/\.md$/, `.bak-${Date.now()}.md`), readFileSync(target, 'utf8'), 'utf8');
                this.pruneBackups(page.topicId);
            }
            catch {
                /* 备份失败不阻断主写入 */
            }
        }
        writeFileSync(target, page.markdown, 'utf8');
        writeFileSync(this.metaFile(page.topicId), JSON.stringify(page, null, 2), 'utf8');
        return page;
    }
    read(topicId) {
        const meta = this.metaFile(topicId);
        if (!existsSync(meta))
            return undefined;
        try {
            return JSON.parse(readFileSync(meta, 'utf8').replace(/^\uFEFF/, ''));
        }
        catch {
            return undefined;
        }
    }
    list() {
        if (!existsSync(this.dir))
            return [];
        return readdirSync(this.dir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => {
            try {
                return JSON.parse(readFileSync(join(this.dir, name), 'utf8').replace(/^\uFEFF/, ''));
            }
            catch {
                return undefined;
            }
        })
            .filter((page) => page !== undefined)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /** 只保留最近 3 份备份，避免目录越堆越大。 */
    pruneBackups(topicId) {
        try {
            const base = topicId.replace(/[^\w.-]/g, '_');
            const files = readdirSync(this.dir)
                .filter((name) => name.startsWith(base + '.bak-') && name.endsWith('.md'))
                .sort();
            while (files.length > 3) {
                const victim = files.shift();
                if (victim !== undefined)
                    unlinkSync(join(this.dir, victim));
            }
        }
        catch {
            /* 清理失败无所谓 */
        }
    }
    /** 供注入用的短摘录：只取前几行，绝不把整页塞进上下文。 */
    excerpt(topicId, limit = 600) {
        const page = this.read(topicId);
        if (page === undefined)
            return '';
        const text = page.markdown;
        if (text.length <= limit)
            return text;
        return `${text.slice(0, limit)}…`;
    }
}
