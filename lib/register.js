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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeTurn } from "./style.js";
import { resolveDataFile } from "./util.js";
/* ------------------------------------------------------------------ *
 * 第 0 层：关键词
 * ------------------------------------------------------------------ */
/**
 * 明确在派活的词。
 *
 * 刻意收「动作 + 对象」型的具体词，不收「帮我」这类——「帮我倒杯水」不是活。
 */
export const WORK_WORDS = [
    '改一下', '改下', '改成', '修改', '调整',
    '加一个', '加个', '新增', '加上', '添加',
    '修一下', '修下', '修复', '修好',
    '删掉', '删除', '去掉', '移除',
    '报错', '错误', '崩溃', '不工作', '跑不通', '挂了',
    '测试', '跑测试', '单元测试', '回归',
    '提交', '推送', '部署', '发布', '打包', '构建', '编译', '安装',
    '重构', '优化', '性能',
    '写一个', '写个', '实现', '开发',
    '查一下', '看一下这个', '检查一下', '排查',
    '文档', '代码', '插件', '接口', '脚本', '日志', '配置', '表格',
    '图片', 'docx', 'word', 'excel', 'ppt',
    'PR', 'issue', 'commit', 'bug',
];
/**
 * 明确在闲聊的词。
 *
 * 只收**状态/情绪/社交**，不收应答词。
 */
export const CHAT_WORDS = [
    '累', '好累', '困', '饿', '忙', '烦', '无聊',
    '晚安', '早安', '在干嘛', '干嘛呢', '最近怎么样',
    '随便聊聊', '聊聊天', '闲聊', '心情',
    '吃饭', '睡觉', '周末', '放假', '天气',
    '哈哈', '笑死', '唉', '哎',
];
/**
 * 应答词白名单：**既不算闲聊，也不算派活**，直接落到下一层。
 *
 * 这是从 `injection_log.ts` 的 `classifyFeedback` 学来的教训——
 * 那里 v1 把「可以/好的/行/嗯」当确认，结果把 appliedGood 洗白。
 * 这里同理：这些词只是「知道了」，不是场合信号。
 */
export const ACK_WORDS = [
    '好的', '好', '行', '可以', '嗯', '嗯嗯', '哦', '收到', '明白', '了解',
    '继续', '接着来', '下一步', '然后呢', '谢谢', '多谢', '辛苦了',
    'ok', 'OK', 'Ok',
];
function hitAny(text, words) {
    const lower = text.toLowerCase();
    return words.filter((word) => {
        const needle = word.toLowerCase();
        // 纯 ASCII 词要按词边界匹配，否则「PR」会命中「preparing」这种英文单词内部。
        if (/^[a-z0-9+#._-]+$/.test(needle)) {
            return new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower);
        }
        return lower.includes(needle);
    });
}
/**
 * 宿主/运行时自动注入的上下文块，**不是人说的话**。
 *
 * 这些块也走 `user/message` 事件（实测确认），如果照样判定，
 * 记录里会塞满「Time sampled while preparing turn 362…」这种机器文本，
 * 既污染统计、又会因为里面的英文单词（PR / bug）误命中关键词。
 */
const RUNTIME_MARKERS = [
    'Time sampled while preparing turn',
    'Tokens prefixed with @',
    'Current runtime context',
    '<system-reminder>',
    'Instructions from:',
    'automatically generated checkpoint',
    'This session is being continued from',
];
/** 这条 user 消息是不是运行时注入的上下文（应当跳过）。 */
export function isRuntimeContext(text) {
    return RUNTIME_MARKERS.some((marker) => text.includes(marker));
}
/**
 * 这句话是不是「纯应答」。
 *
 * 不能用 `includes('好')` 判断——那会把「好累」「好的文档」都吃掉。
 * 做法：去掉应答词与标点后，剩下的内容很短（≤4 字）才算纯应答。
 */
function isPureAck(text) {
    let rest = text.replace(/[\s，。,.!！？?、;；:：~～]/g, '');
    for (const word of ACK_WORDS) {
        if (word.length > 0 && rest.includes(word))
            rest = rest.split(word).join('');
    }
    return rest.length <= 4;
}
/* ------------------------------------------------------------------ *
 * 第 1 层：表层特征打分
 * ------------------------------------------------------------------ */
/** 技术信号：文件路径 / 扩展名 / 代码块 / 命令参数。命中基本就是活。 */
const TECHNICAL_HINT = /```|`[^`\n]+`|[A-Za-z]:\\|\.(?:js|mjs|cjs|ts|tsx|py|ps1|json|md|docx|yml|yaml)\b|--\w+/;
/** 「怎么做」型提问：通常是要方法，不是闲聊。 */
const HOW_QUESTION = /怎么(?:办|做|改|弄|写|修)|如何|为什么|为啥|什么原因/;
const clamp01 = (value) => (value <= 0 ? 0 : value >= 1 ? 1 : value);
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
export function scoreRegister(text) {
    const m = analyzeTurn(text);
    const workHits = hitAny(text, WORK_WORDS).length;
    // 闲聊证据：整体极短 / 语气词 / 表情 / 第一人称（自述）
    let chat = 0.35 * (m.chars <= 10 ? 1 : m.chars <= 20 ? 0.5 : 0) +
        0.3 * clamp01(m.tonePerK / 25) +
        0.2 * clamp01(m.emojiPerK / 20) +
        0.15 * clamp01(m.firstPersonPerK / 40);
    // 干活证据：技术信号 / 长度 / 「怎么做」提问 / 动作词
    const work = 0.4 * (TECHNICAL_HINT.test(text) ? 1 : 0) +
        0.25 * clamp01(m.chars / 80) +
        0.15 * (HOW_QUESTION.test(text) ? 1 : 0) +
        0.2 * clamp01(workHits);
    // 交互项：出现了具体动作词，就几乎不可能是闲聊——
    // 「报错 / 改成 / 测试」这类词不会出现在闲扯里。压掉闲聊分，避免长句被误判。
    if (workHits > 0)
        chat *= 0.4;
    const workScore = Math.round(clamp01(work) * 1000) / 1000;
    const chatScore = Math.round(clamp01(chat) * 1000) / 1000;
    return { work: workScore, chat: chatScore, gap: Math.round(Math.abs(workScore - chatScore) * 1000) / 1000 };
}
/* ------------------------------------------------------------------ *
 * 阈值（学 Rasa FallbackClassifier）
 * ------------------------------------------------------------------ */
/** 最高分低于它就认为「判不了」。 */
export const THRESHOLD = 0.3;
/** 前两名分差小于它就认为「分不清」。 */
export const AMBIGUITY_THRESHOLD = 0.1;
/**
 * 综合判定。
 *
 * 顺序很重要：关键词 → 打分 → 双阈值 → 兜底「干活」。
 */
export function judgeRegister(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return {
            verdict: 'work',
            confidence: 0,
            layer: 'fallback',
            reason: '空消息，按干活处理',
            scores: { work: 0, chat: 0, gap: 0 },
        };
    }
    // —— 第 0 层：关键词 ——
    // 顺序：先看**明确的派活/闲聊词**（互斥才定论），再看应答词。
    // 顺序反了会出事：「今天好累啊」里含「好」，会被当成应答词放过。
    const workHits = hitAny(trimmed, WORK_WORDS);
    const chatHits = hitAny(trimmed, CHAT_WORDS);
    // 两边都命中时**不猜**——交给打分层（比如「累了一天，帮我把文档改完」）
    if (workHits.length > 0 && chatHits.length === 0) {
        return {
            verdict: 'work',
            confidence: 1,
            layer: 'keyword',
            reason: `命中派活词：${workHits.slice(0, 3).join('、')}`,
            scores: { work: 1, chat: 0, gap: 1 },
            hits: workHits.slice(0, 3),
        };
    }
    if (chatHits.length > 0 && workHits.length === 0) {
        return {
            verdict: 'chat',
            confidence: 1,
            layer: 'keyword',
            reason: `命中闲聊词：${chatHits.slice(0, 3).join('、')}`,
            scores: { work: 0, chat: 1, gap: 1 },
            hits: chatHits.slice(0, 3),
        };
    }
    // 应答词：既不是派活也不是闲聊，但**在干活语境里它是「继续」的意思**。
    // 所以直接按干活，置信度给 0.6（不是 1，因为它本身不算强证据）。
    if (workHits.length === 0 && chatHits.length === 0 && isPureAck(trimmed)) {
        return {
            verdict: 'work',
            confidence: 0.6,
            layer: 'keyword',
            reason: '纯应答（好的/嗯/继续），不算场合信号 → 按干活',
            scores: { work: 0.6, chat: 0, gap: 0.6 },
        };
    }
    // —— 第 1 层：打分 ——
    const scores = scoreRegister(trimmed);
    const best = Math.max(scores.work, scores.chat);
    // —— 第 2 层：双阈值兜底 ——
    if (best < THRESHOLD) {
        return {
            verdict: 'work',
            confidence: best,
            layer: 'fallback',
            reason: `最高分 ${best} < 阈值 ${THRESHOLD}，判不了 → 按干活`,
            scores,
        };
    }
    if (scores.gap < AMBIGUITY_THRESHOLD) {
        return {
            verdict: 'work',
            confidence: best,
            layer: 'fallback',
            reason: `前两名只差 ${scores.gap} < ${AMBIGUITY_THRESHOLD}，分不清 → 按干活`,
            scores,
        };
    }
    const verdict = scores.work >= scores.chat ? 'work' : 'chat';
    return {
        verdict,
        confidence: best,
        layer: 'score',
        reason: `打分：干活 ${scores.work} / 闲聊 ${scores.chat}`,
        scores,
    };
}
/* ------------------------------------------------------------------ *
 * 记录（append-only JSONL，只存摘要）
 * ------------------------------------------------------------------ */
export const REGISTER_LOG_VERSION = 1;
/** 摘要长度上限：不存全量原文。 */
export const EXCERPT_CHARS = 40;
export class RegisterLog {
    filePath;
    clock;
    keepRecent;
    rows = [];
    loaded = false;
    skipped = 0;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-register.jsonl') : resolve(options.filePath);
        this.clock = options.now ?? (() => Date.now());
        this.keepRecent = options.keepRecent ?? 300;
    }
    get path() {
        return this.filePath;
    }
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        if (!existsSync(this.filePath))
            return true;
        try {
            const raw = readFileSync(this.filePath, 'utf8');
            for (const line of raw.split('\n')) {
                const text = line.trim();
                if (text.length === 0)
                    continue;
                try {
                    const row = JSON.parse(text);
                    if (row.v !== REGISTER_LOG_VERSION) {
                        this.skipped += 1;
                        continue;
                    }
                    this.rows.push(row);
                }
                catch {
                    this.skipped += 1;
                }
            }
            if (this.rows.length > this.keepRecent)
                this.rows = this.rows.slice(-this.keepRecent);
        }
        catch {
            /* 读失败就当空日志，不影响主流程 */
        }
        return true;
    }
    /** 记一轮。判定在调用方做，这里只管落盘。 */
    record(input) {
        this.loadSync();
        const excerpt = input.text.trim().replace(/\s+/g, ' ').slice(0, EXCERPT_CHARS);
        const row = {
            v: REGISTER_LOG_VERSION,
            at: this.clock(),
            sessionId: input.sessionId,
            turn: input.turn,
            excerpt,
            verdict: input.decision.verdict,
            confidence: input.decision.confidence,
            layer: input.decision.layer,
            reason: input.decision.reason,
            scores: input.decision.scores,
            ...(input.decision.hits === undefined ? {} : { hits: input.decision.hits }),
        };
        this.rows.push(row);
        if (this.rows.length > this.keepRecent)
            this.rows = this.rows.slice(-this.keepRecent);
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, 'utf8');
        }
        catch {
            /* 落盘失败不影响注入（本阶段也不影响任何行为） */
        }
        return row;
    }
    /**
     * 标注某一轮判错了 / 判对了。
     *
     * append-only：追加一条**同 sessionId+turn 的新行**，读取时以后出现的为准。
     * 这样原始判定记录不被改写，事后能算出「当时判成什么、你后来改成什么」。
     */
    label(sessionId, turn, label) {
        this.loadSync();
        const target = [...this.rows].reverse().find((row) => row.sessionId === sessionId && row.turn === turn);
        if (target === undefined)
            return false;
        const patched = { ...target, label };
        this.rows.push(patched);
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            appendFileSync(this.filePath, `${JSON.stringify(patched)}\n`, 'utf8');
        }
        catch {
            return false;
        }
        return true;
    }
    recent(limit = 20) {
        this.loadSync();
        return [...this.rows].reverse().slice(0, limit);
    }
    /** 合并 label 后的最终判定（同一 sessionId+turn 以最后一行为准）。 */
    effective(limit = 20) {
        this.loadSync();
        const byKey = new Map();
        for (const row of this.rows) {
            const key = `${row.sessionId}#${row.turn}`;
            const prev = byKey.get(key);
            byKey.set(key, prev === undefined ? row : { ...prev, ...row });
        }
        return [...byKey.values()].sort((a, b) => b.at - a.at).slice(0, limit);
    }
    overview() {
        this.loadSync();
        const effective = this.effective(Number.MAX_SAFE_INTEGER);
        const byLayer = { keyword: 0, score: 0, fallback: 0 };
        let chat = 0;
        let uncertain = 0;
        let labelled = 0;
        let wrong = 0;
        for (const row of effective) {
            if (row.verdict === 'chat')
                chat += 1;
            if (row.layer === 'fallback')
                uncertain += 1;
            byLayer[row.layer] = (byLayer[row.layer] ?? 0) + 1;
            if (row.label !== undefined) {
                labelled += 1;
                if (row.label === 'wrong')
                    wrong += 1;
            }
        }
        return {
            total: effective.length,
            work: effective.length - chat,
            chat,
            uncertain,
            byLayer,
            labelled,
            wrong,
        };
    }
}
