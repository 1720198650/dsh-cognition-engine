/**
 * src/budget.ts — 学习预算 + 五条停止信号（S6）
 *
 * ## 为什么需要「预算」这种看起来官僚的东西
 *
 * 学习系统的失败模式不是「学不会」，而是**学太多**：
 * - 上下文被塞满（准则越多，每条分到的注意力越少，反而更差）；
 * - 学进来一堆一次性事实和环境相关的噪音；
 * - 同一个主题反复翻烙饼（改来改去），把稳定知识搅乱。
 *
 * 所以这里给「学习」本身加配额：每周最多改几条、学几条。
 * 配额不是敌人——**它逼我们把名额花在真正值得的条目上**。
 *
 * ## 公式
 *
 *   W = clamp(max(ceil(N × 1%), 8), 4, 12)     N = 当前生效准则数
 *   默认 8 = 修旧 5 + 学新 2 + 预留 1
 *
 * 超过配额怎么办：**转入 shadow 试运行**，而不是硬拦。
 * 这样「想学」和「不许污染上下文」两件事都能满足。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDataFile } from './util.ts';

export type LearnKind = 'revise' | 'new';

export interface BudgetQuota {
  total: number;
  revise: number;
  new: number;
  reserve: number;
}

export interface BudgetUsed {
  total: number;
  revise: number;
  new: number;
}

/** 一条停止信号。 */
export interface StopSignal {
  /** 信号编号（稳定，便于页面与日志对齐）。 */
  code: 'futile' | 'still-wrong' | 'overcrowded' | 'flip-flop' | 'idle-quota';
  /** 人话说明。 */
  reason: string;
  /** 触发后应该做什么。 */
  action: 'pause-new' | 'revise-only' | 'freeze-subject' | 'shrink-quota';
}

export interface BudgetDoc {
  schema: 'cognition.budget';
  version: 1;
  /** ISO 周，如 2026-W45。跨周自动重置 used。 */
  week: string;
  activeRules: number;
  quota: BudgetQuota;
  used: BudgetUsed;
  /** 上周没用完的名额不累积，避免「攒着一次学一堆」。 */
  debt: number;
  paused: boolean;
  pauseReason: string | null;
  pausedUntilWeek: string | null;
  updatedAt: number;
}

export interface BudgetStoreOptions {
  filePath?: string;
  now?: () => number;
}

/** ISO 周键（周一起始）。 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // 到本周四
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 按当前生效准则数算配额。 */
export function computeQuota(activeRules: number): BudgetQuota {
  const n = Number.isFinite(activeRules) && activeRules > 0 ? Math.floor(activeRules) : 0;
  const total = Math.min(12, Math.max(4, Math.max(8, Math.ceil(n * 0.01))));
  const revise = Math.max(1, Math.round(total * 0.625));
  const fresh = Math.max(1, Math.round(total * 0.25));
  const reserve = Math.max(0, total - revise - fresh);
  return { total, revise, new: fresh, reserve };
}

function emptyUsed(): BudgetUsed {
  return { total: 0, revise: 0, new: 0 };
}

export class BudgetStore {
  private readonly filePath: string;
  private readonly clock: () => number;
  private doc: BudgetDoc;
  private loaded = false;
  private saveError: string | undefined;

  constructor(options: BudgetStoreOptions = {}) {
    this.filePath = options.filePath === undefined ? resolveDataFile('cognition-budget.json') : resolve(options.filePath);
    this.clock = options.now ?? (() => Date.now());
    this.doc = {
      schema: 'cognition.budget',
      version: 1,
      week: isoWeekKey(new Date(this.clock())),
      activeRules: 0,
      quota: computeQuota(0),
      used: emptyUsed(),
      debt: 0,
      paused: false,
      pauseReason: null,
      pausedUntilWeek: null,
      updatedAt: this.clock(),
    };
  }

  loadSync(): boolean {
    if (this.loaded) return true;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return false;
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<BudgetDoc>;
      if (raw === null || typeof raw !== 'object' || raw.schema !== 'cognition.budget') return false;
      this.doc = {
        schema: 'cognition.budget',
        version: 1,
        week: typeof raw.week === 'string' ? raw.week : isoWeekKey(new Date(this.clock())),
        activeRules: Number(raw.activeRules ?? 0),
        quota: raw.quota ?? computeQuota(0),
        used: raw.used ?? emptyUsed(),
        debt: Number(raw.debt ?? 0),
        paused: raw.paused === true,
        pauseReason: typeof raw.pauseReason === 'string' ? raw.pauseReason : null,
        pausedUntilWeek: typeof raw.pausedUntilWeek === 'string' ? raw.pausedUntilWeek : null,
        updatedAt: Number(raw.updatedAt ?? this.clock()),
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

  /** 跨周重置：used 归零，未用名额不结转。暂停到期自动解除。 */
  rolloverIfNeeded(): { rolled: boolean; from?: string; to?: string } {
    this.loadSync();
    const week = isoWeekKey(new Date(this.clock()));
    if (this.doc.week === week) return { rolled: false };
    const from = this.doc.week;
    this.doc.week = week;
    this.doc.used = emptyUsed();
    this.doc.debt = 0;
    if (this.doc.pausedUntilWeek !== null && this.doc.pausedUntilWeek <= week) {
      this.doc.paused = false;
      this.doc.pauseReason = null;
      this.doc.pausedUntilWeek = null;
    }
    this.doc.updatedAt = this.clock();
    this.#save();
    return { rolled: true, from, to: week };
  }

  /** 同步当前生效准则数并重算配额（配额随规模变化）。 */
  syncActiveRules(activeRules: number): void {
    this.loadSync();
    this.rolloverIfNeeded();
    if (this.doc.activeRules !== activeRules) {
      this.doc.activeRules = activeRules;
      this.doc.quota = computeQuota(activeRules);
      this.doc.updatedAt = this.clock();
      this.#save();
    }
  }

  status(): BudgetDoc & { remaining: BudgetUsed; canLearnNew: boolean; canRevise: boolean } {
    this.loadSync();
    this.rolloverIfNeeded();
    const remaining: BudgetUsed = {
      total: Math.max(0, this.doc.quota.total - this.doc.used.total),
      revise: Math.max(0, this.doc.quota.revise - this.doc.used.revise),
      new: Math.max(0, this.doc.quota.new - this.doc.used.new),
    };
    return { ...this.doc, remaining, canLearnNew: !this.doc.paused && remaining.new > 0, canRevise: remaining.revise > 0 };
  }

  /** 能不能学（不消耗）。 */
  canLearn(kind: LearnKind): { ok: boolean; reason?: string } {
    const status = this.status();
    if (this.doc.paused) return { ok: false, reason: `学习已暂停：${this.doc.pauseReason ?? '触发停止信号'}` };
    if (kind === 'new' && status.remaining.new <= 0) {
      return { ok: false, reason: `本周「学新」名额已用完（${this.doc.used.new}/${this.doc.quota.new}）` };
    }
    if (kind === 'revise' && status.remaining.revise <= 0) {
      return { ok: false, reason: `本周「修旧」名额已用完（${this.doc.used.revise}/${this.doc.quota.revise}）` };
    }
    if (status.remaining.total <= 0) {
      return { ok: false, reason: `本周总名额已用完（${this.doc.used.total}/${this.doc.quota.total}）` };
    }
    return { ok: true };
  }

  /** 消耗一个名额。调用方应先用 canLearn 检查。 */
  consume(kind: LearnKind): { ok: boolean; used: BudgetUsed; reason?: string } {
    const check = this.canLearn(kind);
    if (!check.ok) return { ok: false, used: this.doc.used, reason: check.reason };
    this.doc.used.total += 1;
    this.doc.used[kind] += 1;
    this.doc.updatedAt = this.clock();
    this.#save();
    return { ok: true, used: { ...this.doc.used } };
  }

  /** 触发停止信号 → 暂停学新（到下周一自动解除）。 */
  pause(signal: StopSignal): void {
    this.loadSync();
    this.rolloverIfNeeded();
    this.doc.paused = true;
    this.doc.pauseReason = `[${signal.code}] ${signal.reason}`;
    this.doc.pausedUntilWeek = signal.action === 'pause-new' ? this.doc.week : null;
    this.doc.updatedAt = this.clock();
    this.#save();
  }

  resume(): void {
    this.loadSync();
    this.doc.paused = false;
    this.doc.pauseReason = null;
    this.doc.pausedUntilWeek = null;
    this.doc.updatedAt = this.clock();
    this.#save();
  }

  /**
   * 五条停止信号（docs/upgrade-plan-v3.md §7.2）。
   *
   * 全部用**可观测的计数**判，不做主观判断。没数据就当没触发——
   * 宁可漏报也不误停，因为误停会让学习整体停摆。
   */
  evaluateSignals(input: {
    /** 近 3 周新增准则的累计命中次数。 */
    newRulesHits3w?: number;
    /** 近 2 周出现的负反馈条数（未修正）。 */
    negativeUnfixed2w?: number;
    /** 生效准则总数。 */
    activeRules?: number;
    /** 证据链失效（orphaned）准则数。 */
    orphanedRules?: number;
    /** 近 30 天 supersede 次数最多的 subject 的计数。 */
    maxSupersede30d?: number;
    /** 上周「学新」名额使用率 0..1。 */
    lastWeekNewUsageRatio?: number;
  }): StopSignal[] {
    const out: StopSignal[] = [];
    const active = input.activeRules ?? this.doc.activeRules;
    if ((input.newRulesHits3w ?? 0) === 0 && (input.lastWeekNewUsageRatio ?? 0) > 0 && active > 0) {
      out.push({ code: 'futile', reason: '近 3 周新增准则零命中：学了没用上', action: 'pause-new' });
    }
    if ((input.negativeUnfixed2w ?? 0) >= 2) {
      out.push({ code: 'still-wrong', reason: '近 2 周有负反馈却未修正：先修再学', action: 'pause-new' });
    }
    const orphanedRatio = active > 0 ? (input.orphanedRules ?? 0) / active : 0;
    if (active > 400 || orphanedRatio > 0.2) {
      out.push({ code: 'overcrowded', reason: `准则过多或证据大面积失效（${active} 条，orphaned ${(orphanedRatio * 100).toFixed(0)}%）：只许修旧`, action: 'revise-only' });
    }
    if ((input.maxSupersede30d ?? 0) >= 3) {
      out.push({ code: 'flip-flop', reason: `同一主题 30 天内被取代 ≥3 次：该主题冻结学习`, action: 'freeze-subject' });
    }
    if ((input.lastWeekNewUsageRatio ?? 1) <= 0.25 && (input.lastWeekNewUsageRatio ?? 1) > 0) {
      out.push({ code: 'idle-quota', reason: '连续两周学新名额用不到 25%：配额应降到 4', action: 'shrink-quota' });
    }
    return out;
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
