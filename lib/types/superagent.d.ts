/**
 * src/superagent.ts — 与 dsh-superagent 的只读对接
 *
 * ## 为什么单独一个模块
 *
 * superagent 是**另一个进程**（默认跑在 WSL，`127.0.0.1:3082`），不是本插件的依赖。
 * 所以这里只做一件事：把它的 HTTP API 读成紧凑结构，**任何失败都降级成「不可达」**，
 * 绝不让对面挂了/没起/改版把认知引擎也带崩。
 *
 * ## 接口稳定性（重要）
 *
 * superagent 的 `docs/006-deployment.md` 明确写：
 * 「Agents may rely on these routes: `GET state` / `GET settings` / `GET sources` /
 *  `PUT settings/<block>` / `POST executor/pause` / `POST policy-sync/<id>` /
 *  `GET,PUT prompts` / `POST tickets/<id>/retry|stop`」——
 * 而 **ticket 列表、threads、decisions 属于「面板路由，会随面板变」**。
 *
 * 我们仍然读它们（否则看不到工单），但：
 * 1. 每个字段都做存在性判断，缺了就显示「—」，不抛错；
 * 2. 面板上标明「只读镜像，字段可能随 superagent 版本变化」；
 * 3. 只有文档认可的两个动作（retry / stop）和 pause 提供按钮，其余一律只读。
 *
 * ## 零依赖
 *
 * 用 Node 22 自带的全局 `fetch` + `AbortSignal.timeout`，不引任何包。
 */
/** 一处 health 条目的紧凑形态。 */
export interface SuperagentHealth {
    name: string;
    state: string;
    detail?: string;
}
/** 一张工单的紧凑形态（字段全部可选，对面改版也不炸）。 */
export interface SuperagentTicket {
    id: string;
    title: string;
    state: string;
    /** 它在等谁：person / working / idle */
    stage?: string;
    /** 更细的动作：review / answer / blocked / failed / queued … */
    action?: string;
    strength?: string;
    assignments?: number;
    inputs?: number;
    undelivered?: number;
    sessionId?: string;
    /** 文档认可的两个动作能不能用 */
    canRetry?: boolean;
    canStop?: boolean;
}
export interface SuperagentOverview {
    /** 是否连上了。false 时其余字段没有意义。 */
    reachable: boolean;
    /** 不可达时的一句话原因（给面板显示）。 */
    error?: string;
    baseUrl: string;
    paused?: boolean;
    load?: {
        running: number;
        queued: number;
        maxWorkers: number;
    };
    health?: SuperagentHealth[];
    /** 有问题的 health 条目（state 既不是 ready 也不是 starting）。 */
    unhealthy?: SuperagentHealth[];
    tickets?: SuperagentTicket[];
    /** 按 stage 分组的计数，面板顶部展示用。 */
    counts?: {
        total: number;
        needsPerson: number;
        working: number;
        idle: number;
    };
    /** 取回的时间。 */
    at: number;
}
export interface SuperagentClientOptions {
    /** 默认 http://127.0.0.1:3082 */
    baseUrl?: string;
    /** 单次请求超时，默认 3000ms —— 对面在 WSL，不能把面板拖住。 */
    timeoutMs?: number;
}
/**
 * 一张工单 → 紧凑形态。
 *
 * 只取「人要看」的字段，并把 `actions` 对象摊平成两个布尔——
 * 面板据此决定画不画按钮，而不是自己猜 superagent 的语义。
 */
export declare function compactTicket(raw: unknown): SuperagentTicket | undefined;
/** 从 `GET state` + `GET tickets` 组合出面板要的概览。 */
export declare function buildOverview(baseUrl: string, state: unknown, ticketsPayload: unknown, now: number): SuperagentOverview;
export declare class SuperagentClient {
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly clock;
    constructor(options?: SuperagentClientOptions & {
        now?: () => number;
    });
    get base(): string;
    /** 单次 GET。失败返回 undefined，不抛。 */
    private getJson;
    /**
     * 面板概览。不可达时返回 `{ reachable: false }`，而不是抛错。
     *
     * state 与 tickets 并发取；任一失败都按「不可达」处理（tickets 失败但 state 成功时
     * 仍然返回 reachable: true + 空工单，因为那说明只是在改面板路由）。
     */
    overview(): Promise<SuperagentOverview>;
    /** 只取工单列表（面板刷新用）。 */
    tickets(): Promise<{
        reachable: boolean;
        tickets: SuperagentTicket[];
        error?: string;
    }>;
    /**
     * 文档认可的写操作：暂停/继续、单张工单 retry / stop。
     *
     * 只放行这三个，其余一律拒绝——不给面板留任意请求的洞。
     */
    act(action: 'pause' | 'resume' | 'retry' | 'stop', ticketId?: string): Promise<{
        ok: boolean;
        status?: number;
        error?: string;
    }>;
}
