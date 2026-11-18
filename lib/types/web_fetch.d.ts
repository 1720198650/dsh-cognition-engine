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
    /**
     * 允许抓本机回环地址。**只给本地自测用**，默认 false。
     * 生产语义是「封内网」，打开它会破坏这条保证，所以必须显式开。
     */
    allowLoopback?: boolean;
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
    /** 是否允许抓这个位置（传 pathname + search）。 */
    allow: (target: string) => boolean;
    /** 规则来源：'specific'（命中自己那组）/ 'star'（只有 *）/ 'none'（没规则）。 */
    matched: 'specific' | 'star' | 'none';
}
/**
 * robots.txt 解析（RFC 9309）。
 *
 * 三条容易做错的规则，这里都按规范来：
 *   1. **同名 UA 的多段规则要合并**（§2.2.1），不能只取第一组；
 *   2. 有匹配自己 UA 的组时**整组用自己那组**，`*` 组不参与；
 *   3. 规则匹配最长者优先，等长时 Allow 胜（§2.2.2）；`*` / `$` 是规范里的 MUST（§2.2.3）。
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
