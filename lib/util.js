import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * 插件包根目录（lib/ 或 src/ 的上一级）。
 *
 * 默认落盘路径必须基于这里，而不是进程 cwd：
 * 进程 cwd 是 DSH 的工作目录，多个 profile 会互相覆盖，
 * 换一台机器更是直接读到空库。
 */
export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
/** 把相对文件名解析到插件包根目录下。 */
export function resolveInPackage(name) {
    return join(packageRoot, name);
}
/**
 * 数据目录。
 *
 * **用户数据不能放在代码目录里。** 早期默认放在插件包根目录，结果两次发版的
 * 「清理临时产物」步骤把准则本、主题、待办全删了（v0.9.1、v0.10.0 各一次）。
 *
 * 现在默认放 `~/.dsh/cognition-engine/`，与代码彻底分开——
 * 清理仓库再也不可能误伤用户数据。
 *
 * 可用环境变量 `DSH_COGNITION_DATA_DIR` 覆盖。
 */
export function dataDir() {
    const override = process.env.DSH_COGNITION_DATA_DIR;
    if (typeof override === 'string' && override.trim().length > 0)
        return resolve(override);
    return join(homedir(), '.dsh', 'cognition-engine');
}
/** 数据文件的默认路径（在 dataDir 下）。 */
export function resolveDataFile(name) {
    return join(dataDir(), name);
}
/**
 * 展开路径开头的 `~`（用户主目录）。
 *
 * 配置文件里写 `~/...` 很自然，但 `path.resolve()` 不展开它——会解析成
 * `<进程 cwd>/~/...`，于是「换个工作区就读不到旧数据」。用户配置的路径必须先过这道。
 */
export function expandHome(input) {
    if (input === '~')
        return homedir();
    if (input.startsWith('~/') || input.startsWith('~\\'))
        return join(homedir(), input.slice(2));
    return input;
}
/** 把用户配置里的路径收敛成绝对路径：先展开 `~`，相对路径仍按进程 cwd 解析。 */
export function resolveUserPath(input) {
    return resolve(expandHome(input));
}
/** 需要从旧位置（插件包根目录）迁走的文件。 */
const LEGACY_DATA_FILES = [
    'cognition-state.json',
    'cognition-state.json.sha256',
    'cognition-playbook.json',
    'cognition-topics.json',
    'cognition-audit.jsonl',
    'cognition-audit.jsonl.1',
    'tasks.json',
];
/**
 * 一次性迁移：把旧位置的数据搬到 dataDir。
 *
 * 只在目标文件不存在时搬，**绝不覆盖**已有数据。
 * 返回搬了哪些文件，供启动日志用。
 */
export function migrateLegacyData() {
    const moved = [];
    try {
        mkdirSync(dataDir(), { recursive: true });
    }
    catch {
        return moved;
    }
    for (const name of LEGACY_DATA_FILES) {
        const from = join(packageRoot, name);
        const to = join(dataDir(), name);
        try {
            if (!existsSync(from))
                continue;
            // 目标已存在时**不能一律跳过**：上一次失败的迁移可能已经建了个空库，
            // 再跳过就把真实数据永远留在旧位置。只在目标「确实有内容」时才跳过。
            if (existsSync(to) && statSync(to).size > 200)
                continue;
            // 不能用 renameSync：工作区可能在 D 盘、数据目录在 C 盘，跨盘 rename 会抛 EXDEV。
            // 改成复制 + 删源，两个文件都很小，开销可忽略。
            copyFileSync(from, to);
            rmSync(from, { force: true });
            moved.push(name);
        }
        catch {
            // 迁移失败不影响启动
        }
    }
    try {
        const fromSnap = join(packageRoot, '.snapshots');
        const toSnap = join(dataDir(), '.snapshots');
        if (existsSync(fromSnap) && !existsSync(toSnap)) {
            cpSync(fromSnap, toSnap, { recursive: true });
            rmSync(fromSnap, { recursive: true, force: true });
            moved.push('.snapshots');
        }
    }
    catch {
        /* ignore */
    }
    return moved;
}
/**
 * src/util.ts — 无状态的纯工具函数
 *
 * 从 index.ts 抽出来的原因：这些函数不碰任何插件状态，
 * 放在入口文件里会把「接线」和「参数处理」混在一起。
 */
/** 把任意入参收敛成普通对象。 */
export function asRecord(args) {
    return typeof args === 'object' && args !== null ? args : {};
}
/** 取必填字符串，空串或缺失直接抛错。 */
export function requireString(args, key) {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${key} 必须是非空字符串`);
    }
    return value;
}
/** 取可选字符串，空串按缺失处理。 */
export function optionalString(args, key) {
    const value = args[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
/** 统一把 unknown 异常转成一行文本。 */
export function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
import { buildCard } from "./cards.js";
/** 工具返回统一走纯文本；同时带上 dshGo 原生卡片（构造失败自动退回普通结果）。 */
export const textOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
    ],
    presentationMeta: (_args, value) => buildCard(value),
};
/**
 * 注册期自检：`parameters` 必须是以 `type: 'object'` 为根的 JSON Schema。
 *
 * 宿主会把 parameters 原样透传给模型 API，不校验根形状；一旦写成裸属性表，
 * 每个请求都会被判为 `got 'type: null'` 而整轮失败，且报错不指向具体插件。
 * 这里提前抛错，把故障限制在插件加载阶段。
 */
export function assertObjectSchema(name, parameters) {
    if (parameters === undefined)
        return;
    const root = parameters;
    if (root.type !== 'object' || typeof root.properties !== 'object' || root.properties === null) {
        throw new Error(`cognition-engine: 工具 ${name} 的 parameters 必须是 { type: 'object', properties: {...}, required: [...] }，裸属性表会被模型 API 拒绝`);
    }
}
/** 只取调用方真正给的字段，避免一长串 `...(x === undefined ? {} : { x })`。 */
export function pick(source, keys) {
    const out = {};
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
/**
 * 把用户/模型给的时间表达解析成毫秒时间戳。
 *
 * 支持毫秒数、ISO 日期时间，以及「3天前 / 昨天 / 2小时前 / 上周 / 2026-11-01」这类人话。
 * 解析不出来返回 undefined，交给调用方用默认值，避免静默算错。
 */
export function parseMoment(value, now = Date.now()) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    const text = String(value).trim();
    if (text.length === 0)
        return undefined;
    // 纯数字：按毫秒
    if (/^\d{10,}$/.test(text)) {
        const n = Number(text);
        return Number.isFinite(n) ? n : undefined;
    }
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;
    // 相对时间：N 个时间单位前 / 后
    const rel = text.match(/^(\d+)\s*(分钟|小时|天|周|星期|个月|年)\s*(前|后|以前|之前|以后|之后)?$/);
    if (rel !== null) {
        const amount = Number(rel[1]);
        const unit = rel[2] ?? '';
        const direction = rel[3] ?? '前';
        const sign = /后|以后|之后/.test(direction) ? 1 : -1;
        const unitMs = unit === '分钟' ? MINUTE
            : unit === '小时' ? HOUR
                : unit === '天' ? DAY
                    : unit === '周' || unit === '星期' ? WEEK
                        : unit === '个月' ? 30 * DAY
                            : 365 * DAY;
        return now + sign * amount * unitMs;
    }
    // 口语词
    if (text === '现在' || text === '此刻' || text === '当前')
        return now;
    if (text === '昨天')
        return now - DAY;
    if (text === '前天')
        return now - 2 * DAY;
    if (text === '上周')
        return now - WEEK;
    if (text === '上个月')
        return now - 30 * DAY;
    if (text === '去年')
        return now - 365 * DAY;
    // 绝对日期 / 日期时间
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed))
        return parsed;
    return undefined;
}
/**
 * 解析 POST 请求体里的 JSON（空体返回空对象，坏 JSON 也返回空对象，绝不抛）。
 *
 * 用途：长文本不能塞 query string——Node 的请求行上限约 16KB，超了直接回 431，
 * 而且请求根本到不了业务代码，日志里什么都看不到。所以凡是"可能是整篇文章"的字段，
 * 一律走请求体。
 */
export function readBodyJson(body) {
    const trimmed = body.replace(/^\uFEFF/, '').trim();
    if (trimmed.length === 0)
        return {};
    try {
        const parsed = JSON.parse(trimmed);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
/** 从请求体对象里取字符串字段；没有或类型不对就返回 undefined。 */
export function bodyString(body, key) {
    const value = body[key];
    return typeof value === 'string' ? value : undefined;
}
/**
 * 把文件字节解成文本，自动判编码。
 *
 * 为什么必须判：Excel「另存为 CSV」和统计局导出的表**默认是 GBK**，
 * 直接按 UTF-8 解就是一屏乱码（2026-11-18 用户导入 1.csv，块里全是 `������`）。
 * 顺序：BOM（UTF-16/UTF-8）→ UTF-8 严格解码 → GBK 兜底。
 */
export function decodeTextBuffer(buf) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
    }
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
    }
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return { text: text.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
    }
    catch {
        try {
            return { text: new TextDecoder('gbk').decode(buf), encoding: 'gbk' };
        }
        catch {
            // 宿主没带 GBK 解码器时只能有损解，至少不抛错
            return { text: buf.toString('utf8'), encoding: 'utf-8-lossy' };
        }
    }
}
