/**
 * src/index.ts — cognition-engine 的 DSH（Cordis）插件总入口
 *
 * 导出形式：`export function apply(ctx, config)` + `export const inject = ['tools']`。
 * 插件在 apply 里用 ctx.effect 注册四个工具，并返回清理函数，符合 DSH 插件生命周期约定。
 *
 * 四个工具：
 *   cognition_remember  写入一条双时态记忆（可指定 validFrom / supersedes）
 *   cognition_recall    按 strict / historical / belief 三种时间口径召回
 *   cognition_reflect   三段式辩证反思（thesis → antithesis → synthesis，串行三次）
 *   cognition_state     记忆与图式网络统计
 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { TemporalMemoryStore } from "./memory.js";
import { JsonStateStore } from "./persist.js";
import { buildDetail, buildCoreDigest } from "./views.js";
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker } from "./reflection.js";
import { assertObjectSchema, messageOf, parseMoment } from "./util.js";
import { createTools } from "./tools.js";
import { ProactiveGate } from "./proactive.js";
import { LongHorizonTaskManager } from "./task_manager.js";
import { AuditLog } from "./audit.js";
import { PlaybookStore } from "./playbook.js";
import { TopicStore } from "./topics.js";
import { buildDistillPrompt, parseDistillResult } from "./distill.js";
export function normalizeReflectionMode(value) {
    if (value === 'local' || value === 'real' || value === 'off')
        return value;
    // 任何无法识别的值都退回关闭——默认产出模板内容比不产出更糟。
    return 'off';
}
export const name = 'cognition-engine';
/** 需要 tools 服务才能注册工具。 */
export const inject = ['tools'];
/**
 * 解析访问口令。
 *
 * 当前行为：
 *   - config.lockToken 显式传字符串 → 用它上锁
 *   - 其他情况（含显式传空串）      → 不上锁
 *
 * 为什么不默认自动生成：早期版本会生成口令写到数据文件旁边，
 * 那对同机进程毫无防护作用，只会把页面自己的写操作挡在门外。
 * 想防同机其他程序读记忆正文，必须自己配一个口令。
 */
function resolveLockToken(config) {
    if (typeof config.lockToken === 'string' && config.lockToken.trim().length > 0) {
        return config.lockToken.trim();
    }
    return null;
}
const HOUR_MS = 60 * 60 * 1000;
function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeConfig(raw) {
    const config = (raw ?? {});
    return {
        decayHalfLifeHours: numberOr(config.decayHalfLifeHours, 168),
        strictThreshold: numberOr(config.strictThreshold, 0.12),
        assimilateThreshold: numberOr(config.assimilateThreshold, 0.55),
        overlapThreshold: numberOr(config.overlapThreshold, 0.42),
        communityThreshold: numberOr(config.communityThreshold, 0.3),
        maxClusterSize: Math.max(1, Math.round(numberOr(config.maxClusterSize, 8))),
        injectMemory: config.injectMemory !== false,
        playbookChars: Math.max(200, Math.round(numberOr(config.playbookChars, 600))),
        playbookMaxEntries: Math.max(1, Math.round(numberOr(config.playbookMaxEntries, 12))),
        autoReflect: config.autoReflect === true,
        reflectionEffort: config.reflectionEffort ?? '',
        heartbeatHours: Math.max(0.01, numberOr(config.heartbeatHours, 6)),
        patrolIntervalHours: Math.max(0.01, numberOr(config.patrolIntervalHours, 3)),
        idleThresholdMinutes: Math.max(0.1, numberOr(config.idleThresholdMinutes, 5)),
        recordOnly: config.recordOnly !== false,
        tasksFile: typeof config.tasksFile === 'string' && config.tasksFile.trim().length > 0
            ? config.tasksFile
            : undefined,
        stateFile: typeof config.stateFile === 'string' && config.stateFile.trim().length > 0
            ? config.stateFile
            : undefined,
        playbookFile: typeof config.playbookFile === 'string' && config.playbookFile.trim().length > 0
            ? config.playbookFile
            : undefined,
        topicsFile: typeof config.topicsFile === 'string' && config.topicsFile.trim().length > 0
            ? config.topicsFile
            : undefined,
        lockToken: typeof config.lockToken === 'string' && config.lockToken.trim().length > 0
            ? config.lockToken
            : undefined,
        llmProvider: typeof config.llmProvider === 'string' && config.llmProvider.trim().length > 0
            ? config.llmProvider
            : undefined,
        llmModel: typeof config.llmModel === 'string' && config.llmModel.trim().length > 0
            ? config.llmModel
            : undefined,
        reflectionMode: normalizeReflectionMode(config.reflectionMode),
    };
}
/**
 * 反思回写记忆（Generative Agents 的闭环）：把 synthesis 存成一条可召回的记忆，
 * 并让结论也进图式网络，这样以后 expand 能把相关结论带出来。
 */
export function persistReflection(memory, result) {
    const subject = `结论:${result.query}`.slice(0, 60);
    const fact = memory.ingest({
        content: result.synthesis,
        subject,
        tags: ['reflection'],
        // 用独立来源标记，便于一次性清理：cognition_forget({ source: 'reflection' })
        source: 'reflection',
        importance: 0.6,
    });
    return fact;
}
/* ------------------------------------------------------------------ */
/* 插件入口                                                            */
/* ------------------------------------------------------------------ */
export function apply(ctx, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const audit = new AuditLog();
    const playbook = new PlaybookStore({
        ...(config.playbookFile === undefined ? {} : { filePath: config.playbookFile }),
        maxChars: config.playbookChars,
        maxEntries: config.playbookMaxEntries,
        // 来源校验：sourceIds 必须真实存在，防止模型臆造出处
        validateSourceIds: (ids) => ids.filter((id) => memory.get(id) !== undefined),
    });
    const topics = new TopicStore({
        ...(config.topicsFile === undefined ? {} : { filePath: config.topicsFile }),
    });
    const memory = new TemporalMemoryStore({
        halfLifeMs: config.decayHalfLifeHours * HOUR_MS,
        onEvent: (event) => audit.append(event),
    });
    /** 从存档恢复出来的模式（在 reflectionMode 声明前捕获）。 */
    let restoredReflectionMode;
    // —— 落盘：记忆 ——
    const stateStore = new JsonStateStore({
        ...(config.stateFile === undefined ? {} : { filePath: config.stateFile }),
        serialize: () => ({ version: 1, facts: memory.serialize(), reflectionMode, rules: { ...memory.getRules() } }),
        restore: (data) => {
            if (Array.isArray(data.facts))
                memory.restore(data.facts);
            if (typeof data.reflectionMode === 'string')
                restoredReflectionMode = normalizeReflectionMode(data.reflectionMode);
            // 兼容旧存档：realModel: true 等价于 real
            else if (data.realModel === true)
                restoredReflectionMode = 'real';
            if (data.rules !== undefined)
                memory.setRules(data.rules);
        },
    });
    try {
        playbook.loadSync();
        topics.loadSync();
        if (stateStore.loadSync()) {
            ctx.logger?.info?.(`cognition-engine: 已从磁盘恢复 ${memory.size} 条记忆`);
        }
    }
    catch (error) {
        ctx.logger?.warn?.(`cognition-engine: 状态恢复失败 ${messageOf(error)}`);
    }
    /** 任何写入之后调用一次，合并延迟落盘。 */
    const touch = () => stateStore.schedule();
    // —— 真模型开关 ——
    const mockLLM = new MockDialecticalLLM();
    let reflectionMode = restoredReflectionMode ?? normalizeReflectionMode(config.reflectionMode);
    /**
     * 巡逻发现逾期任务时是否自动跑模型复盘。
     *
     * 默认关闭：一次完整三段式复盘 = 3 次模型调用 ≈ 3100 tokens，
     * 每 patrolIntervalHours（默认 3 小时）就可能触发一次，一天最多 8 次。
     * 关掉后巡逻仍会写「已超期 N 小时」的提示，只是不烧 token。
     */
    let autoReflect = config.autoReflect === true;
    /** 反思/蒸馏用的推理档位；空串表示「自动（最低）」。 */
    let reflectionEffort = config.reflectionEffort ?? '';
    /** 当前模型声明的档位，启动后异步填充，供页面显示。 */
    let availableEfforts = [];
    /** 探测一次模型能力，失败就当宿主不支持，不影响主流程。 */
    const refreshEfforts = async () => {
        const service = ctx.get?.('llm');
        const { provider, model } = resolveModel();
        if (service === undefined || provider === '' || model === '')
            return;
        const efforts = await probeEfforts(service, provider, model);
        if (efforts !== null)
            availableEfforts = efforts;
    };
    /** 上锁口令；null 表示未上锁。 */
    let lockToken = resolveLockToken(config);
    /** 用户是否显式配置了口令（决定 /detail 是否要鉴权）。 */
    const explicitLock = typeof config.lockToken === 'string' && config.lockToken.trim().length > 0;
    const resolveModel = () => {
        if (config.llmProvider !== undefined && config.llmModel !== undefined) {
            return { provider: config.llmProvider, model: config.llmModel };
        }
        const host = ctx.get?.('agentDefaultModel');
        const selection = host?.currentSelection?.();
        return { provider: selection?.provider ?? '', model: selection?.model ?? '' };
    };
    /**
     * 查询当前模型声明的推理档位，并缓存。
     *
     * 返回 null 表示宿主不提供能力查询（老版本），调用方按默认档位走。
     */
    const probeEfforts = async (llm, provider, model) => {
        try {
            if (typeof llm.resolveModelInfo !== 'function')
                return null;
            const info = await llm.resolveModelInfo(provider, model);
            return (info?.reasoning?.efforts ?? []).map((effort) => effort.id);
        }
        catch {
            return null;
        }
    };
    /**
     * 决定这次调用用哪个推理档位。
     *
     * `reflectionEffort` 为空表示「自动」——选最低档，因为反思与蒸馏都是
     * 按格式输出结构化结果的任务，不需要长链推理，而推理 token 和正文抢同一个预算。
     */
    const resolveEffort = async (llm, provider, model) => {
        if (reflectionEffort !== undefined && reflectionEffort !== '')
            return reflectionEffort;
        const efforts = await probeEfforts(llm, provider, model);
        if (efforts === null || efforts.length === 0)
            return undefined;
        return efforts.find((id) => /minimal|none|off|low|fast|light/i.test(id)) ?? efforts[0];
    };
    const callRealModel = async (prompt, maxTokens = 4000) => {
        const llm = ctx.get?.('llm');
        if (llm === undefined || typeof llm.stream !== 'function')
            throw new Error('llm 服务不可用');
        const { provider, model } = resolveModel();
        if (provider === '' || model === '') {
            throw new Error('未找到可用模型：请在 cordis.patch.yml 设 llmProvider / llmModel');
        }
        // 推理档位压到最低：这些任务是格式化的结构化输出，不需要长链推理，
        // 而推理 token 和正文抢同一个 maxTokens 预算。
        const reasoningEffort = await resolveEffort(llm, provider, model);
        let text = '';
        let reasoning = '';
        let hitMaxTokens = false;
        // 诊断用：记录收到过哪些 chunk 类型，空内容时能说清是模型没吐字还是字段名对不上。
        const seen = new Map();
        for await (const chunk of llm.stream({
            provider,
            model,
            maxTokens,
            ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
            // 单段最多等 90 秒，避免模型卡住把整个反思流程挂死
            signal: AbortSignal.timeout(90_000),
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        })) {
            const type = String(chunk.type ?? 'unknown');
            seen.set(type, (seen.get(type) ?? 0) + 1);
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string')
                text += chunk.text;
            if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string')
                reasoning += chunk.text;
            if (chunk.type === 'finish') {
                if (chunk.reason?.kind === 'error')
                    throw new Error('模型返回错误');
                if (chunk.reason?.kind === 'max-tokens')
                    hitMaxTokens = true;
            }
        }
        if (text.trim().length === 0) {
            // 只出推理不出正文 = 预算被思考过程吃光，不是模型故障。
            if (reasoning.length > 0 || hitMaxTokens) {
                throw new Error(`模型只输出了推理过程（${reasoning.length} 字${hitMaxTokens ? '，已触及 maxTokens 上限' : ''}），` +
                    `正文被 token 预算截断。已尝试推理档位 ${reasoningEffort ?? '默认'}；调大 maxTokens（当前 ${maxTokens}）后重试。`);
            }
            const shapes = [...seen.entries()].map(([type, count]) => `${type}×${count}`).join(', ');
            throw new Error(`模型返回空内容（收到 chunk：${shapes.length > 0 ? shapes : '无'}）`);
        }
        return text;
    };
    /**
     * 准则蒸馏：从未被覆盖的记忆里提炼候选，并给现有准则打标记。
     *
     * 不直接改准则——候选进 pending，标记直接生效（标记可以随时改回来，风险低）。
     */
    const runDistill = async (options = {}) => {
        if (reflectionMode === 'off') {
            throw new Error('反思引擎未开启：准则蒸馏需要真实模型，请在设置页切到「真实模型」');
        }
        if (reflectionMode === 'local') {
            throw new Error('本地占位引擎无法蒸馏准则：它只会输出固定模板，请切换到「真实模型」');
        }
        // 已被任何准则引用过的记忆不再重复喂给模型
        const referenced = new Set(playbook.all().flatMap((entry) => entry.sourceIds));
        const uncovered = memory
            .all()
            .filter((fact) => fact.deletedAt === undefined && fact.supersededAt === null && !fact.archived)
            .filter((fact) => !referenced.has(fact.id))
            .sort((a, b) => b.importance - a.importance || b.recordedAt - a.recordedAt)
            .slice(0, 20)
            .map((fact) => ({ id: fact.id, subject: fact.subject, content: fact.content }));
        const prompt = buildDistillPrompt({
            entries: playbook.all(),
            memories: uncovered,
            maxCandidates: options.maxCandidates ?? 5,
        });
        const raw = await callRealModel(prompt);
        const parsed = parseDistillResult(raw);
        // 标记直接生效：helpful/harmful 可以再改，风险低
        let marked = 0;
        for (const item of parsed.marks) {
            if (playbook.mark(item.id, item.mark))
                marked += 1;
        }
        // 候选进 pending，必须人工审核
        const submitted = [];
        for (const candidate of parsed.candidates) {
            // 相对表达（"7d"）与 ISO 日期都由 parseMoment 归一成毫秒；解析不了就当长期有效。
            const validTo = candidate.validUntil === undefined ? null : (parseMoment(candidate.validUntil) ?? null);
            const outcome = playbook.submit({
                section: candidate.section,
                content: candidate.content,
                sourceIds: candidate.sourceIds,
                validTo,
            });
            submitted.push({
                content: candidate.content,
                section: candidate.section ?? '未分类',
                accepted: outcome.accepted,
                ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
                ...(outcome.entry === undefined ? {} : { id: outcome.entry.id }),
                ...(validTo === null ? {} : { validTo }),
                ...(outcome.entry?.conflictWith === undefined ? {} : { conflictWith: outcome.entry.conflictWith }),
            });
        }
        await playbook.flush();
        return {
            reflection: parsed.reflection,
            marked,
            candidates: submitted,
            uncoveredMemories: uncovered.length,
            parseFailed: parsed.raw !== undefined,
            // 解析失败时把模型原文前 600 字带出来，否则无法判断是格式问题还是内容问题。
            ...(parsed.raw === undefined
                ? {}
                : {
                    rawLength: parsed.raw.length,
                    rawTail: parsed.raw.slice(-120),
                    rawPreview: parsed.raw.slice(0, 300),
                }),
            stats: playbook.stats(),
        };
    };
    /**
     * 三道约束里的「拦截」与「审计」。
     *
     * 'tools/pre-execute' 是宿主给的真拦截点（waterfall，可返回 { kind: 'deny' }）。
     * 这里做两件事：
     *   - enforce=true 的准则违反 → 直接拒绝这次工具调用
     *   - audit=true   的准则违反 → 记一次违反（不拦），写进条目计数与审计日志
     * 勾了「自查」的条目走提示词，不走事件。
     *
     * 老版本宿主没有事件能力时整段静默跳过，准则本退化为纯提醒。
     */
    const installToolGuards = () => {
        const on = ctx.on;
        if (typeof on !== 'function')
            return;
        const handler = async (exec, next) => {
            // 没有启用任何拦截/审计时直接放行，避免每次调用都走一遍判定
            const stats = playbook.stats();
            if (stats.enforced === 0 && stats.audited === 0)
                return next();
            const record = exec;
            // 「工具名 + 参数 JSON」一起参与匹配：准则可能要判工具名，也可能要判命令内容
            const text = `${String(record.name ?? '')} ${JSON.stringify(record.arguments ?? {})}`;
            const { blocked, violated } = playbook.checkToolCall(text);
            if (violated.length === 0)
                return next();
            for (const entry of violated) {
                playbook.recordViolation(entry.id);
                audit.append({
                    op: 'playbook.violation',
                    id: entry.id,
                    subject: entry.section,
                    origin: 'agent_tool',
                    detail: `${entry.enforce ? '已拦截' : '仅记录'}：${String(record.name ?? '')}`,
                });
            }
            void playbook.flush();
            if (blocked.length > 0) {
                const list = blocked.map((entry) => `[${entry.id}] ${entry.content}`).join('；');
                return {
                    kind: 'deny',
                    reason: `违反准则，调用被拒绝：${list}。补齐后再试，或在设置页停掉这条准则。`,
                };
            }
            return next();
        };
        try {
            on.call(ctx, 'tools/pre-execute', handler);
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 准则拦截注册失败 ${messageOf(error)}`);
        }
    };
    installToolGuards();
    const reflection = new DialecticalReflectionEngine((prompt, phase) => reflectionMode === 'real'
        ? callRealModel(prompt)
        : reflectionMode === 'local'
            // 不在中间产物上加警示：它会作为下一阶段的输入，会被模型当成正文引用。
            // 警示统一在工具层按模式补。
            ? Promise.resolve(mockLLM.call(prompt, phase))
            : Promise.reject(new Error('反思引擎未开启：请在设置页开启，或直接回答而不调用 cognition_reflect')));
    const worker = new ReflectionWorker(reflection, 1);
    const proactive = new ProactiveGate({
        idleThresholdMs: config.idleThresholdMinutes * 60_000,
        recordOnly: config.recordOnly,
    });
    const taskManager = new LongHorizonTaskManager({
        ...(config.tasksFile === undefined ? {} : { filePath: config.tasksFile }),
        heartbeatMs: config.heartbeatHours * 60 * 60 * 1000,
    });
    const tasksReady = taskManager.load().catch((error) => {
        ctx.logger?.warn?.(`cognition-engine: tasks.json 恢复失败 ${messageOf(error)}`);
    });
    const tools = (ctx.get?.('tools') ?? ctx.tools);
    if (tools === undefined || typeof tools.register !== 'function') {
        ctx.logger?.warn?.('cognition-engine: 未找到 tools 服务，插件未注册任何工具');
        return undefined;
    }
    let disposed = false;
    const disposers = [];
    /**
     * 计算「本轮注入到系统提示的上下文」。
     *
     * 注入与面板上的「注入来源」共用这一个函数——之前是两套各写一遍的代码，
     * 结果注入段只拼了记忆摘要、统计段却按准则本判断，面板报「正在注入准则本」
     * 而模型实际只看到记忆摘要。这类「显示与实际不一致」的 bug 单靠测试抓不到，
     * 只能靠两者同源来根治。
     *
     * 优先级：准则本 > 记忆摘要 > 不注入。两者不叠加——ACE 与 DC 都说明
     * 上下文越长越容易稀释信号。
     */
    const buildInjectedContext = () => {
        const section = playbook.renderSection(undefined, (id) => topics.get(id)?.name);
        if (section.length > 0)
            return { text: section, source: 'playbook' };
        const digest = buildCoreDigest(memory);
        if (digest.length > 0) {
            return { text: `${digest}\n（需要细节时调用 cognition_recall。）`, source: 'digest' };
        }
        return { text: '', source: 'none' };
    };
    /** 页面可视化用的快照（纯 JSON，客户端每 2 秒拉一次）。 */
    const snapshot = () => {
        return {
            memory: memory.stats(),
            /** 标记为 test 的事实条数：页面上用来提醒「这些不是真事」。 */
            samples: memory.all().filter((fact) => fact.source === 'test').length,
            tasks: {
                pending: taskManager.get_pending_tasks().length,
                due: taskManager.check_due_tasks().length,
            },
            proactive: {
                pending: proactive.pending().length,
                recordOnly: proactive.isRecordOnly,
            },
            model: (() => {
                const resolved = resolveModel();
                return {
                    enabled: reflectionMode !== 'off',
                    mode: reflectionMode,
                    autoReflect,
                    effort: reflectionEffort,
                    efforts: availableEfforts,
                    provider: resolved.provider,
                    model: resolved.model,
                    available: resolved.provider !== '' && resolved.model !== '',
                };
            })(),
            locked: lockToken !== null,
            storageFile: basename(stateStore.path),
            playbook: {
                ...playbook.stats(),
                /** 当前注入的是准则本、原始记忆摘要，还是都不注入（与注入段同源）。 */
                injectSource: buildInjectedContext().source,
            },
            topics: topics.stats(),
            storageWarning: stateStore.warning,
            rules: memory.getRules(),
            updatedAt: Date.now(),
        };
    };
    /** 面板展开时按需拉取的明细（不走模型上下文，只给页面看）。 */
    // 准则本指标也放进 detail：页面页签的数字统一从 detail 取，
    // 之前只放在 /state 里，导致「准则」页签后面永远没有数字。
    const detail = () => ({
        ...buildDetail({ memory, taskManager }),
        playbook: playbook.stats(),
        topics: {
            list: topics.all(),
            stats: topics.stats(),
            /** 未归类计数：没有 topicIds 的就是未归类。 */
            unclassified: {
                memories: memory.all().filter((f) => f.deletedAt === undefined && f.topicIds.length === 0).length,
                rules: playbook.all().filter((e) => e.status !== 'retired' && e.topicIds.length === 0).length,
            },
        },
    });
    // 宿主 → 页面 的数据桥：Client 半区 fetch('/cognition-engine/state')
    // 注意：不能放在 /api 前缀下——那条前缀归 API 网关所有，会先被它 401 掉。
    const setupRoutes = (webServer) => {
        const send = (response, status, body) => {
            response.writeHead(status, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
            });
            response.end(JSON.stringify(body));
        };
        /** 上锁后，受保护路由要求 x-cognition-token 请求头。 */
        const authorized = (request) => {
            if (lockToken === null)
                return true;
            const headers = request.headers ?? {};
            const raw = headers['x-cognition-token'];
            const value = Array.isArray(raw) ? raw[0] : raw;
            return value === lockToken;
        };
        /** 注册一条路由：统一方法校验、鉴权与错误转换，避免每个 handler 各写一份。 */
        const route = (path, produce, options = {}) => {
            const method = options.method ?? 'GET';
            const requireAuth = options.requireAuth === true;
            try {
                disposers.push(webServer.register({
                    kind: 'exact',
                    path,
                    handler: async (request, response) => {
                        try {
                            const req = request;
                            if ((req.method ?? 'GET').toUpperCase() !== method) {
                                send(response, 405, { error: 'method not allowed' });
                                return;
                            }
                            if (requireAuth && !authorized(request)) {
                                send(response, 401, { error: 'unauthorized' });
                                return;
                            }
                            send(response, 200, await produce(new URL(req.url ?? path, 'http://local')));
                        }
                        catch (error) {
                            send(response, 500, { error: messageOf(error) });
                        }
                    },
                }));
            }
            catch (error) {
                // 路由被别的插件占用：跳过，不能把插件加载搞挂
                ctx.logger?.warn?.(`cognition-engine: 路由 ${path} 注册失败（可能与其他插件冲突）: ${messageOf(error)}`);
            }
        };
        route('/cognition-engine/state', () => snapshot());
        // 读取记忆默认开放（令牌文件本就可被同机进程读取，锁读取只增加摩擦）；
        // 显式配置 lockToken 时才保护详情。写操作（clear/model/lock）始终需要口令。
        route('/cognition-engine/detail', () => detail(), { requireAuth: explicitLock });
        /** 读 ?name=true 这类布尔开关。 */
        const flag = (url, name) => url.searchParams.get(name) === 'true';
        // 清空：scope = memory / all
        route('/cognition-engine/clear', (url) => {
            const scope = url.searchParams.get('scope') ?? 'memory';
            if (scope !== 'memory' && scope !== 'all') {
                throw new Error('scope 只能是 memory / all');
            }
            let removed = 0;
            removed = memory.all().length;
            for (const fact of memory.all())
                memory.remove(fact.id);
            void stateStore.flush();
            return { cleared: 'memory', removed, memory: memory.stats() };
        }, { method: 'POST', requireAuth: true });
        // 真模型开关
        route('/cognition-engine/model', (url) => {
            // 两个参数各自独立：只传一个时不能把另一个重置掉。
            // （早期写法无条件 normalizeReflectionMode(null)，传 autoReflect 会顺手把引擎关成 off。）
            const mode = url.searchParams.get('mode');
            if (mode !== null)
                reflectionMode = normalizeReflectionMode(mode);
            const auto = url.searchParams.get('autoReflect');
            if (auto !== null)
                autoReflect = auto === 'true' || auto === '1';
            // effort 传空串 = 回到「自动（最低）」
            const effort = url.searchParams.get('effort');
            if (effort !== null)
                reflectionEffort = effort;
            void stateStore.flush();
            const { provider, model } = resolveModel();
            return {
                enabled: reflectionMode !== 'off',
                mode: reflectionMode,
                autoReflect,
                effort: reflectionEffort,
                efforts: availableEfforts,
                provider,
                model,
                available: provider !== '' && model !== '',
            };
        }, { method: 'POST', requireAuth: true });
        // 界面直接新建任务（含时间段）
        route('/cognition-engine/task/create', async (url) => {
            const description = (url.searchParams.get('description') ?? '').trim();
            if (description.length === 0)
                throw new Error('description 不能为空');
            const s = url.searchParams.get('startAt');
            const e = url.searchParams.get('endAt');
            const rawTopics = url.searchParams.get('topicIds');
            const task = await taskManager.create_task(description, {
                ...(s === null ? {} : { startAt: Number(s) }),
                ...(e === null ? {} : { endAt: Number(e) }),
                ...(rawTopics === null
                    ? {}
                    : { topicIds: rawTopics.split(',').map((x) => x.trim()).filter((x) => x.length > 0) }),
            });
            return { task };
        }, { method: 'POST', requireAuth: explicitLock });
        // 调整任务顺序 / 并行
        route('/cognition-engine/task/meta', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const o = url.searchParams.get('order');
            const pl = url.searchParams.get('parallel');
            const task = await taskManager.set_meta(id, {
                ...(o === null ? {} : { order: Number(o) }),
                ...(pl === null ? {} : { parallel: pl === 'true' }),
            });
            if (task === undefined)
                throw new Error('任务不存在');
            return { task };
        }, { method: 'POST', requireAuth: explicitLock });
        // 归并同类记忆（手动触发）
        route('/cognition-engine/consolidate', () => {
            const groups = memory.consolidate();
            void stateStore.flush();
            return {
                groups: groups.length,
                merged: groups.reduce((sum, group) => sum + group.merged.length, 0),
                detail: groups,
            };
        }, { method: 'POST', requireAuth: explicitLock });
        // 删除任务
        route('/cognition-engine/task/delete', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const ok = await taskManager.delete_task(id);
            if (!ok)
                throw new Error('任务不存在');
            return { id, deleted: true };
        }, { method: 'POST', requireAuth: explicitLock });
        // 改任务状态（页面上的「开始 / 完成 / 重新打开」）
        route('/cognition-engine/task/status', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const status = url.searchParams.get('status') ?? '';
            if (status !== 'PENDING' && status !== 'IN_PROGRESS' && status !== 'COMPLETED') {
                throw new Error('status 只能是 PENDING / IN_PROGRESS / COMPLETED');
            }
            const clue = url.searchParams.get('clue');
            const task = await taskManager.update_task_progress(id, status, clue === null || clue.trim().length === 0 ? undefined : clue.trim());
            return { task };
        }, { method: 'POST', requireAuth: explicitLock });
        // 删除 / 恢复一条记忆（软删除）
        route('/cognition-engine/memory/delete', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const restore = url.searchParams.get('restore') === 'true';
            const ok = restore ? memory.restoreDeleted(id) : memory.softDelete(id);
            if (!ok)
                throw new Error(restore ? '没有可恢复的记忆' : '记忆不存在');
            void stateStore.flush();
            return { id, deleted: !restore };
        }, { method: 'POST', requireAuth: explicitLock });
        // 手动修正一条记忆
        route('/cognition-engine/memory/update', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const content = url.searchParams.get('content');
            const subject = url.searchParams.get('subject');
            const recordedAt = url.searchParams.get('recordedAt');
            const superseded = url.searchParams.get('superseded');
            const fact = memory.updateFact(id, {
                ...(content === null ? {} : { content }),
                ...(subject === null ? {} : { subject }),
                ...(recordedAt === null ? {} : { recordedAt: Number(recordedAt) }),
                ...(superseded === null ? {} : { superseded: superseded === 'true' }),
            });
            if (fact === undefined)
                throw new Error('记忆不存在');
            void stateStore.flush();
            return {
                id: fact.id,
                content: fact.content,
                recordedAt: fact.recordedAt,
                superseded: fact.supersededAt !== null,
            };
        }, { method: 'POST', requireAuth: explicitLock });
        // 界面直接写记忆
        route('/cognition-engine/memory/create', (url) => {
            const content = (url.searchParams.get('content') ?? '').trim();
            if (content.length === 0)
                throw new Error('content 不能为空');
            const subject = url.searchParams.get('subject') ?? undefined;
            const fact = memory.ingest({ content, subject, source: 'user', origin: 'ui' });
            void stateStore.flush();
            return { id: fact.id, subject: fact.subject };
        }, { method: 'POST', requireAuth: explicitLock });
        // 记忆准入规则：读 / 改
        route('/cognition-engine/rules', () => ({ rules: memory.getRules() }));
        route('/cognition-engine/rules/set', (url) => {
            const patch = {};
            for (const key of ['transient', 'sensitive', 'injection', 'authority']) {
                const v = url.searchParams.get(key);
                if (v !== null)
                    patch[key] = v === 'true';
            }
            memory.setRules(patch);
            void stateStore.flush();
            return { rules: memory.getRules() };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 主题（人定的适用范围键）——
        route('/cognition-engine/topics', () => {
            // 每个主题挂了多条记忆/准则——页面上要显示人话，不是裸 id
            const facts = memory.all().filter((f) => f.deletedAt === undefined);
            const rules = playbook.all().filter((e) => e.status !== 'retired');
            // 取全部任务：已完成的也要能看到，否则点「完成」后任务会凭空消失
            const allTasks = taskManager.all();
            return {
                stats: topics.stats(),
                list: topics.all().map((topic) => {
                    const owned = allTasks.filter((task) => (task.topicIds ?? []).includes(topic.id));
                    return {
                        ...topic,
                        memoryCount: facts.filter((f) => f.topicIds.includes(topic.id)).length,
                        ruleCount: rules.filter((e) => e.topicIds.includes(topic.id)).length,
                        taskCount: owned.length,
                        // 主题卡片上直接列出「进行中事项」，任务不再是孤立台账
                        tasks: owned.slice(0, 5).map((task) => ({ id: task.id, description: task.description, status: task.status })),
                    };
                }),
                unclassified: {
                    memories: memory.all().filter((f) => f.deletedAt === undefined && f.topicIds.length === 0).length,
                    rules: rules.filter((e) => e.topicIds.length === 0).length,
                },
            };
        });
        route('/cognition-engine/topics/add', async (url) => {
            const aliases = (url.searchParams.get('aliases') ?? '')
                .split(',')
                .map((a) => a.trim())
                .filter((a) => a.length > 0);
            const parent = url.searchParams.get('parentId');
            const result = topics.add({
                name: url.searchParams.get('name') ?? '',
                description: url.searchParams.get('description') ?? '',
                aliases,
                parentId: parent === null || parent.length === 0 ? null : parent,
            });
            if (typeof result === 'string')
                return { accepted: false, reason: result };
            await topics.flush();
            return { accepted: true, topic: result };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/topics/update', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const name = url.searchParams.get('name');
            const description = url.searchParams.get('description');
            const aliasesRaw = url.searchParams.get('aliases');
            const parentRaw = url.searchParams.get('parentId');
            const ok = topics.update(id, {
                ...(name === null ? {} : { name }),
                ...(description === null ? {} : { description }),
                ...(aliasesRaw === null
                    ? {}
                    : { aliases: aliasesRaw.split(',').map((a) => a.trim()).filter((a) => a.length > 0) }),
                ...(parentRaw === null ? {} : { parentId: parentRaw.length === 0 ? null : parentRaw }),
            });
            if (!ok)
                throw new Error('主题更新失败：不存在、重名或父级非法');
            await topics.flush();
            return { id, updated: true };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/topics/archive', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            if (!topics.archive(id))
                throw new Error('主题不存在');
            await topics.flush();
            return { id, archived: true };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/topics/assign', async (url) => {
            const targetType = url.searchParams.get('targetType') ?? '';
            const id = url.searchParams.get('id') ?? '';
            const topicIds = (url.searchParams.get('topicIds') ?? '')
                .split(',')
                .map((x) => x.trim())
                .filter((x) => x.length > 0);
            // 只允许挂到存在且未归档的主题，避免悬空引用
            const valid = topicIds.filter((tid) => topics.get(tid)?.status === 'active');
            if (targetType === 'memory') {
                memory.setTopics(id, valid);
                void stateStore.flush();
                return { targetType, id, topicIds: valid };
            }
            if (targetType === 'rule') {
                if (!playbook.setTopics(id, valid))
                    throw new Error('准则不存在');
                await playbook.flush();
                return { targetType, id, topicIds: valid };
            }
            if (targetType === 'task') {
                const task = await taskManager.set_meta(id, { topicIds: valid });
                if (task === undefined)
                    throw new Error('任务不存在');
                return { targetType, id, topicIds: valid };
            }
            throw new Error('targetType 只能是 memory / rule / task');
        }, { method: 'POST', requireAuth: explicitLock });
        // 只给候选，不落库——主题是人工确认的
        route('/cognition-engine/topics/suggest', (url) => {
            const text = url.searchParams.get('text') ?? '';
            return { suggestions: topics.match(text, 3) };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 准则蒸馏 ——
        route('/cognition-engine/playbook/distill', async (url) => {
            const raw = url.searchParams.get('maxCandidates');
            const maxCandidates = raw === null ? 5 : Math.max(1, Math.min(10, Number(raw)));
            return runDistill({ maxCandidates: Number.isFinite(maxCandidates) ? maxCandidates : 5 });
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 准则本 ——
        route('/cognition-engine/playbook', () => ({
            stats: playbook.stats(),
            // 带上计算出来的过期标记：页面不用自己算时间，也能正确分组到「已过期」
            entries: playbook.all().map((entry) => ({
                ...entry,
                expired: entry.status === 'active' && playbook.isExpired(entry),
            })),
            rendered: playbook.render(),
        }));
        route('/cognition-engine/playbook/candidate', async (url) => {
            const rawValidTo = url.searchParams.get('validTo');
            const outcome = playbook.submit({
                content: url.searchParams.get('content') ?? '',
                section: url.searchParams.get('section') ?? undefined,
                sourceIds: (url.searchParams.get('sourceIds') ?? '')
                    .split(',')
                    .map((id) => id.trim())
                    .filter((id) => id.length > 0),
                validTo: rawValidTo === null ? null : (parseMoment(rawValidTo) ?? null),
            });
            if (outcome.accepted)
                await playbook.flush();
            return outcome;
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/playbook/add', async (url) => {
            const outcome = playbook.addManual({
                content: url.searchParams.get('content') ?? '',
                section: url.searchParams.get('section') ?? undefined,
            });
            if (outcome.accepted)
                await playbook.flush();
            return outcome;
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/playbook/act', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const action = url.searchParams.get('action') ?? '';
            let ok = false;
            switch (action) {
                case 'accept':
                    ok = playbook.accept(id);
                    break;
                case 'reject':
                    ok = playbook.reject(id);
                    break;
                case 'retire':
                    ok = playbook.retire(id, '手动停用');
                    break;
                case 'revive':
                    ok = playbook.revive(id);
                    break;
                case 'revise':
                    ok = playbook.revise(id, url.searchParams.get('content') ?? '');
                    break;
                case 'extend': {
                    const raw = url.searchParams.get('validTo');
                    ok = playbook.extend(id, raw === null ? null : (parseMoment(raw) ?? null));
                    break;
                }
                case 'helpful':
                    ok = playbook.mark(id, 'helpful');
                    break;
                case 'harmful':
                    ok = playbook.mark(id, 'harmful');
                    break;
                // 永久删除（任意状态）。停用只是不注入，删除是当它没存在过。
                case 'delete':
                    ok = playbook.remove(id);
                    break;
                // 三道约束开关：只改传了的项，没传的保持原值
                case 'flags': {
                    const bool = (name) => {
                        const value = url.searchParams.get(name);
                        return value === null ? undefined : value === 'true' || value === '1';
                    };
                    const str = (name) => url.searchParams.get(name) ?? undefined;
                    ok = playbook.setFlags(id, {
                        guard: bool('guard'),
                        enforce: bool('enforce'),
                        audit: bool('audit'),
                        trigger: str('trigger'),
                        required: str('required'),
                    });
                    break;
                }
                default:
                    throw new Error('action 只能是 accept/reject/retire/revive/revise/extend/helpful/harmful/delete/flags');
            }
            if (!ok)
                throw new Error(`准则本操作失败：${action} ${id}`);
            await playbook.flush();
            return { id, action, ok };
        }, { method: 'POST', requireAuth: explicitLock });
        // 当前实际注入到系统提示的内容（排查「面板说有、模型看不到」这类问题用）
        route('/cognition-engine/injected', () => {
            const { text, source } = buildInjectedContext();
            return { source, chars: text.length, text };
        });
        // 审计日志（最近 N 条）
        route('/cognition-engine/audit', async (url) => {
            const raw = url.searchParams.get('limit');
            const limit = raw === null ? 20 : Number(raw);
            const lines = await audit.tail(Number.isFinite(limit) ? limit : 20);
            return {
                path: audit.path,
                count: lines.length,
                items: lines.map((line) => {
                    try {
                        return JSON.parse(line);
                    }
                    catch {
                        return { raw: line };
                    }
                }),
            };
        });
        // 快照列表与回滚
        route('/cognition-engine/snapshots', async () => ({ items: await stateStore.listSnapshots() }));
        route('/cognition-engine/snapshot/restore', async (url) => {
            const name = url.searchParams.get('name') ?? '';
            const ok = await stateStore.restoreSnapshot(name);
            if (!ok)
                throw new Error('快照不存在或名称非法');
            stateStore.clearWarning();
            return { restored: name };
        }, { method: 'POST', requireAuth: explicitLock });
        // 导出：整库记忆（JSON）
        route('/cognition-engine/export', () => ({
            version: 1,
            exportedAt: Date.now(),
            facts: memory.serialize(),
        }));
        // 导入：用请求体里的 JSON 整体替换记忆库
        route('/cognition-engine/import', (url) => {
            const raw = url.searchParams.get('payload');
            if (raw === null || raw.length === 0)
                throw new Error('缺少 payload');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.facts))
                throw new Error('payload.facts 必须是数组');
            for (const fact of memory.all())
                memory.remove(fact.id);
            // 导入的条目统一标成 import 通道，避免外部内容冒充用户陈述
            const imported = parsed.facts.map((fact) => ({
                ...fact,
                origin: 'import',
            }));
            memory.restore(imported);
            void stateStore.flush();
            return { imported: memory.stats().total };
        }, { method: 'POST', requireAuth: explicitLock });
        // 上锁开关：开启时返回口令，页面用它设置 x-cognition-token
        route('/cognition-engine/lock', (url) => {
            lockToken = flag(url, 'enabled') ? (config.lockToken ?? randomUUID()) : null;
            return { locked: lockToken !== null, token: lockToken };
        }, 
        // 自动生成的口令可自助开关；用户显式配置口令时才要求鉴权
        { method: 'POST', requireAuth: explicitLock });
    };
    const webServer = ctx.get?.('webServer');
    if (webServer !== undefined && typeof webServer.register === 'function') {
        setupRoutes(webServer);
    }
    else {
        // 宿主启动顺序可能晚于插件：轮询等待 webServer 出现后补注册，避免全部 404
        let tries = 0;
        const waitTimer = setInterval(() => {
            tries += 1;
            const late = ctx.get?.('webServer');
            if (late !== undefined && typeof late.register === 'function') {
                clearInterval(waitTimer);
                try {
                    setupRoutes(late);
                    ctx.logger?.info?.('cognition-engine: webServer 就绪，HTTP 路由已补注册');
                }
                catch (error) {
                    ctx.logger?.warn?.(`cognition-engine: 路由补注册失败: ${messageOf(error)}`);
                }
            }
            else if (tries >= 120) {
                clearInterval(waitTimer);
            }
        }, 500);
        waitTimer.unref?.();
        disposers.push(() => clearInterval(waitTimer));
    }
    const toolList = createTools({
        memory,
        topics,
        taskManager,
        proactive,
        touch,
        reflection,
        persistReflection: (result) => persistReflection(memory, result),
        tasksReady,
        config,
        // 这两个之前漏传：导致「本地占位告警」从未出现、准则蒸馏不可用。
        currentReflectionMode: () => reflectionMode,
        distillPlaybook: runDistill,
    });
    const [remember, recall, forget, reflect, state, cognitionContext, manageLongTask] = toolList;
    for (const definition of [remember, recall, forget, reflect, state, cognitionContext, manageLongTask]) {
        try {
            assertObjectSchema(definition.name, definition.parameters);
            disposers.push(tools.register(definition));
        }
        catch (error) {
            // 与其他插件重名、或宿主改了 schema 约定：只跳过这一个工具，其余照常注册
            ctx.logger?.warn?.(`cognition-engine: 工具 ${definition.name} 注册失败（可能与其他插件重名）: ${messageOf(error)}`);
        }
    }
    /**
     * 把跨会话上下文挂进系统提示：有生效准则就注入准则本，否则回退到记忆摘要。
     *
     * 每次装配都会调用 text()，内容永远是最新的；两者都为空时返回空串——不占 token。
     * 具体拼什么由 buildInjectedContext 决定，与面板的「注入来源」同源。
     */
    const systemPrompt = ctx.get?.('systemPrompt');
    if (config.injectMemory && systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
        try {
            disposers.push(systemPrompt.section({
                name: 'cognition-engine-memory',
                order: 900,
                text: () => buildInjectedContext().text,
            }));
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 系统提示段注册失败: ${messageOf(error)}`);
        }
    }
    /**
     * 后台巡视：每隔 patrolIntervalHours 检查 tasks.json，
     * 用 ReflectionWorker 在后台宏任务里复盘最久没动的任务，全程不阻塞主线程。
     */
    const patrol = async () => {
        try {
            await tasksReady;
            // P1 记忆生命周期：长期没被想起的记忆退出 strict 召回（不删数据）
            const archived = memory.autoArchive({ idleDays: 180, maxActivation: 1 });
            if (archived.length > 0) {
                ctx.logger?.info?.(`cognition-engine: 已归档 ${archived.length} 条长期未访问的记忆`);
                touch();
            }
            const due = taskManager.check_due_tasks();
            const target = due[0];
            if (target === undefined)
                return;
            const overdueHours = Math.round(target.overdueMs / 3_600_000);
            // 自动复盘要花 3 次模型调用（≈3100 tokens），默认不跑。
            // 关掉时仍然写一条提示，「提醒」这个功能保留，只是不烧 token。
            if (!autoReflect || reflectionMode !== 'real') {
                ctx.logger?.info?.(`cognition-engine: 巡视发现 ${due.length} 个待催办任务，已记录提示（未开启自动复盘）`);
                await taskManager.update_task_progress(target.id, target.status, `自动巡视：已超期 ${overdueHours} 小时，待处理`);
                return;
            }
            ctx.logger?.info?.(`cognition-engine: 巡视发现 ${due.length} 个待催办任务，后台复盘 ${target.id}`);
            const result = await worker.submit(`长程任务「${target.description}」已 ${overdueHours} 小时没有更新，下一步应该推进什么`);
            const firstLine = (result.synthesis.split(/\r?\n/)[0] ?? '').slice(0, 200);
            await taskManager.update_task_progress(target.id, target.status, `自动巡视：${firstLine}`);
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 巡视失败 ${messageOf(error)}`);
        }
    };
    // 启动后探测一次模型能力，让设置页能列出可选推理档位
    void refreshEfforts();
    const timer = setInterval(() => {
        void patrol();
    }, config.patrolIntervalHours * 3_600_000);
    timer.unref?.();
    const disposeAll = () => {
        if (disposed)
            return;
        disposed = true;
        clearInterval(timer);
        stateStore.close();
        void stateStore.flush();
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // 卸载阶段忽略单个工具的反注册异常
            }
        }
    };
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => disposeAll);
    }
    ctx.logger?.info?.('cognition-engine: 已注册 cognition_remember / cognition_recall / cognition_forget / cognition_reflect / cognition_state / manage_long_task');
    return disposeAll;
}
