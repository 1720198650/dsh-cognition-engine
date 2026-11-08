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
const DEFAULT_BASE = 'http://127.0.0.1:3082';
const DEFAULT_TIMEOUT = 3000;
/** superagent 要求这个头；缺了或 Origin 不对会被 403。 */
const REQUEST_HEADER = { 'x-orchestrator-request': '1' };
const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
const asArray = (value) => (Array.isArray(value) ? value : []);
const asString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
/**
 * 一张工单 → 紧凑形态。
 *
 * 只取「人要看」的字段，并把 `actions` 对象摊平成两个布尔——
 * 面板据此决定画不画按钮，而不是自己猜 superagent 的语义。
 */
export function compactTicket(raw) {
    const item = asRecord(raw);
    if (item === undefined)
        return undefined;
    const id = asString(item.id);
    if (id.length === 0)
        return undefined;
    const actions = asRecord(item.actions);
    return {
        id,
        title: asString(item.title, '(无标题)'),
        state: asString(item.state, 'unknown'),
        ...(typeof item.stage === 'string' ? { stage: item.stage } : {}),
        ...(typeof item.action === 'string' ? { action: item.action } : {}),
        ...(typeof item.strength === 'string' ? { strength: item.strength } : {}),
        ...(asNumber(item.assignments) === undefined ? {} : { assignments: asNumber(item.assignments) }),
        ...(asNumber(item.inputs) === undefined ? {} : { inputs: asNumber(item.inputs) }),
        ...(asNumber(item.undelivered) === undefined ? {} : { undelivered: asNumber(item.undelivered) }),
        ...(typeof item.sessionId === 'string' ? { sessionId: item.sessionId } : {}),
        canRetry: actions?.retry === true,
        canStop: actions?.stop === true,
    };
}
/** 从 `GET state` + `GET tickets` 组合出面板要的概览。 */
export function buildOverview(baseUrl, state, ticketsPayload, now) {
    const s = asRecord(state) ?? {};
    const healthRaw = asRecord(s.health) ?? {};
    const health = Object.entries(healthRaw).map(([name, value]) => {
        const entry = asRecord(value) ?? {};
        return {
            name,
            state: asString(entry.state, 'unknown'),
            ...(typeof entry.detail === 'string' && entry.detail.length > 0 ? { detail: entry.detail } : {}),
        };
    });
    // starting 不算异常：刚重启时会有几秒。
    const unhealthy = health.filter((item) => item.state !== 'ready' && item.state !== 'starting');
    const tickets = asArray(asRecord(ticketsPayload)?.items)
        .map(compactTicket)
        .filter((item) => item !== undefined);
    const counts = { total: tickets.length, needsPerson: 0, working: 0, idle: 0 };
    for (const ticket of tickets) {
        if (ticket.stage === 'person')
            counts.needsPerson += 1;
        else if (ticket.stage === 'working')
            counts.working += 1;
        else if (ticket.stage === 'idle')
            counts.idle += 1;
    }
    const loadRaw = asRecord(s.load);
    return {
        reachable: true,
        baseUrl,
        ...(typeof s.paused === 'boolean' ? { paused: s.paused } : {}),
        ...(loadRaw === undefined
            ? {}
            : {
                load: {
                    running: asNumber(loadRaw.running) ?? 0,
                    queued: asNumber(loadRaw.queued) ?? 0,
                    maxWorkers: asNumber(loadRaw.maxWorkers) ?? 0,
                },
            }),
        health,
        unhealthy,
        tickets,
        counts,
        at: now,
    };
}
export class SuperagentClient {
    baseUrl;
    timeoutMs;
    clock;
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
        this.clock = options.now ?? (() => Date.now());
    }
    get base() {
        return this.baseUrl;
    }
    /** 单次 GET。失败返回 undefined，不抛。 */
    async getJson(path, timeoutMs) {
        try {
            const res = await fetch(`${this.baseUrl}/orchestrator/api/${path}`, {
                headers: REQUEST_HEADER,
                signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
            });
            if (!res.ok)
                return undefined;
            return (await res.json());
        }
        catch {
            return undefined;
        }
    }
    /**
     * 面板概览。不可达时返回 `{ reachable: false }`，而不是抛错。
     *
     * state 与 tickets 并发取；任一失败都按「不可达」处理（tickets 失败但 state 成功时
     * 仍然返回 reachable: true + 空工单，因为那说明只是在改面板路由）。
     */
    async overview() {
        const now = this.clock();
        const [state, tickets] = await Promise.all([this.getJson('state'), this.getJson('tickets')]);
        if (state === undefined) {
            return {
                reachable: false,
                error: `连不上 ${this.baseUrl}（superagent 没起，或 WSL 端口没通）`,
                baseUrl: this.baseUrl,
                at: now,
            };
        }
        return buildOverview(this.baseUrl, state, tickets, now);
    }
    /** 只取工单列表（面板刷新用）。 */
    async tickets() {
        const payload = await this.getJson('tickets');
        if (payload === undefined) {
            return { reachable: false, tickets: [], error: `连不上 ${this.baseUrl}` };
        }
        const tickets = asArray(asRecord(payload)?.items)
            .map(compactTicket)
            .filter((item) => item !== undefined);
        return { reachable: true, tickets };
    }
    /**
     * 文档认可的写操作：暂停/继续、单张工单 retry / stop。
     *
     * 只放行这三个，其余一律拒绝——不给面板留任意请求的洞。
     */
    async act(action, ticketId) {
        let path;
        let method = 'POST';
        let body;
        switch (action) {
            case 'pause':
            case 'resume':
                path = 'executor/pause';
                body = JSON.stringify({ paused: action === 'pause' });
                break;
            case 'retry':
            case 'stop':
                if (ticketId === undefined || ticketId.length === 0)
                    return { ok: false, error: '缺少 ticket id' };
                path = `tickets/${encodeURIComponent(ticketId)}/${action}`;
                break;
            default:
                return { ok: false, error: `不支持的动作 ${String(action)}` };
        }
        try {
            const res = await fetch(`${this.baseUrl}/orchestrator/api/${path}`, {
                method,
                headers: { ...REQUEST_HEADER, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
                ...(body === undefined ? {} : { body }),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            if (!res.ok) {
                let detail = '';
                try {
                    const json = (await res.json());
                    detail = asString(json.error);
                }
                catch {
                    /* 忽略 */
                }
                return { ok: false, status: res.status, ...(detail.length > 0 ? { error: detail } : {}) };
            }
            return { ok: true, status: res.status };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
}
