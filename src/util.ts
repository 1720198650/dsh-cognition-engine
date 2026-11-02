import { dirname, join } from 'node:path';
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
export function resolveInPackage(name: string): string {
  return join(packageRoot, name);
}
/**
 * src/util.ts — 无状态的纯工具函数
 *
 * 从 index.ts 抽出来的原因：这些函数不碰任何插件状态，
 * 放在入口文件里会把「接线」和「参数处理」混在一起。
 */

/** 把任意入参收敛成普通对象。 */
export function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
}

/** 取必填字符串，空串或缺失直接抛错。 */
export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value;
}

/** 取可选字符串，空串按缺失处理。 */
export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** 统一把 unknown 异常转成一行文本。 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { buildCard } from './cards.ts';

/** 工具返回统一走纯文本；同时带上 dshGo 原生卡片（构造失败自动退回普通结果）。 */
export const textOutput = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ],
  presentationMeta: (_args: unknown, value: unknown): Record<string, unknown> => buildCard(value),
};

/**
 * 注册期自检：`parameters` 必须是以 `type: 'object'` 为根的 JSON Schema。
 *
 * 宿主会把 parameters 原样透传给模型 API，不校验根形状；一旦写成裸属性表，
 * 每个请求都会被判为 `got 'type: null'` 而整轮失败，且报错不指向具体插件。
 * 这里提前抛错，把故障限制在插件加载阶段。
 */
export function assertObjectSchema(name: string, parameters: unknown): void {
  if (parameters === undefined) return;
  const root = parameters as { type?: unknown; properties?: unknown };
  if (root.type !== 'object' || typeof root.properties !== 'object' || root.properties === null) {
    throw new Error(
      `cognition-engine: 工具 ${name} 的 parameters 必须是 { type: 'object', properties: {...}, required: [...] }，裸属性表会被模型 API 拒绝`,
    );
  }
}

/** 只取调用方真正给的字段，避免一长串 `...(x === undefined ? {} : { x })`。 */
export function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 把用户/模型给的时间表达解析成毫秒时间戳。
 *
 * 支持毫秒数、ISO 日期时间，以及「3天前 / 昨天 / 2小时前 / 上周 / 2026-11-01」这类人话。
 * 解析不出来返回 undefined，交给调用方用默认值，避免静默算错。
 */
export function parseMoment(value: unknown, now: number = Date.now()): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  const text = String(value).trim();
  if (text.length === 0) return undefined;

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
    const unitMs =
      unit === '分钟' ? MINUTE
      : unit === '小时' ? HOUR
      : unit === '天' ? DAY
      : unit === '周' || unit === '星期' ? WEEK
      : unit === '个月' ? 30 * DAY
      : 365 * DAY;
    return now + sign * amount * unitMs;
  }

  // 口语词
  if (text === '现在' || text === '此刻' || text === '当前') return now;
  if (text === '昨天') return now - DAY;
  if (text === '前天') return now - 2 * DAY;
  if (text === '上周') return now - WEEK;
  if (text === '上个月') return now - 30 * DAY;
  if (text === '去年') return now - 365 * DAY;

  // 绝对日期 / 日期时间
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return parsed;

  return undefined;
}
