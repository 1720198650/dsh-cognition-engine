/**
 * src/correction.ts — 「你觉得不对」的识别（自动学习链的扳机）。
 *
 * 为什么扳机必须来自用户原话：
 * Huang et al. 2024 实测，没有外部反馈的自我修订越改越差
 * （Llama-2 CommonSenseQA 62.0 → 36.5）。所以这个模块只做一件事：
 * **判断这句话是不是在纠正我**，并且把可核对的原话抓出来当锚。
 *
 * 不做的事：不判断"谁对谁错"（那是反思环节）、不自己触发修订（要过门槛）。
 */
export interface CorrectionSignal {
    /** 是不是在纠正 */
    corrected: boolean;
    /** 可核对的原话片段（当锚用） */
    quote: string;
    /** 倾向：改事实还是改做法 */
    hint: 'fact' | 'rule' | 'unknown';
    /** 命中的是哪种说法（调试用） */
    matched: string;
}
/**
 * 识别纠正信号。
 *
 * 门槛刻意压低（一句话里出现"不对/错了/我说的是"就算），因为：
 * 漏判的代价 = 我继续错；误判的代价 = 多生成一条候选，你点一下丢弃。
 * 但**证据门槛不在这里**——这里只负责发现，改不改由 autorevise 的门槛决定。
 */
export declare function detectCorrection(text: string): CorrectionSignal;
/**
 * 反思提示词：只问两件事——我原来错在哪、以后该按什么做。
 *
 * 不给模型"要不要改"的决定权（那是门槛的事），也不让它自己找新证据
 * （那是联网环节的事），只让它把用户这句话翻译成一条可执行的诊断。
 */
export declare function buildCorrectionPrompt(input: {
    correction: string;
    subject?: string;
}): string;
export interface CorrectionResult {
    wrong: string;
    diagnosis: string;
    rule: string;
}
/** 解析反思输出；解析不出来就返回空 rule，调用方降级为只记候选。 */
export declare function parseCorrectionResult(raw: string): CorrectionResult;
