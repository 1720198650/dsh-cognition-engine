/**
 * src/assumptions.ts — 「假设台账」：抓住模型自己下的、用户还没确认的假设
 *
 * ## 为什么需要
 *
 * 依据：arXiv:2505.06120《LLMs Get Lost In Multi-Turn Conversation》——
 * 多轮比单轮平均掉 **39%**，掉的主要不是能力而是**可靠性**；
 * 机制是「模型早轮就自作假设并急于给最终解，然后过度依赖那个解；一旦走错就不回头」。
 *
 * 我们能做的最便宜的一件事：把模型自己下的假设**显式列出来**，下一轮摆在它面前，
 * 让它确认或撤回；用户说「不对」时直接清空。这不是让模型更聪明，是让它别在错的假设上越走越远。
 *
 * ## 边界
 *
 * - 纯内存、按会话隔离，不落盘（会话结束即消失，不会变成"记忆"污染长期存储）。
 * - 只记录**有歧义信号**的句子（"按…理解"/"我默认"/"应该是…"），不记录正常陈述。
 * - 最多 3 条，每条 80 字，避免自己变成新的上下文膨胀源。
 */
export interface Assumption {
    id: string;
    text: string;
    at: number;
}
/**
 * 从一段助手输出里抽「假设句」。纯函数，便于测试。
 *
 * 返回去重后的片段（同一条假设在多段输出里重复出现只留一次）。
 */
export declare function extractAssumptions(text: string): string[];
/** 按会话维护假设列表。纯内存。 */
export declare class AssumptionLedger {
    private readonly bySession;
    private seq;
    /** 从一段助手输出里抽取并登记；返回新增条数。 */
    observe(sessionId: string, assistantText: string, now?: number): number;
    list(sessionId: string): Assumption[];
    count(sessionId: string): number;
    /** 用户明确纠正时调用：把台账清空（那些假设已被否掉）。 */
    clear(sessionId: string): number;
    /** 渲染成注入段；空则返回空串（不占 token）。 */
    render(sessionId: string): string;
}
