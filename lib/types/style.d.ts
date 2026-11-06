/**
 * src/style.ts — 风格指纹 + 语域分桶（S4）
 *
 * 定位：**纯代码，0 token，每天可跑**。
 *
 * ## 一个关键取舍：不存原文，只存派生指标
 *
 * 风格审计需要「模型到底怎么说话」的样本。最直接的做法是把每轮回复原文落盘，
 * 但那是把用户的对话内容写到磁盘上——收益是审计更细，代价是隐私面变大。
 *
 * 这里选保守路线：**原文只在内存里过一遍，落盘的只有统计量**
 * （平均句长、语气词频率、标点密度……）。事后能回答「风格变没变」，
 * 但翻不出「当时说了什么」。真要复现原文，只能靠 session 日志（那是宿主自己的存储）。
 *
 * ## 研究口径
 *
 * 核心 8 项来自 docs/persona-format-and-style-metrics.md。
 * 语域分桶（technical / emotional / casual）来自 Halliday / Biber 的教训：
 * **同一个人在不同语域说话不同，跨桶比较必然误报**。
 * 相似度用有界加权距离而不是裸欧氏距离——语气词 200 vs 0 这种量级差
 * 会在欧氏距离里淹没其他所有维度。
 */
/** 记录格式版本。 */
export declare const STYLE_LOG_VERSION: 2;
/** 语域桶。 */
export type StyleBucket = 'technical' | 'emotional' | 'casual';
/** 一轮回复的统计量（**不含原文**）。 */
export interface TurnStyleMetrics {
    /** 非空白字符数。 */
    chars: number;
    meanSentLen: number;
    sentLenCv: number;
    shortRatio: number;
    tonePerK: number;
    firstPersonPerK: number;
    punctPer100: number;
    emojiPerK: number;
    catchphrasePerK: number;
}
/** 一行记录。 */
export interface StyleRow extends TurnStyleMetrics {
    v: typeof STYLE_LOG_VERSION;
    at: number;
    sessionId: string;
    turn: number;
    bucket: StyleBucket;
}
/** 每个桶的中位指纹。 */
export type StyleFingerprint = {
    [K in keyof TurnStyleMetrics]: number;
};
/** 指标名（顺序固定，便于对比与展示）。 */
export declare const STYLE_METRICS: Array<keyof TurnStyleMetrics>;
/** 按句切分（中英文句末标点 + 换行）。 */
export declare function splitSentences(text: string): string[];
/**
 * 算一轮回复的统计量。纯函数，不碰磁盘。
 *
 * `catchphrases` 是用户自定的口癖列表（3–5 个），空数组时该项恒为 0——
 * 恒为 0 的某项在相似度里权重会自动失效（差值恒 0），不会拖累判断。
 */
export declare function analyzeTurn(text: string, catchphrases?: readonly string[]): TurnStyleMetrics;
/**
 * 判语域桶。
 *
 * 顺序：技术 > 情绪 > 其余。技术优先是因为代码/路径信号最硬，
 * 一句「这个报错很难受，`ENOENT`」应算技术而不是情绪。
 */
export declare function classifyBucket(text: string, metrics?: TurnStyleMetrics): StyleBucket;
/** 一组行的中位指纹。 */
export declare function fingerprintOf(rows: readonly StyleRow[]): StyleFingerprint;
/**
 * 有界加权距离 → 相似度。
 *
 * `d = Σ w_i · min(1, |a_i − b_i| / (scale_i × 3)) / Σ w_i`
 * `similarity = 1 − d`
 *
 * 每项最多贡献 1，所以任何单一维度的爆炸（比如语气词从 0 变 200）都只能拉低有限幅度，
 * 不会像裸欧氏距离那样把结论完全带偏。
 */
export declare function styleSimilarity(a: StyleFingerprint, b: StyleFingerprint): number;
/** 差异最大的 N 个维度（排查用）。 */
export declare function topDiffs(a: StyleFingerprint, b: StyleFingerprint, limit?: number): Array<{
    metric: keyof TurnStyleMetrics;
    from: number;
    to: number;
    normalized: number;
}>;
/** 相似度 → 状态（阈值来自 docs/upgrade-plan-v3.md §5.5）。 */
export declare function statusOf(similarity: number): 'green' | 'yellow' | 'orange' | 'red';
export interface StyleStoreOptions {
    filePath?: string;
    baselinePath?: string;
    now?: () => number;
    /** 内存/文件保留多少行（默认 5000，约几千轮）。 */
    keep?: number;
    /** 样本下限：少于这么多轮算 insufficient。 */
    minTurns?: number;
    /** 样本下限：少于这么多字符算 insufficient。 */
    minChars?: number;
}
export interface StyleComparison {
    status: 'insufficient' | 'green' | 'yellow' | 'orange' | 'red';
    bucket: StyleBucket | 'all';
    similarity: number | null;
    baseline: {
        source: 'frozen' | 'auto-split' | 'none';
        turns: number;
        chars: number;
    } | null;
    current: {
        turns: number;
        chars: number;
    } | null;
    topDiffs: Array<{
        metric: keyof TurnStyleMetrics;
        from: number;
        to: number;
        normalized: number;
    }>;
    note: string;
}
/**
 * 风格指纹存储。
 *
 * 落盘的是**每轮统计量**（一行 JSONL），**不含原文**。
 * 想回看当时说了什么，只能去 session 日志——那是宿主的存储，不是这里的。
 */
export declare class StyleStore {
    private readonly filePath;
    private readonly baselinePath;
    private readonly clock;
    private readonly keep;
    private readonly minTurns;
    private readonly minChars;
    private rows;
    private frozen;
    private loaded;
    private saveError;
    constructor(options?: StyleStoreOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    /** 记录一轮（只存统计量）。 */
    record(input: {
        sessionId: string;
        turn: number;
        text: string;
        catchphrases?: readonly string[];
    }): StyleRow;
    /** 样本概况。 */
    sampleSummary(): {
        turns: number;
        chars: number;
        buckets: Record<StyleBucket, number>;
        minTurns: number;
        minChars: number;
        confidence: number;
        sufficient: boolean;
    };
    /**
     * 把当前窗口冻结成基线。
     *
     * 为什么要冻结：自动切分（前半当基线、后半当当前）在样本漂移时会把漂移吃进基线，
     * 越漂越像。冻结基线才是「和当初比」。
     */
    freezeBaseline(): {
        ok: boolean;
        sample: ReturnType<StyleStore['sampleSummary']>;
    };
    /**
     * 当前窗口 vs 基线。
     *
     * 桶内比较：技术回答和闲聊分开算，跨桶报警是纯噪声（Biber 的老坑）。
     * 样本不足一律 `insufficient`，不给一个看起来很像的假分数。
     */
    compare(options?: {
        bucket?: StyleBucket | 'all';
        recentTurns?: number;
    }): StyleComparison;
    /** 最近 N 行的趋势（每 10 轮一个点，供页面画小图）。 */
    trend(points?: number, bucketSize?: number): Array<{
        at: number;
        turns: number;
        chars: number;
        meanSentLen: number;
        tonePerK: number;
    }>;
}
