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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDataFile } from "./util.js";
/** 记录格式版本。 */
export const STYLE_LOG_VERSION = 2;
/** 指标名（顺序固定，便于对比与展示）。 */
export const STYLE_METRICS = [
    'chars',
    'meanSentLen',
    'sentLenCv',
    'shortRatio',
    'tonePerK',
    'firstPersonPerK',
    'punctPer100',
    'emojiPerK',
    'catchphrasePerK',
];
/**
 * 每项指标的「正常跨度」尺度，用于把差值归一化。
 *
 * 取文档里的目标区间宽度，不要用样本自身方差——
 * 样本本身漂了的时候，用样本方差会把漂移算成正常。
 */
const SCALE = {
    chars: 260,
    meanSentLen: 20,
    sentLenCv: 0.4,
    shortRatio: 0.3,
    tonePerK: 30,
    firstPersonPerK: 20,
    punctPer100: 10,
    emojiPerK: 5,
    catchphrasePerK: 20,
};
/** 权重：句长结构最重要，emoji/口癖是风格签名，字符数是粗粒度。 */
const WEIGHT = {
    chars: 1,
    meanSentLen: 2,
    sentLenCv: 1.5,
    shortRatio: 1.5,
    tonePerK: 2,
    firstPersonPerK: 1.5,
    punctPer100: 1,
    emojiPerK: 1,
    catchphrasePerK: 2,
};
const TONE_PARTICLES = ['吧', '呢', '啊', '嘛', '呀', '啦', '哦', '呗', '哈', '嘿', '唉', '哎', '咦', '噢', '喔', '嗯', '哼', '咯', '喽', '呦'];
const FIRST_PERSON = /我们|咱们|咱|我/g;
const PUNCTUATION = /[，。！？；：、,.!?;:]/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
const SENTENCE_END = /[。！？!?；;\n]+/;
const TECHNICAL = /```|`[^`\n]+`|[A-Za-z]:\\|\.(?:js|mjs|cjs|ts|py|ps1|json|md|docx|yml|yaml)\b|\bnode\b|\bnpm\b|--\w+/;
const EMOTIONAL = /难受|开心|焦虑|害怕|累|烦|压力|情绪|委屈|崩溃|担心|紧张|生气|哭|笑死/;
/** 按句切分（中英文句末标点 + 换行）。 */
export function splitSentences(text) {
    return text
        .split(SENTENCE_END)
        .map((s) => s.trim())
        .filter((s) => s.replace(/\s/g, '').length > 0);
}
function countMatches(text, re) {
    const matches = text.match(re);
    return matches === null ? 0 : matches.length;
}
/**
 * 算一轮回复的统计量。纯函数，不碰磁盘。
 *
 * `catchphrases` 是用户自定的口癖列表（3–5 个），空数组时该项恒为 0——
 * 恒为 0 的某项在相似度里权重会自动失效（差值恒 0），不会拖累判断。
 */
export function analyzeTurn(text, catchphrases = []) {
    const normalized = text.replace(/\r\n/g, '\n');
    const chars = normalized.replace(/\s/g, '').length;
    const sentences = splitSentences(normalized);
    const lengths = sentences.map((s) => s.replace(/\s/g, '').length);
    const sentenceCount = lengths.length;
    const meanSentLen = sentenceCount === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / sentenceCount;
    const variance = sentenceCount <= 1
        ? 0
        : lengths.reduce((acc, len) => acc + (len - meanSentLen) ** 2, 0) / sentenceCount;
    const sentLenCv = meanSentLen === 0 ? 0 : Math.sqrt(variance) / meanSentLen;
    const shortRatio = sentenceCount === 0 ? 0 : lengths.filter((len) => len <= 8).length / sentenceCount;
    const perK = (count) => (chars === 0 ? 0 : (count * 1000) / chars);
    const toneCount = TONE_PARTICLES.reduce((acc, particle) => acc + countMatches(normalized, new RegExp(particle, 'g')), 0);
    const catchphraseCount = catchphrases.reduce((acc, phrase) => {
        if (phrase.length === 0)
            return acc;
        return acc + countMatches(normalized, new RegExp(escapeRegExp(phrase), 'g'));
    }, 0);
    return {
        chars,
        meanSentLen: round3(meanSentLen),
        sentLenCv: round3(sentLenCv),
        shortRatio: round3(shortRatio),
        tonePerK: round3(perK(toneCount)),
        firstPersonPerK: round3(perK(countMatches(normalized, FIRST_PERSON))),
        punctPer100: round3(chars === 0 ? 0 : (countMatches(normalized, PUNCTUATION) * 100) / chars),
        emojiPerK: round3(perK(countMatches(normalized, EMOJI))),
        catchphrasePerK: round3(perK(catchphraseCount)),
    };
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function round3(value) {
    return Math.round(value * 1000) / 1000;
}
/**
 * 判语域桶。
 *
 * 顺序：技术 > 情绪 > 其余。技术优先是因为代码/路径信号最硬，
 * 一句「这个报错很难受，`ENOENT`」应算技术而不是情绪。
 */
export function classifyBucket(text, metrics) {
    if (TECHNICAL.test(text))
        return 'technical';
    if (EMOTIONAL.test(text))
        return 'emotional';
    const m = metrics ?? analyzeTurn(text);
    if (m.shortRatio > 0.5 && m.firstPersonPerK > 15)
        return 'emotional';
    return 'casual';
}
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
/** 一组行的中位指纹。 */
export function fingerprintOf(rows) {
    const out = {};
    for (const metric of STYLE_METRICS) {
        out[metric] = round3(median(rows.map((row) => row[metric])));
    }
    return out;
}
/**
 * 有界加权距离 → 相似度。
 *
 * `d = Σ w_i · min(1, |a_i − b_i| / (scale_i × 3)) / Σ w_i`
 * `similarity = 1 − d`
 *
 * 每项最多贡献 1，所以任何单一维度的爆炸（比如语气词从 0 变 200）都只能拉低有限幅度，
 * 不会像裸欧氏距离那样把结论完全带偏。
 */
export function styleSimilarity(a, b) {
    let total = 0;
    let weightSum = 0;
    for (const metric of STYLE_METRICS) {
        const w = WEIGHT[metric];
        const scale = SCALE[metric];
        const delta = Math.abs(a[metric] - b[metric]);
        const capped = scale === 0 ? 0 : Math.min(1, delta / (scale * 3));
        total += w * capped;
        weightSum += w;
    }
    if (weightSum === 0)
        return 1;
    return round3(1 - total / weightSum);
}
/** 差异最大的 N 个维度（排查用）。 */
export function topDiffs(a, b, limit = 3) {
    return STYLE_METRICS.map((metric) => ({
        metric,
        from: b[metric],
        to: a[metric],
        normalized: SCALE[metric] === 0 ? 0 : Math.min(1, Math.abs(a[metric] - b[metric]) / (SCALE[metric] * 3)),
    }))
        .sort((x, y) => y.normalized - x.normalized)
        .slice(0, limit);
}
/** 相似度 → 状态（阈值来自 docs/upgrade-plan-v3.md §5.5）。 */
export function statusOf(similarity) {
    if (similarity >= 0.85)
        return 'green';
    if (similarity >= 0.75)
        return 'yellow';
    if (similarity >= 0.65)
        return 'orange';
    return 'red';
}
/**
 * 风格指纹存储。
 *
 * 落盘的是**每轮统计量**（一行 JSONL），**不含原文**。
 * 想回看当时说了什么，只能去 session 日志——那是宿主的存储，不是这里的。
 */
export class StyleStore {
    filePath;
    baselinePath;
    clock;
    keep;
    minTurns;
    minChars;
    rows = [];
    frozen;
    loaded = false;
    saveError;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-style.jsonl') : resolve(options.filePath);
        this.baselinePath =
            options.baselinePath === undefined ? resolveDataFile('cognition-style-baseline.json') : resolve(options.baselinePath);
        this.clock = options.now ?? (() => Date.now());
        this.keep = options.keep ?? 5000;
        this.minTurns = options.minTurns ?? 60;
        this.minChars = options.minChars ?? 6000;
    }
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        try {
            if (existsSync(this.baselinePath)) {
                const raw = JSON.parse(readFileSync(this.baselinePath, 'utf8'));
                if (raw !== null && typeof raw === 'object' && 'buckets' in raw) {
                    this.frozen = raw;
                }
            }
        }
        catch {
            this.frozen = undefined;
        }
        try {
            if (!existsSync(this.filePath))
                return false;
            const out = [];
            for (const line of readFileSync(this.filePath, 'utf8').split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed.length === 0)
                    continue;
                try {
                    const row = JSON.parse(trimmed);
                    if (row.v !== STYLE_LOG_VERSION)
                        continue;
                    out.push(row);
                }
                catch {
                    /* 单行坏了跳过 */
                }
            }
            this.rows = out.slice(-this.keep);
            return out.length > 0;
        }
        catch {
            return false;
        }
    }
    get path() {
        return this.filePath;
    }
    get lastSaveError() {
        return this.saveError;
    }
    /** 记录一轮（只存统计量）。 */
    record(input) {
        this.loadSync();
        const metrics = analyzeTurn(input.text, input.catchphrases ?? []);
        const row = {
            v: STYLE_LOG_VERSION,
            at: this.clock(),
            sessionId: input.sessionId,
            turn: input.turn,
            bucket: classifyBucket(input.text, metrics),
            ...metrics,
        };
        this.rows.push(row);
        if (this.rows.length > this.keep)
            this.rows.shift();
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            appendFileSync(this.filePath, JSON.stringify(row) + '\n', 'utf8');
        }
        catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
        }
        return row;
    }
    /** 样本概况。 */
    sampleSummary() {
        this.loadSync();
        const buckets = { technical: 0, emotional: 0, casual: 0 };
        let chars = 0;
        for (const row of this.rows) {
            buckets[row.bucket] += 1;
            chars += row.chars;
        }
        const turns = this.rows.length;
        const confidence = Math.min(1, turns / this.minTurns, this.minChars === 0 ? 1 : chars / this.minChars);
        return {
            turns,
            chars,
            buckets,
            minTurns: this.minTurns,
            minChars: this.minChars,
            confidence: round3(Math.max(0, confidence)),
            sufficient: turns >= this.minTurns && chars >= this.minChars,
        };
    }
    /**
     * 把当前窗口冻结成基线。
     *
     * 为什么要冻结：自动切分（前半当基线、后半当当前）在样本漂移时会把漂移吃进基线，
     * 越漂越像。冻结基线才是「和当初比」。
     */
    freezeBaseline() {
        this.loadSync();
        const summary = this.sampleSummary();
        const buckets = {};
        const allRows = this.rows;
        if (allRows.length > 0) {
            buckets.all = { fingerprint: fingerprintOf(allRows), turns: allRows.length, chars: summary.chars };
        }
        for (const bucket of ['technical', 'emotional', 'casual']) {
            const pool = allRows.filter((row) => row.bucket === bucket);
            if (pool.length === 0)
                continue;
            buckets[bucket] = {
                fingerprint: fingerprintOf(pool),
                turns: pool.length,
                chars: pool.reduce((acc, row) => acc + row.chars, 0),
            };
        }
        this.frozen = { at: this.clock(), buckets };
        try {
            mkdirSync(dirname(this.baselinePath), { recursive: true });
            writeFileSync(this.baselinePath, JSON.stringify(this.frozen, null, 2) + '\n', 'utf8');
            this.saveError = undefined;
            return { ok: true, sample: summary };
        }
        catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
            return { ok: false, sample: summary };
        }
    }
    /**
     * 当前窗口 vs 基线。
     *
     * 桶内比较：技术回答和闲聊分开算，跨桶报警是纯噪声（Biber 的老坑）。
     * 样本不足一律 `insufficient`，不给一个看起来很像的假分数。
     */
    compare(options = {}) {
        this.loadSync();
        const bucket = options.bucket ?? 'all';
        const recentTurns = options.recentTurns ?? 30;
        const pool = bucket === 'all' ? this.rows : this.rows.filter((row) => row.bucket === bucket);
        const summary = this.sampleSummary();
        const currentTurns = Math.min(pool.length, recentTurns);
        const currentRows = pool.slice(-recentTurns);
        const currentChars = currentRows.reduce((acc, row) => acc + row.chars, 0);
        const insufficientNote = `样本不足（${pool.length} 轮 / ${currentChars} 字，门槛 ${this.minTurns} 轮 / ${this.minChars} 字），不做判断`;
        if (!summary.sufficient || currentTurns < Math.min(this.minTurns, 10)) {
            return {
                status: 'insufficient',
                bucket,
                similarity: null,
                baseline: null,
                current: { turns: currentTurns, chars: currentChars },
                topDiffs: [],
                note: insufficientNote,
            };
        }
        const current = fingerprintOf(currentRows);
        const frozenEntry = this.frozen?.buckets?.[bucket] ?? this.frozen?.buckets?.all;
        let baselineFingerprint;
        let baselineMeta;
        if (frozenEntry !== undefined) {
            baselineFingerprint = frozenEntry.fingerprint;
            baselineMeta = { source: 'frozen', turns: frozenEntry.turns, chars: frozenEntry.chars };
        }
        else {
            // 没冻结过：前 60% 当基线、后 40% 当当前（只够做个粗略对照）
            const splitAt = Math.max(1, Math.floor(pool.length * 0.6));
            const oldRows = pool.slice(0, splitAt);
            baselineFingerprint = fingerprintOf(oldRows);
            baselineMeta = {
                source: 'auto-split',
                turns: oldRows.length,
                chars: oldRows.reduce((acc, row) => acc + row.chars, 0),
            };
        }
        const similarity = styleSimilarity(current, baselineFingerprint);
        const status = statusOf(similarity);
        return {
            status,
            bucket,
            similarity,
            baseline: baselineMeta,
            current: { turns: currentTurns, chars: currentChars },
            topDiffs: topDiffs(current, baselineFingerprint),
            note: baselineMeta.source === 'frozen'
                ? '与冻结基线比较'
                : '自动切分对照（还没冻结基线，结论仅供观察）',
        };
    }
    /** 最近 N 行的趋势（每 10 轮一个点，供页面画小图）。 */
    trend(points = 12, bucketSize = 10) {
        this.loadSync();
        const out = [];
        for (let end = this.rows.length; end > 0 && out.length < points; end -= bucketSize) {
            const start = Math.max(0, end - bucketSize);
            const chunk = this.rows.slice(start, end);
            if (chunk.length === 0)
                break;
            const fp = fingerprintOf(chunk);
            out.push({ at: chunk[chunk.length - 1].at, turns: chunk.length, chars: fp.chars, meanSentLen: fp.meanSentLen, tonePerK: fp.tonePerK });
        }
        return out.reverse();
    }
}
