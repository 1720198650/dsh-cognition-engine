/**
 * src/usage.ts — 用量账本（成本看板）
 *
 * 目的：让"花了多少"变成可见的数字，而不是靠感觉。
 * 只记元数据（用途、字符数、模型名），**不记提示词正文**——省空间，也不留隐私。
 *
 * 估算口径（写在代码里，避免口径漂移）：
 *   - 中文约 0.75 token / 字（保守取 0.8 会导致高估，这里取 0.75）
 *   - 单价由配置给，默认 ¥2 / 百万 tokens（DeepSeek 量级）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function recordUsage(filePath, entry) {
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    }
    catch {
        /* 记不上不影响主流程 */
    }
}
function readJsonl(filePath) {
    if (!existsSync(filePath))
        return [];
    const out = [];
    for (const line of readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0)
            continue;
        try {
            out.push(JSON.parse(trimmed));
        }
        catch {
            /* 坏行跳过 */
        }
    }
    return out;
}
const CHARS_PER_TOKEN = 0.75;
export function summarizeUsage(options) {
    const now = options.now ?? Date.now();
    const today = new Date(now);
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const monthKey = todayKey.slice(0, 7);
    const keyOf = (ms) => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const injections = readJsonl(options.injectionFile);
    let totalChars = 0;
    let todayChars = 0;
    let monthChars = 0;
    for (const row of injections) {
        const chars = Number(row.chars ?? 0);
        totalChars += chars;
        if (typeof row.at === 'number') {
            const key = keyOf(row.at);
            if (key === todayKey)
                todayChars += chars;
            if (key.startsWith(monthKey))
                monthChars += chars;
        }
    }
    const usage = readJsonl(options.usageFile);
    let calls = 0;
    let monthCalls = 0;
    let todayCalls = 0;
    let promptChars = 0;
    let outputChars = 0;
    const byPurpose = {};
    for (const row of usage) {
        calls += 1;
        promptChars += Number(row.promptChars ?? 0);
        outputChars += Number(row.outputChars ?? 0);
        const purpose = String(row.purpose ?? 'other');
        byPurpose[purpose] = (byPurpose[purpose] ?? 0) + 1;
        if (typeof row.at === 'number') {
            const key = keyOf(row.at);
            if (key === todayKey)
                todayCalls += 1;
            if (key.startsWith(monthKey))
                monthCalls += 1;
        }
    }
    const injectionTokens = Math.round(totalChars * CHARS_PER_TOKEN);
    const modelTokens = Math.round((promptChars + outputChars) * CHARS_PER_TOKEN);
    const price = options.pricePerMTokens ?? 2;
    const estCostYuan = Number((((injectionTokens + modelTokens) / 1_000_000) * price).toFixed(4));
    const turns = injections.length;
    return {
        injection: {
            turns,
            totalChars,
            todayChars,
            monthChars,
            estTokens: injectionTokens,
        },
        model: {
            calls,
            monthCalls,
            todayCalls,
            promptChars,
            outputChars,
            estTokens: modelTokens,
            byPurpose,
        },
        pricePerMTokens: price,
        estCostYuan,
        estTokensPerTurn: turns === 0 ? 0 : Math.round(totalChars / turns),
    };
}
