/**
 * src/proactive_scan.ts — 主动闸门接火（S7）
 *
 * ## 现状与目标
 *
 * `src/proactive.ts` 里的 `ProactiveGate` 是**群聊语境**的（冷场 + 点名 + 准入矩阵）。
 * 我们这里是单人长期助手，真正值得主动提的东西不是「该不该插话」，而是
 * **「有几件事你可能忘了，要不要现在处理」**：待办逾期、未解决缺口、
 * 证据链断裂的准则、过期准则。
 *
 * ## 三阶段（默认停在 P1）
 *
 *   P1 record-only   只记录「本来会提醒什么」，零主动消息  ← 默认
 *   P2 用户规则      只有用户明确写了规则（如「每天 9 点提醒待办」）才发
 *   P3 学习后放开    采纳率 ≥70% 且样本 ≥20 才允许自主判断
 *
 * **为什么默认 P1 而且门槛这么硬**：主动提醒做错的代价不对称——
 * 漏提醒只是少一次帮助，误提醒是打断注意力、并且会让人开始无视所有提醒。
 * 先证明「我提的你都用得上」，再谈自主。
 *
 * ## 打分
 *
 * 沿用 MaiBot `turn_trigger` 的**逻辑回归形态**（可解释、可手调），
 * 但信号换成我们自己的场景。没有用它的系数——那是在群聊数据上拟合的，
 * 直接搬过来只是把别人的先验当真理。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataFile } from "./util.js";
/** 各信号对 logit 的贡献（可手调；全部有界）。 */
const WEIGHTS = {
    intercept: -1.2,
    pendingDue: 1.6,
    unresolvedGaps: 1.1,
    brokenEvidence: 1.2,
    expiredRules: 0.5,
    silence: 0.06,
};
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(1, Math.max(0, value));
}
/**
 * 算分，返回可用于解释的分解。
 *
 * 纯函数：同样的输入永远同样的分，便于事后复盘「当时为什么提醒/没提醒」。
 */
export function scoreScan(input) {
    const parts = {
        pendingDue: WEIGHTS.pendingDue * Math.min(1, Math.max(0, input.pendingDue) / 3),
        unresolvedGaps: WEIGHTS.unresolvedGaps * Math.min(1, Math.max(0, input.unresolvedGaps) / 2),
        brokenEvidence: WEIGHTS.brokenEvidence * Math.min(1, Math.max(0, input.brokenEvidence)),
        expiredRules: WEIGHTS.expiredRules * Math.min(1, Math.max(0, input.expiredRules) / 3),
        // 静默按小时计：1 小时 ≈ 0.04，一周 ≈ 0.31，不喧宾夺主
        silence: WEIGHTS.silence * Math.log1p(Math.max(0, input.silenceMs ?? 0) / 3_600_000),
    };
    const logit = WEIGHTS.intercept + parts.pendingDue + parts.unresolvedGaps + parts.brokenEvidence + parts.expiredRules + parts.silence;
    return { score: Number(clamp01(sigmoid(logit)).toFixed(3)), logit: Number(logit.toFixed(3)), parts };
}
/** 把输入 + 来源转成 wouldDo 草稿（不含入库逻辑，纯函数，便于测试）。 */
export function buildWouldDo(source, score) {
    const out = [];
    for (const task of source.dueTasks) {
        out.push({
            key: `pending-due:${task.id}`,
            kind: 'pending-due',
            targetId: task.id,
            score,
            action: `待办「${task.description.slice(0, 40)}」已逾期 ${task.overdueHours} 小时`,
            userAction: '确认这条待办是已完成、还是需要改期',
            benefit: '避免拖成僵尸任务，越拖越不想碰',
        });
    }
    for (const gap of source.gaps) {
        out.push({
            key: `unresolved-gap:${gap.id}`,
            kind: 'unresolved-gap',
            targetId: gap.id,
            score,
            action: `有一个没补上的信息：${gap.text.slice(0, 50)}`,
            userAction: '补一句你知道的（或直接说「不用管」）',
            benefit: '下次遇到同类问题不会又卡在同一个地方',
        });
    }
    for (const rule of source.brokenRules) {
        out.push({
            key: `broken-evidence:${rule.id}`,
            kind: 'broken-evidence',
            targetId: rule.id,
            score,
            action: `准则「${rule.content.slice(0, 40)}」的依据被删掉了`,
            userAction: '确认这条还成立吗？不成立就停用',
            benefit: '避免继续按一条没有依据的准则做事',
        });
    }
    for (const rule of source.expiredRules) {
        out.push({
            key: `expired-rule:${rule.id}`,
            kind: 'expired-rule',
            targetId: rule.id,
            score,
            action: `准则「${rule.content.slice(0, 40)}」已过期`,
            userAction: '复核是否续期',
            benefit: '防止过期准则继续参与判断',
        });
    }
    return out;
}
const DEFAULT_PHASE = 'P1';
/** P3 的开门条件：样本够 + 采纳率高。 */
const P3_MIN_SAMPLES = 20;
const P3_MIN_ADOPTION = 0.7;
export class ProactiveStore {
    filePath;
    clock;
    keep;
    doc;
    loaded = false;
    saveError;
    constructor(options = {}) {
        this.filePath = options.filePath === undefined ? resolveDataFile('cognition-proactive.json') : resolve(options.filePath);
        this.clock = options.now ?? (() => Date.now());
        this.keep = options.keep ?? 200;
        this.doc = {
            schema: 'cognition.proactive',
            version: 1,
            phase: DEFAULT_PHASE,
            rules: [],
            items: [],
            stats: { adopted: 0, dismissed: 0, lastScanAt: null, lastScore: null },
        };
    }
    loadSync() {
        if (this.loaded)
            return true;
        this.loaded = true;
        try {
            if (!existsSync(this.filePath))
                return false;
            const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.proactive')
                return false;
            const phase = raw.phase === 'P2' || raw.phase === 'P3' ? raw.phase : 'P1';
            this.doc = {
                schema: 'cognition.proactive',
                version: 1,
                phase,
                rules: Array.isArray(raw.rules) ? raw.rules.filter((r) => r !== null && typeof r === 'object' && typeof r.id === 'string') : [],
                items: Array.isArray(raw.items) ? raw.items.filter((i) => i !== null && typeof i === 'object' && typeof i.id === 'string') : [],
                stats: {
                    adopted: Number(raw.stats?.adopted ?? 0),
                    dismissed: Number(raw.stats?.dismissed ?? 0),
                    lastScanAt: typeof raw.stats?.lastScanAt === 'number' ? raw.stats.lastScanAt : null,
                    lastScore: typeof raw.stats?.lastScore === 'number' ? raw.stats.lastScore : null,
                },
            };
            return true;
        }
        catch {
            return false;
        }
    }
    get path() {
        return this.filePath;
    }
    get lastSaveError() {
        return this.saveError;
    }
    get document() {
        this.loadSync();
        return this.doc;
    }
    get phase() {
        this.loadSync();
        return this.doc.phase;
    }
    /**
     * 切阶段。**升级到 P3 有门槛**：采纳率 ≥70% 且样本 ≥20。
     * 降到 P1 随时允许（安全方向不该设门槛）。
     */
    setPhase(phase) {
        this.loadSync();
        if (phase === 'P3') {
            const samples = this.doc.stats.adopted + this.doc.stats.dismissed;
            const rate = this.adoptionRate();
            if (samples < P3_MIN_SAMPLES) {
                return { ok: false, phase: this.doc.phase, reason: `样本不足（${samples}/${P3_MIN_SAMPLES}），先跑一段 P1/P2` };
            }
            if (rate < P3_MIN_ADOPTION) {
                return { ok: false, phase: this.doc.phase, reason: `采纳率 ${(rate * 100).toFixed(0)}% < 70%，还不够格自主` };
            }
        }
        this.doc.phase = phase;
        this.#save();
        return { ok: true, phase };
    }
    /** 采纳率（adopted / (adopted + dismissed)）；没样本时为 0。 */
    adoptionRate() {
        this.loadSync();
        const total = this.doc.stats.adopted + this.doc.stats.dismissed;
        return total === 0 ? 0 : Number((this.doc.stats.adopted / total).toFixed(3));
    }
    addRule(text) {
        this.loadSync();
        const trimmed = text.trim();
        if (trimmed.length === 0)
            return { ok: false, reason: '规则不能为空' };
        const rule = { id: `pr-${randomUUID().slice(0, 8)}`, text: trimmed, createdAt: this.clock(), active: true };
        this.doc.rules.push(rule);
        this.#save();
        return { ok: true, id: rule.id };
    }
    removeRule(id) {
        this.loadSync();
        const before = this.doc.rules.length;
        this.doc.rules = this.doc.rules.filter((rule) => rule.id !== id);
        if (this.doc.rules.length === before)
            return false;
        this.#save();
        return true;
    }
    /**
     * 记一次扫描结果。
     *
     * 同 key 的条目**只更新不新增**，并把 `seen` 加一——「同一件事被反复扫到」
     * 本身就是最有价值的信息（说明一直没处理）。
     */
    recordScan(source, score) {
        this.loadSync();
        this.doc.stats.lastScanAt = this.clock();
        this.doc.stats.lastScore = score;
        const drafts = buildWouldDo(source, score);
        const touched = [];
        for (const draft of drafts) {
            const existing = this.doc.items.find((item) => item.key === draft.key && item.status === 'pending');
            if (existing !== undefined) {
                existing.lastSeenAt = this.clock();
                existing.seen += 1;
                existing.score = score;
                touched.push(existing);
                continue;
            }
            // 已处理过的同一件事不再复活（否则「忽略」等于没忽略）
            const handled = this.doc.items.find((item) => item.key === draft.key && item.status !== 'pending');
            if (handled !== undefined)
                continue;
            const item = {
                id: `wd-${randomUUID().slice(0, 8)}`,
                ...draft,
                at: this.clock(),
                lastSeenAt: this.clock(),
                seen: 1,
                status: 'pending',
            };
            this.doc.items.push(item);
            touched.push(item);
        }
        this.doc.items = this.doc.items.slice(-this.keep);
        this.#save();
        return touched;
    }
    /** 当前待处理的 wouldDo（新的在前）。 */
    pending() {
        this.loadSync();
        return this.doc.items.filter((item) => item.status === 'pending').reverse();
    }
    /**
     * 标记已采纳。
     *
     * 采纳 = 用户点了「好，我去处理」。这个计数是 P3 的入场券。
     */
    adopt(id) {
        this.loadSync();
        const item = this.doc.items.find((entry) => entry.id === id);
        if (item === undefined || item.status !== 'pending')
            return false;
        item.status = 'adopted';
        this.doc.stats.adopted += 1;
        this.#save();
        return true;
    }
    /** 标记不需要（也算一次负样本，用来算采纳率）。 */
    dismiss(id) {
        this.loadSync();
        const item = this.doc.items.find((entry) => entry.id === id);
        if (item === undefined || item.status !== 'pending')
            return false;
        item.status = 'dismissed';
        this.doc.stats.dismissed += 1;
        this.#save();
        return true;
    }
    /**
     * 这一轮到底能不能真的发消息。
     *
     * P1 永远不发；P2 只在有启用的用户规则时发；P3 才允许按分数自主。
     */
    canSpeak(score, threshold = 0.6) {
        this.loadSync();
        if (this.doc.phase === 'P1')
            return { speak: false, reason: 'P1 record-only：只记录，不发言' };
        if (this.doc.phase === 'P2') {
            const active = this.doc.rules.filter((rule) => rule.active);
            if (active.length === 0)
                return { speak: false, reason: 'P2：还没有用户规则，不发言' };
            return { speak: true, reason: `P2：命中用户规则（${active.length} 条启用）` };
        }
        return { speak: score >= threshold, reason: `P3：分数 ${score} ${score >= threshold ? '过线' : '未过线'}（线 ${threshold}）` };
    }
    #save() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(this.doc, null, 2) + '\n', 'utf8');
            this.saveError = undefined;
        }
        catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
        }
    }
}
