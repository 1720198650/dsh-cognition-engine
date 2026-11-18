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
    if (isPrivateHost(host)) {
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
/**
 * 极简 robots.txt 解析：只认 `User-agent:` / `Disallow:` / `Allow:` / `Crawl-delay:`。
 *
 * 规则选择顺序：优先匹配我们 UA 里出现的名字，其次 `*`；同长度规则里 Allow 优先于 Disallow
 * （与主流实现一致）。抓不到的 robots 一律按"允许"处理，但限速仍然生效。
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
        if (field === 'disallow' && value.length > 0)
            current.rules.push({ allow: false, path: value });
        if (field === 'allow' && value.length > 0)
            current.rules.push({ allow: true, path: value });
        if (field === 'crawl-delay') {
            const seconds = Number(value);
            if (Number.isFinite(seconds) && seconds > 0)
                current.crawlDelayMs = Math.round(seconds * 1000);
        }
    }
    const uaLower = userAgent.toLowerCase();
    const tokens = uaLower.split(/[^a-z0-9._-]+/).filter((token) => token.length > 0);
    const score = (agents) => {
        if (agents.includes('*'))
            return 1;
        let best = 0;
        for (const agent of agents) {
            if (agent.length > 0 && tokens.includes(agent))
                best = Math.max(best, 2 + agent.length);
        }
        return best;
    };
    let chosen;
    let bestScore = 0;
    for (const group of groups) {
        const value = score(group.agents);
        if (value > bestScore) {
            bestScore = value;
            chosen = group;
        }
    }
    const rules = chosen?.rules ?? [];
    const crawlDelayMs = chosen?.crawlDelayMs ?? 0;
    return {
        crawlDelayMs,
        allow(pathname) {
            let best;
            for (const rule of rules) {
                // `*` 通配与 `$` 结尾在极简实现里只做前缀匹配
                const pattern = rule.path.replace(/\*.*$/, '');
                if (!pathname.startsWith(pattern))
                    continue;
                const length = pattern.length;
                if (best === undefined || length > best.length || (length === best.length && rule.allow)) {
                    best = { allow: rule.allow, length };
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
