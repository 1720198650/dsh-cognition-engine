/**
 * src/source_note.ts — 从一条来源里提炼「讲什么 + 几条可复用结论」。
 *
 * 这一步是"放进来自动学"缺的那一层：长文 → 结构化条目。
 * 条目只进资料层（不写记忆事实），因为资料讲的是外部世界，
 * 不是"关于用户为真"的口径。分不清这两者就会记忆洪泛。
 *
 * 提示词与解析都放在这里，便于离线单测（不需要真模型）。
 */
import { type SourceNote } from './source_library.ts';
/**
 * 提炼前的前置校验：太短或压根不是正文的资料，不调模型。
 *
 * 为什么必须拦：2026-11-18 实测，用户把两个**文件路径**粘进收件箱（26/42 字），
 * 模型照样一本正经地提炼出「仅有文件路径不能作为归档依据」这类假结论——
 * 看着像知识，其实是把"资料缺失"包装成了原则。宁可不提炼。
 *
 * 阈值 800 字：同一天那篇 328 字的散文被提炼成 4 条"结论"，全是可以从任何文字里
 * 套出来的空话。短资料不需要结论，只需要能检索到原文。
 */
export declare const MIN_DISTILL_CHARS = 800;
/** 表格够这么多行就值得提炼（不受字数门槛限制）。 */
export declare const TABLE_MIN_ROWS = 20;
export declare function distillSkipReason(text: string): string | null;
export declare function excerptForNote(text: string): {
    text: string;
    truncated: boolean;
    tableRows?: number;
};
export declare function buildSourceNotePrompt(input: {
    title: string;
    text: string;
    topics?: readonly string[];
    maxPoints?: number;
}): {
    prompt: string;
    truncated: boolean;
};
/**
 * 解析模型输出。宽容到"能从一堆废话里抠出 JSON"，但不猜内容：
 * 解析不出来就把原文塞进 error，调用方落成 failed，用户可重试。
 */
export declare function parseSourceNote(raw: string): {
    summary: string;
    points: string[];
    quotes: string[];
    topic?: string;
};
/**
 * 模型不可用时的兜底：从原文里抽前几句当摘要，状态标 failed 让用户知道不是真提炼。
 * 有总比"什么都没有"强——检索块已经可用，摘要只是锦上添花。
 */
export declare function fallbackNote(input: {
    sourceId: string;
    title: string;
    text: string;
    at: number;
    error: string;
}): SourceNote;
