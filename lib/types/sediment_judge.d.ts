/**
 * src/sediment_judge.ts — 语义判定层（M1）
 *
 * 为什么单独一个文件：判定是**语义**问题，状态转移是**确定性**问题，
 * 两者混在一起就没法分别测。这里只做三件纯函数的事：
 *   1. 拼判定提示词（只给两段原文 + 主题 + 理由，不给结论）
 *   2. 解析模型返回（严格 JSON，容错抽第一个花括号块）
 *   3. 校验（类别合法、置信度夹到 0..1、证据截断）
 *
 * 依据：docs/m0-findings.md —— 真实语料上规则召回 0/3，语义判定必须交给模型；
 * 但模型判定必须**冻结进事件**（重放不重算），否则哈希链会断。
 */
import type { SedimentClass, SedimentJudge } from './sediment.ts';
export declare const SEDIMENT_CLASSES: readonly SedimentClass[];
export interface JudgePromptInput {
    subject: string;
    oldText: string;
    newText: string;
    reason?: string;
}
/**
 * 判定提示词。
 *
 * 刻意要求「引用原文片段」：没有证据的判定无法复核，
 * 而复核是这套东西唯一的价值所在。
 */
export declare function buildJudgePrompt(input: JudgePromptInput): string;
/**
 * 解析模型返回。**容错但严格**：
 * - 允许外面包代码块或多余文字，只抽第一个 {...} 块
 * - 类别不合法 / 置信度不是数 → 返回 null（调用方按 fail-closed 处理）
 * - 证据缺失 → 用原文兜底并降置信（证据不全的判定不该有高置信）
 */
export declare function parseJudgeResponse(raw: string, model: string, fallback: JudgePromptInput): SedimentJudge | null;
