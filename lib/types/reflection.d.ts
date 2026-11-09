/**
 * src/reflection.ts — DialecticalReflectionEngine
 *
 * 三段式辩证反思，Prompt 编排对齐 Hegelion（Hmbown/Hegelion）的
 * `hegelion/core/prompt_dialectic.py` 与 `hegelion/mcp/handlers/dialectic.py`：
 *
 *   THESIS      → 给出初始立场，要求承认不确定性
 *   ANTITHESIS  → 拿到 thesis 后做对抗性批判，按 `CONTRADICTION:` / `EVIDENCE:` 成对输出
 *   SYNTHESIS   → 同时拿到 thesis 与 antithesis，要求「超越两者」，并明确禁止
 *                 「thesis 对」「antithesis 对」「两者都有道理」这三种偷懒答案
 *
 * 三次调用严格串行：后一次调用的入参来自前一次的输出，绝不并发。
 * `callLLM` 由外部注入，测试与离线场景使用 `MockDialecticalLLM`。
 */
export type DialecticalPhase = 'thesis' | 'antithesis' | 'synthesis';
export type CallLLM = (prompt: string, phase: DialecticalPhase) => string | Promise<string>;
export interface Contradiction {
    description: string;
    evidence: string;
}
export interface DialecticalCall {
    phase: DialecticalPhase;
    prompt: string;
    output: string;
    startedAt: number;
    finishedAt: number;
}
export interface DialecticalResult {
    query: string;
    thesis: string;
    antithesis: string;
    contradictions: Contradiction[];
    synthesis: string;
    calls: DialecticalCall[];
    durationMs: number;
    /**
     * 结果的可信度标记。
     *
     * - `synthesized`：反题里至少给出了一条 CONTRADICTION/EVIDENCE 对，合题建立在它上面。
     * - `no-contradiction`：反题**没找到任何具体矛盾**。此时不产出合题，因为
     *   「没找到矛盾」不等于「没有问题」——它也可能只是模型自洽地走过场。
     *
     * 依据：LLM 自评普遍偏正面，"judged itself correct every time" 是已知失效模式
     * （arXiv:2607.28576 里 Reflexion 在小模型上从未触发过一次重试）；
     * 而「检测到矛盾」才能推出「至少一方错」，「没检测到」什么都证明不了
     * （Consistency Is Not Correctness, 2026）。所以这里 fail-closed。
     */
    verdict: 'synthesized' | 'no-contradiction';
    /** 给调用方看的一句话说明（verdict 为 no-contradiction 时必填）。 */
    note?: string;
}
export interface ReflectionOptions {
    now?: () => number;
    /** 传给 synthesis 的批判原文上限，避免 prompt 无限膨胀。 */
    maxAntithesisChars?: number;
    /**
     * 反题没给出任何 CONTRADICTION/EVIDENCE 对时，是否跳过合题（默认 true）。
     *
     * 关掉它 = 允许「零矛盾的批判」也能产出合题，等于把「结构走完」当成「认知发生」，
     * 而证据表明这两件事经常不是一回事。只有明确知道自己要什么时才关。
     */
    failClosedOnNoContradiction?: boolean;
}
export declare function buildThesisPrompt(query: string): string;
export declare function buildAntithesisPrompt(query: string, thesis: string): string;
export declare function buildSynthesisPrompt(query: string, thesis: string, antithesis: string, contradictions?: readonly Contradiction[]): string;
/** 从 antithesis 文本里抽出 `CONTRADICTION:` / `EVIDENCE:` 成对结构。 */
export declare function extractContradictions(text: string): Contradiction[];
/** 给提示词追加 JSON 输出契约。 */
export declare function withJsonContract(prompt: string, phase: DialecticalPhase): string;
/** 去掉 ```json 围栏后尝试解析；失败返回 null。 */
export declare function tryParseJson(text: string): Record<string, unknown> | null;
/** 从 JSON 输出里取某个字符串字段；不是 JSON 就原样返回。 */
export declare function unwrapField(text: string, field: string): string;
/** 解析 antithesis：优先 JSON 的 contradictions 数组，回退到文本格式。 */
/**
 * 从 markdown / 编号列表里抽矛盾条目。
 *
 * 模型经常把批判写成「1. xxx」「- xxx」列表而不是 CONTRADICTION:/EVIDENCE: 对，
 * 只认后者会让 contradictions 恒为空数组——反方阶段等于白跑。
 */
export declare function extractListContradictions(text: string): Contradiction[];
export declare function parseAntithesis(text: string): {
    text: string;
    contradictions: Contradiction[];
};
export declare class DialecticalReflectionEngine {
    private readonly callLLM;
    private readonly clock;
    private readonly maxAntithesisChars;
    /** 零矛盾时是否跳过合题（fail-closed）。 */
    private readonly failClosedOnNoContradiction;
    /** 结果缓存：同样的 query + draft 不重复调用模型。 */
    private readonly cache;
    constructor(callLLM: CallLLM, options?: ReflectionOptions);
    /**
     * 串行执行 thesis → antithesis → synthesis。
     * 任何一次返回空串都会抛错，因为空输出会让下一次调用的入参失去意义。
     */
    reflect(query: string): Promise<DialecticalResult>;
    /**
     * 把「已有的回答」接进反思：草稿直接当 thesis，跳过第一步生成，
     * 只做对抗性批评与合成。省一次调用，也让真正要发出去的内容被审一遍。
     */
    reflectDraft(query: string, draft: string): Promise<DialecticalResult>;
    /**
     * Worker 异步隔离版：每一段都用 setTimeout 让出事件循环，
     * 把三次串行调用排到后台宏任务里跑，调用方（主线程）不会被占住。
     */
    reflectInBackground(query: string): Promise<DialecticalResult>;
    private run;
    /** 三段结果的纯文本报告。 */
    renderTranscript(result: DialecticalResult): string;
    private step;
}
/**
 * 确定性的 Mock 模型：不联网、不随机，但严格按 Hegelion 的输出格式作答，
 * 因此可以用来验证「三次串行 + 上一段输出喂给下一段」这条链路本身。
 */
export declare class MockDialecticalLLM {
    private readonly calls;
    /** 记录调用顺序，测试用来断言串行性。 */
    get callOrder(): readonly DialecticalPhase[];
    reset(): void;
    readonly call: CallLLM;
}
/** 让出一次事件循环：把后续工作排到后台宏任务，主线程先跑。 */
export declare function yieldToEventLoop(): Promise<void>;
export type WorkerJobStatus = 'queued' | 'running' | 'done' | 'error';
export interface WorkerJob {
    id: string;
    query: string;
    status: WorkerJobStatus;
    queuedAt: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
}
/**
 * 串行 Worker：把反思任务排进队列，最多 maxConcurrent 个并行，
 * 每个任务都在后台宏任务里推进，绝不阻塞调用方。
 */
export declare class ReflectionWorker {
    private readonly engine;
    private readonly maxConcurrent;
    private readonly clock;
    private running;
    private readonly waiting;
    private readonly records;
    private seq;
    constructor(engine: DialecticalReflectionEngine, maxConcurrent?: number, now?: () => number);
    /** 排队执行，返回结果 Promise。 */
    submit(query: string): Promise<DialecticalResult>;
    /** 队列与历史任务快照。 */
    jobs(): WorkerJob[];
    get pending(): number;
    private finish;
    private pump;
}
