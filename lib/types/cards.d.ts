/**
 * src/cards.ts — dshGo 原生工具卡
 *
 * dshGo 的 App 里不执行 client.js，只渲染工具结果上的 `presentationMeta`。
 * 视图是纯 JSON 树，只能用固定组件（stack / metric / text）。
 * 构造失败或超限时返回空对象，dshGo 会自动退回普通结果——绝不影响模型。
 */
export interface CardNode {
    type: string;
    [key: string]: unknown;
}
/**
 * 统一入口：按返回值形状挑卡片。
 * 认不出来就返回空对象——dshGo 会退回普通工具结果。
 */
export declare function buildCard(value: unknown): Record<string, unknown>;
