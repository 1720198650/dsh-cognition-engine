/**
 * src/util.ts — 无状态的纯工具函数
 *
 * 从 index.ts 抽出来的原因：这些函数不碰任何插件状态，
 * 放在入口文件里会把「接线」和「参数处理」混在一起。
 */
/** 把任意入参收敛成普通对象。 */
export declare function asRecord(args: unknown): Record<string, unknown>;
/** 取必填字符串，空串或缺失直接抛错。 */
export declare function requireString(args: Record<string, unknown>, key: string): string;
/** 取可选字符串，空串按缺失处理。 */
export declare function optionalString(args: Record<string, unknown>, key: string): string | undefined;
/** 统一把 unknown 异常转成一行文本。 */
export declare function messageOf(error: unknown): string;
/** 工具返回统一走纯文本；同时带上 dshGo 原生卡片（构造失败自动退回普通结果）。 */
export declare const textOutput: {
    schema: {
        type: "string";
    };
    render: (_args: unknown, value: unknown) => Array<{
        type: "text";
        text: string;
    }>;
    presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
};
/**
 * 注册期自检：`parameters` 必须是以 `type: 'object'` 为根的 JSON Schema。
 *
 * 宿主会把 parameters 原样透传给模型 API，不校验根形状；一旦写成裸属性表，
 * 每个请求都会被判为 `got 'type: null'` 而整轮失败，且报错不指向具体插件。
 * 这里提前抛错，把故障限制在插件加载阶段。
 */
export declare function assertObjectSchema(name: string, parameters: unknown): void;
/** 只取调用方真正给的字段，避免一长串 `...(x === undefined ? {} : { x })`。 */
export declare function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown>;
