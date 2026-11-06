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
import { resolveDataFile } from './util.ts';

export type ProactivePhase = 'P1' | 'P2' | 'P3';

/** 扫描输入：都是**可观测的计数**，不做主观判断。 */
export interface ScanInput {
  pendingDue: number;
  unresolvedGaps: number;
  brokenEvidence: number;
  expiredRules: number;
  /** 距上次交互多久（毫秒）。 */
  silenceMs?: number;
}

export type WouldDoKind = 'pending-due' | 'unresolved-gap' | 'broken-evidence' | 'expired-rule';

/**
 * 工单阶段（S10）。
 *
 * 为什么在「三种状态」之外还要阶段：状态只回答「做没做」，
 * 阶段回答「卡在哪、下一步该谁动」。真实的长任务经常停在
 * 「我做完了但你要验一下」——没有 `review` 这一档，它只能被硬塞进
 * `done`，然后没人验，或者一直挂在 `doing` 里假装还在做。
 */
export type TicketStage = 'draft' | 'open' | 'doing' | 'review' | 'done';

/** 阶段到基础状态的映射：状态用于既有列表/筛选，阶段是更细的那一层。 */
export const STAGE_TO_STATUS: Readonly<Record<TicketStage, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>> = Object.freeze({
  draft: 'PENDING',
  open: 'PENDING',
  doing: 'IN_PROGRESS',
  review: 'IN_PROGRESS',
  done: 'COMPLETED',
});

export interface WouldDo {
  id: string;
  /** 去重键：同一件事反复扫到只更新不新增。 */
  key: string;
  kind: WouldDoKind;
  at: number;
  lastSeenAt: number;
  /** 见了几次（≥2 说明一直没处理）。 */
  seen: number;
  /** 具体指哪一条（任务/缺口/准则 id）。 */
  targetId: string;
  /** 触发时算出的分。 */
  score: number;
  /** 一句话：本来会提醒什么。 */
  action: string;
  /** 用户需要做什么。 */
  userAction: string;
  /** 用户能得到什么。 */
  benefit: string;
  status: 'pending' | 'adopted' | 'dismissed' | 'stale';
  /** 下线/处理时留下的说明。 */
  note?: string;

  /* ---------------------- S10：工单字段 ---------------------- */
  /** 工单阶段。缺省时按 `status` 推测（老数据兼容）。 */
  stage?: TicketStage;
  /** 做完要交什么（产物）：文件路径、一份结论、一个数值。 */
  deliverable?: string;
  /** 为什么做 / 卡在哪（自由文本，几条即可）。 */
  background?: string;
  /** 依赖：这些工单没完成，这条就动不了。 */
  blockedBy?: string[];
  /** 阶段变更历史（谁在什么时候推到哪一步）。 */
  history?: Array<{ at: number; from: TicketStage | null; to: TicketStage; by: 'user' | 'agent'; note?: string }>;
}

export interface ProactiveDoc {
  schema: 'cognition.proactive';
  version: 1;
  phase: ProactivePhase;
  /** P2 的用户规则（自然语言，由人写）。 */
  rules: Array<{ id: string; text: string; createdAt: number; active: boolean }>;
  items: WouldDo[];
  stats: { adopted: number; dismissed: number; lastScanAt: number | null; lastScore: number | null };
}

export interface ProactiveStoreOptions {
  filePath?: string;
  now?: () => number;
  /** 历史保留多少条。 */
  keep?: number;
}

/** 各信号对 logit 的贡献（可手调；全部有界）。 */
const WEIGHTS = {
  intercept: -1.2,
  pendingDue: 1.6,
  unresolvedGaps: 1.1,
  brokenEvidence: 1.2,
  expiredRules: 0.5,
  silence: 0.06,
} as const;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 算分，返回可用于解释的分解。
 *
 * 纯函数：同样的输入永远同样的分，便于事后复盘「当时为什么提醒/没提醒」。
 */
export function scoreScan(input: ScanInput): { score: number; logit: number; parts: Record<string, number> } {
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

/** 供 scan 生成 wouldDo 的原始条目（由调用方从各存储里取）。 */
export interface ScanSource {
  dueTasks: Array<{ id: string; description: string; overdueHours: number }>;  gaps: Array<{ id: string; text: string }>;
  brokenRules: Array<{ id: string; content: string }>;
  expiredRules: Array<{ id: string; content: string }>;
}

/** 把输入 + 来源转成 wouldDo 草稿（不含入库逻辑，纯函数，便于测试）。 */
export function buildWouldDo(source: ScanSource, score: number): Array<Omit<WouldDo, 'id' | 'at' | 'lastSeenAt' | 'seen' | 'status'>> {
  const out: Array<Omit<WouldDo, 'id' | 'at' | 'lastSeenAt' | 'seen' | 'status'>> = [];
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

const DEFAULT_PHASE: ProactivePhase = 'P1';
/** dismissed 之后的冷却期：这段时间内不再提同一件事（默认 7 天）。 */
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** P3 的开门条件：样本够 + 采纳率高。 */
const P3_MIN_SAMPLES = 20;
const P3_MIN_ADOPTION = 0.7;

export class ProactiveStore {
  private readonly filePath: string;
  private readonly clock: () => number;
  private readonly keep: number;
  private doc: ProactiveDoc;
  private loaded = false;
  private saveError: string | undefined;

  constructor(options: ProactiveStoreOptions = {}) {
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

  loadSync(): boolean {
    if (this.loaded) return true;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return false;
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ProactiveDoc>;
      if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.proactive') return false;
      const phase: ProactivePhase = raw.phase === 'P2' || raw.phase === 'P3' ? raw.phase : 'P1';
      this.doc = {
        schema: 'cognition.proactive',
        version: 1,
        phase,
        rules: Array.isArray(raw.rules) ? raw.rules.filter((r): r is ProactiveDoc['rules'][number] => r !== null && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') : [],
        items: Array.isArray(raw.items) ? raw.items.filter((i): i is WouldDo => i !== null && typeof i === 'object' && typeof (i as WouldDo).id === 'string') : [],
        stats: {
          adopted: Number(raw.stats?.adopted ?? 0),
          dismissed: Number(raw.stats?.dismissed ?? 0),
          lastScanAt: typeof raw.stats?.lastScanAt === 'number' ? raw.stats.lastScanAt : null,
          lastScore: typeof raw.stats?.lastScore === 'number' ? raw.stats.lastScore : null,
        },
      };
      return true;
    } catch {
      return false;
    }
  }

  get path(): string {
    return this.filePath;
  }

  get lastSaveError(): string | undefined {
    return this.saveError;
  }

  get document(): ProactiveDoc {
    this.loadSync();
    return this.doc;
  }

  get phase(): ProactivePhase {
    this.loadSync();
    return this.doc.phase;
  }

  /**
   * 切阶段。**升级到 P3 有门槛**：采纳率 ≥70% 且样本 ≥20。
   * 降到 P1 随时允许（安全方向不该设门槛）。
   */
  setPhase(phase: ProactivePhase): { ok: boolean; phase: ProactivePhase; reason?: string } {
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
  adoptionRate(): number {
    this.loadSync();
    const total = this.doc.stats.adopted + this.doc.stats.dismissed;
    return total === 0 ? 0 : Number((this.doc.stats.adopted / total).toFixed(3));
  }

  addRule(text: string): { ok: boolean; id?: string; reason?: string } {
    this.loadSync();
    const trimmed = text.trim();
    if (trimmed.length === 0) return { ok: false, reason: '规则不能为空' };
    const rule = { id: `pr-${randomUUID().slice(0, 8)}`, text: trimmed, createdAt: this.clock(), active: true };
    this.doc.rules.push(rule);
    this.#save();
    return { ok: true, id: rule.id };
  }

  removeRule(id: string): boolean {
    this.loadSync();
    const before = this.doc.rules.length;
    this.doc.rules = this.doc.rules.filter((rule) => rule.id !== id);
    if (this.doc.rules.length === before) return false;
    this.#save();
    return true;
  }

  /**
   * 记一次扫描结果。
   *
   * 同 key 的条目**只更新不新增**，并把 `seen` 加一——「同一件事被反复扫到」
   * 本身就是最有价值的信息（说明一直没处理）。
   */
  recordScan(source: ScanSource, score: number): WouldDo[] {
    this.loadSync();
    this.doc.stats.lastScanAt = this.clock();
    this.doc.stats.lastScore = score;
    const drafts = buildWouldDo(source, score);
    const touched: WouldDo[] = [];
    for (const draft of drafts) {
      const existing = this.doc.items.find((item) => item.key === draft.key && item.status === 'pending');
      if (existing !== undefined) {
        existing.lastSeenAt = this.clock();
        existing.seen += 1;
        existing.score = score;
        touched.push(existing);
        continue;
      }
      // 「已处理」只挡 `adopted`（用户真去做了），**不挡 dismissed**——
      // dismissed 的意思是「这一次先不处理」，不是「以后别再提」。
      // 上一版把两者都当成永久封杀，结果一次误点就让提醒永不再现。
      const handled = this.doc.items.find((item) => item.key === draft.key && item.status === 'adopted');
      if (handled !== undefined) continue;
      // dismissed 带冷却：冷却期内不重提，免得每轮扫描都烦一次；过了冷却才允许再出现。
      const dismissed = this.doc.items
        .filter((item) => item.key === draft.key && item.status === 'dismissed')
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
      if (dismissed !== undefined && this.clock() - dismissed.lastSeenAt < DISMISS_COOLDOWN_MS) continue;
      const item: WouldDo = {
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
    this.#reconcile(touched);
    this.#save();
    return touched;
  }

  /**
   * 联动清理：条件已经不成立的待处理项自动下线。
   *
   * 这是「任务做完了但提醒还在」的修法。触发场景：
   *   - 待办被标记完成 → 不再出现在 dueTasks；
   *   - 缺口被解决 → 不再出现在 gaps；
   *   - 准则被修复/停用 → 不再出现在 broken/expired 列表。
   *
   * 标 `stale` 而不是 `dismissed`：它既不是「用户采纳」也不是「用户不要」，
   * 只是「事情已经不存在了」，不能算进采纳率的分母。
   */
  #reconcile(touched: readonly WouldDo[]): void {
    const alive = new Set(touched.map((item) => item.key));
    for (const item of this.doc.items) {
      if (item.status !== 'pending') continue;
      if (alive.has(item.key)) continue;
      item.status = 'stale';
    }
  }

  /** 明确清掉某一条目标（任务/缺口/准则）对应的待处理提醒。即时联动用。 */
  clearByTarget(targetId: string, reason = '目标已处理'): number {
    this.loadSync();
    let cleared = 0;
    for (const item of this.doc.items) {
      if (item.status !== 'pending' || item.targetId !== targetId) continue;
      item.status = 'stale';
      item.lastSeenAt = this.clock();
      if (item.note === undefined) item.note = reason;
      cleared += 1;
    }
    if (cleared > 0) this.#save();
    return cleared;
  }

  /** 当前待处理的 wouldDo（新的在前）。 */
  pending(): WouldDo[] {
    this.loadSync();
    return this.doc.items.filter((item) => item.status === 'pending').reverse();
  }

  /**
   * 当前工单（不含已下线/已删除）。
   *
   * 与 `pending()` 的区别：`pending()` 是「还没处理的提醒」，
   * 这里返回所有活着的工单（含已推进到 doing/review 的），供工单板按阶段分组。
   */
  tickets(): WouldDo[] {
    this.loadSync();
    return this.doc.items
      .filter((item) => item.status !== 'stale' && item.status !== 'dismissed')
      .map((item) => ({ ...item, stage: item.stage ?? this.#inferStage(item) }));
  }

  /** 老数据没有 stage 时按 status 推测，避免升级后全部显示成「草稿」。 */
  #inferStage(item: WouldDo): TicketStage {
    if (item.stage !== undefined) return item.stage;
    if (item.status === 'adopted') return 'doing';
    return 'open';
  }

  /**
   * 推进工单阶段。
   *
   * 允许任意跳转（比如直接 `open → done`）：真实的活儿经常一步到位，
   * 强制逐级推进会让人为了走流程多点三次。
   * 但**不允许从 `done` 悄悄改回去**——那要走 `reopen`，留下痕迹。
   */
  setStage(id: string, stage: TicketStage, options: { by?: 'user' | 'agent'; note?: string } = {}): {
    ok: boolean;
    stage?: TicketStage;
    reason?: string;
    unblocked?: string[];
  } {
    this.loadSync();
    const item = this.doc.items.find((entry) => entry.id === id);
    if (item === undefined) return { ok: false, reason: `找不到工单 ${id}` };
    if (item.status === 'stale' || item.status === 'dismissed') {
      return { ok: false, reason: '这条已经下线，不能推进阶段' };
    }
    const from = item.stage ?? this.#inferStage(item);
    if (from === stage) return { ok: true, stage };

    // 依赖检查：要动工，前置得先完成。`draft / open` 不受限（可以先攒着）。
    if (stage === 'doing' || stage === 'review' || stage === 'done') {
      const blockers = (item.blockedBy ?? []).filter((dep) => {
        const depItem = this.doc.items.find((entry) => entry.id === dep);
        if (depItem === undefined) return false;
        return (depItem.stage ?? this.#inferStage(depItem)) !== 'done';
      });
      if (blockers.length > 0) {
        return { ok: false, reason: `还有前置没完成：${blockers.join('、')}` };
      }
    }

    item.stage = stage;
    item.status = stage === 'draft' || stage === 'open' ? 'pending' : 'adopted';
    item.lastSeenAt = this.clock();
    item.history = [
      ...(item.history ?? []),
      { at: this.clock(), from, to: stage, by: options.by ?? 'user', ...(options.note === undefined ? {} : { note: options.note }) },
    ].slice(-30);

    // 完成时把「本来要提醒」的账记上：这条不再是待办
    if (stage === 'done' && from !== 'done') {
      // 若它原本还是 pending（没被 adopt 过），这里不再重复计采纳
      if (item.status === 'pending') item.status = 'adopted';
    }

    // 我完成了，可能解开别人的依赖
    const unblocked: string[] = [];
    if (stage === 'done') {
      for (const other of this.doc.items) {
        if (!other.blockedBy?.includes(id)) continue;
        const stillBlocked = other.blockedBy.some((dep) => {
          if (dep === id) return false;
          const depItem = this.doc.items.find((entry) => entry.id === dep);
          return depItem !== undefined && (depItem.stage ?? this.#inferStage(depItem)) !== 'done';
        });
        if (!stillBlocked) unblocked.push(other.id);
      }
    }

    this.#save();
    return { ok: true, stage, unblocked };
  }

  /** 补/改工单字段（产物、背景、依赖）。 */
  update(id: string, patch: { deliverable?: string; background?: string; blockedBy?: string[] }): boolean {
    this.loadSync();
    const item = this.doc.items.find((entry) => entry.id === id);
    if (item === undefined) return false;
    if (patch.deliverable !== undefined) item.deliverable = patch.deliverable.slice(0, 300);
    if (patch.background !== undefined) item.background = patch.background.slice(0, 600);
    if (patch.blockedBy !== undefined) item.blockedBy = patch.blockedBy.filter((dep) => dep !== id).slice(0, 10);
    this.#save();
    return true;
  }

  /**
   * 标记已采纳。
   *
   * 采纳 = 用户点了「好，我去处理」。这个计数是 P3 的入场券。
   * S10 起顺带推进到 `doing`（「我去处理」= 开始做了）。
   */
  adopt(id: string): boolean {
    this.loadSync();
    const item = this.doc.items.find((entry) => entry.id === id);
    if (item === undefined || item.status !== 'pending') return false;
    const fromStage: TicketStage = item.stage ?? this.#inferStage(item);
    item.status = 'adopted';
    item.stage = 'doing';
    item.history = [
      ...(item.history ?? []),
      { at: this.clock(), from: fromStage, to: 'doing' as const, by: 'user' as const, note: '从提醒点「我去处理」' },
    ].slice(-30);
    this.doc.stats.adopted += 1;
    this.#save();
    return true;
  }

  /** 标记不需要（也算一次负样本，用来算采纳率）。冷却期内不会再提同一件事。 */
  dismiss(id: string): boolean {
    this.loadSync();
    const item = this.doc.items.find((entry) => entry.id === id);
    if (item === undefined || item.status !== 'pending') return false;
    item.status = 'dismissed';
    item.lastSeenAt = this.clock();
    this.doc.stats.dismissed += 1;
    this.#save();
    return true;
  }

  /** 工单板分组（按阶段），新的在前。 */
  board(): Array<{ stage: TicketStage; label: string; items: WouldDo[] }> {
    const all = this.tickets();
    const order: Array<{ stage: TicketStage; label: string }> = [
      { stage: 'draft', label: '草稿' },
      { stage: 'open', label: '待办' },
      { stage: 'doing', label: '进行中' },
      { stage: 'review', label: '待验收' },
      { stage: 'done', label: '已完成' },
    ];
    return order.map((entry) => ({
      ...entry,
      items: all.filter((item) => (item.stage ?? 'open') === entry.stage).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    }));
  }

  /**
   * 这一轮到底能不能真的发消息。
   *
   * P1 永远不发；P2 只在有启用的用户规则时发；P3 才允许按分数自主。
   */
  canSpeak(score: number, threshold = 0.6): { speak: boolean; reason: string } {
    this.loadSync();
    if (this.doc.phase === 'P1') return { speak: false, reason: 'P1 record-only：只记录，不发言' };
    if (this.doc.phase === 'P2') {
      const active = this.doc.rules.filter((rule) => rule.active);
      if (active.length === 0) return { speak: false, reason: 'P2：还没有用户规则，不发言' };
      return { speak: true, reason: `P2：命中用户规则（${active.length} 条启用）` };
    }
    return { speak: score >= threshold, reason: `P3：分数 ${score} ${score >= threshold ? '过线' : '未过线'}（线 ${threshold}）` };
  }

  #save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.doc, null, 2) + '\n', 'utf8');
      this.saveError = undefined;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error);
    }
  }
}
