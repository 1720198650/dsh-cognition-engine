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
