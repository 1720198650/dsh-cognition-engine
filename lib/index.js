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
import { basename, dirname, join } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { GapStore } from "./gaps.js";
import { PlaybookEventLog } from "./events.js";
import { InjectionLog, TurnFeedbackTracker, classifyFeedback, extractUserText } from "./injection_log.js";
import { PersonaStore } from "./persona.js";
import { CpeStore, blocksAcceptance } from "./cpe.js";
import { BudgetStore } from "./budget.js";
import { ShadowStore } from "./shadow.js";
import { shouldReject, summarize } from "./notlearn.js";
import { StyleStore } from "./style.js";
import { RegisterLog, judgeRegister, isRuntimeContext, THRESHOLD, AMBIGUITY_THRESHOLD } from "./register.js";
import { SuperagentClient } from "./superagent.js";
import { AssumptionLedger } from "./assumptions.js";
import { runDreaming } from "./dreaming.js";
import { SedimentStore, observeSupersedeFrom } from "./sediment.js";
import { WikiStore, buildWiki } from "./wiki.js";
import { CandidateInbox } from "./inbox.js";
import { SourceStore } from "./sources.js";
import { SourceLibrary } from "./source_library.js";
import { LearningQueue, candidatesFromPoints, checkAnchor } from "./learning.js";
import { RevisionLog, markAuto, shouldAutoRevise, unmarkAuto } from "./autorevise.js";
import { StanceStore } from "./stance.js";
import { VoiceStore } from "./voice.js";
import { fetchComments, resolveAid } from "./voice_source.js";
import { mergeAnswers, toClaimTable, researchStatus, buildAnswerPrompt, buildTriagePrompt, parseAnswer, parseTriage, SAME_THRESHOLD } from "./deepresearch.js";
import { buildCorrectionPrompt, detectCorrection, parseCorrectionResult } from "./correction.js";
import { buildSearchQueries, pickSources } from "./autolearn.js";
import { buildSourceNotePrompt, distillSkipReason, parseSourceNote, fallbackNote } from "./source_note.js";
import { DEFAULT_POLICY, FetchThrottle, WhitelistStore, checkUrl, fetchOnce, parseRobots, } from "./web_fetch.js";
import { recordUsage, summarizeUsage } from "./usage.js";
import { SettingsStore, resolveInjectMode, isInjectMode, resolveLearnLevel } from "./settings.js";
import { runPracticeProbes } from "./probes.js";
import { extractText, scanFlags, wrapAsData } from "./extract.js";
import { buildTaskBrief } from "./brief.js";
import { updateWikiIncrementally } from "./wiki_incremental.js";
import { buildJudgePrompt, parseJudgeResponse } from "./sediment_judge.js";
import { AgentsFileSync, defaultAgentsFilePath } from "./agents_file.js";
import { TemporalMemoryStore, textSimilarity } from "./memory.js";
import { JsonStateStore } from "./persist.js";
import { buildDetail, buildCoreDigest } from "./views.js";
import { DialecticalReflectionEngine, MockDialecticalLLM, ReflectionWorker } from "./reflection.js";
import { assertObjectSchema, asRecord, bodyString, dataDir, decodeTextBuffer, expandHome, messageOf, migrateLegacyData, parseMoment, readBodyJson, requireString, textOutput } from "./util.js";
import { createTools } from "./tools.js";
import { ProactiveGate } from "./proactive.js";
import { ProactiveStore, scoreScan } from "./proactive_scan.js";
import { RecallLog, RetrievalEvalStore } from "./retrieval.js";
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
        playbookChars: Math.max(200, Math.round(numberOr(config.playbookChars, 700))),
        playbookMaxEntries: Math.max(1, Math.round(numberOr(config.playbookMaxEntries, 6))),
        autoFeedback: config.autoFeedback !== false,
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
        personaFile: typeof config.personaFile === 'string' && config.personaFile.trim().length > 0
            ? config.personaFile
            : undefined,
        personaEnabled: config.personaEnabled !== false,
        styleEnabled: config.styleEnabled !== false,
        styleMinTurns: Math.max(5, Math.round(numberOr(config.styleMinTurns, 60))),
        styleMinChars: Math.max(200, Math.round(numberOr(config.styleMinChars, 6000))),
        styleCatchphrases: Array.isArray(config.styleCatchphrases)
            ? config.styleCatchphrases.filter((item) => typeof item === 'string' && item.length > 0).slice(0, 5)
            : [],
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
        superagentBaseUrl: typeof config.superagentBaseUrl === 'string' && config.superagentBaseUrl.trim().length > 0
            ? config.superagentBaseUrl.trim().replace(/\/+$/, '')
            : 'http://127.0.0.1:3082',
        superagentTimeoutMs: Math.max(500, Math.round(numberOr(config.superagentTimeoutMs, 3000))),
        superagentRepo: typeof config.superagentRepo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(config.superagentRepo.trim())
            ? config.superagentRepo.trim()
            : '',
        injectionOnly: config.injectionOnly === true,
        agentsFileSync: config.agentsFileSync === true,
        reflectionFailClosed: config.reflectionFailClosed !== false,
        cpeStrictGate: config.cpeStrictGate !== false,
        conflictHintThreshold: Math.min(0.99, Math.max(0.05, numberOr(config.conflictHintThreshold, 0.55))),
        injectMaxInstances: Math.min(20, Math.max(1, Math.round(numberOr(config.injectMaxInstances, 8)))),
        injectBoundaryNotice: config.injectBoundaryNotice !== false,
        injectTopicScoped: config.injectTopicScoped !== false,
        // 默认索引模式：注入只给 id + 标题，省 60-70% 注入 token；细节走 recall（零模型成本）
        injectIndexOnly: config.injectIndexOnly !== false,
        sedimentFile: typeof config.sedimentFile === 'string' && config.sedimentFile.trim().length > 0
            ? expandHome(config.sedimentFile.trim())
            : join(dataDir(), 'cognition-sediment.jsonl'),
        sedimentEta: Math.min(0.1, Math.max(0.001, numberOr(config.sedimentEta, 0.02))),
        wikiIncremental: config.wikiIncremental === true,
        wikiIncrementalMinChanges: Math.max(1, numberOr(config.wikiIncrementalMinChanges, 3)),
        pricePerMTokens: numberOr(config.pricePerMTokens, 2),
        fetchTimeoutMs: Math.max(1000, numberOr(config.fetchTimeoutMs, DEFAULT_POLICY.timeoutMs)),
        fetchMaxBytes: Math.max(64 * 1024, numberOr(config.fetchMaxBytes, DEFAULT_POLICY.maxBytes)),
        fetchAllowLoopback: config.fetchAllowLoopback === true,
        probeMaxTurns: Math.max(10, Math.round(numberOr(config.probeMaxTurns, 60))),
        probeMinOverlap: Math.min(0.9, Math.max(0.1, numberOr(config.probeMinOverlap, 0.3))),
        probeMaxCounter: Math.max(1, Math.round(numberOr(config.probeMaxCounter, 2))),
        anchorStrictCoverage: Math.min(1, Math.max(0.6, numberOr(config.anchorStrictCoverage, 0.9))),
        anchorLooseCoverage: Math.min(0.95, Math.max(0.3, numberOr(config.anchorLooseCoverage, 0.6))),
        briefMinRelevance: Math.min(0.9, Math.max(0, numberOr(config.briefMinRelevance, 0.15))),
        reviseCooldownHours: Math.max(0, numberOr(config.reviseCooldownHours, 24)),
        reviseMaxPerDay: Math.max(1, Math.round(numberOr(config.reviseMaxPerDay, 5))),
        conflictRatio: Math.max(1, numberOr(config.conflictRatio, 1.2)),
        // 语感预算：默认 120 字，上限 240（再多就会挤掉事实）
        voiceMaxChars: Math.min(240, Math.max(0, numberOr(config.voiceMaxChars, 120))),
        inboxFile: typeof config.inboxFile === 'string' && config.inboxFile.trim().length > 0
            ? expandHome(config.inboxFile.trim())
            : join(dataDir(), 'cognition-inbox.json'),
        wikiDir: typeof config.wikiDir === 'string' && config.wikiDir.trim().length > 0
            ? expandHome(config.wikiDir.trim())
            : join(dataDir(), 'wiki'),
        sedimentShadow: config.sedimentShadow !== false,
        // 沉积层默认关（弱支撑 + 观察期大概率不达标，见 docs/audit-evidence.md）
        sedimentEnabled: config.sedimentEnabled === true,
        // 默认走 LLM 五分类（只在真实取代时触发，成本极低）；不可用时 fail-closed
        sedimentJudge: config.sedimentJudge === 'rules' ? 'rules' : 'llm',
        agentsFilePath: typeof config.agentsFilePath === 'string' && config.agentsFilePath.trim().length > 0
            ? expandHome(config.agentsFilePath.trim())
            : defaultAgentsFilePath(),
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
/**
 * `injectionOnly` 模式：只把「准则本 + 人格」注册成提示段。
 *
 * 用途：dsh-superagent 的 preset 会话不继承 host 级 section，要在 preset 里再挂一份。
 * 挂完整插件会在同一数据目录上多一个实例、两份内存快照互相覆盖，所以这里**只读**：
 * 不注册工具、不注册 HTTP 路由、不启动巡视、不写任何文件。
 */
function installInjectionOnlySections(ctx, deps) {
    const systemPrompt = ctx.get?.('systemPrompt');
    if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
        ctx.logger?.warn?.('cognition-engine: injectionOnly 模式需要 systemPrompt 服务，未找到，跳过');
        return () => { };
    }
    const disposers = [];
    try {
        disposers.push(systemPrompt.section({
            name: 'cognition-engine-memory',
            order: 900,
            // text() 必须纯：只读文件、不改状态。每次装配都会被调用。
            text: () => {
                try {
                    deps.playbook.loadSync();
                    return deps.playbook.renderSection();
                }
                catch {
                    return '';
                }
            },
        }));
    }
    catch (error) {
        ctx.logger?.warn?.(`cognition-engine: injectionOnly 记忆段注册失败: ${messageOf(error)}`);
    }
    try {
        disposers.push(systemPrompt.section({
            name: 'cognition-engine-persona',
            order: 100,
            text: () => {
                try {
                    return deps.persona.render();
                }
                catch {
                    return '';
                }
            },
        }));
    }
    catch (error) {
        ctx.logger?.warn?.(`cognition-engine: injectionOnly 人格段注册失败: ${messageOf(error)}`);
    }
    // 临时诊断：注册完成后回报实际注册了几段（正常应为 2）。
    ctx.logger?.info?.(`cognition-engine: injectionOnly 已注册 ${disposers.length} 段提示`);
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                /* 忽略 */
            }
        }
    };
}
export function apply(ctx, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const audit = new AuditLog();
    const playbook = new PlaybookStore({
        ...(config.playbookFile === undefined ? {} : { filePath: config.playbookFile }),
        maxChars: config.playbookChars,
        maxEntries: config.playbookMaxEntries,
        // 冲突裁决倍率（默认 1.2，经验值，可配）
        conflictRatio: config.conflictRatio,
        // P3-1：运行时强制「没有边界不许生效」，无边界的手工/候选准则会被打回
        requireBoundary: true,
        // P4-1：改准则必须写诊断
        requireRevisionDiagnosis: true,
        // 来源校验：sourceIds 必须真实存在，防止模型臆造出处
        validateSourceIds: (ids) => ids.filter((id) => memory.get(id) !== undefined),
        // 证据链：源记忆必须仍然「活着」——未被取代、未删除、未归档。
        // 只要它变了，依赖它的准则就该知道自己失去了支撑（Doyle TMS）。
        isSourceAlive: (id) => {
            const fact = memory.get(id);
            if (fact === undefined)
                return false;
            if (fact.deletedAt !== undefined)
                return false;
            if (fact.supersededAt !== null)
                return false;
            if (fact.archived)
                return false;
            return true;
        },
    });
    const topics = new TopicStore({
        ...(config.topicsFile === undefined ? {} : { filePath: config.topicsFile }),
    });
    // 候选收件箱（L0，不联网）：外部材料先落候选，人工采用后才进记忆
    const inbox = new CandidateInbox({ filePath: config.inboxFile });
    // 不可变来源账本（SoMem 的 Source 层）：只追加，内容哈希 + 链
    const sources = new SourceStore({ filePath: join(dataDir(), 'cognition-sources.jsonl') });
    // 资料库（资料层）：来源切块索引 + 自动摘要。
    // 长文只走这条路，不进记忆事实——否则几十条同主题事实会把用户真实口径挤出检索窗口。
    const library = new SourceLibrary({
        blocksFile: join(dataDir(), 'cognition-source-blocks.jsonl'),
        notesFile: join(dataDir(), 'cognition-source-notes.json'),
    });
    // L3 学习候选队列（事实/准则/技能，全部带外部锚）
    const learning = new LearningQueue({ filePath: join(dataDir(), 'cognition-learning.json') });
    // 自动修订存档（append-only，改之前必须先写进去）
    const revisionLog = new RevisionLog({ filePath: join(dataDir(), 'cognition-revisions.jsonl') });
    /**
     * 立场层：项目目标 + 判据（2026-11-19 用户定，宪章同步修订）。
     *
     * 首次启动种入几条用户自己的话，省得他从空白开始加；每条都能删。
     */
    const stance = new StanceStore({ filePath: join(dataDir(), 'cognition-stance.json') });
    /**
     * 语感层：从公开讨论学「怎么说」，不学「说什么」。
     *
     * 只读公开接口（B站），不登录、不互动、不发内容。
     * 注入预算极小（≤120 字），是调味不是主菜。
     */
    const voice = new VoiceStore({ filePath: join(dataDir(), 'cognition-voice.json') });
    if (stance.list().length === 0) {
        try {
            stance.add({ kind: 'goal', text: '让对话和工作更利落：工作→反馈→提升自动完成，人只提需求和反驳', origin: '用户原话 2026-11-19' });
            stance.add({ kind: 'prefer', text: '可验证 > 好听：没有证据的结论不许说「已完成」', origin: '用户原话' });
            stance.add({ kind: 'prefer', text: '少操作 > 多按钮：能自动的不要让人点', origin: '用户原话 2026-11-19' });
            stance.add({ kind: 'prefer', text: '用户口径 > 资料结论：论文里的话不许冒充用户的规矩', origin: '用户原话' });
            stance.add({ kind: 'forbid', text: '引入外部数据库依赖', deny: ['sqlite', '向量数据库', 'vector db', 'graph database', 'chromadb', 'faiss'], origin: '准则 ctxt-00003' });
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 立场初始化失败 ${messageOf(error)}`);
        }
    }
    // 运行时设置（面板可改）：注入方式
    /**
     * 练习样本：把「用户纠正/确认」的回合和当时的原话拼起来。
     * 原话只取 register 日志里的 excerpt（本来就只存片段），不额外保存对话正文。
     */
    const buildProbeTurns = (limit = 60) => {
        const readJsonl = (path) => {
            try {
                return readFileSync(path, 'utf8')
                    .replace(/^\uFEFF/, '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
                    .map((line) => {
                    try {
                        return JSON.parse(line);
                    }
                    catch {
                        return undefined;
                    }
                })
                    .filter((row) => row !== undefined);
            }
            catch {
                return [];
            }
        };
        const inject = readJsonl(join(dataDir(), 'cognition-injection.jsonl'));
        const register = readJsonl(join(dataDir(), 'cognition-register.jsonl'));
        const excerptOf = new Map();
        for (const row of register) {
            const key = `${String(row.sessionId ?? '')}#${String(row.turn ?? '')}`;
            if (typeof row.excerpt === 'string' && row.excerpt.trim().length > 0)
                excerptOf.set(key, row.excerpt.trim());
        }
        const turns = [];
        for (const row of inject) {
            const verdict = String(row.verdict ?? '');
            if (verdict !== 'correction' && verdict !== 'confirmation')
                continue;
            const key = `${String(row.sessionId ?? '')}#${String(row.turn ?? '')}`;
            const excerpt = excerptOf.get(key);
            if (excerpt === undefined)
                continue;
            turns.push({
                sessionId: String(row.sessionId ?? ''),
                turn: Number(row.turn ?? 0),
                excerpt,
                verdict,
                ...(typeof row.at === 'number' ? { at: row.at } : {}),
            });
        }
        return turns.slice(-limit);
    };
    const settings = new SettingsStore(join(dataDir(), 'cognition-settings.json'));
    let injectMode = resolveInjectMode({
        ...(config.injectMode === undefined ? {} : { configured: config.injectMode }),
        ...(settings.read().injectMode === undefined ? {} : { saved: settings.read().injectMode }),
        injectMemory: config.injectMemory,
        injectIndexOnly: config.injectIndexOnly,
    });
    // 知识缺口：模型卡壳时登记，下次针对性补（P6 学习闭环）
    const gaps = new GapStore();
    // 人格块（S3）：轻人格，文件不存在就等于没启用，注入段不占 token
    const persona = new PersonaStore({
        ...(config.personaFile === undefined ? {} : { filePath: config.personaFile }),
    });
    // 风格指纹（S4）：只落统计量，不落原文
    const styleStore = new StyleStore({
        ...(config.styleMinTurns === undefined ? {} : { minTurns: config.styleMinTurns }),
        ...(config.styleMinChars === undefined ? {} : { minChars: config.styleMinChars }),
    });
    // CPE 回归闸门（S5）：冻结回归集 + 变更闸门
    const cpe = new CpeStore();
    // 学习预算（S6）：每周名额 + 五条停止信号
    const budget = new BudgetStore();
    // shadow 试运行（S6）：先进 shadow 不进注入，够格再转正
    const shadow = new ShadowStore();
    // 主动闸门（S7）：默认 P1 record-only，只记录「本来会提醒什么」
    const proactiveStore = new ProactiveStore();
    // 检索度量（S8）：真实召回日志 + 人工标注的 Top-1/Top-3
    const recallLog = new RecallLog();
    const retrievalEval = new RetrievalEvalStore();
    // 准则事件日志（轻量事件溯源）：只追加，不改主存储
    const ruleEvents = new PlaybookEventLog();
    // 注入快照：记录每轮注入了哪些准则，用于把用户反馈回写到准则。
    // v2 起只由真实轮次（session/event）写入——渲染函数已纯化，面板轮询不再产生任何一行。
    const injectionLog = new InjectionLog();
    // 场合判定（干活 / 闲聊）：**当前只记录，不改任何注入内容**。
    // 没有标注数据之前先攒样本，等用户标出判错的再调阈值（同 CPE / 检索标注的纪律）。
    const registerLog = new RegisterLog();
    // 与 dsh-superagent 的只读对接。对面是另一个进程（默认 WSL 3082），
    // 不可达时只让面板显示「未连接」，不影响本插件任何功能。
    const superagent = new SuperagentClient({
        baseUrl: config.superagentBaseUrl,
        timeoutMs: config.superagentTimeoutMs,
    });
    // 把「人格 + 准则本」同步进 $DSH_HOME/AGENTS.md 的受控块（默认关闭，用户开启才写）。
    const agentsSync = new AgentsFileSync({ filePath: config.agentsFilePath });
    /** 受控块的正文：人格在前，准则本在后。都为空则不写块。 */
    const agentsBody = () => {
        const parts = [];
        try {
            const personaText = persona.render();
            if (personaText.trim().length > 0)
                parts.push(personaText.trim());
        }
        catch {
            /* 人格读失败不影响准则 */
        }
        try {
            playbook.loadSync();
            const rules = playbook.renderSection();
            if (rules.trim().length > 0)
                parts.push(rules.trim());
        }
        catch {
            /* 准则读失败就只写人格 */
        }
        return parts.join('\n\n');
    };
    const memory = new TemporalMemoryStore({
        halfLifeMs: config.decayHalfLifeHours * HOUR_MS,
        onEvent: (event) => audit.append(event),
    });
    /**
     * injectionOnly：只注册提示段就返回。
     *
     * 位置很关键——必须放在 `migrateLegacyData`（会写盘）、工具注册、HTTP 路由、巡视之前，
     * 这样这个实例**一个字节都不会写**，也就不会和 host 那份实例抢同一个数据文件。
     */
    if (config.injectionOnly) {
        return installInjectionOnlySections(ctx, { playbook, persona });
    }
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
        // 先把旧位置（插件包根目录）的数据搬到独立数据目录，再加载。
        // 用户数据放代码目录里，任何「清理仓库」都会误伤——这个坑踩过两次。
        const migrated = migrateLegacyData();
        if (migrated.length > 0) {
            ctx.logger?.info?.(`cognition-engine: 已将 ${migrated.length} 个数据文件迁到 ${dataDir()}（${migrated.join(', ')}）`);
        }
        playbook.loadSync();
        topics.loadSync();
        gaps.loadSync();
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
    const usageFile = join(dataDir(), 'cognition-usage.jsonl');
    const callRealModel = async (prompt, maxTokens = 4000, purpose = 'other') => {
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
        recordUsage(usageFile, {
            at: Date.now(),
            purpose,
            promptChars: prompt.length,
            outputChars: text.length,
            model: `${config.llmProvider ?? ''}:${config.llmModel ?? ''}`,
        });
        return text;
    };
    /**
     * 「放什么就自动学什么」的实现：切块（同步、确定性）+ 提炼摘要（异步、要模型）。
     *
     * 两件事必须拆开：切块不依赖模型，模型不可用时检索照样能用；
     * 摘要失败只是少了一段导读，不能连带把资料弄丢。
     */
    const indexSourceNow = (record) => {
        try {
            library.indexSource(record);
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 来源切块失败 ${record.id}: ${messageOf(error)}`);
        }
    };
    const distillSourceNote = async (record) => {
        const reason = distillSkipReason(record.content);
        if (reason !== null) {
            return library.saveNote({
                sourceId: record.id,
                at: Date.now(),
                status: 'skipped',
                title: record.title,
                summary: record.content.trim().slice(0, 200),
                points: [],
                error: reason,
            });
        }
        library.setPending(record.id, record.title);
        const failed = (error) => library.saveNote(fallbackNote({ sourceId: record.id, title: record.title, text: record.content, at: Date.now(), error }));
        if (reflectionMode !== 'real') {
            return failed('未开启真实模型：切块已建好，可检索；把设置页切到「真实模型」后可在收件页重新提炼');
        }
        try {
            const built = buildSourceNotePrompt({
                title: record.title,
                text: record.content,
                topics: topics.all().map((topic) => topic.name),
                maxPoints: 5,
            });
            const raw = await callRealModel(built.prompt, 2000, 'source');
            const parsed = parseSourceNote(raw);
            /**
             * 摘要洗白防护：模型写出来的 summary/points 也要再过一遍可疑句式扫描。
             *
             * 否则注入句会被"提炼"成结论，之后以「已提炼结论」的身份被检索返回，
             * 相当于用我们自己的可信度给攻击者背书（docs/l2-security.md 第四节）。
             */
            const derived = scanFlags([parsed.summary, ...parsed.points].join('\n'));
            const risky = derived.filter((flag) => ['instruction-override', 'summary-injection', 'wrapper-spoof', 'role-marker', 'tool-nl', 'tool-json', 'exfil-md', 'exfil-url', 'chat-template'].includes(flag));
            return library.saveNote({
                sourceId: record.id,
                at: Date.now(),
                status: risky.length === 0 ? 'ready' : 'suspicious',
                title: record.title,
                summary: parsed.summary,
                points: parsed.points,
                ...(parsed.quotes.some((quote) => quote.length > 0) ? { quotes: parsed.quotes } : {}),
                ...(parsed.topic === undefined ? {} : { topic: parsed.topic }),
                ...(risky.length === 0 ? {} : { flags: risky }),
            });
        }
        catch (error) {
            return failed(messageOf(error));
        }
    };
    /** 导入一处来源后统一走这里：先建块索引，再后台提炼。 */
    const ingestSource = (record) => {
        indexSourceNow(record);
        void distillSourceNote(record)
            // 提炼完自动进学习流水线：生成候选 → 自动采用。人不点任何按钮。
            .then(() => learningPipelineRef?.(record.id))
            .catch((error) => {
            ctx.logger?.warn?.(`cognition-engine: 来源提炼失败 ${record.id}: ${messageOf(error)}`);
        });
    };
    // —— 自动学习：走宿主 web 服务（DeepSeek 官方搜索），不需要自己维护白名单 ——
    const autoLearnLogFile = join(dataDir(), 'cognition-autolearn.jsonl');
    const readAutoLearn = (limit = 20) => {
        if (!existsSync(autoLearnLogFile))
            return [];
        const rows = [];
        for (const line of readFileSync(autoLearnLogFile, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            try {
                rows.push(JSON.parse(trimmed));
            }
            catch {
                continue;
            }
        }
        return rows.slice(-Math.max(1, limit)).reverse();
    };
    const recordAutoLearn = (record) => {
        try {
            mkdirSync(dirname(autoLearnLogFile), { recursive: true });
            appendFileSync(autoLearnLogFile, `${JSON.stringify(record)}\n`, 'utf8');
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 自动学习日志写入失败 ${messageOf(error)}`);
        }
    };
    const autoToggles = () => {
        const saved = settings.read();
        // 三档是唯一真相：老的 autoLearn/deepResearch 由它推出来
        const level = resolveLearnLevel(saved);
        return {
            autoLearn: level !== 'off',
            autoRevise: saved.autoRevise === true,
            // 自动采用默认开：用户 2026-11-19「学习应完全自动化，人只提需求和反驳」
            autoAccept: saved.autoAccept !== false,
            deepResearch: level === 'deep',
            learnLevel: level,
        };
    };
    /**
     * 自动联网学习：一句话 → 检索 → 抓正文 → 进资料层（切块+提炼+候选）。
     *
     * 用宿主的 ctx.web（DeepSeek 官方搜索）而不是我们自己抓：不维护白名单、
     * 也不用担心 robots——provider 层已经处理。默认关闭，只在开关打开时被调用。
     */
    const importFromSearch = async (text, reason) => {
        const web = ctx.get?.('web');
        if (web === undefined || typeof web.search !== 'function' || typeof web.fetch !== 'function') {
            throw new Error('宿主没有提供 web 服务（搜索/抓取），自动学习不可用');
        }
        const queries = buildSearchQueries(text);
        if (queries.length === 0)
            throw new Error('没有可检索的内容');
        const imported = [];
        const failed = [];
        for (const query of queries) {
            const { provider, model } = resolveModel();
            const result = await web.search({ query, maxResults: 5, ...(provider === '' ? {} : { llmProvider: provider }) });
            const picked = pickSources(result.sources ?? [], 2);
            if (picked.length === 0) {
                failed.push({ url: '(无结果)', reason: '这个检索词没搜到可用页面' });
                continue;
            }
            for (const source of picked) {
                try {
                    const page = await web.fetch({ url: source.url });
                    if (page.statusCode >= 400) {
                        failed.push({ url: source.url, reason: 'HTTP ' + page.statusCode });
                        continue;
                    }
                    const extracted = extractText(page.body.content, { maxChars: 20000 });
                    if (extracted.text.trim().length === 0) {
                        failed.push({ url: source.url, reason: '抽不出正文' });
                        continue;
                    }
                    const record = sources.append({
                        kind: 'web',
                        title: source.title ?? source.url,
                        content: extracted.text,
                        locator: source.url,
                    });
                    ingestSource(record);
                    imported.push({ sourceId: record.id, url: source.url, chars: extracted.text.length });
                }
                catch (error) {
                    failed.push({ url: source.url, reason: messageOf(error) });
                }
            }
            void model;
            if (imported.length > 0)
                break; // 一个问题学到东西就停，别把检索词都跑一遍烧钱
        }
        recordAutoLearn({ at: Date.now(), reason, query: queries[0] ?? text.slice(0, 60), imported, failed });
        return { queries, imported, failed, provider: null };
    };
    /**
     * 深研：带着一个问题去查多源，交叉核对后才留下结论。
     *
     * 和快学的差别就一条硬规则：**只有 1 个独立来源的结论标 unverified**，
     * 不许拿单篇资料冒充"多源印证过的知识"。
     * 代价：一次 3 检索 + 3 抓取 + 3 次模型调用（约快学的 5~10 倍）。
     */
    const runDeepResearch = async (question) => {
        const web = ctx.get?.('web');
        if (web === undefined || typeof web.search !== 'function' || typeof web.fetch !== 'function') {
            throw new Error('宿主没有 web 服务，深研不可用');
        }
        const at = Date.now();
        const id = `res-${at.toString(36)}`;
        // 检索词要多角度：原问法 + 方法向 + 论文向。只用一个词常常搜回同一批结果，
        // 导致"多源核对"根本凑不出第二个来源（2026-11-18 首次实跑踩到：只读到 1 篇）。
        const base = buildSearchQueries(question, 1)[0] ?? question;
        const queries = [...new Set([base, base + ' 方法 实践', base + ' 论文 研究'])].slice(0, 3);
        const answers = [];
        const usedSources = [];
        const failures = [];
        const seenUrls = new Set();
        for (const query of queries) {
            const { provider } = resolveModel();
            let result;
            try {
                result = await web.search({ query, maxResults: 6, ...(provider === '' ? {} : { llmProvider: provider }) });
            }
            catch (error) {
                failures.push({ url: '(检索失败) ' + query, reason: messageOf(error) });
                continue;
            }
            for (const source of pickSources(result.sources ?? [], 3, 2)) {
                if (seenUrls.has(source.url))
                    continue;
                seenUrls.add(source.url);
                try {
                    const page = await web.fetch({ url: source.url });
                    if (page.statusCode >= 400) {
                        failures.push({ url: source.url, reason: 'HTTP ' + page.statusCode });
                        continue;
                    }
                    const extracted = extractText(page.body.content, { maxChars: 12000 });
                    if (extracted.text.trim().length < 200) {
                        failures.push({ url: source.url, reason: '正文太短' });
                        continue;
                    }
                    const record = sources.append({ kind: 'web', title: source.title ?? source.url, content: extracted.text, locator: source.url });
                    indexSourceNow(record);
                    const raw = await callRealModel(buildAnswerPrompt({ question, title: source.title ?? source.url, text: extracted.text }), 1000, 'deepresearch');
                    const answer = { ...parseAnswer(raw), source: record.id };
                    // 引文必须在这篇原文的某一块里，否则这条回答不算
                    const lookup = {
                        blockText: (sid, block) => library.blocksOf(sid).find((item) => item.ord === block)?.text,
                    };
                    const quoteOk = answer.relevant && library.blocksOf(record.id).some((block) => checkAnchor({ type: 'source', ref: record.id, block: block.ord, quote: answer.quote }, lookup).ok);
                    if (quoteOk)
                        answers.push(answer);
                    usedSources.push({ sourceId: record.id, url: source.url, chars: extracted.text.length, claims: quoteOk ? 1 : 0 });
                }
                catch (error) {
                    failures.push({ url: source.url, reason: messageOf(error) });
                }
                if (usedSources.length >= 5)
                    break; // 封顶：一次深研最多读 5 篇，别失控
            }
            if (usedSources.length >= 4)
                break;
        }
        let merged = mergeAnswers(answers);
        // 灰区一次性三分类（封顶 7 对、一次模型调用）；判 same 的并进去后重算
        if (merged.greyPairs.length > 0) {
            try {
                const raw = await callRealModel(buildTriagePrompt(merged.greyPairs), 600, 'deepresearch');
                const verdicts = parseTriage(raw, merged.greyPairs.length);
                const sameCount = verdicts.filter((value) => value === 'same').length;
                if (sameCount > 0) {
                    // 简化合并：把被判同一的对，让后一条并入前一条所在簇
                    merged = mergeAnswers(answers, SAME_THRESHOLD - 0.15);
                }
            }
            catch (error) {
                ctx.logger?.warn?.(`cognition-engine: 灰区判定失败，按不合并处理 ${messageOf(error)}`);
            }
        }
        const clusters = merged.clusters;
        const record = {
            id,
            at,
            question,
            sources: usedSources,
            clusters,
            verified: clusters.filter((cluster) => cluster.verified).length,
            total: clusters.length,
            failures,
            // 三种"没有一致结论"要分开报，不能都塞一句"未找到"
            status: researchStatus({
                verified: clusters.filter((cluster) => cluster.verified).length,
                answeredSources: usedSources.filter((item) => item.claims > 0).length,
                clusters: clusters.length,
                hasContradiction: clusters.some((cluster) => cluster.agreement > 1),
            }),
            claims: toClaimTable(clusters),
        };
        try {
            mkdirSync(dirname(researchFile), { recursive: true });
            appendFileSync(researchFile, `${JSON.stringify(record)}\n`, 'utf8');
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 深研记录写入失败 ${messageOf(error)}`);
        }
        // 交叉核对通过的结论进准则候选（带出处，等你点采用）
        for (const cluster of clusters) {
            if (!cluster.verified)
                continue;
            learning.add({
                kind: 'rule',
                content: cluster.answer,
                anchor: { type: 'source', ref: cluster.sources[0] ?? 'unknown', block: 0, quote: cluster.quotes[0] ?? '' },
                scope: 'world',
                confidence: Math.min(0.9, 0.5 + cluster.sources.length * 0.1),
                note: '深研交叉核对通过（' + cluster.sources.length + ' 个独立来源，一致率 ' + Math.round(cluster.ratio * 100) + '%）：' + cluster.sources.join('、'),
            });
        }
        return record;
    };
    // 深研记录（append-only，问题→来源→交叉核对结果）
    const researchFile = join(dataDir(), 'cognition-research.jsonl');
    // —— L2 白名单抓取：手动指定站点时走这里；自动学习走上面的 ctx.web ——
    const whitelist = new WhitelistStore({ filePath: join(dataDir(), 'cognition-whitelist.json') });
    const throttle = new FetchThrottle();
    /** robots 按站点缓存一个进程生命周期，别每次抓都重新拉 */
    const robotsCache = new Map();
    const fetchPolicy = () => ({
        ...DEFAULT_POLICY,
        hosts: whitelist.list(),
        ...(config.fetchTimeoutMs === undefined ? {} : { timeoutMs: config.fetchTimeoutMs }),
        ...(config.fetchMaxBytes === undefined ? {} : { maxBytes: config.fetchMaxBytes }),
        allowLoopback: config.fetchAllowLoopback === true,
    });
    const readRobots = async (origin, host, policy) => {
        const cached = robotsCache.get(host);
        if (cached !== undefined)
            return cached;
        const result = await fetchOnce(`${origin}/robots.txt`, { ...policy, maxBytes: 512 * 1024 });
        const allowed = { crawlDelayMs: 0, matched: 'none', allow: () => true };
        const denied = {
            crawlDelayMs: 0,
            matched: 'none',
            allow: () => false,
        };
        let rules;
        if (result.status >= 400 && result.status < 500) {
            // RFC 9309 §2.3.1.3：4xx 视为"没有限制"
            rules = allowed;
        }
        else if (!result.ok) {
            // §2.3.1.4：服务端错误（5xx / 超时 / 网络失败）是 MUST 假定"整站不可抓"
            rules = denied;
        }
        else {
            rules = parseRobots(result.text, policy.userAgent);
        }
        robotsCache.set(host, rules);
        return rules;
    };
    /**
     * 抓一个网址进资料库：白名单 → 限速 → robots → 抓取 → 抽正文 → 来源账本 → 切块提炼。
     *
     * 任何一步不通过都抛错并说明原因，不静默降级——用户需要知道"为什么没抓到"。
     */
    const importFromWeb = async (rawUrl) => {
        const policy = fetchPolicy();
        const checked = checkUrl(rawUrl, policy);
        if (!checked.ok || checked.url === undefined || checked.host === undefined) {
            throw new Error(checked.reason ?? '网址不允许抓取');
        }
        const url = checked.url;
        const host = checked.host;
        const origin = url.origin;
        const rules = await readRobots(origin, host, policy);
        if (!rules.allow(url.pathname + url.search)) {
            throw new Error(`robots.txt 不允许抓这个位置：${url.pathname}${url.search}`);
        }
        const interval = Math.max(policy.minIntervalMs, rules.crawlDelayMs);
        const wait = throttle.waitMs(host, interval);
        if (wait > 5000) {
            throw new Error(`对这个站点抓太快了：还要等 ${Math.ceil(wait / 1000)} 秒`);
        }
        if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
        throttle.mark(host);
        const page = await fetchOnce(url.toString(), policy);
        if (!page.ok)
            throw new Error('抓取失败：HTTP ' + page.status + (page.reason === undefined ? '' : '（' + page.reason + '）'));
        // 重定向可能把我们带到白名单外（开放重定向/镜像站），落点必须重新校验
        const landed = checkUrl(page.finalUrl, policy);
        if (!landed.ok) {
            throw new Error('重定向落点不在白名单内，已放弃：' + (landed.reason ?? page.finalUrl));
        }
        if (!/text|html|xml|json/i.test(page.contentType)) {
            throw new Error('这个地址不是文本页面：' + page.contentType);
        }
        const extracted = extractText(page.text, { maxChars: 20000 });
        if (extracted.text.trim().length === 0)
            throw new Error('抓到了，但抽不出正文（可能是纯脚本页面）');
        const title = host + url.pathname;
        const source = sources.append({
            kind: 'web',
            title,
            content: extracted.text,
            locator: page.finalUrl,
        });
        ingestSource(source);
        const facts = memory
            .all()
            .filter((fact) => fact.deletedAt === undefined && fact.supersededBy === null && fact.archived !== true)
            .map((fact) => ({ id: fact.id, content: fact.content }));
        const cand = inbox.add({
            content: extracted.text,
            title,
            url: page.finalUrl,
            sourceId: source.id,
            note: '来自白名单抓取：' + page.finalUrl + '（' + page.bytes + ' 字节，抽取后 ' + extracted.text.length + ' 字）' +
                (extracted.flags.length === 0 ? '' : '；含可疑句式（' + extracted.flags.join('、') + '）'),
            source: 'web',
        }, { facts });
        return {
            sourceId: source.id,
            candidateId: cand.id,
            url: page.finalUrl,
            status: page.status,
            bytes: page.bytes,
            chars: extracted.text.length,
            flags: extracted.flags,
            truncated: page.reason ?? null,
            // 抓到了但内容很少时要说清原因，别让用户以为抓失败
            hint: extracted.flags.includes('index-page')
                ? '这页像目录/索引页，正文只有 ' + extracted.text.length + ' 字（链接被剔掉了）。抓具体文章页更有用。'
                : extracted.text.length < 800
                    ? '正文只有 ' + extracted.text.length + ' 字：太短，只存原文供检索，不会提炼结论。'
                    : null,
        };
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
            // 有缺口时蒸馏优先针对它们，而不是泛泛归纳
            gaps: gaps.open().map((g) => ({ id: g.id, text: g.text })),
        });
        const raw = await callRealModel(prompt, 4000, 'distill');
        const parsed = parseDistillResult(raw);
        // 标记直接生效：helpful/harmful 可以再改，风险低
        let marked = 0;
        for (const item of parsed.marks) {
            if (playbook.mark(item.id, item.mark))
                marked += 1;
        }
        // 候选进 pending，必须人工审核
        const submitted = [];
        const blocked = [];
        for (const candidate of parsed.candidates) {
            // 「八类不学」硬过滤（S6）：无依据 / 含密钥 / 一次性事实 / 环境绑定 直接不进库。
            // soft 命中的照常提交，只是把标记带出去让人看一眼——一刀切会误杀有用内容。
            const verdict = shouldReject(candidate.content, {
                hasUserEvidence: (candidate.sourceIds ?? []).length > 0,
            });
            if (verdict.reject) {
                blocked.push({
                    content: candidate.content,
                    code: summarize(verdict.hits),
                    reason: verdict.hits.filter((hit) => hit.severity === 'hard').map((hit) => hit.reason).join('；'),
                });
                continue;
            }
            // 相对表达（"7d"）与 ISO 日期都由 parseMoment 归一成毫秒；解析不了就当长期有效。
            const validTo = candidate.validUntil === undefined ? null : (parseMoment(candidate.validUntil) ?? null);
            const outcome = playbook.submit({
                section: candidate.section,
                content: candidate.content,
                when: candidate.when,
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
                // soft 标记：超粒度/平手冲突/口误/投机主题，提交了但要标注
                ...(verdict.hits.length === 0 ? {} : { softFlags: summarize(verdict.hits) }),
            });
        }
        await playbook.flush();
        return {
            reflection: parsed.reflection,
            marked,
            candidates: submitted,
            /** 被「八类不学」拦下的候选（含命中原因），让人知道模型想学什么但被拒。 */
            blocked,
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
        ? callRealModel(prompt, 4000, 'reflect')
        : reflectionMode === 'local'
            // 不在中间产物上加警示：它会作为下一阶段的输入，会被模型当成正文引用。
            // 警示统一在工具层按模式补。
            ? Promise.resolve(mockLLM.call(prompt, phase))
            : Promise.reject(new Error('反思引擎未开启：请在设置页开启，或直接回答而不调用 cognition_reflect')), { failClosedOnNoContradiction: config.reflectionFailClosed });
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
     * **这个函数必须是纯的**（v0.12.0 修的 bug）：
     * 它有三个调用点——系统提示段（每个 step 都拼一次）、页面 `/state`（面板每 2 秒轮询）、
     * `/injected` 路由。v0.11.0 在函数里顺手写注入快照，结果 88 分钟写了 2432 行，
     * 全是轮询噪声，轮次号变成轮询计数器。现在记录只发生在 `session/event` 的轮次边界上。
     *
     * 优先级：准则本 > 记忆摘要 > 不注入。两者不叠加——ACE 与 DC 都说明
     * 上下文越长越容易稀释信号。
     */
    const renderInjectedContext = () => {
        // 面板可把注入关掉：此时什么都不塞（缺口/假设也不塞，避免"关了还有东西"）
        if (injectMode === 'off')
            return { text: '', source: 'none', ruleIds: [], chars: 0 };
        // 待补缺口很短（通常 0~3 行），接在准则本后面——
        // 它提醒模型「这些是你还不知道的」，避免在同一个地方反复卡壳。
        const gapText = gaps.renderSection();
        const withGaps = (text) => (gapText.length === 0 ? text : `${text}\n\n${gapText}`);
        // 假设台账放最前面：早轮假设被后续所有推理继承，越靠前越容易被"看见"。
        const assumptionText = lastSessionId === null ? '' : assumptionLedger.render(lastSessionId);
        const withAssumptions = (text) => assumptionText.length === 0 ? text : `${assumptionText}\n\n${text}`;
        // 立场放最前面：它决定"怎么判断"，后面所有内容都在这个框架下读
        const stanceText = stance.render(320);
        // 语感样本：放在立场之后。只给句子，不给规则——规则会变成套话。
        const voiceText = config.voiceMaxChars <= 0 ? '' : voice.render(config.voiceMaxChars, 3);
        const withStance = (text) => {
            const head = [stanceText, voiceText].filter((part) => part.length > 0).join('\n\n');
            return head.length === 0 ? text : `${head}\n\n${text}`;
        };
        /**
         * 资料层提示：把学到的结论**自动**带到本轮任务前面。
         *
         * 这是"学 → 用"闭环的关键一环。没有它，资料层的结论只能靠人去翻，
         * 学得再多也不影响行动（用户 2026-11 直接指出过这是"假学习"）。
         * 限额 240 字，只取命中的、已提炼的，带 [src-xx] 出处。
         */
        const sourceHint = (() => {
            if (lastUserText.trim().length < 6)
                return '';
            let hits;
            try {
                hits = library.search(lastUserText, { k: 3, maxChars: 1200 });
            }
            catch {
                return '';
            }
            if (hits.length === 0)
                return '';
            const seen = new Set();
            const lines = [];
            let used = 0;
            for (const hit of hits) {
                if (seen.has(hit.sourceId))
                    continue;
                seen.add(hit.sourceId);
                const note = library.note(hit.sourceId);
                if (note === undefined || note.status !== 'ready' || note.summary.length === 0)
                    continue;
                const line = `[${hit.sourceId}] ${note.summary.slice(0, 110)}`;
                if (used + line.length > 240)
                    break;
                lines.push(line);
                used += line.length + 1;
            }
            if (lines.length === 0)
                return '';
            return `\n\n【资料库相关结论（外部资料，不是用户口径）】\n${lines.join('\n')}\n（引用需标 [src-xx]；与本任务无关就别用。）`;
        })();
        // 主题隔离（ACL 2026, 1770）：窄领域示例会外溢到无关任务。
        // 命中当前任务主题时，只注入该主题 + 未归类的准则；没命中则全量（信息不足时不猜）。
        let topicFilter;
        let hitTopicId;
        if (config.injectTopicScoped && lastUserText.length > 0) {
            const hit = topics.match(lastUserText, 1)[0];
            if (hit !== undefined) {
                const topicId = hit.topic.id;
                hitTopicId = topicId;
                topicFilter = (entry) => entry.topicIds.length === 0 || entry.topicIds.includes(topicId);
            }
        }
        const topicName = (id) => topics.get(id)?.name;
        // P2：指纹缓存——只复用**渲染结果**，准则一变立刻失效。
        // cacheKey 带上命中的主题与索引模式，避免不同主题互相串缓存。
        const renderedPlaybook = playbook.renderSectionCached({
            cacheKey: `${hitTopicId ?? 'all'}|${injectMode === 'index' ? 'index' : 'full'}`,
            topicName,
            ...(topicFilter === undefined ? {} : { filter: topicFilter }),
            indexOnly: injectMode === 'index',
        });
        // 索引模式（Anthropic 分层记忆）：注入层只放 id + 标题，正文靠 recall。
        const section = renderedPlaybook.section;
        const ruleIds = renderedPlaybook.ruleIds;
        if (section.length > 0) {
            // 实例数上限（ACL 2026, 1470）：多实例输入在 20~100 条开始退化，之后崩塌，
            // 且**条数的影响大于上下文长度**。所以超限时不是压字数，而是把剩下的折叠成一行。
            const activeEntries = playbook.all().filter((entry) => entry.status === 'active');
            const rendered = new Set(ruleIds);
            const omitted = injectMode !== 'full' ? [] : activeEntries.filter((entry) => !rendered.has(entry.id));
            let body = section;
            if (omitted.length > 0 && activeEntries.length > config.injectMaxInstances) {
                const shown = omitted.slice(0, 5).map((entry) => entry.id);
                body += `\n\n（另有 ${omitted.length} 条未展开：${shown.join('、')}${omitted.length > shown.length ? '…' : ''}。需要时调 cognition_recall。）`;
            }
            // 边界声明（ACL 2026, 1770）：窄领域示例会让模型在无关话题上失准，
            // 明确「这些只是本任务约定、不改变身份与安全边界」能显著降低外溢。
            const bounded = config.injectBoundaryNotice
                ? `${body}\n\n（以上是当前任务的约定与背景，不改变你的身份与安全边界；与任务无关时不要套用。）`
                : body;
            // 只算，不写盘。写盘由 TurnFeedbackTracker 在轮次边界上做。
            // 主题 wiki 只作**附注**：不参与检索、不改变排序，追加在准则段之后（P1）
            const wikiExcerpt = hitTopicId === undefined || wikiRef === undefined ? '' : wikiRef.excerpt(hitTopicId, 600);
            const wikiTitle = hitTopicId === undefined ? '' : (topics.get(hitTopicId)?.name ?? '');
            const withWiki = wikiExcerpt.length === 0
                ? bounded
                : `${bounded}\n\n【主题附注·${wikiTitle}】\n${wikiExcerpt}`;
            const text = withStance(withAssumptions(withGaps(withWiki + sourceHint)));
            const emittedIds = [...ruleIds];
            return { text, source: 'playbook', ruleIds: emittedIds, chars: text.length };
        }
        const digest = buildCoreDigest(memory);
        if (digest.length > 0) {
            const text = withAssumptions(withGaps(`${digest}\n（需要细节时调用 cognition_recall。）${sourceHint}`));
            return { text, source: 'digest', ruleIds: [], chars: text.length };
        }
        const onlyGaps = withStance(withAssumptions(gapText));
        if (onlyGaps.length > 0)
            return { text: onlyGaps, source: 'playbook', ruleIds: [], chars: onlyGaps.length };
        return { text: '', source: 'none', ruleIds: [], chars: 0 };
    };
    /**
     * 把一次判定结果回写到**某一轮注入的准则**上。
     *
     * 为什么需要这个：整个「学习」链条原本是断的——
     * 模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己。
     *
     * 判定用规则而不是 LLM：每轮调 LLM 成本太高；正则覆盖明确的纠正/确认，
     * 剩下的靠其他信号补（比如用户直接改代码）。
     *
     * **单次纠正不降级**：累计 appliedBad ≥ 3 且 > appliedGood 才进入 disputed
     * （ReasoningBoost 的结论：判官只有 72.7% 准确，70–90% 噪声下性能不敏感）。
     */
    const applyFeedback = (kind, ids, message) => {
        if (kind === 'neutral' || ids.length === 0)
            return;
        const usageKind = kind === 'correction' ? 'appliedBad' : 'appliedGood';
        const trace = `${kind}: ${message.slice(0, 40)}`;
        for (const id of ids) {
            try {
                playbook.markUsage(id, usageKind, trace, 'user');
                ruleEvents.append({ type: 'RuleUsageRecorded', ruleId: id, usage: usageKind, trace, by: 'system' });
            }
            catch {
                /* 单条失败不影响其余 */
            }
        }
        void playbook.flush();
    };
    /**
     * 手动回写（`POST /cognition-engine/feedback`）：不依赖轮次事件，直接打到最近一轮。
     *
     * 正常的自动闭环走 `session/event`；这个路由留给「事件没挂上」和手工排查两种场景。
     */
    const recordFeedback = (message) => {
        const kind = classifyFeedback(message);
        if (kind === 'neutral')
            return { kind, scored: [] };
        const latest = injectionLog.latest();
        if (latest === undefined)
            return { kind, scored: [] };
        const ids = injectionLog.markVerdict(latest.sessionId, latest.turn, kind);
        applyFeedback(kind, ids, message);
        return { kind, scored: ids };
    };
    // 自动反馈闭环：宿主轮次 → 注入快照 → 用户下一轮的反应 → 回写准则证据
    const turnTracker = new TurnFeedbackTracker(injectionLog, {
        injection: () => {
            const rendered = renderInjectedContext();
            return { ruleIds: rendered.ruleIds, chars: rendered.chars };
        },
        onFeedback: (kind, ids, reaction) => applyFeedback(kind, ids, reaction),
    });
    /** 是否真的收到过 session/event：面板用它区分「闭环在跑」和「事件没挂上」。 */
    let turnTrackingSeen = false;
    /** 子代理会话不参与打分：它们的「用户消息」是父代理的任务说明，不是人的反馈。 */
    const subagentSessions = new Set();
    /**
     * 本轮助手输出缓冲（只用于风格统计，写完即丢，不进磁盘）。
     *
     * 为什么要缓冲：`assistant/message` 是**每个 step** 一条，一轮里可能几十条；
     * 风格指针对应的是「这一轮整体怎么说话」，所以按轮累加，`turn/end` 时一次性算完。
     */
    const assistantBuffers = new Map();
    /** 每个会话当前的轮号，供场合判定记录用（user/message 事件本身不带轮号）。 */
    const registerTurns = new Map();
    /** 最近一次用户轮次开始时间，用于主动闸门的「静默多久」信号。 */
    let lastTurnAtMs = Date.now();
    /** 假设台账：按会话记录模型自作而未确认的假设（不落盘）。 */
    const assumptionLedger = new AssumptionLedger();
    /** 最近一次活跃会话 id：注入段拿不到会话参数，只能用它。 */
    let lastSessionId = null;
    /** 最近一条用户消息：用于主题匹配，决定注入哪些主题的准则（主题隔离）。 */
    let lastUserText = '';
    /** 纠正链入口（在 setupRoutes 里赋值；这里只留引用，避开作用域问题） */
    let correctionChainRef;
    /** 学习流水线入口：提完摘要后自动生成候选 + 自动采用（在 setupRoutes 里赋值） */
    let learningPipelineRef;
    /** 由 setupRoutes 内赋值；工具层通过它把真实取代转给沉积层。 */
    let observeSupersedeRef;
    /** 由 setupRoutes 内赋值；注入渲染在前，实例在后，所以用引用。 */
    let wikiRef;
    /** 由 setupRoutes 内赋值；巡检在 setupRoutes 之外，需要间接拿到来源组装器。 */
    let wikiSourcesRef;
    /** 单轮参与统计的最大字符数：防止超长轮把内存和统计都拖歪。 */
    const MAX_STYLE_CHARS = 12000;
    /**
     * 挂上轮次事件。
     *
     * 为什么用 `session/event` 而不是 `agent/inbox/claimed`：
     * - 它有 `session` 对象，能读到 `session.header.origin` 把子代理排除掉；
     * - turn/start / turn/end / user/message 三类事件都在同一条流上，不用猜时序。
     * 实测时序（session 日志）：turn/start → step/start → system/message →
     * user/message ×N → … → turn/end。
     */
    const installTurnTracking = () => {
        if (config.autoFeedback !== true)
            return;
        const on = ctx.on;
        if (typeof on !== 'function') {
            ctx.logger?.warn?.('cognition-engine: 宿主没有事件订阅能力，自动反馈闭环未挂载');
            return;
        }
        const noteSubagent = (info) => {
            const id = info?.id;
            if (typeof id !== 'string' || id.length === 0)
                return;
            if (subagentSessions.size >= 500)
                subagentSessions.clear();
            subagentSessions.add(id);
        };
        const handler = (session, event) => {
            // 监听器抛错会打到会话上：所有异常就地吞掉。
            try {
                const sessionId = session?.id;
                if (typeof sessionId !== 'string' || sessionId.length === 0)
                    return;
                turnTrackingSeen = true;
                const header = session
                    ?.header;
                // 子代理会话不参与打分：它们的「用户消息」是父代理的任务说明，不是人的反馈。
                // 两道判据都用上——origin 是显式标记，delegationDepth 是所有子会话都有的数值。
                if (header?.origin === 'subagent' || subagentSessions.has(sessionId))
                    return;
                if (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0)
                    return;
                const type = event?.type;
                const data = event?.data;
                // 注入段拿不到会话参数，只能记住最近活跃的那个会话（单用户桌面场景够用）。
                lastSessionId = sessionId;
                if (type === 'turn/start') {
                    const turn = Number(data?.turn);
                    if (Number.isFinite(turn))
                        turnTracker.beginTurn(sessionId, turn);
                    if (Number.isFinite(turn))
                        registerTurns.set(sessionId, turn);
                    lastTurnAtMs = Date.now();
                    assistantBuffers.delete(sessionId);
                }
                else if (type === 'user/message') {
                    const text = extractUserText(data);
                    turnTracker.appendUserText(sessionId, text);
                    if (!isRuntimeContext(text) && text.trim().length > 0) {
                        lastUserText = text;
                        // 自动扳机：这句话像纠正、且开关开着，就跑一次链（内部有 10 分钟冷却）
                        if (detectCorrection(text).corrected) {
                            const auto = autoToggles();
                            if (auto.autoLearn || auto.autoRevise) {
                                void correctionChainRef?.(text).catch((error) => {
                                    ctx.logger?.warn?.(`cognition-engine: 纠正链失败 ${messageOf(error)}`);
                                });
                            }
                        }
                    }
                    // 用户明确纠正 → 之前那些"模型自作假设"已被否掉，清空台账。
                    // 依据 arXiv:2505.06120：模型走错方向后不会自己回头，得靠外部信号打断。
                    if (!isRuntimeContext(text) && classifyFeedback(text) === 'correction') {
                        const cleared = assumptionLedger.clear(sessionId);
                        if (cleared > 0) {
                            ctx.logger?.info?.(`cognition-engine: 用户纠正，清掉 ${cleared} 条未确认假设`);
                        }
                    }
                    // 场合判定：只记一行，不改注入。运行时注入的上下文块和空白不记。
                    if (text.trim().length > 0 && !isRuntimeContext(text)) {
                        try {
                            registerLog.record({
                                sessionId,
                                turn: registerTurns.get(sessionId) ?? 0,
                                text,
                                decision: judgeRegister(text),
                            });
                        }
                        catch {
                            /* 记录失败绝不影响会话 */
                        }
                    }
                }
                else if (type === 'assistant/message') {
                    const message = data?.message;
                    const turn = Number(data?.turn);
                    const text = extractUserText(message); // 同样的取文本逻辑：只拼 text 块
                    // 假设台账：不受 styleEnabled 影响，永远记（这是防漂移的一环）。
                    if (text.length > 0)
                        assumptionLedger.observe(sessionId, text);
                    if (config.styleEnabled) {
                        if (text.length > 0) {
                            const current = assistantBuffers.get(sessionId);
                            const base = current !== undefined && current.turn === turn ? current.text : '';
                            const merged = base.length >= MAX_STYLE_CHARS ? base : (base + '\n' + text).slice(0, MAX_STYLE_CHARS);
                            assistantBuffers.set(sessionId, { turn: Number.isFinite(turn) ? turn : 0, text: merged });
                        }
                    }
                }
                else if (type === 'turn/end') {
                    // 先算风格（用本轮助手输出），再结束轮次跟踪——顺序反了会丢缓冲
                    if (config.styleEnabled) {
                        const buffer = assistantBuffers.get(sessionId);
                        assistantBuffers.delete(sessionId);
                        if (buffer !== undefined && buffer.text.trim().length > 0) {
                            try {
                                styleStore.record({
                                    sessionId,
                                    turn: buffer.turn,
                                    text: buffer.text,
                                    catchphrases: config.styleCatchphrases,
                                });
                            }
                            catch {
                                /* 统计失败不影响会话 */
                            }
                        }
                    }
                    turnTracker.endTurn(sessionId);
                }
            }
            catch {
                /* 事件处理失败不能影响会话 */
            }
        };
        // 统一登记反注册：插件被停用/热重载时必须解绑。
        // 宿主的 ctx.on 本身会随上下文销毁自动解绑，但这里显式登记一层——
        // 否则热重载几次就会有多个监听器同时写同一个日志文件（重复行）。
        const listen = (event, listener) => {
            try {
                const disposer = on.call(ctx, event, listener);
                if (typeof disposer === 'function')
                    disposers.push(disposer);
            }
            catch (error) {
                ctx.logger?.warn?.(`cognition-engine: 订阅 ${event} 失败 ${messageOf(error)}`);
            }
        };
        listen('subagent/start', noteSubagent);
        listen('subagent/end', noteSubagent);
        listen('session/disposed', (session) => {
            const id = session?.id;
            if (typeof id === 'string') {
                turnTracker.forget(id);
                assistantBuffers.delete(id);
            }
        });
        listen('session/event', handler);
        ctx.logger?.info?.('cognition-engine: 自动反馈闭环已挂载（session/event）');
    };
    installTurnTracking();
    /**
     * 记忆变了就重算准则的证据链。
     *
     * 这是「作废会传染」的落点：删一条记忆，依赖它的准则必须知道自己失去了支撑，
     * 而不是继续当作无事发生（那正是 TMS 说的「留下没有主人的下游结论」）。
     */
    const refreshEvidence = () => {
        try {
            const changed = playbook.recheckEvidence();
            if (changed.length > 0) {
                ctx.logger?.info?.(`cognition-engine: ${changed.length} 条准则的证据链状态变化（${changed.join(', ')}）`);
                void playbook.flush();
            }
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 证据链重算失败 ${messageOf(error)}`);
        }
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
            /** 沉积层总开关（默认关；关着只是不再写新事件，已有链不删） */
            sediment: { enabled: config.sedimentEnabled === true },
            proactive: {
                pending: proactiveStore.pending().length,
                recordOnly: proactiveStore.phase === 'P1',
                phase: proactiveStore.phase,
                adoptionRate: proactiveStore.adoptionRate(),
                samples: proactiveStore.document.stats.adopted + proactiveStore.document.stats.dismissed,
                rules: proactiveStore.document.rules.filter((rule) => rule.active).length,
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
                injectSource: renderInjectedContext().source,
            },
            /**
             * 自动反馈闭环的体检数据。
             *
             * `tracking` 是关键：false 说明这个进程没收到过 session/event——
             * 要么宿主没有事件能力，要么挂载点变了。观察期先看这一项。
             */
            feedback: {
                enabled: config.autoFeedback === true,
                tracking: turnTrackingSeen,
                ...injectionLog.statistics(),
            },
            persona: {
                present: persona.present,
                chars: persona.usage().rendered,
                revision: persona.document?.revision ?? 0,
                pending: persona.pending().length,
            },
            style: {
                enabled: config.styleEnabled,
                turns: styleStore.sampleSummary().turns,
                status: styleStore.sampleSummary().sufficient ? styleStore.compare().status : 'insufficient',
                chars: styleStore.sampleSummary().chars,
            },
            cpe: {
                cases: cpe.document.holdout.cases.length,
                frozenAt: cpe.document.holdout.frozenAt,
                baseline: cpe.document.baseline?.passRate ?? null,
                status: cpe.document.lastCheck?.status ?? 'insufficient',
            },
            budget: (() => {
                budget.syncActiveRules(playbook.stats().active);
                const status = budget.status();
                return {
                    week: status.week,
                    quota: status.quota,
                    used: status.used,
                    remaining: status.remaining,
                    paused: status.paused,
                    pauseReason: status.pauseReason,
                };
            })(),
            shadow: shadow.stats(),
            retrieval: (() => {
                const overview = recallLog.overview();
                const evaluated = retrievalEval.evaluate(recallIdsOf);
                return {
                    logged: overview.total,
                    zeroRate: overview.zeroRate,
                    cases: evaluated.cases,
                    top1: evaluated.top1,
                    top3: evaluated.top3,
                    status: evaluated.status,
                };
            })(),
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
        /** 同主题互斥事实对：面板「记忆」页签顶部据此显示「标记取代」，让人裁决。 */
        memoryConflicts: memory.conflicts().map((item) => ({
            subject: item.subject,
            leftId: item.leftId,
            rightId: item.rightId,
        })),
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
    /**
     * CPE 评测用的「准则排名」：按与问题的相似度给**当前生效**准则排序。
     *
     * 为什么不复用准则本的注入排序：注入排序混了有效分、衰减、主题，
     * 用来做「该命中的有没有被挤掉」的回归测试会引入无关波动。
     * 这里只按文本相关度排，测的是检索面，变量单一。
     */
    const ruleRankResolver = (question) => playbook
        .all()
        .filter((entry) => entry.status === 'active')
        .map((entry) => ({ id: entry.id, score: textSimilarity(question, entry.content) }))
        .sort((a, b) => b.score - a.score)
        .map((item) => item.id);
    /**
     * 收一轮主动扫描的来源数据。全部是可观测计数，不做主观判断。
     *
     * 故意不在这里做任何模型调用：主动闸门每 patrolIntervalHours 跑一次，
     * 一旦掺进 LLM，光是「观察」就变成持续烧 token。
     */
    const collectScanSource = () => {
        // 用 withAge() 而不是 check_due_tasks()：后者的 overdueMs 只对**逾期**任务有意义，
        // 这里要的是「所有未完成任务的真实年龄」，口径和 /detail 完全一致。
        const due = taskManager
            .withAge()
            .filter((task) => task.status !== 'COMPLETED' && task.overdue)
            .map((task) => ({
            id: task.id,
            description: task.description,
            overdueHours: Math.max(0, Math.round(task.ageMs / 3_600_000)),
        }));
        const openGaps = gaps.open().map((gap) => ({ id: gap.id, text: gap.text }));
        const active = playbook.all().filter((entry) => entry.status === 'active');
        const brokenRules = active
            .filter((entry) => entry.evidence?.status === 'orphaned')
            .map((entry) => ({ id: entry.id, content: entry.content }));
        const expiredRules = active
            .filter((entry) => playbook.isExpired(entry))
            .map((entry) => ({ id: entry.id, content: entry.content }));
        return { dueTasks: due, gaps: openGaps, brokenRules, expiredRules };
    };
    const runProactiveScan = () => {
        const source = collectScanSource();
        const scored = scoreScan({
            pendingDue: source.dueTasks.length,
            unresolvedGaps: source.gaps.length,
            brokenEvidence: source.brokenRules.length,
            expiredRules: source.expiredRules.length,
            silenceMs: Math.max(0, Date.now() - lastTurnAtMs),
        });
        const items = proactiveStore.recordScan(source, scored.score);
        return {
            score: scored.score,
            parts: scored.parts,
            items,
            canSpeak: proactiveStore.canSpeak(scored.score),
            phase: proactiveStore.phase,
        };
    };
    /**
     * 检索评测用的「现算召回」：必须用**当前**记忆库。
     *
     * 为什么不复用历史召回日志：日志里的库和现在不一样，
     * 拿它算指标得到的是「过去的准确率」，回答不了「现在准不准」。
     */
    const recallIdsOf = (query) => memory.recall(query, { mode: 'strict' }).map((hit) => hit.fact.id);
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
        /** 读 POST 请求体（上限 8MB）；宿主给的不是流就返回空串。 */
        const readRequestBody = async (request) => {
            const req = request;
            if (typeof req[Symbol.asyncIterator] !== 'function')
                return '';
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                size += buf.length;
                if (size > 8 * 1024 * 1024)
                    throw new Error('请求体太大（>8MB）');
                chunks.push(buf);
            }
            return Buffer.concat(chunks).toString('utf8');
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
                            // 长文本必须走请求体：塞 query string 会超过 Node 的请求行上限（431），
                            // 而且 431 是 Node 自己回的，业务代码根本没机会报错。
                            const body = method === 'POST' ? await readRequestBody(request) : '';
                            send(response, 200, await produce(new URL(req.url ?? path, 'http://local'), body));
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
        // 知识缺口：模型卡壳时登记，下次针对性补
        route('/cognition-engine/gaps', () => ({ gaps: gaps.all(), open: gaps.open(), stats: gaps.stats() }));
        route('/cognition-engine/gaps/add', (url) => {
            const text = url.searchParams.get('text') ?? '';
            if (text.trim().length === 0)
                throw new Error('缺口描述不能为空');
            const context = url.searchParams.get('context');
            const { gap, duplicate } = gaps.add({ text, ...(context === null ? {} : { context }) });
            gaps.flush();
            return { gap, duplicate };
        }, { method: 'POST' });
        route('/cognition-engine/gaps/resolve', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const ok = gaps.resolve(id, url.searchParams.get('by') ?? '人工确认');
            if (ok) {
                gaps.flush();
                // 联动：缺口解决了，相关提醒立刻下线
                proactiveStore.clearByTarget(id, '缺口已补齐');
            }
            return { id, ok };
        }, { method: 'POST' });
        // 注入快照：最近 N 轮注入了哪些准则
        route('/cognition-engine/injection/recent', (url) => {
            const limit = Number(url.searchParams.get('limit') ?? '10');
            return { recent: injectionLog.recent(Number.isFinite(limit) ? limit : 10), stats: injectionLog.statistics() };
        });
        // 反馈回写：把一个用户回复判成纠正/确认，回写到上一轮注入的准则
        route('/cognition-engine/feedback', (url) => {
            const message = url.searchParams.get('message') ?? '';
            if (message.trim().length === 0)
                throw new Error('message 不能为空');
            return recordFeedback(message);
        }, { method: 'POST' });
        // 准则事件日志：全部 / 单条准则 / 统计
        route('/cognition-engine/events', (url) => {
            const ruleId = url.searchParams.get('ruleId');
            if (ruleId !== null && ruleId.length > 0)
                return { ruleId, events: ruleEvents.forRule(ruleId) };
            return { stats: ruleEvents.stats(), recent: ruleEvents.all().slice(-20) };
        });
        route('/cognition-engine/state', () => snapshot());
        // 读取记忆默认开放（令牌文件本就可被同机进程读取，锁读取只增加摩擦）；
        // 显式配置 lockToken 时才保护详情。写操作（clear/model/lock）始终需要口令。
        route('/cognition-engine/detail', () => ({
            ...detail(),
            // 主题 wiki 摘要（附注用；不含全文，避免把面板撑爆）
            inbox: {
                stats: inbox.stats(),
                pending: inbox.list('pending').slice(0, 20).map((cand) => ({ ...cand, knowledge: library.describe(cand.sourceId) })),
                duplicates: inbox.list('duplicate').slice(0, 8),
                sources: { total: sources.list(200).length, chain: sources.verify() },
                library: library.stats(),
            },
            injectMode,
            usage: summarizeUsage({
                injectionFile: join(dataDir(), 'cognition-injection.jsonl'),
                usageFile: join(dataDir(), 'cognition-usage.jsonl'),
                pricePerMTokens: config.pricePerMTokens,
            }),
            wiki: (wikiRef?.list() ?? []).map((page) => ({
                topicId: page.topicId,
                topicName: page.topicName,
                excerpt: page.markdown.slice(0, 180),
                bytes: page.bytes,
                sourceBytes: page.sourceBytes,
                trimmed: page.trimmed,
            })),
        }), { requireAuth: explicitLock });
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
            proactiveStore.clearByTarget(id, '任务已删除');
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
            // 联动：任务状态一变（尤其标记完成），立刻清掉它的待处理提醒。
            // 不这么做就会出现「任务早做完了，提醒还挂着」——用户会以为系统没在看。
            const cleared = proactiveStore.clearByTarget(id, status === 'COMPLETED' ? '任务已完成' : '任务状态已更新');
            // 反向联动（S10）：同一个 id 的工单阶段跟着走，别让两块看板说两套话
            const stage = status === 'COMPLETED' ? 'done' : status === 'IN_PROGRESS' ? 'doing' : 'open';
            for (const ticket of proactiveStore.tickets()) {
                if (ticket.targetId !== id)
                    continue;
                if (ticket.status === 'stale' || ticket.status === 'dismissed')
                    continue;
                proactiveStore.setStage(ticket.id, stage, { by: 'user', note: '从任务列表改状态' });
            }
            return { task, clearedReminders: cleared, ticketStage: stage };
        }, { method: 'POST', requireAuth: explicitLock });
        // 删除 / 恢复一条记忆（软删除）
        route('/cognition-engine/memory/delete', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const restore = url.searchParams.get('restore') === 'true';
            const ok = restore ? memory.restoreDeleted(id) : memory.softDelete(id);
            if (!ok)
                throw new Error(restore ? '没有可恢复的记忆' : '记忆不存在');
            refreshEvidence();
            // 联动：准则的证据链可能因此断裂 → 相关提醒要重算；已恢复则清掉旧的
            if (restore)
                proactiveStore.clearByTarget(id, '记忆已恢复');
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
        route('/cognition-engine/playbook', (url) => {
            const includeRejected = url.searchParams.get('includeRejected') === 'true';
            return {
                stats: playbook.stats(),
                // 带上计算出来的过期标记：页面不用自己算时间，也能正确分组到「已过期」
                entries: playbook.all().filter((entry) => includeRejected || entry.status !== 'rejected').map((entry) => ({
                    ...entry,
                    expired: entry.status === 'active' && playbook.isExpired(entry),
                })),
                rendered: playbook.render(),
            };
        });
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
            // 边界用逗号/顿号分隔（面板一行输入），空 = 未声明 → addManual 会打回
            const boundaryRaw = url.searchParams.get('boundary') ?? '';
            const boundaryEnvs = boundaryRaw
                .split(/[,，、;；]/)
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
            const outcome = playbook.addManual({
                content: url.searchParams.get('content') ?? '',
                section: url.searchParams.get('section') ?? undefined,
                boundaryEnvs,
            });
            if (outcome.accepted)
                await playbook.flush();
            return outcome;
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/playbook/act', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const action = url.searchParams.get('action') ?? '';
            let ok = false;
            /** 如果这一步触发过 CPE 回归检查，把结果带回去（页面据此解释「为什么被回滚」）。 */
            let gate;
            /** true 表示「没成功但不是故障」（预算用尽转 shadow / 回归回滚），不要抛 500。 */
            let softFail = false;
            switch (action) {
                case 'accept': {
                    // 候选没有边界就不能生效（P3-1）；允许在采纳时一并传 envs
                    const boundaryRaw = url.searchParams.get('envs') ?? '';
                    if (boundaryRaw.trim().length > 0) {
                        playbook.setBoundary(id, boundaryRaw.split(/[|｜]/).map((value) => value.trim()).filter((value) => value.length > 0));
                    }
                    else {
                        const target = playbook.get(id);
                        if (target !== undefined && (target.boundaryEnvs ?? []).length === 0) {
                            return { ok: false, error: '先填适用边界（envs）再采纳：没有边界的准则会被到处套用' };
                        }
                    }
                    // P4-2 practice probe：先看历史上会不会撞上用户纠正
                    try {
                        const target = playbook.get(id);
                        if (target !== undefined) {
                            const probe = runPracticeProbes({
                                candidate: target.content,
                                turns: buildProbeTurns(config.probeMaxTurns ?? 60),
                                minOverlap: config.probeMinOverlap ?? 0.3,
                                maxCounter: config.probeMaxCounter ?? 2,
                            });
                            if (probe.verdict === 'reject') {
                                return { ok: false, error: 'practice probe 拒收：' + probe.reason, probe };
                            }
                        }
                    }
                    catch {
                        /* 试跑本身失败不阻断（没有样本时本来也判不了） */
                    }
                    // 学习预算（S6）：名额用尽时**转进 shadow 试运行**，而不是硬拒。
                    // 这样「想学」和「别污染上下文」两件事都满足。
                    budget.syncActiveRules(playbook.stats().active);
                    const budgetCheck = budget.canLearn('new');
                    if (!budgetCheck.ok) {
                        const candidate = playbook.get(id);
                        const shadowed = shadow.add({
                            text: candidate?.content ?? '',
                            subject: candidate?.section ?? '未分类',
                            source: 'budget-overflow',
                            note: budgetCheck.reason ?? '本周名额已用完',
                        });
                        ok = playbook.reject(id); // 移出待审，进 shadow 观察
                        softFail = true;
                        gate = { budget: budgetCheck, shadowId: shadowed.entry?.id ?? null, movedToShadow: true };
                        break;
                    }
                    // CPE 闸门：启用一条新准则前先快照，启用后跑回归集；
                    // 掉分超阈值就回滚文件并拒绝本次启用——这是「越学越稳」的落点。
                    //
                    // 严格模式（默认）：如果回归集样本不足，压根测不出来，就不放行——
                    // 转 shadow 观察，等有足够用例再启用。理由：一个测不出来的闸门，
                    // 通过它等于没有闸门（NeMo 的质量门要求基准必须两边都在，缺就算失败；
                    // ai_eval 空题集直接 passed_gate=FALSE，不给 0 分当及格）。
                    if (config.cpeStrictGate) {
                        const preCheck = cpe.check(ruleRankResolver);
                        if (blocksAcceptance(preCheck.status, config.cpeStrictGate)) {
                            const candidate = playbook.get(id);
                            const shadowed = shadow.add({
                                text: candidate?.content ?? '',
                                subject: candidate?.section ?? '未分类',
                                source: 'gate-insufficient',
                                note: preCheck.note ?? '回归集样本不足，无法评估',
                            });
                            playbook.reject(id, '转 shadow：回归集不足');
                            ok = false;
                            softFail = true;
                            gate = {
                                ...preCheck,
                                movedToShadow: true,
                                shadowId: shadowed.entry?.id ?? null,
                                reason: '回归集样本不足，无法评估；已转 shadow 观察，先补用例再启用',
                            };
                            break;
                        }
                    }
                    const snap = cpe.snapshotFiles([playbook.path]);
                    ok = playbook.accept(id);
                    if (ok) {
                        await playbook.flush();
                        const check = cpe.check(ruleRankResolver);
                        gate = check;
                        if (check.status === 'red') {
                            cpe.restoreFiles(snap);
                            playbook.loadSync();
                            cpe.recordIncident({
                                label: `accept ${id}`,
                                before: check.passRate === null || check.delta === null ? null : check.passRate - check.delta,
                                after: check.passRate,
                                dropped: check.delta,
                                rolledBack: true,
                                detail: check.note,
                            });
                            ok = false;
                            softFail = true;
                        }
                        else {
                            ruleEvents.append({ type: 'RuleAccepted', ruleId: id, by: 'user' });
                            budget.consume('new');
                        }
                    }
                    break;
                }
                case 'reject':
                    ok = playbook.reject(id);
                    break;
                case 'retire':
                    ok = playbook.retire(id, '手动停用');
                    if (ok) {
                        ruleEvents.append({ type: 'RuleRetired', ruleId: id, reason: '手动停用', by: 'user' });
                        // 停用后这条不再参与注入，关于它的提醒也就没意义了
                        proactiveStore.clearByTarget(id, '准则已停用');
                    }
                    break;
                case 'revive':
                    ok = playbook.revive(id);
                    break;
                case 'revise': {
                    const nextContent = url.searchParams.get('content') ?? '';
                    const diagnosis = url.searchParams.get('diagnosis') ?? '';
                    const evidence = url.searchParams.get('evidence') ?? '';
                    try {
                        ok = playbook.revise(id, nextContent, {
                            ...(diagnosis.trim().length === 0 ? {} : { diagnosis }),
                            ...(evidence.trim().length === 0 ? {} : { evidence }),
                        });
                    }
                    catch (error) {
                        return { ok: false, error: messageOf(error) };
                    }
                    // 修旧也占名额（但不拦：改错比不改好）
                    if (ok) {
                        budget.consume('revise');
                        proactiveStore.clearByTarget(id, '准则已修订');
                    }
                    break;
                }
                case 'extend': {
                    const raw = url.searchParams.get('validTo');
                    ok = playbook.extend(id, raw === null ? null : (parseMoment(raw) ?? null));
                    if (ok)
                        proactiveStore.clearByTarget(id, '准则已续期');
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
                    if (ok) {
                        ruleEvents.append({ type: 'RuleRetired', ruleId: id, reason: '人工删除', by: 'user' });
                        proactiveStore.clearByTarget(id, '准则已删除');
                    }
                    break;
                // 人工标记冲突对：自动检测不可靠时用这个
                case 'markConflict': {
                    const otherId = url.searchParams.get('otherId') ?? '';
                    ok = playbook.markConflict(id, otherId);
                    break;
                }
                // 未决冲突的人工裁决：保留哪一条
                case 'resolve': {
                    const keepId = url.searchParams.get('keepId') ?? '';
                    ok = playbook.resolveConflict(keepId, id, url.searchParams.get('reason') ?? '人工裁决');
                    break;
                }
                // 立墓碑：这条本来就错了（区别于被更好的取代）
                case 'revoke':
                    ok = playbook.revoke(id, url.searchParams.get('reason') ?? '人工撤销');
                    if (ok)
                        ruleEvents.append({ type: 'RuleRevoked', ruleId: id, reason: url.searchParams.get('reason') ?? '人工撤销', by: 'user' });
                    break;
                // 分项使用打标：applied / appliedGood / appliedBad / missed / userCorrected
                case 'usage': {
                    const kind = url.searchParams.get('kind') ?? '';
                    const allowed = ['applied', 'appliedGood', 'appliedBad', 'missed', 'userCorrected'];
                    if (!allowed.includes(kind))
                        throw new Error(`kind 只能是 ${allowed.join(' / ')}`);
                    ok = playbook.markUsage(id, kind, url.searchParams.get('trace') ?? '');
                    break;
                }
                // 设置证据来源（sourceIds）：改完立刻重算证据链
                case 'source': {
                    const ids = (url.searchParams.get('sourceIds') ?? '')
                        .split(',')
                        .map((x) => x.trim())
                        .filter((x) => x.length > 0);
                    ok = playbook.setSourceIds(id, ids);
                    if (ok)
                        refreshEvidence();
                    break;
                }
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
                        when: str('when'),
                    });
                    break;
                }
                default:
                    throw new Error('action 只能是 accept/reject/retire/revive/revise/extend/helpful/harmful/delete/flags');
            }
            if (!ok && !softFail)
                throw new Error(`准则本操作失败：${action} ${id}`);
            await playbook.flush();
            return { id, action, ok, ...(gate === undefined ? {} : { gate }) };
        }, { method: 'POST', requireAuth: explicitLock });
        // 当前实际注入到系统提示的内容（排查「面板说有、模型看不到」这类问题用）
        route('/cognition-engine/injected', () => {
            const { text, source, ruleIds, chars } = renderInjectedContext();
            return {
                source,
                chars,
                text,
                persona: persona.render(),
                /** 本轮实际展开的准则条数 / 生效准则总数（用于判断有没有被折叠） */
                ruleCount: ruleIds.length,
                activeRuleCount: playbook.all().filter((entry) => entry.status === 'active').length,
                injectMaxInstances: config.injectMaxInstances,
                /** 本会话未确认的假设（防多轮漂移用）。 */
                assumptions: lastSessionId === null ? [] : assumptionLedger.list(lastSessionId).map((item) => item.text),
            };
        });
        // 人格块（S3）：查看 / 提案 / 确认 / 拒绝。
        // 设计上 agent 只能 propose，只有 confirm 才真的改写——人格被悄悄重写是最难查的退化。
        route('/cognition-engine/persona', () => {
            const doc = persona.document;
            return {
                present: doc !== undefined,
                revision: doc?.revision ?? 0,
                updatedAt: doc?.updatedAt ?? 0,
                path: persona.path,
                usage: persona.usage(),
                render: persona.render(),
                /** 上次写盘失败原因；非空说明「改了但没存下」，不能当成功。 */
                saveError: persona.lastSaveError ?? null,
                /** traits / slots 只做审计，不进注入段（BFI-2 不是文本分类器）。 */
                audit: doc === undefined
                    ? undefined
                    : {
                        personaTraits: doc.blocks.persona.traits ?? {},
                        personaInteractionStyle: doc.blocks.persona.interactionStyle ?? {},
                        humanSlots: doc.blocks.human.slots ?? {},
                        humanFacts: doc.blocks.human.facts ?? [],
                    },
                history: doc === undefined ? [] : [...doc.blocks.persona.history, ...doc.blocks.human.history].slice(-10),
                /**
                 * 原始块内容（编辑页面要用）。
                 *
                 * 只认 limit / readOnly / lockedPhrases / value 这四项——
                 * `traits` / `slots` / `facts` / `history` 一律不在这里返回给编辑框，
                 * 免得页面把它们当成可编辑正文写回去。
                 */
                blocks: doc === undefined
                    ? null
                    : {
                        persona: {
                            value: doc.blocks.persona.value,
                            limit: doc.blocks.persona.limit,
                            readOnly: doc.blocks.persona.readOnly === true,
                            lockedPhrases: doc.blocks.persona.lockedPhrases ?? [],
                        },
                        human: {
                            value: doc.blocks.human.value,
                            limit: doc.blocks.human.limit,
                            readOnly: doc.blocks.human.readOnly === true,
                            lockedPhrases: doc.blocks.human.lockedPhrases ?? [],
                        },
                    },
                budget: doc?.budget ?? null,
                pending: persona.pending(),
            };
        });
        // 从零创建人格文件（首次启用走这里；已存在时拒绝，不能当覆盖后门）
        route('/cognition-engine/persona/create', (url) => persona.create({
            persona: url.searchParams.get('persona') ?? '',
            human: url.searchParams.get('human') ?? '',
        }), { method: 'POST' });
        // CPE 回归闸门（S5）
        route('/cognition-engine/cpe', () => {
            const doc = cpe.document;
            return {
                path: cpe.path,
                thresholds: doc.thresholds,
                holdout: {
                    cases: doc.holdout.cases.length,
                    frozenAt: doc.holdout.frozenAt,
                    neverUsedForGeneration: doc.holdout.neverUsedForGeneration,
                    derivedFromRules: doc.holdout.cases.filter((item) => item.derivedFrom === 'rules').length,
                    // 面板要看见每一条，才能删（count 不够）
                    caseList: doc.holdout.cases.map((item) => ({
                        id: item.id,
                        question: item.question,
                        expectedRuleIds: item.expectedRuleIds,
                        derivedFrom: item.derivedFrom,
                        note: item.note ?? null,
                    })),
                },
                baseline: doc.baseline,
                lastCheck: doc.lastCheck,
                incidents: doc.incidents.slice(-5),
                /** 实时算一遍，不写盘：看一眼当前回归通过率 */
                live: cpe.evaluate(ruleRankResolver),
                saveError: cpe.lastSaveError ?? null,
            };
        });
        route('/cognition-engine/cpe/case', (url) => {
            const question = url.searchParams.get('question') ?? '';
            const rules = (url.searchParams.get('rules') ?? '')
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
            const note = url.searchParams.get('note');
            return cpe.addCase({ question, expectedRuleIds: rules, ...(note === null ? {} : { note }), by: 'user' });
        }, { method: 'POST' });
        route('/cognition-engine/cpe/case/remove', (url) => ({ id: url.searchParams.get('id') ?? '', ok: cpe.removeCase(url.searchParams.get('id') ?? '') }), { method: 'POST' });
        route('/cognition-engine/cpe/seed', () => cpe.seedFromRules(playbook.all().filter((entry) => entry.status === 'active').map((entry) => ({ id: entry.id, content: entry.content }))), { method: 'POST' });
        route('/cognition-engine/cpe/freeze', () => cpe.freeze(), { method: 'POST' });
        route('/cognition-engine/cpe/unfreeze', () => cpe.unfreeze(), { method: 'POST' });
        route('/cognition-engine/cpe/thresholds', (url) => {
            const raw = url.searchParams.get('minCases');
            const minCases = raw === null ? undefined : Number(raw);
            return cpe.setThresholds(minCases === undefined || !Number.isFinite(minCases) ? {} : { minCases: Math.max(1, Math.round(minCases)) });
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/cpe/baseline', () => cpe.measureBaseline(ruleRankResolver), { method: 'POST' });
        route('/cognition-engine/cpe/check', () => cpe.check(ruleRankResolver), { method: 'POST' });
        // 学习预算（S6）
        route('/cognition-engine/budget', () => {
            budget.syncActiveRules(playbook.stats().active);
            return { path: budget.path, ...budget.status(), saveError: budget.lastSaveError ?? null };
        });
        route('/cognition-engine/budget/signals', () => {
            // 只喂能算出来的指标，其余留空（宁可漏报也不误停）
            const stats = playbook.stats();
            const orphaned = playbook.all().filter((entry) => entry.evidence?.status === 'orphaned').length;
            return budget.evaluateSignals({ activeRules: stats.active, orphanedRules: orphaned });
        });
        route('/cognition-engine/budget/pause', (url) => {
            const code = url.searchParams.get('code') ?? 'futile';
            budget.pause({
                code: (['futile', 'still-wrong', 'overcrowded', 'flip-flop', 'idle-quota'].includes(code) ? code : 'futile'),
                reason: url.searchParams.get('reason') ?? '手动暂停学习',
                action: 'pause-new',
            });
            return budget.status();
        }, { method: 'POST' });
        route('/cognition-engine/budget/resume', () => {
            budget.resume();
            return budget.status();
        }, { method: 'POST' });
        // shadow 试运行（S6）
        route('/cognition-engine/shadow', () => ({
            path: shadow.path,
            stats: shadow.stats(),
            entries: shadow.all().slice(-30),
            saveError: shadow.lastSaveError ?? null,
        }));
        route('/cognition-engine/shadow/add', (url) => {
            const result = shadow.add({
                text: url.searchParams.get('text') ?? '',
                subject: url.searchParams.get('subject') ?? undefined,
                source: url.searchParams.get('source') ?? 'manual',
            });
            return result;
        }, { method: 'POST' });
        route('/cognition-engine/shadow/record', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const flag = (name) => url.searchParams.get(name) === 'true';
            return {
                id,
                ok: shadow.record(id, {
                    occurrence: flag('occurrence'),
                    hit: flag('hit'),
                    helpful: flag('helpful'),
                    harmful: flag('harmful'),
                }),
            };
        }, { method: 'POST' });
        route('/cognition-engine/shadow/promote', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const promoted = shadow.promote(id);
            if (!promoted.ok || promoted.entry === undefined)
                return promoted;
            // 转正 = 走正常提交路径（仍需人工在准则本里 accept，不绕过审核）
            const outcome = playbook.submit({ section: promoted.entry.subject, content: promoted.entry.text });
            await playbook.flush();
            return { ...promoted, submitted: outcome.accepted, ruleId: outcome.entry?.id ?? null };
        }, { method: 'POST' });
        route('/cognition-engine/shadow/reject', (url) => ({
            id: url.searchParams.get('id') ?? '',
            ok: shadow.reject(url.searchParams.get('id') ?? '', url.searchParams.get('note') ?? undefined),
        }), { method: 'POST' });
        route('/cognition-engine/shadow/sweep', () => ({ expired: shadow.sweepExpired().map((entry) => entry.id) }), { method: 'POST' });
        // 主动闸门（S7）：默认 P1 只记录，不发言
        route('/cognition-engine/proactive', () => {
            const doc = proactiveStore.document;
            return {
                path: proactiveStore.path,
                phase: doc.phase,
                /** P1 永远不发言；这条字段就是给页面「为什么没有主动消息」的解释。 */
                recordOnly: doc.phase === 'P1',
                rules: doc.rules,
                pending: proactiveStore.pending().slice(0, 20),
                stats: { ...doc.stats, adoptionRate: proactiveStore.adoptionRate() },
                /** 下一阶段的门槛，页面直接展示，避免「为什么不能开 P3」的疑问。 */
                gates: { p3MinSamples: 20, p3MinAdoption: 0.7 },
                saveError: proactiveStore.lastSaveError ?? null,
            };
        });
        route('/cognition-engine/proactive/scan', () => runProactiveScan(), { method: 'POST' });
        route('/cognition-engine/proactive/adopt', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const item = proactiveStore.pending().find((entry) => entry.id === id);
            // 「好，我去处理」= 这件事真的开始做了 → 关联任务标成「进行中」。
            // 只动 pending-due 这一类：缺口/准则那几类没有对应的任务台账。
            let taskUpdated = null;
            if (item !== undefined && item.kind === 'pending-due') {
                try {
                    const task = await taskManager.update_task_progress(item.targetId, 'IN_PROGRESS', '从提醒里点「我去处理」');
                    if (task !== undefined)
                        taskUpdated = { id: task.id, status: task.status };
                }
                catch {
                    /* 任务可能已被删除：提醒照样标记为已采纳 */
                }
            }
            return { id, ok: proactiveStore.adopt(id), taskUpdated };
        }, { method: 'POST' });
        route('/cognition-engine/proactive/dismiss', async (url) => {
            const id = url.searchParams.get('id') ?? '';
            const item = proactiveStore.pending().find((entry) => entry.id === id);
            // 「不用管」= 这件事不做了 → 关联任务直接删掉（不是标完成：
            // 标完成会让它变成「做过的事」，而用户的意思是「这事我不打算做」）。
            let taskDeleted = false;
            if (item !== undefined && item.kind === 'pending-due') {
                try {
                    taskDeleted = await taskManager.delete_task(item.targetId);
                }
                catch {
                    /* 任务已不存在：忽略 */
                }
            }
            return { id, ok: proactiveStore.dismiss(id), taskDeleted };
        }, { method: 'POST' });
        route('/cognition-engine/proactive/phase', (url) => {
            const raw = url.searchParams.get('phase');
            const phase = raw === 'P1' || raw === 'P2' || raw === 'P3' ? raw : 'P1';
            return proactiveStore.setPhase(phase);
        }, { method: 'POST' });
        route('/cognition-engine/proactive/rule', (url) => proactiveStore.addRule(url.searchParams.get('text') ?? ''), { method: 'POST' });
        route('/cognition-engine/proactive/rule/remove', (url) => ({
            id: url.searchParams.get('id') ?? '',
            ok: proactiveStore.removeRule(url.searchParams.get('id') ?? ''),
        }), { method: 'POST' });
        // —— 工单（S10）——
        route('/cognition-engine/tickets', () => {
            // 来源待办已被删除的提醒自动下线，否则会永远挂在「待办」里（实测过）。
            proactiveStore.pruneOrphanedTargets((id) => taskManager.get(id) !== undefined);
            return {
                phase: proactiveStore.phase,
                board: proactiveStore.board(),
                stats: proactiveStore.document.stats,
            };
        });
        route('/cognition-engine/tickets/stage', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const raw = url.searchParams.get('stage');
            const stage = raw === 'draft' || raw === 'open' || raw === 'doing' || raw === 'review' || raw === 'done' ? raw : 'open';
            const note = url.searchParams.get('note');
            return { id, ...proactiveStore.setStage(id, stage, { by: 'user', ...(note === null ? {} : { note }) }) };
        }, { method: 'POST' });
        route('/cognition-engine/tickets/update', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const deliverable = url.searchParams.get('deliverable');
            const background = url.searchParams.get('background');
            const blockedBy = url.searchParams.get('blockedBy');
            return {
                id,
                ok: proactiveStore.update(id, {
                    ...(deliverable === null ? {} : { deliverable }),
                    ...(background === null ? {} : { background }),
                    ...(blockedBy === null ? {} : { blockedBy: blockedBy.split(',').map((x) => x.trim()).filter((x) => x.length > 0) }),
                }),
            };
        }, { method: 'POST' });
        // 检索度量（S8）
        /** 现算召回：评测必须用**当前**记忆库，不能拿历史日志（那时库里没这些条目）。 */
        const recallResolver = recallIdsOf;
        route('/cognition-engine/retrieval', () => ({
            logs: { path: recallLog.path, ...recallLog.overview() },
            eval: { path: retrievalEval.path, minCases: retrievalEval.minCasesRequired, ...retrievalEval.evaluate(recallResolver) },
            saveError: recallLog.lastSaveError ?? retrievalEval.lastSaveError ?? null,
        }));
        route('/cognition-engine/retrieval/log', (url) => {
            const limit = Number(url.searchParams.get('limit') ?? '20');
            return { recent: recallLog.recent(Number.isFinite(limit) ? limit : 20) };
        });
        route('/cognition-engine/retrieval/candidates', (url) => {
            const limit = Number(url.searchParams.get('limit') ?? '20');
            // 给标注工作流用：最近真实查询里还没标过的，附上当时返回了什么
            return { candidates: recallLog.unannotated(retrievalEval.annotatedQueries(), Number.isFinite(limit) ? limit : 20) };
        });
        route('/cognition-engine/retrieval/case', (url) => {
            const expected = (url.searchParams.get('expected') ?? '')
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
            const note = url.searchParams.get('note');
            return retrievalEval.addCase({
                query: url.searchParams.get('query') ?? '',
                expectedIds: expected,
                expectEmpty: url.searchParams.get('expectEmpty') === 'true',
                ...(note === null ? {} : { note }),
                source: 'user',
            });
        }, { method: 'POST' });
        route('/cognition-engine/retrieval/case/remove', (url) => ({
            id: url.searchParams.get('id') ?? '',
            ok: retrievalEval.removeCase(url.searchParams.get('id') ?? ''),
        }), { method: 'POST' });
        route('/cognition-engine/retrieval/evaluate', () => retrievalEval.evaluate(recallResolver), { method: 'POST' });
        // 分维度审计（S9）：不做单一总分，每个维度独立报告并标注评测者是谁
        route('/cognition-engine/audit/dimensions', () => {
            const stats = memory.stats();
            const styleSample = styleStore.sampleSummary();
            const styleCompare = styleStore.compare();
            const cpeCheck = cpe.document.lastCheck;
            const retrieval = retrievalEval.evaluate(recallIdsOf);
            const orphans = memory.orphans();
            const fb = injectionLog.statistics();
            const pStats = proactiveStore.document.stats;
            return {
                generatedAt: Date.now(),
                /** 四个维度各自独立，**故意不给总分**——Anchor 明确反对合成单一分数。 */
                dimensions: [
                    {
                        key: 'memory',
                        title: '记忆质量',
                        evaluator: '代码（确定性）',
                        status: stats.conflicts > 0 || orphans.length > 0 ? 'attention' : 'ok',
                        facts: {
                            total: stats.total,
                            current: stats.current,
                            superseded: stats.superseded,
                            conflicts: stats.conflicts,
                            orphans: orphans.length,
                        },
                        /** 能找到「该找到的」吗（需要标注才有数）。 */
                        retrieval: { cases: retrieval.cases, top1: retrieval.top1, top3: retrieval.top3, status: retrieval.status },
                        note: (() => {
                            const parts = [];
                            parts.push(orphans.length > 0 ? `有 ${orphans.length} 条事实的取代者已被删除，永久不生效（可点「修一下」）` : '没有孤儿取代关系');
                            // 冲突要说清口径：很多「冲突」其实是同一 subject 下的不同事，不是真矛盾
                            if (stats.conflicts > 0)
                                parts.push(`冲突 ${stats.conflicts} 对（同主题下内容不同即算，需人工判断是否真矛盾）`);
                            return parts.join('；');
                        })(),
                    },
                    {
                        key: 'style',
                        title: '说话风格',
                        evaluator: '代码（统计量，不存原文）',
                        status: styleCompare.status,
                        facts: { turns: styleSample.turns, chars: styleSample.chars, similarity: styleCompare.similarity },
                        note: styleCompare.note,
                    },
                    {
                        key: 'capability',
                        title: '能力回归',
                        evaluator: '代码（冻结回归集）',
                        status: cpeCheck?.status ?? 'insufficient',
                        facts: {
                            cases: cpe.document.holdout.cases.length,
                            baseline: cpe.document.baseline?.passRate ?? null,
                            lastPassRate: cpeCheck?.passRate ?? null,
                            incidents: cpe.document.incidents.length,
                        },
                        note: cpeCheck?.note ?? '还没有跑过检查',
                    },
                    {
                        key: 'feedback',
                        title: '反馈与采纳',
                        evaluator: '用户（你说了算）',
                        status: fb.corrected + fb.confirmed > 0 ? 'ok' : 'insufficient',
                        facts: {
                            turns: fb.total,
                            corrected: fb.corrected,
                            confirmed: fb.confirmed,
                            adoption: proactiveStore.adoptionRate(),
                            samples: pStats.adopted + pStats.dismissed,
                        },
                        note: fb.corrected + fb.confirmed === 0
                            ? '还没有收到过明确的「对/不对」，这些数字只表示记录通了，不代表准'
                            : `明确反馈 ${fb.corrected + fb.confirmed} 次`,
                    },
                ],
            };
        });
        route('/cognition-engine/memory/orphans', () => ({ orphans: memory.orphans() }));
        // 手动取代：把 old 标为失效并指向 new，可带理由（面板「标记取代」用这个）
        route('/cognition-engine/memory/supersede', (url) => {
            const oldId = url.searchParams.get('old') ?? '';
            const newId = url.searchParams.get('new') ?? '';
            const reason = url.searchParams.get('reason') ?? undefined;
            if (oldId.length === 0 || newId.length === 0)
                throw new Error('需要 old 和 new 两个记忆 id');
            const result = memory.supersede(oldId, newId, Date.now(), reason);
            observeSupersede(oldId, newId, reason);
            refreshEvidence();
            void stateStore.flush();
            return {
                ok: true,
                oldId,
                newId,
                supersededAt: result.superseded.supersededAt,
                reason: result.superseded.supersedeReason ?? null,
            };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 沉积层（Step 1）：只追加哈希链，只读日志/校验 ——
        const sediment = new SedimentStore({ filePath: config.sedimentFile, eta: config.sedimentEta, shadow: config.sedimentShadow });
        // 主题 wiki：只作附注，不参与检索（P1）
        const wiki = new WikiStore(config.wikiDir);
        wikiRef = wiki;
        /** 一次真实取代 → 沉积层（单向：事实 → 偏置）。任何异常都不许冒到调用方。 */
        /** 判定串行队列：判定是异步的，落盘必须按顺序，否则哈希链会交错。 */
        let judgeChain = Promise.resolve();
        /**
         * 语义判定（LLM 通道）。
         * 未开启 / 模型不可用 / 调用失败 → 返回 confidence=0 的判定，
         * 让状态层按 uncertain 拒收（fail-closed），**不偷偷退回正则猜**。
         */
        const judgeSupersede = async (subject, oldText, newText, reason) => {
            if (config.sedimentJudge !== 'llm')
                return undefined;
            const input = { subject, oldText, newText, ...(reason === undefined ? {} : { reason }) };
            try {
                const raw = await callRealModel(buildJudgePrompt(input), 700, 'judge');
                // 记真实 provider:model —— 换模型后判定风格会变，统计必须能分层
                const route = resolveModel();
                const parsed = parseJudgeResponse(raw, `${route.provider}:${route.model}`, input);
                if (parsed !== null)
                    return parsed;
            }
            catch {
                /* 落到下面的 fail-closed */
            }
            return { class: 'supplement', confidence: 0, evidenceFrom: '', evidenceTo: '', model: 'llm-unavailable' };
        };
        const observeSupersede = (oldId, newId, reason) => {
            // 总开关关着就完全不动：不写事件、不调判定模型（省 token）
            if (config.sedimentEnabled !== true)
                return;
            const oldFact = memory.get(oldId);
            const newFact = memory.get(newId);
            if (oldFact === undefined || newFact === undefined)
                return;
            judgeChain = judgeChain
                .then(async () => {
                const judge = await judgeSupersede(newFact.subject, oldFact.content, newFact.content, reason);
                try {
                    observeSupersedeFrom(sediment, (id) => memory.get(id), oldId, newId, reason, judge);
                }
                catch {
                    /* 沉积层故障不影响记忆写入 */
                }
            })
                .catch(() => undefined);
        };
        observeSupersedeRef = observeSupersede;
        route('/cognition-engine/sediment/log', (url) => {
            const raw = Number(url.searchParams.get('limit') ?? '50');
            const limit = Number.isFinite(raw) ? Math.max(1, Math.min(500, raw)) : 50;
            return { events: sediment.log(limit), filePath: sediment.filePath };
        });
        route('/cognition-engine/sediment/verify', () => sediment.verify());
        // 自检：只回结论，不回数值（面板按钮用）
        route('/cognition-engine/sediment/selfcheck', () => sediment.summary());
        // —— 主题 wiki（P1，附注模式；不参与检索排序）——
        const wikiSourcesFor = (topicId) => {
            const topic = topics.get(topicId);
            const facts = memory
                .all()
                .filter((fact) => fact.deletedAt === undefined && fact.archived !== true)
                .filter((fact) => (fact.topicIds ?? []).includes(topicId) || (topic !== undefined && fact.subject === topic.name))
                .map((fact) => ({
                id: fact.id,
                content: fact.content,
                importance: fact.importance,
                supersededBy: fact.supersededBy ?? null,
                supersedeReason: fact.supersedeReason ?? '',
            }));
            const tasks = taskManager
                .all()
                .filter((task) => (task.topicIds ?? []).includes(topicId))
                .map((task) => ({ description: task.description, status: task.status }));
            const rules = playbook
                .all()
                .filter((entry) => (entry.topicIds ?? []).includes(topicId))
                .map((entry) => ({ id: entry.id, content: entry.content, boundaryEnvs: entry.boundaryEnvs ?? [] }));
            return { topic, facts, tasks, rules };
        };
        wikiSourcesRef = wikiSourcesFor;
        // —— 候选收件箱（L0）——
        route('/cognition-engine/inbox/list', (url) => {
            const status = url.searchParams.get('status');
            const allowed = ['pending', 'accepted', 'rejected', 'duplicate'];
            const filter = status !== null && allowed.includes(status) ? status : undefined;
            // 每条候选带上资料层的状态：块数 + 摘要，页面据此显示"已学成什么样"
            const items = inbox.list(filter).map((cand) => ({ ...cand, knowledge: library.describe(cand.sourceId) }));
            return { stats: inbox.stats(), items, library: library.stats(), filePath: inbox.filePath };
        });
        // 资料层：按需检索（收件页与工具共用）
        route('/cognition-engine/sources/search', (url) => {
            const query = (url.searchParams.get('q') ?? '').trim();
            if (query.length === 0)
                throw new Error('需要 q');
            const hits = library.search(query, {
                k: Number(url.searchParams.get('k') ?? 5),
                maxChars: Number(url.searchParams.get('maxChars') ?? 1500),
            });
            // 块里只存 sourceId，标题得回来查一次账本，否则页面上全是 src-10 这种代号
            const titled = hits.map((hit) => ({ ...hit, title: sources.get(hit.sourceId)?.title ?? hit.title }));
            return { query, hits: titled, stats: library.stats() };
        });
        // 资料层：全部摘要
        route('/cognition-engine/sources/notes', () => ({ notes: library.notes(), stats: library.stats() }));
        // 删除一条资料的派生数据（块索引 + 摘要）。来源账本是哈希链，不动。
        route('/cognition-engine/sources/delete', (url) => {
            const sourceId = (url.searchParams.get('sourceId') ?? '').trim();
            if (sourceId.length === 0)
                throw new Error('需要 sourceId');
            const removed = library.deleteSource(sourceId);
            // 顺手落下还挂着的候选，否则待审里会留一条指向空资料的记录
            const dangling = inbox
                .list()
                .find((cand) => cand.sourceId === sourceId && cand.status === 'pending');
            if (dangling !== undefined)
                inbox.reject(dangling.id, '资料库已删除这条资料的块与摘要');
            return { ...removed, candidateRejected: dangling?.id ?? null, stats: library.stats() };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 立场层：目标与判据（宪章 2026-11-19 修订：可读可改，不打分）——
        route('/cognition-engine/stance/list', () => ({ items: stance.list(), rendered: stance.render(320) }));
        route('/cognition-engine/stance/add', (url, body) => {
            const json = readBodyJson(body);
            const kind = (url.searchParams.get('kind') ?? bodyString(json, 'kind') ?? '').trim();
            if (kind !== 'goal' && kind !== 'prefer' && kind !== 'forbid')
                throw new Error('kind 只能是 goal / prefer / forbid');
            const text = (url.searchParams.get('text') ?? bodyString(json, 'text') ?? '').trim();
            const denyRaw = url.searchParams.get('deny') ?? bodyString(json, 'deny') ?? '';
            const deny = denyRaw.split(/[,，、]/).map((word) => word.trim()).filter((word) => word.length > 0);
            return stance.add({ kind, text, ...(deny.length === 0 ? {} : { deny }), origin: 'user' });
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/stance/remove', (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            return { removed: stance.remove(id), items: stance.list() };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 语感层：只读公开讨论，学句式不学观点 ——
        route('/cognition-engine/voice/list', () => ({
            items: voice.list(50),
            stats: voice.stats(),
            rendered: voice.render(config.voiceMaxChars, 3),
        }));
        route('/cognition-engine/voice/fetch', async (url, body) => {
            const json = readBodyJson(body);
            const bvid = (url.searchParams.get('bvid') ?? bodyString(json, 'bvid') ?? '').trim();
            const aidRaw = Number(url.searchParams.get('aid') ?? bodyString(json, 'aid') ?? 0);
            const aid = aidRaw > 0 ? aidRaw : await resolveAid(bvid);
            const comments = await fetchComments(aid, 1, 20);
            let added = 0;
            const rejected = {};
            for (const comment of comments) {
                const result = voice.add({
                    text: comment.text,
                    from: 'bilibili',
                    url: `https://www.bilibili.com/video/av${aid}`,
                    likes: comment.likes,
                });
                if (result.added)
                    added += 1;
                else if (result.reason !== undefined)
                    rejected[result.reason] = (rejected[result.reason] ?? 0) + 1;
            }
            return { aid, fetched: comments.length, added, rejected, stats: voice.stats() };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/voice/remove', (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            return { removed: voice.remove(id), stats: voice.stats() };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 深研：一个问题 → 多源 → 交叉核对 → 知识条目 ——
        route('/cognition-engine/research/run', async (url, body) => {
            const json = readBodyJson(body);
            const question = (url.searchParams.get('q') ?? bodyString(json, 'q') ?? '').trim();
            if (question.length < 4)
                throw new Error('需要 q（要搞清楚的问题，至少 4 个字）');
            if (!autoToggles().deepResearch)
                throw new Error('深研开关是关的：一次约 ¥0.1，先在面板打开再跑');
            return runDeepResearch(question);
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/research/list', (url) => {
            const limit = Number(url.searchParams.get('limit') ?? 10);
            if (!existsSync(researchFile))
                return { items: [] };
            const rows = [];
            for (const line of readFileSync(researchFile, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
                const trimmed = line.trim();
                if (trimmed.length === 0)
                    continue;
                try {
                    rows.push(JSON.parse(trimmed));
                }
                catch {
                    continue;
                }
            }
            return { items: rows.slice(-Math.max(1, limit)).reverse() };
        });
        // —— 纠正触发：识别 → 反思 → 联网 → 候选（扳机只认用户原话）——
        const correctionsFile = join(dataDir(), 'cognition-corrections.jsonl');
        const readCorrections = (limit = 20) => {
            if (!existsSync(correctionsFile))
                return [];
            const rows = [];
            for (const line of readFileSync(correctionsFile, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
                const trimmed = line.trim();
                if (trimmed.length === 0)
                    continue;
                try {
                    rows.push(JSON.parse(trimmed));
                }
                catch {
                    continue;
                }
            }
            return rows.slice(-Math.max(1, limit)).reverse();
        };
        let lastCorrectionAt = 0;
        const runCorrectionChain = async (text) => {
            const signal = detectCorrection(text);
            if (!signal.corrected)
                return { corrected: false };
            const now = Date.now();
            if (now - lastCorrectionAt < 10 * 60 * 1000)
                return { corrected: true, skipped: '冷却中（10 分钟内只跑一次）' };
            lastCorrectionAt = now;
            const toggles = autoToggles();
            const subject = topics.match(text, 1)[0]?.topic.name;
            const id = `cor-${now.toString(36)}`;
            let reflection = { wrong: '', diagnosis: '', rule: '' };
            if (toggles.autoLearn || toggles.autoRevise) {
                try {
                    const raw = await callRealModel(buildCorrectionPrompt({ correction: signal.quote, ...(subject === undefined ? {} : { subject }) }), 800, 'correction');
                    reflection = parseCorrectionResult(raw);
                }
                catch (error) {
                    ctx.logger?.warn?.(`cognition-engine: 纠正反思失败 ${messageOf(error)}`);
                }
            }
            let learned = [];
            if (toggles.autoLearn) {
                try {
                    const result = await importFromSearch(text, 'correction');
                    learned = result.imported.map((item) => item.sourceId);
                }
                catch (error) {
                    ctx.logger?.warn?.(`cognition-engine: 纠正后自动联网失败 ${messageOf(error)}`);
                }
            }
            try {
                mkdirSync(dirname(correctionsFile), { recursive: true });
                appendFileSync(correctionsFile, `${JSON.stringify({ id, at: now, text: signal.quote, wrong: reflection.wrong, diagnosis: reflection.diagnosis, rule: reflection.rule, learned })}\n`, 'utf8');
            }
            catch {
                /* 日志失败不影响主流程 */
            }
            let candidateId = null;
            if (reflection.rule.length >= 8) {
                const added = learning.add({
                    kind: 'rule',
                    content: reflection.rule,
                    anchor: { type: 'turn', ref: id, quote: signal.quote },
                    ...(subject === undefined ? {} : { subject }),
                    scope: 'user',
                    confidence: 0.7,
                    note: '来自你的纠正：' + (reflection.wrong.length > 0 ? reflection.wrong : '（未提炼出错在哪）'),
                });
                candidateId = added.duplicate ? null : added.candidate.id;
            }
            // 纠正链也要走自动采用：上一版只有「资料导入」那条路会调 autoAcceptPending，
            // 纠正产出的准则候选会一直停在待审（2026-11-19 发版前实测踩到 lc-36）。
            if (candidateId !== null && autoToggles().autoAccept) {
                try {
                    autoAcceptPending();
                }
                catch {
                    /* 自动采用失败不影响纠正本身 */
                }
            }
            return { corrected: true, id, wrong: reflection.wrong, diagnosis: reflection.diagnosis, rule: reflection.rule, learned, candidateId };
        };
        correctionChainRef = runCorrectionChain;
        route('/cognition-engine/correction/check', (url) => detectCorrection(url.searchParams.get('text') ?? ''));
        route('/cognition-engine/correction/list', (url) => ({ items: readCorrections(Number(url.searchParams.get('limit') ?? 20)) }));
        route('/cognition-engine/correction/run', async (url, body) => {
            const json = readBodyJson(body);
            const text = (url.searchParams.get('text') ?? bodyString(json, 'text') ?? '').trim();
            if (text.length === 0)
                throw new Error('需要 text（你那句纠正）');
            return runCorrectionChain(text);
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 自动修订：先存档再改，改完带标注，可回滚 ——
        route('/cognition-engine/autorevise/list', (url) => ({
            items: revisionLog.list(Number(url.searchParams.get('limit') ?? 30)),
            enabled: autoToggles().autoRevise,
        }));
        route('/cognition-engine/autorevise/apply', (url, body) => {
            const json = readBodyJson(body);
            const target = (url.searchParams.get('target') ?? bodyString(json, 'target') ?? '').trim();
            const targetId = (url.searchParams.get('targetId') ?? bodyString(json, 'targetId') ?? '').trim();
            const content = (url.searchParams.get('content') ?? bodyString(json, 'content') ?? '').trim();
            const reason = (url.searchParams.get('reason') ?? bodyString(json, 'reason') ?? '').trim();
            const diagnosis = (url.searchParams.get('diagnosis') ?? bodyString(json, 'diagnosis') ?? '').trim();
            const by = (url.searchParams.get('by') ?? bodyString(json, 'by') ?? 'user') === 'auto' ? 'auto' : 'user';
            if (target !== 'fact' && target !== 'rule')
                throw new Error('target 只能是 fact / rule');
            if (targetId.length === 0)
                throw new Error('需要 targetId');
            if (content.length === 0)
                throw new Error('需要 content（改后的内容）');
            if (diagnosis.length < 4)
                throw new Error('必须写诊断（≥4 字）：错在哪、以后怎么避免');
            if (by === 'auto') {
                // 自动修订要过门槛：开关 / 用户明确纠正 / 冷却 / 当天上限
                const last = revisionLog.lastAt(targetId);
                const midnight = new Date();
                midnight.setHours(0, 0, 0, 0);
                const todayCount = revisionLog.list(200).filter((item) => item.by === 'auto' && item.undone !== true && item.at >= midnight.getTime()).length;
                const gate = shouldAutoRevise({
                    target: target,
                    counterEvidence: Number(url.searchParams.get('counterEvidence') ?? bodyString(json, 'counterEvidence') ?? 1),
                    hoursSinceLastRevision: last === undefined ? 9999 : (Date.now() - last) / 3_600_000,
                    userSaidSo: (url.searchParams.get('userSaidSo') ?? bodyString(json, 'userSaidSo') ?? 'false') === 'true',
                    todayCount,
                    autoReviseEnabled: autoToggles().autoRevise,
                    // 冷却与每日上限可配（默认 24h / 5 次，经验值未标定）
                    cooldownHours: config.reviseCooldownHours,
                    maxPerDay: config.reviseMaxPerDay,
                });
                if (!gate.allow)
                    throw new Error('自动修订被门槛挡住：' + gate.reason);
            }
            if (target === 'fact') {
                const existing = memory.get(targetId);
                const before = existing === undefined ? {} : { id: existing.id, content: existing.content, subject: existing.subject, importance: existing.importance };
                const marked = markAuto(content);
                const record = revisionLog.backup({ target: 'fact', targetId, before, after: { content: marked }, reason: reason || '（未写原因）', diagnosis, by });
                const fact = memory.ingest({
                    content: marked,
                    subject: String(before.subject ?? '待归类'),
                    tags: ['auto-revised', 'rev:' + record.id],
                    importance: typeof before.importance === 'number' ? before.importance : 0.5,
                    source: 'agent',
                    origin: 'ui',
                    ...(existing === undefined ? {} : { supersedes: existing.id }),
                });
                refreshEvidence();
                touch();
                void stateStore.flush();
                return { record, factId: fact.id };
            }
            const entry = playbook.get(targetId);
            if (entry === undefined)
                throw new Error('没有这条准则：' + targetId);
            const before = { id: entry.id, content: entry.content, boundaryEnvs: entry.boundaryEnvs ?? [] };
            const marked = markAuto(content);
            const record = revisionLog.backup({ target: 'rule', targetId, before, after: { content: marked }, reason: reason || '（未写原因）', diagnosis, by });
            const outcome = playbook.revise(targetId, marked, { diagnosis, evidence: '自动修订 ' + record.id });
            if (!outcome)
                throw new Error('准则修订失败（存档已留 ' + record.id + '）');
            touch();
            void stateStore.flush();
            return { record, ruleId: targetId };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/autorevise/undo', (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            const record = revisionLog.list(200).find((item) => item.id === id);
            if (record === undefined)
                throw new Error('没有这条修订记录：' + id);
            if (record.undone === true)
                throw new Error('这条已经回滚过了');
            const previous = String(record.before.content ?? '');
            if (previous.length === 0)
                throw new Error('存档里没有修改前的内容，无法回滚');
            if (record.target === 'fact') {
                const fact = memory.ingest({
                    content: unmarkAuto(previous),
                    subject: String(record.before.subject ?? '待归类'),
                    tags: ['auto-revised-undo', 'rev:' + record.id],
                    importance: typeof record.before.importance === 'number' ? (record.before.importance) : 0.5,
                    source: 'agent',
                    origin: 'ui',
                });
                revisionLog.markUndone(id);
                refreshEvidence();
                touch();
                void stateStore.flush();
                return { undone: true, factId: fact.id };
            }
            const outcome = playbook.revise(record.targetId, unmarkAuto(previous), { diagnosis: '回滚自动修订 ' + id, evidence: '用户点回滚' });
            if (!outcome)
                throw new Error('回滚失败');
            revisionLog.markUndone(id);
            touch();
            void stateStore.flush();
            return { undone: true, ruleId: record.targetId };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— 自动学习：开关 + 手动触发 + 日志 ——
        route('/cognition-engine/autolearn/status', async () => {
            const toggles = autoToggles();
            const web = ctx.get?.('web');
            // 把宿主注册的搜索提供方列出来：收费与否取决于机器上实际选中的那个
            let providers = null;
            try {
                const list = web?.listProviders?.();
                if (list !== undefined) {
                    providers = {
                        search: list.search.map((item) => item.id),
                        fetch: list.fetch.map((item) => item.id),
                    };
                }
            }
            catch {
                providers = null;
            }
            return {
                ...toggles,
                webAvailable: web !== undefined && typeof web.search === 'function' && typeof web.fetch === 'function',
                providers,
                recent: readAutoLearn(10),
            };
        });
        route('/cognition-engine/autolearn/run', async (url, body) => {
            const toggles = autoToggles();
            if (!toggles.autoLearn)
                throw new Error('自动联网学习是关着的：先在设置里打开（避免在我不知情的时候花你的钱）');
            const json = readBodyJson(body);
            const text = (url.searchParams.get('text') ?? bodyString(json, 'text') ?? '').trim();
            if (text.length === 0)
                throw new Error('需要 text（要学什么）');
            const result = await importFromSearch(text, 'manual');
            return result;
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/autolearn/toggle', (url, body) => {
            const json = readBodyJson(body);
            const readFlag = (name) => {
                const raw = url.searchParams.get(name) ?? bodyString(json, name);
                if (raw === null || raw === undefined)
                    return undefined;
                return raw === 'true' || raw === '1';
            };
            const patch = {
                autoLearn: readFlag('autoLearn'),
                autoRevise: readFlag('autoRevise'),
                autoAccept: readFlag('autoAccept'),
                deepResearch: readFlag('deepResearch'),
            };
            // 三档：off / fast / deep（合并了原来的 autoLearn + deepResearch 两个开关）
            const rawLevel = url.searchParams.get('learnLevel') ?? bodyString(json, 'learnLevel');
            const learnLevel = rawLevel === 'off' || rawLevel === 'fast' || rawLevel === 'deep' ? rawLevel : undefined;
            const next = settings.writeToggles({
                ...(patch.autoLearn === undefined ? {} : { autoLearn: patch.autoLearn }),
                ...(patch.autoRevise === undefined ? {} : { autoRevise: patch.autoRevise }),
                ...(patch.autoAccept === undefined ? {} : { autoAccept: patch.autoAccept }),
                ...(patch.deepResearch === undefined ? {} : { deepResearch: patch.deepResearch }),
                ...(learnLevel === undefined ? {} : { learnLevel }),
            });
            const level = resolveLearnLevel(next);
            return {
                autoLearn: level !== 'off',
                autoRevise: next.autoRevise === true,
                autoAccept: next.autoAccept !== false,
                deepResearch: level === 'deep',
                learnLevel: level,
            };
        }, { method: 'POST', requireAuth: explicitLock });
        // —— L3 学习候选：事实 / 准则 / 技能，全部带外部锚 ——
        const anchorLookup = {
            blockText: (sourceId, block) => library.blocksOf(sourceId).find((item) => item.ord === block)?.text,
            blockFlags: (sourceId, block) => {
                const text = library.blocksOf(sourceId).find((item) => item.ord === block)?.text;
                return text === undefined ? [] : scanFlags(text);
            },
        };
        /** 锚校验阈值（默认 0.9/0.6，经验值未标定，可用 config 覆盖） */
        const anchorOptions = { strictCoverage: config.anchorStrictCoverage, looseCoverage: config.anchorLooseCoverage };
        route('/cognition-engine/learn/list', (url) => {
            const status = url.searchParams.get('status');
            const allowed = ['pending', 'accepted', 'rejected'];
            const filter = status !== null && allowed.includes(status) ? status : undefined;
            return { stats: learning.stats(), items: learning.list(filter) };
        });
        /**
         * 采用一个候选（路由与自动采用共用同一套规则）。
         *
         * 自动/手动唯一的区别是 boundary 有没有人填：
         *   - 事实 → 写入记忆（世界知识降权）
         *   - 准则 → 写进准则本；**来自用户纠正的标 tentative（不参与每轮注入）**，
         *     等第二次印证或用户明说才升正式（用户 2026-11-19 定的）
         */
        const applyCandidate = (candidateId, options = {}) => {
            const candidate = learning.get(candidateId);
            if (candidate === undefined)
                throw new Error('没有这个候选：' + candidateId);
            if (candidate.status !== 'pending')
                throw new Error('候选状态是 ' + candidate.status + '，不能再采用');
            const checked = checkAnchor(candidate.anchor, anchorLookup, anchorOptions);
            if (!checked.ok)
                throw new Error('锚校验没通过，拒绝写入：' + checked.reason);
            // 立场层：违反 forbid 判据的候选不入库（判据只做明确词命中，不语义推断）
            const violation = stance.violates(candidate.content);
            if (violation.violates) {
                throw new Error('违反判据「' + (violation.rule?.text ?? '') + '」（命中「' + (violation.word ?? '') + '」），不入库');
            }
            if (candidate.kind === 'fact') {
                const world = candidate.scope === 'world';
                const fact = memory.ingest({
                    content: candidate.content,
                    subject: (world ? '资料:' : '') + (candidate.subject ?? '待归类').slice(0, 40),
                    tags: [
                        'learned',
                        ...(options.auto === true ? ['auto-accepted'] : []),
                        ...(world ? ['world-knowledge'] : []),
                        'anchor:' + candidate.anchor.ref + (candidate.anchor.block === undefined ? '' : '#' + candidate.anchor.block),
                    ],
                    importance: world ? 0.25 : Math.min(0.9, 0.4 + candidate.confidence * 0.4),
                    source: 'imported',
                    origin: 'ui',
                });
                learning.markAccepted(candidateId, fact.id);
                refreshEvidence();
                touch();
                void stateStore.flush();
                return { kind: 'fact', ref: fact.id, tentative: false };
            }
            if (candidate.kind === 'rule') {
                // 来自用户纠正的准则：先当弱准则（不进注入），等二次印证再升
                const fromCorrection = candidate.anchor.type === 'turn';
                const tentative = fromCorrection && candidate.confidence < 0.9;
                // 边界自动派生：有 subject 用它，否则标"通用"；弱准则允许空边界
                const boundary = options.boundary !== undefined && options.boundary.length > 0
                    ? options.boundary
                    : [candidate.subject === undefined ? '通用（自动派生，可改）' : candidate.subject];
                if (!tentative && boundary.length === 0) {
                    throw new Error('准则候选必须填适用边界：没有边界的准则会被到处套用');
                }
                const outcome = playbook.addManual({
                    content: candidate.content,
                    boundaryEnvs: tentative ? [] : boundary,
                    confidence: candidate.confidence,
                    ...(tentative ? { tentative: true } : {}),
                });
                if (!outcome.accepted)
                    throw new Error('准则没写进去：' + (outcome.reason ?? '未知原因'));
                const ruleId = outcome.entry?.id ?? outcome.merged?.id ?? 'unknown';
                learning.markAccepted(candidateId, ruleId);
                touch();
                void stateStore.flush();
                return { kind: 'rule', ref: ruleId, tentative };
            }
            throw new Error('技能候选暂未开放');
        };
        /**
         * 自动采用：把 pending 里"够格"的直接生效，人不点。
         *
         * 够格 = 事实一律；准则按上面规则（纠正来的变弱准则）。
         * 这是"学习完全自动化"的落点——用户只提需求和反驳。
         */
        const autoAcceptPending = () => {
            let accepted = 0;
            let skipped = 0;
            let dropped = 0;
            for (const candidate of learning.list('pending')) {
                try {
                    applyCandidate(candidate.id, { auto: true });
                    accepted += 1;
                }
                catch (error) {
                    const reason = messageOf(error);
                    // 终局失败（重复 / 套话 / 过长 / 锚核不到）直接落定，别让队列越堆越长；
                    // 其他（临时错误）留着待审，避免误丢
                    if (/重复|套话|过长|过短|锚校验|违反判据|没有这个候选|准则没写进去/.test(reason)) {
                        learning.reject(candidate.id, '自动跳过：' + reason);
                        dropped += 1;
                    }
                    else {
                        skipped += 1;
                    }
                }
            }
            return { accepted, skipped, dropped };
        };
        /** 从单条来源生成候选（提炼完自动调用），再按开关自动采用。 */
        const generateFromSource = (sourceId) => {
            const note = library.note(sourceId);
            if (note === undefined || note.status !== 'ready')
                return { generated: 0, duplicates: 0, dropped: 0 };
            const blocks = library.blocksOf(sourceId).map((block) => ({ ord: block.ord, text: block.text, flags: scanFlags(block.text) }));
            const drafts = candidatesFromPoints({
                sourceId,
                title: note.title,
                ...(note.topic === undefined ? {} : { topic: note.topic }),
                summary: note.summary,
                points: note.points,
                ...(note.quotes === undefined ? {} : { quotes: note.quotes }),
                blocks,
            }, anchorOptions);
            let generated = 0;
            let duplicates = 0;
            let dropped = 0;
            for (const draft of drafts) {
                const checked = checkAnchor(draft.anchor, anchorLookup, anchorOptions);
                if (!checked.ok) {
                    dropped += 1;
                    continue;
                }
                const result = learning.add({
                    ...draft,
                    anchorChars: checked.matchedChars,
                    anchorFlags: checked.flags,
                    scope: 'world',
                    needsQuote: checked.needsQuote === true,
                });
                if (result.duplicate)
                    duplicates += 1;
                else
                    generated += 1;
            }
            return { generated, duplicates, dropped };
        };
        learningPipelineRef = async (sourceId) => {
            try {
                generateFromSource(sourceId);
                if (autoToggles().autoAccept)
                    autoAcceptPending();
            }
            catch (error) {
                ctx.logger?.warn?.(`cognition-engine: 学习流水线失败 ${sourceId}: ${messageOf(error)}`);
            }
        };
        /**
         * 从资料库已提炼的结论生成候选。
         *
         * 只生成"能在原文块里核到"的结论——核不到的直接丢，不进待审。
         * 这样用户看到的每一条都能点开看原文，不用赌模型有没有胡说。
         */
        route('/cognition-engine/learn/generate', () => {
            let generated = 0;
            let duplicates = 0;
            const noAnchor = [];
            for (const note of library.notes()) {
                if (note.status !== 'ready')
                    continue;
                const blocks = library.blocksOf(note.sourceId).map((block) => ({
                    ord: block.ord,
                    text: block.text,
                    flags: scanFlags(block.text),
                }));
                const drafts = candidatesFromPoints({
                    sourceId: note.sourceId,
                    title: note.title,
                    ...(note.topic === undefined ? {} : { topic: note.topic }),
                    summary: note.summary,
                    points: note.points,
                    ...(note.quotes === undefined ? {} : { quotes: note.quotes }),
                    blocks,
                }, anchorOptions);
                for (const draft of drafts) {
                    const checked = checkAnchor(draft.anchor, anchorLookup, anchorOptions);
                    if (!checked.ok) {
                        noAnchor.push(draft.content.slice(0, 30) + '…：' + checked.reason);
                        continue;
                    }
                    const result = learning.add({
                        ...draft,
                        anchorChars: checked.matchedChars,
                        anchorFlags: checked.flags,
                        // 资料来源一律算世界知识；转述型引文标记出来让用户补原文
                        scope: 'world',
                        needsQuote: checked.needsQuote === true,
                    });
                    if (result.duplicate)
                        duplicates += 1;
                    else
                        generated += 1;
                }
            }
            const auto = autoToggles().autoAccept ? autoAcceptPending() : { accepted: 0, skipped: 0 };
            return { generated, duplicates, dropped: noAnchor.length, droppedDetail: noAnchor.slice(0, 5), auto, stats: learning.stats() };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/learn/accept', (url, body) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            const json = readBodyJson(body);
            const boundaryRaw = url.searchParams.get('boundary') ?? bodyString(json, 'boundary') ?? '';
            const boundary = boundaryRaw.split(/[,，、]/).map((item) => item.trim()).filter((item) => item.length > 0);
            return applyCandidate(id, { boundary });
        }, { method: 'POST', requireAuth: explicitLock });
        // 一键把所有够格的候选自动采用（人不用点）
        route('/cognition-engine/learn/auto-accept', () => ({ ...autoAcceptPending(), stats: learning.stats() }), { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/learn/reject', (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            return learning.reject(id, url.searchParams.get('reason') ?? undefined);
        }, { method: 'POST', requireAuth: explicitLock });
        // —— L2 白名单抓取 ——
        route('/cognition-engine/fetch/whitelist', (url) => {
            const host = url.searchParams.get('host');
            const action = url.searchParams.get('action');
            if (host !== null && action === 'add')
                return whitelist.add(host);
            if (host !== null && action === 'remove')
                return whitelist.remove(host);
            return { hosts: whitelist.list(), policy: { ...DEFAULT_POLICY, hosts: whitelist.list() } };
        });
        route('/cognition-engine/fetch/import', async (url) => importFromWeb(url.searchParams.get('url') ?? ''), { method: 'POST', requireAuth: explicitLock });
        /**
         * 资料库总览：每篇资料一行（块数 + 提炼状态 + 主题 + 摘要）。
         *
         * 收件页的主体必须是这个，而不是"待审 N 条"——待审只表示"还没转成记忆事实"，
         * 资料早就在库里可检索了。2026-11-18 用户看到「待审 0 条 · 收件箱是空的」，
         * 以为那篇论文没学进去，实际已经切成 34 块。
         */
        route('/cognition-engine/sources/list', () => {
            const seen = new Set();
            const items = [...sources.list(200)]
                .reverse()
                // 同一篇资料被反复导入时账本里有多条（不可变账本不能删），总览只显示最新那份
                .filter((record) => {
                if (seen.has(record.contentHash))
                    return false;
                seen.add(record.contentHash);
                return true;
            })
                .map((record) => {
                const known = library.describe(record.id);
                return {
                    sourceId: record.id,
                    title: record.title,
                    kind: record.kind,
                    at: record.at,
                    chars: record.content.length,
                    locator: record.locator ?? null,
                    blocks: known.blocks,
                    note: known.note,
                };
            })
                // 块被删光的资料等于已删除：列表里不该再占一行
                // （来源账本仍留着原文，那是不可变证据层）
                .filter((item) => item.blocks > 0);
            return { items, stats: library.stats() };
        });
        // 重新提炼某条来源（模型当时不可用、或换了模型想重做）
        route('/cognition-engine/sources/redistill', async (url) => {
            const sourceId = url.searchParams.get('sourceId') ?? '';
            const record = sources.get(sourceId);
            if (record === undefined)
                throw new Error('来源不存在：' + sourceId);
            indexSourceNow(record);
            const note = await distillSourceNote(record);
            return { note, stats: library.stats() };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/inbox/add', (url) => {
            const content = url.searchParams.get('content') ?? '';
            const facts = memory
                .all()
                .filter((fact) => fact.deletedAt === undefined && fact.supersededAt === null && fact.archived !== true)
                .map((fact) => ({ id: fact.id, content: fact.content }));
            // L1：外部材料一律先抽取（去脚本/注释/零宽 + 标记可疑句式），再进候选箱
            const extracted = extractText(content, { maxChars: 6000 });
            // SoMem 的 Source 层：先落一条不可变来源（证据），候选只是指针
            const source = sources.append({
                kind: 'paste',
                title: url.searchParams.get('title') ?? extracted.text.slice(0, 40),
                content: extracted.text,
            });
            ingestSource(source);
            const cand = inbox.add({
                content: extracted.text,
                sourceId: source.id,
                ...(extracted.flags.length === 0
                    ? {}
                    : { note: '含可疑指令句式（' + extracted.flags.join('、') + '），已按数据隔离' }),
                ...(url.searchParams.get('title') === null ? {} : { title: url.searchParams.get('title') }),
                ...(url.searchParams.get('url') === null ? {} : { url: url.searchParams.get('url') }),
                ...(url.searchParams.get('subject') === null ? {} : { subject: url.searchParams.get('subject') }),
                ...(url.searchParams.get('summary') === null ? {} : { summary: url.searchParams.get('summary') }),
                source: 'paste',
            }, { facts });
            return cand;
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/inbox/accept', (url, body) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            // 正文可能是一整篇文章：优先从请求体取，query 只作兼容回退
            const json = readBodyJson(body);
            const contentOverride = url.searchParams.get('content') ?? bodyString(json, 'content');
            const subjectOverride = url.searchParams.get('subject') ?? bodyString(json, 'subject');
            // 主题为空时，按内容自动匹配一个主题（省得全落到「待归类」）
            let autoSubject = subjectOverride;
            if (autoSubject === undefined || autoSubject.trim().length === 0) {
                const hitTopic = topics.match(contentOverride ?? '', 1)[0];
                if (hitTopic !== undefined)
                    autoSubject = hitTopic.topic.name;
            }
            // SoMem 的证据链接：采用时必须能解析到不可变 Source
            const pendingCand = inbox.get(id);
            const sourceId = pendingCand?.sourceId;
            if (sourceId !== undefined && sources.get(sourceId) === undefined) {
                throw new Error('来源记录不存在（' + sourceId + '），拒绝采用：没有证据的内容不能进记忆');
            }
            // 长资料采用时不把两万字塞进一条记忆：落「入口 + 要点」，全文留在资料库。
            // 老行为是落 summary（前 200 字），等于把论文开头当内容，用户当场指出过。
            const longSource = pendingCand !== undefined && (contentOverride ?? pendingCand.content).length > 600;
            let factContent;
            if (longSource) {
                const known = sourceId === undefined ? undefined : library.note(sourceId);
                const blocks = sourceId === undefined ? 0 : library.blocksOf(sourceId).length;
                const title = pendingCand.title;
                const brief = known !== undefined && known.status === 'ready' && known.summary.length > 0
                    ? '要点：' + known.summary
                    : '摘要待提炼（可在收件页点「重新提炼」）';
                factContent =
                    `资料《${title}》${sourceId === undefined ? '' : '（' + sourceId + '）'}已入资料库，共 ${blocks} 块；${brief}。` +
                        '需要细节时用 cognition_source 工具查原文，不要凭记忆复述。';
            }
            const cand = inbox.accept(id, (input) => {
                const fact = memory.ingest({
                    content: input.content,
                    subject: input.subject,
                    tags: sourceId === undefined ? input.tags : [...input.tags, 'src:' + sourceId],
                    importance: input.importance,
                    source: 'imported',
                    origin: 'ui',
                });
                return fact.id;
            }, {
                ...(contentOverride === undefined ? {} : { content: contentOverride }),
                ...(autoSubject === undefined ? {} : { subject: autoSubject }),
                ...(factContent === undefined ? {} : { factContent }),
            });
            refreshEvidence();
            touch();
            void stateStore.flush();
            return cand;
        }, { method: 'POST', requireAuth: explicitLock });
        // 从本地文件导入：只当文本读，不执行、不解析格式；二进制与超大文件拒收
        route('/cognition-engine/inbox/add-file', (url) => {
            const rawPath = (url.searchParams.get('path') ?? '').trim();
            if (rawPath.length === 0)
                throw new Error('需要 path');
            const filePath = expandHome(rawPath);
            let info;
            try {
                info = statSync(filePath);
            }
            catch {
                // 把收到的原串也打出来：路径里有多余字符（空格/引号/全角括号）时能一眼看出
                throw new Error('读不到这个文件：' + JSON.stringify(filePath));
            }
            if (!info.isFile())
                throw new Error('不是普通文件');
            if (info.size > 4 * 1024 * 1024)
                throw new Error('文件太大（>4MB）：先截取片段再放');
            const buf = readFileSync(filePath);
            if (buf.includes(0))
                throw new Error('看起来是二进制文件，只能导入纯文本');
            // 编码要判：Excel/统计局导出的 CSV 默认是 GBK，按 UTF-8 读就是一屏乱码
            const decoded = decodeTextBuffer(buf);
            // 文件导入给更大上限：论文 HTML 光导航就几千字，6000 会只截到菜单
            const text = extractText(decoded.text, { maxChars: 20000 });
            const source = sources.append({
                kind: 'file',
                title: filePath.split(/[\\/]/).pop() ?? filePath,
                content: text.text,
                locator: filePath,
            });
            ingestSource(source);
            const facts = memory
                .all()
                .filter((fact) => fact.deletedAt === undefined && fact.supersededBy === null && fact.archived !== true)
                .map((fact) => ({ id: fact.id, content: fact.content }));
            const subject = url.searchParams.get('subject');
            return inbox.add({
                content: text.text,
                sourceId: source.id,
                title: filePath.split(/[\\/]/).pop() ?? filePath,
                ...(subject === null ? {} : { subject }),
                note: '来自本地文件：' + filePath +
                    (text.flags.length === 0 ? '' : '；含可疑句式（' + text.flags.join('、') + '）'),
                source: 'file',
            }, { facts });
        }, { method: 'POST', requireAuth: explicitLock });
        // 浏览器选文件后的分片上传暂存（内存，不落盘；提交后清掉）
        const pendingUploads = new Map();
        const UPLOAD_TTL_MS = 10 * 60 * 1000;
        route('/cognition-engine/inbox/upload/begin', (url) => {
            // 顺手清理过期暂存，避免内存泄漏
            const now = Date.now();
            for (const [key, value] of pendingUploads) {
                if (now - value.at > UPLOAD_TTL_MS)
                    pendingUploads.delete(key);
            }
            const id = `up-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            pendingUploads.set(id, { name: (url.searchParams.get('name') ?? '未命名').slice(0, 80), parts: [], at: now });
            return { id };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/inbox/upload/chunk', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const entry = pendingUploads.get(id);
            if (entry === undefined)
                throw new Error('上传会话不存在或已过期，请重新选择文件');
            entry.parts.push(url.searchParams.get('text') ?? '');
            entry.at = Date.now();
            return { id, chunks: entry.parts.length };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/inbox/upload/commit', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const entry = pendingUploads.get(id);
            if (entry === undefined)
                throw new Error('上传会话不存在或已过期，请重新选择文件');
            pendingUploads.delete(id);
            const raw = entry.parts.join('');
            if (raw.trim().length === 0)
                throw new Error('文件是空的');
            const text = extractText(raw, { maxChars: 20000 });
            const source = sources.append({ kind: 'file', title: entry.name, content: text.text });
            ingestSource(source);
            const facts = memory
                .all()
                .filter((fact) => fact.deletedAt === undefined && fact.supersededBy === null && fact.archived !== true)
                .map((fact) => ({ id: fact.id, content: fact.content }));
            const subject = url.searchParams.get('subject');
            const cand = inbox.add({
                content: text.text,
                title: entry.name,
                sourceId: source.id,
                note: '来自浏览器上传：' + entry.name + '（' + raw.length + ' 字，抽取后 ' + text.text.length + ' 字）' +
                    (text.flags.length === 0 ? '' : '；含可疑句式（' + text.flags.join('、') + '）'),
                source: 'file',
                ...(subject === null ? {} : { subject }),
            }, { facts });
            return cand;
        }, { method: 'POST', requireAuth: explicitLock });
        // 来源账本（SoMem 的 Source 层）：只读
        route('/cognition-engine/sources/list', (url) => {
            const raw = Number(url.searchParams.get('limit') ?? '50');
            const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, raw)) : 50;
            return {
                total: sources.list(200).length,
                chain: sources.verify(),
                items: sources.list(limit).map((record) => ({
                    id: record.id,
                    at: record.at,
                    kind: record.kind,
                    title: record.title,
                    chars: record.content.length,
                    ...(record.locator === undefined ? {} : { locator: record.locator }),
                })),
            };
        });
        route('/cognition-engine/sources/verify', () => sources.verify());
        // 三种视图（照 SoMem 的 Timeline / Recent 派生）：从现有数据推导，不额外维护
        route('/cognition-engine/inbox/views', (url) => {
            const by = url.searchParams.get('by') ?? 'recent';
            const all = inbox.list();
            if (by === 'time') {
                const groups = new Map();
                for (const item of all) {
                    const day = new Date(item.createdAt).toISOString().slice(0, 10);
                    groups.set(day, (groups.get(day) ?? 0) + 1);
                }
                return { by, groups: [...groups.entries()].sort().map(([day, count]) => ({ day, count })) };
            }
            if (by === 'status')
                return { by, status: inbox.stats() };
            return {
                by: 'recent',
                items: all.slice(0, 20).map((item) => ({
                    id: item.id,
                    status: item.status,
                    title: item.title,
                    createdAt: item.createdAt,
                    ...(item.sourceId === undefined ? {} : { sourceId: item.sourceId }),
                })),
            };
        });
        route('/cognition-engine/inbox/reject', (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            return inbox.reject(id, url.searchParams.get('reason') ?? undefined);
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/settings/inject-mode', (url) => {
            if (url.searchParams.get('mode') === null)
                return { mode: injectMode };
            const mode = url.searchParams.get('mode');
            if (!isInjectMode(mode))
                throw new Error('mode 只能是 off / index / full');
            injectMode = mode;
            settings.writeInjectMode(mode);
            return { mode: injectMode };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/playbook/probe', (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            const content = (url.searchParams.get('content') ?? '').trim();
            const entry = id.length === 0 ? undefined : playbook.get(id);
            const candidate = content.length > 0 ? content : entry?.content ?? '';
            if (candidate.length === 0)
                throw new Error('需要 id 或 content');
            return runPracticeProbes({
                candidate,
                turns: buildProbeTurns(config.probeMaxTurns ?? 60),
                minOverlap: config.probeMinOverlap ?? 0.3,
                maxCounter: config.probeMaxCounter ?? 2,
            });
        }, { method: 'POST', requireAuth: explicitLock });
        // P5 任务简报：给子代理/超级代理用；不进主上下文
        route('/cognition-engine/brief', (url) => {
            const task = (url.searchParams.get('task') ?? '').trim();
            if (task.length === 0)
                throw new Error('需要 task 参数');
            const facts = memory
                .all()
                .filter((fact) => fact.deletedAt === undefined && fact.archived !== true)
                .map((fact) => ({
                id: fact.id,
                subject: fact.subject,
                content: fact.content,
                importance: fact.importance,
                supersededBy: fact.supersededBy ?? null,
                supersedeReason: fact.supersedeReason ?? '',
            }));
            const rules = playbook
                .all()
                .filter((entry) => entry.status === 'active')
                .map((entry) => ({
                id: entry.id,
                content: entry.content,
                ...(entry.section === undefined ? {} : { section: String(entry.section) }),
                boundaryEnvs: entry.boundaryEnvs ?? [],
            }));
            const hit = topics.match(task, 1)[0];
            const wikiExcerpt = hit === undefined || wikiRef === undefined ? '' : wikiRef.excerpt(hit.topic.id, 400);
            const completion = url.searchParams.get('completion') ?? undefined;
            const preferredSubjects = hit === undefined ? [] : [hit.topic.name, ...(hit.topic.aliases ?? [])];
            return buildTaskBrief({
                task,
                facts,
                rules,
                preferredSubjects,
                // 相关性下限可配（默认 0.15，经验值未标定）
                minRelevance: config.briefMinRelevance,
                ...(wikiExcerpt.length === 0 ? {} : { wikiExcerpt }),
                ...(completion === undefined ? {} : { completion }),
            });
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/playbook/boundary', async (url) => {
            const id = (url.searchParams.get('id') ?? '').trim();
            if (id.length === 0)
                throw new Error('需要 id');
            const raw = url.searchParams.get('envs') ?? '';
            const envs = raw.split(/[|｜]/).map((value) => value.trim()).filter((value) => value.length > 0);
            const ok = playbook.setBoundary(id, envs);
            if (ok) {
                await playbook.flush();
                touch();
            }
            return { ok, id, boundaryEnvs: envs };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/usage', () => summarizeUsage({
            injectionFile: join(dataDir(), 'cognition-injection.jsonl'),
            usageFile: join(dataDir(), 'cognition-usage.jsonl'),
            pricePerMTokens: config.pricePerMTokens,
        }));
        route('/cognition-engine/wiki/list', () => ({
            dir: wiki.dir,
            pages: wiki.list().map((page) => ({
                topicId: page.topicId,
                topicName: page.topicName,
                updatedAt: page.updatedAt,
                bytes: page.bytes,
                sourceBytes: page.sourceBytes,
                trimmed: page.trimmed,
                excerpt: page.markdown.slice(0, 240),
            })),
        }));
        route('/cognition-engine/wiki/incremental', (url) => {
            const topicId = (url.searchParams.get('topic') ?? '').trim();
            if (topicId.length === 0)
                throw new Error('需要 topic 参数');
            const force = url.searchParams.get('force') === 'true';
            const sources = wikiSourcesFor(topicId);
            const result = updateWikiIncrementally({
                prev: wiki.read(topicId),
                topicId,
                topicName: sources.topic?.name ?? topicId,
                facts: sources.facts,
                tasks: sources.tasks,
                rules: sources.rules,
            });
            if (!result.changed)
                return { changed: false, reason: '来源没有变化', diff: result.diff };
            if (!force && result.diff.total < config.wikiIncrementalMinChanges) {
                return {
                    changed: false,
                    reason: '变化 ' + result.diff.total + ' 条，未达阈值 ' + config.wikiIncrementalMinChanges,
                    diff: result.diff,
                };
            }
            return { changed: true, page: wiki.save(result.page), diff: result.diff, suggestions: result.suggestions };
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/wiki', (url) => {
            const topicId = (url.searchParams.get('topic') ?? '').trim();
            if (topicId.length === 0)
                throw new Error('需要 topic 参数');
            return wiki.read(topicId) ?? { topicId, empty: true };
        });
        route('/cognition-engine/wiki/rebuild', (url) => {
            const topicId = (url.searchParams.get('topic') ?? '').trim();
            if (topicId.length === 0)
                throw new Error('需要 topic 参数');
            const sources = wikiSourcesFor(topicId);
            const page = buildWiki({
                topicId,
                topicName: sources.topic?.name ?? topicId,
                facts: sources.facts,
                tasks: sources.tasks,
                rules: sources.rules,
            });
            return wiki.save(page);
        }, { method: 'POST', requireAuth: explicitLock });
        route('/cognition-engine/wiki/save', (url) => {
            const topicId = (url.searchParams.get('topic') ?? '').trim();
            const md = url.searchParams.get('md') ?? '';
            if (topicId.length === 0)
                throw new Error('需要 topic 参数');
            const existing = wiki.read(topicId);
            if (existing === undefined)
                throw new Error('这个主题还没有 wiki，请先 rebuild');
            // 手工保存要把"哪几节被人改过"记下来——以后自动更新不许覆盖这些节
            const titles = {
                stance: '现行口径',
                avoid: '该避开',
                done: '完成判定',
                open: '未决问题',
            };
            const edited = new Set((existing.editedSections ?? []));
            const blockOf = (text, title) => {
                const match = text.split('## ').find((chunk) => chunk.startsWith(title));
                return match === undefined ? '' : match.slice(title.length).trim();
            };
            for (const key of ['stance', 'avoid', 'done', 'open']) {
                if (blockOf(md, titles[key]) !== blockOf(existing.markdown, titles[key]))
                    edited.add(key);
            }
            const page = {
                ...existing,
                markdown: md,
                bytes: md.length,
                updatedAt: Date.now(),
                editedSections: [...edited],
            };
            return wiki.save(page);
        }, { method: 'POST', requireAuth: explicitLock });
        // 视角窗：只回答一个具体情境；不聚合、不给参数值
        route('/cognition-engine/sediment/perspective', (url) => {
            const subject = (url.searchParams.get('subject') ?? '').trim();
            if (subject.length === 0 || subject === '*') {
                throw new Error('视角窗只回答具体情境：请给一个 subject（不接受全部）');
            }
            const facts = memory
                .all()
                .filter((fact) => fact.deletedAt === undefined && fact.supersededAt === null && fact.archived !== true)
                .map((fact) => ({
                id: fact.id,
                subject: fact.subject,
                content: fact.content,
                validFrom: fact.validFrom,
                importance: fact.importance,
            }));
            return sediment.perspective(subject, facts);
        });
        route('/cognition-engine/sediment/event', (url) => {
            const subject = url.searchParams.get('subject') ?? '';
            const oldText = url.searchParams.get('old') ?? '';
            const newText = url.searchParams.get('new') ?? '';
            if (subject.length === 0 || oldText.length === 0 || newText.length === 0) {
                throw new Error('需要 subject / old / new 三个参数');
            }
            return sediment.observe({
                subject,
                from: url.searchParams.get('from'),
                to: url.searchParams.get('to'),
                oldText,
                newText,
                personRelated: url.searchParams.get('person') === 'true',
            });
        }, { method: 'POST' });
        // —— 离线整合（dreaming）：只出报告，不改数据 ——
        const dreamFile = () => join(dataDir(), 'cognition-dream.json');
        const runDream = (threshold) => {
            const report = runDreaming({
                facts: memory.all().map((fact) => ({
                    id: fact.id,
                    subject: fact.subject,
                    content: fact.content,
                    supersededAt: fact.supersededAt,
                    deletedAt: fact.deletedAt,
                    archived: fact.archived,
                })),
                rules: playbook.all().map((entry) => ({
                    id: entry.id,
                    section: entry.section,
                    content: entry.content,
                    status: entry.status,
                    topicIds: entry.topicIds,
                    evidenceStatus: entry.evidence?.status,
                })),
                topicCount: topics.all().length,
                ...(threshold === undefined ? {} : { duplicateThreshold: threshold }),
            });
            try {
                writeFileSync(dreamFile(), JSON.stringify(report, null, 2) + '\n', 'utf8');
            }
            catch {
                /* 写不进报告不影响返回值 */
            }
            return report;
        };
        route('/cognition-engine/dreaming', () => {
            try {
                if (!existsSync(dreamFile()))
                    return { report: null, path: dreamFile() };
                return { report: JSON.parse(readFileSync(dreamFile(), 'utf8')), path: dreamFile() };
            }
            catch (error) {
                return { report: null, path: dreamFile(), error: messageOf(error) };
            }
        });
        route('/cognition-engine/dreaming/run', (url) => {
            const raw = Number(url.searchParams.get('threshold'));
            return runDream(Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : undefined);
        }, { method: 'POST' });
        route('/cognition-engine/memory/repair', () => {
            const repaired = memory.repairOrphans();
            if (repaired > 0) {
                touch();
                refreshEvidence();
            }
            return { repaired };
        }, { method: 'POST' });
        // —— 场合判定（干活 / 闲聊）：当前只记录，不改任何注入内容 ——
        route('/cognition-engine/register', (url) => {
            const raw = Number(url.searchParams.get('limit') ?? '20');
            const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, raw)) : 20;
            return {
                path: registerLog.path,
                overview: registerLog.overview(),
                thresholds: { threshold: THRESHOLD, ambiguity: AMBIGUITY_THRESHOLD },
                /** 说明当前阶段：只记录，不改行为。 */
                mode: 'record-only',
                recent: registerLog.effective(limit),
            };
        });
        route('/cognition-engine/register/label', (url) => {
            const sessionId = url.searchParams.get('sessionId') ?? '';
            const turn = Number(url.searchParams.get('turn') ?? '0');
            const label = url.searchParams.get('label') === 'right' ? 'right' : 'wrong';
            return { ok: registerLog.label(sessionId, turn, label), label };
        }, { method: 'POST' });
        // —— 超级代理（dsh-superagent）只读镜像 + 少量写动作 ——
        // 对面是另一个进程，所以每个 route 都要 async，并只返回紧凑结构。
        route('/cognition-engine/superagent/overview', async () => ({
            ...(await superagent.overview()),
            /** 派活用：`owner/name`，没配就是 null（面板只给可复制文本，不给链接）。 */
            repo: config.superagentRepo.length > 0 ? config.superagentRepo : null,
        }));
        route('/cognition-engine/superagent/tickets', async () => superagent.tickets());
        route('/cognition-engine/superagent/action', async (url) => {
            const raw = url.searchParams.get('action') ?? '';
            const ticketId = url.searchParams.get('id') ?? undefined;
            if (raw !== 'pause' && raw !== 'resume' && raw !== 'retry' && raw !== 'stop') {
                return { ok: false, error: `不支持的动作 ${raw}` };
            }
            return superagent.act(raw, ticketId);
        }, { method: 'POST' });
        route('/cognition-engine/tickets/link', (url) => {
            const id = url.searchParams.get('id') ?? '';
            const ticket = url.searchParams.get('ticket');
            return { id, ok: proactiveStore.linkTicket(id, ticket === null ? null : ticket) };
        }, { method: 'POST' });
        // —— AGENTS.md 受控块同步（默认关闭；只替换标记之间） ——
        route('/cognition-engine/agents-sync', () => {
            const body = agentsBody();
            const preview = agentsSync.preview(body);
            return {
                enabled: config.agentsFileSync,
                path: agentsSync.path,
                bodyChars: body.length,
                empty: body.length === 0,
                changed: preview.changed,
                malformed: preview.malformed,
                exists: preview.previous !== null,
                /** 合并后的完整内容，供面板预览（不写盘） */
                merged: preview.content,
            };
        });
        route('/cognition-engine/agents-sync/apply', () => {
            if (!config.agentsFileSync) {
                return { ok: false, reason: '未开启：agentsFileSync=false（不擅自改用户的全局指令文件）' };
            }
            return agentsSync.apply(agentsBody());
        }, { method: 'POST' });
        // 八类不学：给候选做个检查（不改数据，只回答「该不该学」）
        route('/cognition-engine/learn/check', (url) => {
            const text = url.searchParams.get('text') ?? '';
            const sourceIds = url.searchParams.get('sourceIds');
            // 只在调用方**明确**说了 sourceIds 时才判「无用户依据」；
            // 不说 = 不知道，不能当成「没有」（否则每句正常准则都会被误拒）。
            const verdict = shouldReject(text, sourceIds === null ? {} : { hasUserEvidence: sourceIds.length > 0 });
            return { text: text.slice(0, 80), reject: verdict.reject, hits: verdict.hits };
        });
        route('/cognition-engine/persona/undo', (url) => persona.undo(url.searchParams.get('hash') ?? undefined), { method: 'POST' });
        // 风格指纹（S4）：只读统计量，页面/脚本查询用
        route('/cognition-engine/style', (url) => {
            const rawBucket = url.searchParams.get('bucket');
            const bucket = rawBucket === 'technical' || rawBucket === 'emotional' || rawBucket === 'casual' ? rawBucket : 'all';
            const rawRecent = Number(url.searchParams.get('recent') ?? '30');
            return {
                enabled: config.styleEnabled,
                path: styleStore.path,
                sample: styleStore.sampleSummary(),
                comparison: styleStore.compare({
                    bucket,
                    ...(Number.isFinite(rawRecent) ? { recentTurns: rawRecent } : {}),
                }),
                trend: styleStore.trend(12),
                /** 只落统计量、不落原文——这一项写出来是为了让后来人一眼看到边界。 */
                storesRawText: false,
                saveError: styleStore.lastSaveError ?? null,
            };
        });
        route('/cognition-engine/style/baseline', () => styleStore.freezeBaseline(), { method: 'POST' });
        route('/cognition-engine/persona/propose', (url) => {
            const raw = url.searchParams.get('label');
            const label = raw === 'human' ? 'human' : 'persona';
            const value = url.searchParams.get('value') ?? '';
            const reason = url.searchParams.get('reason') ?? undefined;
            const by = url.searchParams.get('by') === 'user' ? 'user' : 'agent';
            const result = persona.propose({ label, value, by, ...(reason === undefined ? {} : { reason }) });
            return { ...result, warnings: result.proposal === undefined ? [] : persona.lint(value) };
        }, { method: 'POST' });
        route('/cognition-engine/persona/confirm', (url) => persona.confirm(url.searchParams.get('id') ?? '', 'user'), { method: 'POST' });
        route('/cognition-engine/persona/reject', (url) => {
            const id = url.searchParams.get('id') ?? '';
            return { id, ok: persona.reject(id) };
        }, { method: 'POST' });
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
            refreshEvidence();
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
        refreshEvidence,
        sedimentObserve: (oldId, newId, reason) => observeSupersedeRef?.(oldId, newId, reason),
        gapRecorder: (text, context) => {
            const { gap, duplicate } = gaps.add({ text, ...(context === undefined ? {} : { context }) });
            if (!duplicate)
                gaps.flush();
            return { id: gap.id, duplicate, open: gaps.open().length };
        },
        playbookRate: (id, kind, trace) => {
            // 这是**模型自报**路径（cognition_reflect action=rate）：只记 selfApplied*，
            // 推不动准则的升级/降级。要影响判定，只能走用户反馈那条路。
            const ok = playbook.markUsage(id, kind, trace, 'self');
            if (ok)
                void playbook.flush();
            return ok;
        },
        // 这两个之前漏传：导致「本地占位告警」从未出现、准则蒸馏不可用。
        currentReflectionMode: () => reflectionMode,
        distillPlaybook: runDistill,
        // S8：每次真实召回都记一条（只记 id 与分数，不记正文）
        onRecall: (info) => recallLog.record(info),
    });
    const [remember, recall, forget, reflect, state, cognitionContext, manageLongTask, clarify] = toolList;
    /**
     * 资料层检索工具：模型在对话里主动取回「用户放进来的资料」。
     *
     * 与 cognition_recall 分工明确——recall 查的是「关于用户为真」的口径，
     * 这个查的是外部资料原文。合在一起就会出现「用论文里的话冒充用户口径」。
     */
    const sourceTool = {
        name: 'cognition_source',
        description: '查用户放进来的资料（论文/文档/网页）：按关键词取回原文片段与已提炼的结论摘要。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
                query: { type: 'string', description: '要查什么：关键词或一句话。' },
                k: { type: 'number', description: '返回块数，默认 4。' },
                withNote: { type: 'boolean', description: '是否附带来源的摘要与结论，默认 true。' },
            },
        },
        output: textOutput,
        async execute(args) {
            const input = asRecord(args);
            const query = requireString(input, 'query');
            const hits = library.search(query, { k: Number(input.k ?? 4) });
            const withNote = input.withNote !== false;
            const sourceIds = [...new Set(hits.map((hit) => hit.sourceId))];
            const notes = withNote
                ? sourceIds
                    .map((sourceId) => library.note(sourceId))
                    .filter((note) => note !== undefined && note.status === 'ready')
                    .map((note) => ({ sourceId: note.sourceId, title: note.title, topic: note.topic, summary: note.summary, points: note.points }))
                : [];
            /** 行首 datamark：标注随数据走，不会被上游一句总结稀释。 */
            const datamark = (text) => text.split('\n').map((line) => `⟦D⟧ ${line}`).join('\n');
            const blocks = hits.map((hit) => {
                const flags = scanFlags(hit.text);
                const label = `${hit.sourceId}#${hit.ord}`;
                return {
                    sourceId: hit.sourceId,
                    ref: `[${label}]`,
                    title: sources.get(hit.sourceId)?.title ?? hit.title,
                    ord: hit.ord,
                    score: Number(hit.score.toFixed(3)),
                    flags,
                    // 原文一律包成数据块再给模型：不包的话模型只能从 hint 里"听说"这是资料
                    text: wrapAsData(label, datamark(hit.text), flags),
                };
            });
            return JSON.stringify({
                query,
                hits: blocks,
                notes,
                hint: hits.length === 0
                    ? '资料库里没有命中的块：可能没导入过，或换个关键词。'
                    : '以上是外部资料的原文（⟦D⟧ 行是数据标记），不是用户的口径。引用时写 [src-xx#n]；' +
                        '带 flags 的块不能单独作为依据，必须再引一个没有 flags 的块。',
            });
        },
    };
    /**
     * L2 抓取工具：只抓白名单内的站点，链路与收件箱导入完全相同。
     *
     * 为什么不给"随便抓"：一次不受控的抓取会把整站内容灌进资料库，
     * 也会让"用户放进来的资料"变成"模型自己找的资料"——那是两回事。
     */
    const webTool = {
        name: 'cognition_web',
        description: '把白名单内的网页抓进资料库（切块+提炼后可按需检索）。域名不在白名单会拒绝并告诉你加哪个。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['url'],
            properties: {
                url: { type: 'string', description: '完整网址（http/https）。' },
            },
        },
        output: textOutput,
        async execute(args) {
            const input = asRecord(args);
            const url = requireString(input, 'url');
            const result = await importFromWeb(url);
            return JSON.stringify(result);
        },
    };
    for (const definition of [remember, recall, forget, reflect, state, cognitionContext, manageLongTask, clarify, sourceTool, webTool]) {
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
     * 具体拼什么由 renderInjectedContext 决定，与面板的「注入来源」同源。
     * text() 是纯的：装配多少次都不产生副作用（v0.11.0 在这里写日志，把注入表写成了轮询计数器）。
     */
    const systemPrompt = ctx.get?.('systemPrompt');
    if (config.injectMemory && systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
        try {
            disposers.push(systemPrompt.section({
                name: 'cognition-engine-memory',
                order: 900,
                text: () => renderInjectedContext().text,
            }));
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 系统提示段注册失败: ${messageOf(error)}`);
        }
    }
    /**
     * 人格段挂在最前面（order 100，记忆段是 900）。
     *
     * 顺序有讲究：人格是「谁在说话」，记忆是「知道什么」。
     * 人格放在后面会被长记忆段稀释；放在最前面才能稳定住风格。
     * 文件不存在时 `persona.render()` 返回空串，这个段实际不占任何 token。
     */
    if (config.personaEnabled && systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
        try {
            const present = persona.loadSync();
            disposers.push(systemPrompt.section({
                name: 'cognition-engine-persona',
                order: 100,
                text: () => persona.render(),
            }));
            ctx.logger?.info?.(present ? 'cognition-engine: 人格段已挂载' : 'cognition-engine: 人格段已就位（暂无人格文件）');
        }
        catch (error) {
            ctx.logger?.warn?.(`cognition-engine: 人格段注册失败: ${messageOf(error)}`);
        }
    }
    /**
     * 后台巡视：每隔 patrolIntervalHours 检查 tasks.json，
     * 用 ReflectionWorker 在后台宏任务里复盘最久没动的任务，全程不阻塞主线程。
     */
    const patrol = async () => {
        try {
            await tasksReady;
            // 主动闸门扫描（S7）：放在最前面——即使没有逾期任务也要记录 wouldDo
            try {
                runProactiveScan();
            }
            catch (error) {
                ctx.logger?.warn?.(`cognition-engine: 主动扫描失败 ${messageOf(error)}`);
            }
            // P1 记忆生命周期：长期没被想起的记忆退出 strict 召回（不删数据）
            const archived = memory.autoArchive({ idleDays: 180, maxActivation: 1 });
            if (archived.length > 0)
                refreshEvidence();
            if (archived.length > 0) {
                ctx.logger?.info?.(`cognition-engine: 已归档 ${archived.length} 条长期未访问的记忆`);
                touch();
            }
            // P3-2 到期下沉：过期未完成的任务转 EXPIRED，并写一条普通记忆（不删任务）
            const expiredTasks = await taskManager.expireDue(Date.now());
            if (expiredTasks.length > 0) {
                for (const task of expiredTasks) {
                    try {
                        memory.ingest({
                            content: `任务到期未完成：${task.description}` +
                                (task.expiresAt === undefined ? '' : `（原定 ${new Date(task.expiresAt).toISOString().slice(0, 10)}）`) +
                                `。最后线索：${task.context.slice(-2).join('；') || '无'}`,
                            subject: '未完成事项',
                            source: 'agent',
                            importance: 0.4,
                        });
                    }
                    catch (error) {
                        ctx.logger?.warn?.(`cognition-engine: 过期任务下沉失败 ${messageOf(error)}`);
                    }
                }
                refreshEvidence();
                touch();
                ctx.logger?.info?.(`cognition-engine: ${expiredTasks.length} 个任务到期，已下沉为记忆`);
            }
            // wiki 增量巡检（默认关）：只刷"变化条数达到阈值"的主题；没有变化不写盘
            if (config.wikiIncremental && wikiRef !== undefined && wikiSourcesRef !== undefined) {
                for (const topic of topics.all()) {
                    try {
                        const sources = wikiSourcesRef(topic.id);
                        const result = updateWikiIncrementally({
                            prev: wikiRef.read(topic.id),
                            topicId: topic.id,
                            topicName: topic.name,
                            facts: sources.facts,
                            tasks: sources.tasks,
                            rules: sources.rules,
                        });
                        if (result.changed && result.diff.total >= config.wikiIncrementalMinChanges) {
                            wikiRef.save(result.page);
                        }
                    }
                    catch (error) {
                        ctx.logger?.warn?.(`cognition-engine: wiki 增量失败 ${messageOf(error)}`);
                    }
                }
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
