/**
 * src/register.ts — 场合判定（干活 / 闲聊）
 *
 * ## 它解决什么问题
 *
 * 人格里的工作纪律（结论在前、别和稀泥、验证过再说）用在闲聊上，
 * 正好产出「汇报腔」：不念清单了、最近就两件事、别的没了、你想聊啥就说。
 * 这不是人格写错，是**一套语气用在了所有场合**。
 *
 * ## 分三层，全部是纯函数、零依赖、0 token
 *
 * 依据来自 Rasa 的组件设计（见 docs/register-research.md）：
 *
 * 1. **关键词层** —— 对应 Rasa `KeywordIntentClassifier`：明确的话直接定，
 *    置信度 1.0，**不进打分**。明确的和模糊的混在一个分数里算，必然互相污染。
 * 2. **表层特征层** —— 复用 style.ts 的 `analyzeTurn()`（短句率、语气词、第一人称、表情）。
 *    这批特征本来就是文献里判断 chit-chat 用的。
 * 3. **双阈值兜底** —— 对应 Rasa `FallbackClassifier`：除了「最高分不够」，
 *    还要看「前两名挨太近」。分数打平的时候硬选一个，是最容易出错的。
 *
 * ## 一个不能反的默认方向
 *
 * 判错两个方向的代价**不对称**：
 * - 闲聊判成干活 → 说话官腔重（难听，但无害）
 * - 干活判成闲聊 → 该动手时跟你闲扯（**真会把事搞砸**）
 *
 * 所以 **分不清一律按「干活」**。这一条写在 `judgeRegister()` 的兜底里。
 *
 * ## 隐私取舍（同 style.ts）
 *
 * 落盘只存**前 40 字**摘要，不存全量原文。要复现原文只能靠宿主自己的 session 日志。
 *
 * ## 当前阶段：只记录，不改行为
 *
 * 我们没有标注数据，阈值是从 Rasa 抄的（英文意图分类），中文闲聊分布未必一样。
 * 所以这一版**一个字都不改注入内容**，只攒记录。等你标出判错的，再调阈值。
 */
/** 判定结论。 */
export type RegisterVerdict = 'work' | 'chat';
/** 哪一层给出的结论。 */
export type RegisterLayer = 'keyword' | 'score' | 'fallback';
export interface RegisterScores {
    work: number;
    chat: number;
    /** 前两名分差。Rasa 的 ambiguity_threshold 比的就是这个。 */
    gap: number;
}
export interface RegisterDecision {
    verdict: RegisterVerdict;
    /** 0..1。关键词命中是 1；打分层是 max(work, chat)；兜底层表示「其实没定」。 */
    confidence: number;
    layer: RegisterLayer;
    /** 一句话说明为什么，给面板显示用。 */
    reason: string;
    scores: RegisterScores;
    /** 命中的关键词（关键词层才有）。 */
    hits?: string[];
}
/**
 * 明确在派活的词。
 *
 * 刻意收「动作 + 对象」型的具体词，不收「帮我」这类——「帮我倒杯水」不是活。
 */
export declare const WORK_WORDS: readonly string[];
/**
 * 明确在闲聊的词。
 *
 * 只收**状态/情绪/社交**，不收应答词。
 */
export declare const CHAT_WORDS: readonly string[];
/**
 * 应答词白名单：**既不算闲聊，也不算派活**，直接落到下一层。
 *
 * 这是从 `injection_log.ts` 的 `classifyFeedback` 学来的教训——
 * 那里 v1 把「可以/好的/行/嗯」当确认，结果把 appliedGood 洗白。
 * 这里同理：这些词只是「知道了」，不是场合信号。
 */
export declare const ACK_WORDS: readonly string[];
/** 这条 user 消息是不是运行时注入的上下文（应当跳过）。 */
export declare function isRuntimeContext(text: string): boolean;
/**
 * 打分。两个分数都在 0..1，**不做归一化**——归一化会让「两边都很弱」变成
 * 「一边很强」，正好把该兜底的情况伪装成确定。
 *
 * ## 为什么不用 shortRatio
 *
 * 中文派活经常是「这个函数报错，帮我改成 async，顺便加个测试」——
 * 逗号切开全是短句，shortRatio = 1，于是被判成闲聊。这是**句法噪声**，不是信号。
 * 改用**整条消息的总长度**判断「短」：闲聊短是整体短，不是分句短。
 */
export declare function scoreRegister(text: string): RegisterScores;
/** 最高分低于它就认为「判不了」。 */
export declare const THRESHOLD = 0.3;
/** 前两名分差小于它就认为「分不清」。 */
export declare const AMBIGUITY_THRESHOLD = 0.1;
/**
 * 综合判定。
 *
 * 顺序很重要：关键词 → 打分 → 双阈值 → 兜底「干活」。
 */
export declare function judgeRegister(text: string): RegisterDecision;
export declare const REGISTER_LOG_VERSION: 1;
/** 摘要长度上限：不存全量原文。 */
export declare const EXCERPT_CHARS = 40;
export interface RegisterRow {
    v: typeof REGISTER_LOG_VERSION;
    at: number;
    sessionId: string;
    turn: number;
    /** 用户原文前 40 字（隐私取舍：不存全量）。 */
    excerpt: string;
    verdict: RegisterVerdict;
    confidence: number;
    layer: RegisterLayer;
    reason: string;
    scores: RegisterScores;
    hits?: string[];
    /** 用户后来标注：判错了 / 判对了。当前版本只存不给值。 */
    label?: 'wrong' | 'right';
}
export interface RegisterOverview {
    total: number;
    work: number;
    chat: number;
    /** 走兜底（判不了 / 分不清）的比例——这个数字高说明阈值或特征不够。 */
    uncertain: number;
    byLayer: Record<RegisterLayer, number>;
    labelled: number;
    wrong: number;
}
export interface RegisterLogOptions {
    filePath?: string;
    now?: () => number;
    keepRecent?: number;
}
export declare class RegisterLog {
    private readonly filePath;
    private readonly clock;
    private readonly keepRecent;
    private rows;
    private loaded;
    private skipped;
    constructor(options?: RegisterLogOptions);
    get path(): string;
    loadSync(): boolean;
    /** 记一轮。判定在调用方做，这里只管落盘。 */
    record(input: {
        sessionId: string;
        turn: number;
        text: string;
        decision: RegisterDecision;
    }): RegisterRow;
    /**
     * 标注某一轮判错了 / 判对了。
     *
     * append-only：追加一条**同 sessionId+turn 的新行**，读取时以后出现的为准。
     * 这样原始判定记录不被改写，事后能算出「当时判成什么、你后来改成什么」。
     */
    label(sessionId: string, turn: number, label: 'wrong' | 'right'): boolean;
    recent(limit?: number): RegisterRow[];
    /** 合并 label 后的最终判定（同一 sessionId+turn 以最后一行为准）。 */
    effective(limit?: number): RegisterRow[];
    overview(): RegisterOverview;
}
