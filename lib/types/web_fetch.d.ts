export interface FetchPolicy {
    /** 允许的域名（含子域）。空数组 = 一律拒绝。 */
    hosts: string[];
    /** 同站点最小间隔毫秒（robots 的 crawl-delay 若更大则取大者）。 */
    minIntervalMs: number;
    /** 单页最大字节数。 */
    maxBytes: number;
    /** 单次请求超时毫秒。 */
    timeoutMs: number;
    /** 最大重定向次数。 */
    maxRedirects: number;
    userAgent: string;
}
export declare const DEFAULT_POLICY: Omit<FetchPolicy, 'hosts'>;
export interface UrlCheck {
    ok: boolean;
    url?: URL;
    host?: string;
    reason?: string;
}
/**
 * 校验一个 URL 能不能抓。
 *
 * 白名单只认域名后缀边界：白名单里有 `example.com` 时 `a.example.com` 允许，
 * 但 `notexample.com` 不允许（避免后缀匹配被绕过）。
 */
export declare function checkUrl(raw: string, policy: FetchPolicy): UrlCheck;
export interface RobotsRules {
    /** 命中的 crawl-delay 毫秒（没写则 0）。 */
    crawlDelayMs: number;
    /** 是否允许抓这个路径。 */
    allow: (pathname: string) => boolean;
}
/**
 * 极简 robots.txt 解析：只认 `User-agent:` / `Disallow:` / `Allow:` / `Crawl-delay:`。
 *
 * 规则选择顺序：优先匹配我们 UA 里出现的名字，其次 `*`；同长度规则里 Allow 优先于 Disallow
 * （与主流实现一致）。抓不到的 robots 一律按"允许"处理，但限速仍然生效。
 */
export declare function parseRobots(text: string, userAgent: string): RobotsRules;
export interface FetchResult {
    ok: boolean;
    status: number;
    finalUrl: string;
    contentType: string;
    text: string;
    bytes: number;
    reason?: string;
}
/** 抓一个页面（不含 robots 检查与限速，那些由调用方先做）。 */
export declare function fetchOnce(url: string, policy: FetchPolicy): Promise<FetchResult>;
/** 白名单持久化：域名数组，落一个 JSON 文件。 */
export declare class WhitelistStore {
    readonly filePath: string;
    private cache;
    constructor(options: {
        filePath: string;
    });
    private load;
    private save;
    list(): string[];
    add(host: string): {
        hosts: string[];
        added: boolean;
    };
    remove(host: string): {
        hosts: string[];
        removed: boolean;
    };
}
/** 每站点的上次抓取时间，用来做限速。 */
export declare class FetchThrottle {
    private readonly last;
    private readonly clock;
    constructor(clock?: () => number);
    /** 返回还需要等多少毫秒（0 表示可以立刻抓）。 */
    waitMs(host: string, intervalMs: number): number;
    mark(host: string): void;
}
