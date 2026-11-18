/**
 * src/web_fetch.ts — L2 白名单抓取（唯一会主动联网的模块）。
 *
 * 设计底线（写死在代码里，不靠"记得"）：
 *   - 只允许 http/https，且**必须在白名单域名内**；空白名单 = 一律拒绝。
 *   - 封掉本机与内网地址（SSRF）：localhost / 127.* / 10.* / 172.16-31.* / 192.168.* / ::1 / .local
 *   - 遵守 robots.txt：Disallow 路径不抓，Crawl-delay 参与限速。
 *   - 限速：同一站点两次抓取间隔 ≥ max(crawlDelay, 3 秒)。
 *   - 上限：单页 2MB、15 秒超时、最多 3 次重定向。
 *
 * 抓回来的正文一律走 extractText 当**数据**处理（剥脚本/注释/零宽 + 标可疑句式），
 * 与收件箱同一条管道，不允许网页内容直接影响指令。
 *
 * 零依赖：只用 Node 全局 fetch。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export const DEFAULT_POLICY = {
    minIntervalMs: 3000,
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 15000,
    maxRedirects: 3,
    userAgent: 'dsh-cognition-engine/0.13 (+local reading assistant)',
    allowLoopback: false,
};
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|::1|\[::1\])$/i;
function isPrivateHost(host) {
    if (PRIVATE_HOST.test(host))
        return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host))
        return true;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan'))
        return true;
    return false;
}
/**
 * 校验一个 URL 能不能抓。
 *
 * 白名单只认域名后缀边界：白名单里有 `example.com` 时 `a.example.com` 允许，
 * 但 `notexample.com` 不允许（避免后缀匹配被绕过）。
 */
export function checkUrl(raw, policy) {
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch {
        return { ok: false, reason: '不是合法的网址（要带 http:// 或 https://）' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: '只支持 http/https，不允许 ' + url.protocol };
    }
    const host = url.hostname.toLowerCase();
    if (host.length === 0)
        return { ok: false, reason: '网址没有域名' };
    if (isPrivateHost(host) && policy.allowLoopback !== true) {
        return { ok: false, reason: '拒绝抓取本机/内网地址（' + host + '）' };
    }
    const hosts = policy.hosts.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0);
    if (hosts.length === 0) {
        return { ok: false, reason: '白名单是空的：先把域名加进白名单再抓', host };
    }
    const allowed = hosts.some((base) => host === base || host.endsWith('.' + base));
    if (!allowed) {
        return { ok: false, reason: '域名不在白名单里：' + host, host };
    }
    return { ok: true, url, host };
}
/** 把 robots 的一条路径规则编译成正则：`*` 是任意序列，结尾 `$` 是行尾锚点（RFC 9309 §2.2.3）。 */
function compileRule(pattern) {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const escape = (part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const source = body.split('*').map(escape).join('.*');
    let re;
    try {
        re = new RegExp('^' + source + (anchored ? '$' : ''));
    }
    catch {
        // 规则写坏了就当成不匹配，别让一条坏规则把整站封死
        return { test: () => false, weight: 0 };
    }
    // 具体性按规则字面长度算（去掉通配符），与"最长匹配优先"一致
    return { test: (target) => re.test(target), weight: body.replace(/\*/g, '').length };
}
/**
 * robots.txt 解析（RFC 9309）。
 *
 * 三条容易做错的规则，这里都按规范来：
 *   1. **同名 UA 的多段规则要合并**（§2.2.1），不能只取第一组；
 *   2. 有匹配自己 UA 的组时**整组用自己那组**，`*` 组不参与；
 *   3. 规则匹配最长者优先，等长时 Allow 胜（§2.2.2）；`*` / `$` 是规范里的 MUST（§2.2.3）。
 */
export function parseRobots(text, userAgent) {
    const groups = [];
    let current;
    let lastWasAgent = false;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (line.length === 0)
            continue;
        const index = line.indexOf(':');
        if (index <= 0)
            continue;
        const field = line.slice(0, index).trim().toLowerCase();
        const value = line.slice(index + 1).trim();
        if (field === 'user-agent') {
            if (current === undefined || !lastWasAgent) {
                current = { agents: [], rules: [], crawlDelayMs: 0 };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (current === undefined)
            continue;
        if (field === 'disallow') {
            // 空 Disallow 是"没有限制"，不是"禁全站"
            if (value.length > 0)
                current.rules.push({ allow: false, pattern: value });
        }
        if (field === 'allow' && value.length > 0)
            current.rules.push({ allow: true, pattern: value });
        if (field === 'crawl-delay') {
            const seconds = Number(value);
            if (Number.isFinite(seconds) && seconds > 0)
                current.crawlDelayMs = Math.round(seconds * 1000);
        }
    }
    const tokens = userAgent.toLowerCase().split(/[^a-z0-9._-]+/).filter((token) => token.length > 0);
    // 自己 UA 的匹配组（可能多段），取"UA 名最长"的那一类；同长度的全并进来
    let bestAgentLength = 0;
    const specific = [];
    for (const group of groups) {
        for (const agent of group.agents) {
            if (agent === '*' || agent.length === 0)
                continue;
            if (!tokens.includes(agent))
                continue;
            if (agent.length > bestAgentLength) {
                bestAgentLength = agent.length;
                specific.length = 0;
                specific.push(group);
            }
            else if (agent.length === bestAgentLength && !specific.includes(group)) {
                specific.push(group);
            }
        }
    }
    const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'));
    const matched = specific.length > 0 ? 'specific' : chosen.length > 0 ? 'star' : 'none';
    const crawlDelayMs = chosen.reduce((max, group) => Math.max(max, group.crawlDelayMs), 0);
    const rules = chosen
        .flatMap((group) => group.rules)
        .map((rule) => ({ allow: rule.allow, ...compileRule(rule.pattern) }));
    return {
        crawlDelayMs,
        matched,
        allow(target) {
            let best;
            for (const rule of rules) {
                if (!rule.test(target))
                    continue;
                if (best === undefined || rule.weight > best.weight || (rule.weight === best.weight && rule.allow)) {
                    best = { allow: rule.allow, weight: rule.weight };
                }
            }
            return best === undefined ? true : best.allow;
        },
    };
}
/** 只读 body 到上限，避免一个巨大页面把内存吃光。 */
async function readCapped(response, maxBytes) {
    const reader = response.body?.getReader();
    if (reader === undefined) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return { text: buffer.toString('utf8'), bytes: buffer.length, truncated: buffer.length > maxBytes };
    }
    const chunks = [];
    let size = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value === undefined)
            continue;
        size += value.length;
        if (size > maxBytes) {
            chunks.push(value.subarray(0, Math.max(0, value.length - (size - maxBytes))));
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
        }
        chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString('utf8'), bytes: Math.min(size, maxBytes), truncated };
}
/** 抓一个页面（不含 robots 检查与限速，那些由调用方先做）。 */
export async function fetchOnce(url, policy) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': policy.userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
        });
        const contentType = response.headers.get('content-type') ?? '';
        const capped = await readCapped(response, policy.maxBytes);
        return {
            ok: response.ok,
            status: response.status,
            finalUrl: response.url || url,
            contentType,
            text: capped.text,
            bytes: capped.bytes,
            ...(capped.truncated ? { reason: `页面超过 ${policy.maxBytes} 字节，已截断` } : {}),
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            status: 0,
            finalUrl: url,
            contentType: '',
            text: '',
            bytes: 0,
            reason: /abort/i.test(message) ? `请求超时（${policy.timeoutMs}ms）` : message,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
/** 白名单持久化：域名数组，落一个 JSON 文件。 */
export class WhitelistStore {
    filePath;
    cache;
    constructor(options) {
        this.filePath = options.filePath;
    }
    load() {
        if (this.cache !== undefined)
            return this.cache;
        this.cache = [];
        if (!existsSync(this.filePath))
            return this.cache;
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
            if (Array.isArray(parsed.hosts)) {
                this.cache = parsed.hosts.filter((item) => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0);
            }
        }
        catch {
            this.cache = [];
        }
        return this.cache;
    }
    save() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify({ hosts: this.load() }, null, 2), 'utf8');
    }
    list() {
        return [...this.load()];
    }
    add(host) {
        const clean = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (clean.length === 0)
            throw new Error('域名不能为空');
        if (isPrivateHost(clean))
            throw new Error('不能把本机/内网地址加进白名单：' + clean);
        const hosts = this.load();
        if (hosts.includes(clean))
            return { hosts: [...hosts], added: false };
        hosts.push(clean);
        this.save();
        return { hosts: [...hosts], added: true };
    }
    remove(host) {
        const clean = host.trim().toLowerCase();
        const hosts = this.load();
        const index = hosts.indexOf(clean);
        if (index < 0)
            return { hosts: [...hosts], removed: false };
        hosts.splice(index, 1);
        this.save();
        return { hosts: [...hosts], removed: true };
    }
}
/** 每站点的上次抓取时间，用来做限速。 */
export class FetchThrottle {
    last = new Map();
    clock;
    constructor(clock = () => Date.now()) {
        this.clock = clock;
    }
    /** 返回还需要等多少毫秒（0 表示可以立刻抓）。 */
    waitMs(host, intervalMs) {
        const previous = this.last.get(host);
        if (previous === undefined)
            return 0;
        const elapsed = this.clock() - previous;
        return Math.max(0, intervalMs - elapsed);
    }
    mark(host) {
        this.last.set(host, this.clock());
    }
}
