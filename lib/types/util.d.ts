/**
 * 插件包根目录（lib/ 或 src/ 的上一级）。
 *
 * 默认落盘路径必须基于这里，而不是进程 cwd：
 * 进程 cwd 是 DSH 的工作目录，多个 profile 会互相覆盖，
 * 换一台机器更是直接读到空库。
 */
export declare const packageRoot: string;
/** 把相对文件名解析到插件包根目录下。 */
export declare function resolveInPackage(name: string): string;
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
export declare function dataDir(): string;
/** 数据文件的默认路径（在 dataDir 下）。 */
export declare function resolveDataFile(name: string): string;
/**
 * 一次性迁移：把旧位置的数据搬到 dataDir。
 *
 * 只在目标文件不存在时搬，**绝不覆盖**已有数据。
 * 返回搬了哪些文件，供启动日志用。
 */
export declare function migrateLegacyData(): string[];
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
/**
 * 把用户/模型给的时间表达解析成毫秒时间戳。
 *
 * 支持毫秒数、ISO 日期时间，以及「3天前 / 昨天 / 2小时前 / 上周 / 2026-11-01」这类人话。
 * 解析不出来返回 undefined，交给调用方用默认值，避免静默算错。
 */
export declare function parseMoment(value: unknown, now?: number): number | undefined;
