/**
 * src/autorevise.ts — 自动修订的"安全内核"：先存档、再改、必标注、可回滚。
 *
 * 用户 2026-11-18 授权自动修订，但附了三条硬条件：
 *   ① 面板有开关；② 修改要标注；③ **修改前要有存档**。
 * 这个文件只管 ②③（①在 settings 里），而且刻意做成三件事分离：
 *
 *   1. 门槛（shouldAutoRevise）：纯函数，不碰数据。宁可少改，不可乱改。
 *   2. 存档（RevisionLog）：append-only JSONL，先写存档再改数据；改失败也要留痕。
 *   3. 标注（AUTO_MARK）：写进内容里，而不是只在渲染时加前缀——
 *      渲染前缀会丢（换个界面就没了），写进内容才跟数据一起走。
 *
 * 为什么"先存档再改"：自动修订是唯一一种会让插件自己改自己判断的机制，
 * 出错时用户需要的是"能回到改之前"，而不是"看日志猜之前是什么"。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 自动修订的元数据（落数据字段，**不往内容里写前缀**）。
 *
 * 依据 docs/l3-autorevise.md：ACE 的 bullet 元数据只有 id 和 helpful/harmful 计数，
 * 不满足"可审计"；能抄的是 SkillHone 的决策记录 h=(诊断, 修订, 证据, 结果)。
 * 前缀只该出现在显示层——写进 content 会污染检索与去重，也会混进注入。
 */
export interface RevisionMeta {
  origin: 'auto_revise' | 'manual';
  by: 'auto' | 'user';
  /** 触发来源：用户纠正 / 反证 / 资料 */
  trigger: 'user_correction' | 'counter_evidence' | 'source';
  /** 可核对证据（原话或出处 id） */
  evidence: string;
  reason: string;
}

/** 渲染层用：给自动修订过的条目加个可见标记（不进数据）。 */
export function revisionBadge(meta: { by?: 'auto' | 'user'; origin?: string } | undefined): string {
  if (meta === undefined) return '';
  if (meta.origin === 'auto_revise') return '[自动修订] ';
  return '';
}

export type RevisionTarget = 'fact' | 'rule';

export interface RevisionRecord {
  id: string;
  at: number;
  target: RevisionTarget;
  targetId: string;
  /** 修改前的完整快照（回滚用） */
  before: Record<string, unknown>;
  /** 修改后的完整快照 */
  after: Record<string, unknown>;
  /** 为什么改（一句话，人看得懂） */
  reason: string;
  /** 诊断：错在哪、以后怎么避免（准则修订要求 ≥4 字） */
  diagnosis: string;
  /** 触发来源：auto = 自动，user = 用户点的 */
  by: 'auto' | 'user';
  /** 已回滚过？ */
  undone?: boolean;
}

export interface ReviseGateInput {
  target: RevisionTarget;
  /** 支持新版本的证据条数（反证/用户纠正次数） */
  counterEvidence: number;
  /** 距上次修订过去了多少小时 */
  hoursSinceLastRevision: number;
  /** 用户是否明确说过"以前那条不对/改成这样" */
  userSaidSo: boolean;
  /** 今天已经自动改了几次 */
  todayCount?: number;
  /** 全局自动修订开关 */
  autoReviseEnabled: boolean;
}

export type ReviseDecision =
  | { allow: true; reason: string }
  | { allow: false; reason: string };

/** 每天自动修订上限（工程取值，见 docs/l3-autorevise.md 的强度标注）。 */
export const MAX_REVISIONS_PER_DAY = 5;
/** 冷却小时数（工程取值）。 */
export const COOLDOWN_HOURS = 24;

/**
 * 自动修订门槛（依据 docs/l3-autorevise.md）。
 *
 * 最重要的一条不是阈值，而是**触发只能来自外部信号**：
 * Huang et al. 2024 实测，没有外部反馈的自我修订轮数越多越差
 * （GPT-3.5 GSM8K 75.9→74.7，Llama-2 CommonSenseQA 62.0→36.5）。
 * 所以这里没有"自查"这条路：没有你的明确纠正，就只提建议、不自改。
 *
 *   1. 你明确纠正过（≥1 次）→ 可以改；
 *   2. 只是"资料说要这样"→ 不改内容，只提候选（本函数直接拒绝）；
 *   3. 24 小时冷却、每天最多 5 次。
 * 阈值强度：第 1 条有实验支持（Huang 2024 外部反馈），第 3 条是工程取值。
 */
export function shouldAutoRevise(input: ReviseGateInput): ReviseDecision {
  if (!input.autoReviseEnabled) return { allow: false, reason: '自动修订开关是关的' };
  if (!input.userSaidSo) {
    return { allow: false, reason: '没有你的明确纠正：自查和资料不该让我自己改自己（只提建议）' };
  }
  if (input.counterEvidence < 1) {
    return { allow: false, reason: '没有一条可核对的纠正内容' };
  }
  if (input.hoursSinceLastRevision < COOLDOWN_HOURS) {
    return { allow: false, reason: `冷却期内（上次修订 ${input.hoursSinceLastRevision.toFixed(1)} 小时前，至少要 ${COOLDOWN_HOURS} 小时）` };
  }
  if ((input.todayCount ?? 0) >= MAX_REVISIONS_PER_DAY) {
    return { allow: false, reason: `今天已经自动改了 ${input.todayCount} 次，到上限 ${MAX_REVISIONS_PER_DAY} 了` };
  }
  return { allow: true, reason: '你明确纠正过 + 过冷却期 + 未到当天上限' };
}

/** 兼容旧调用：不再往内容里写前缀，原样返回（标注改在数据字段与渲染层）。 */
export function markAuto(content: string): string {
  return content.trim();
}

/** 兼容旧调用：内容里没有前缀了，去掉历史前缀即可。 */
export function unmarkAuto(content: string): string {
  return content.replace(/^\[自动修订\]\s*/, '').trim();
}

/** append-only 修订存档。 */
export class RevisionLog {
  readonly filePath: string;
  private readonly clock: () => number;
  private cache: RevisionRecord[] | undefined;

  constructor(options: { filePath: string; now?: () => number }) {
    this.filePath = options.filePath;
    this.clock = options.now ?? (() => Date.now());
  }

  private load(): RevisionRecord[] {
    if (this.cache !== undefined) return this.cache;
    this.cache = [];
    if (!existsSync(this.filePath)) return this.cache;
    for (const line of readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        this.cache.push(JSON.parse(trimmed) as RevisionRecord);
      } catch {
        continue; // 坏行只跳过这一行，别把后面全丢了
      }
    }
    return this.cache;
  }

  /**
   * 先存档。返回存档记录；调用方拿到它之后才去改数据。
   *
   * 注意顺序：**存档写盘成功才返回**，写不进去就抛错让调用方放弃修订——
   * 宁可这次不改，也不能出现"改了但没存档"。
   */
  backup(input: {
    target: RevisionTarget;
    targetId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    reason: string;
    diagnosis: string;
    by: 'auto' | 'user';
  }): RevisionRecord {
    const records = this.load();
    const record: RevisionRecord = {
      id: `rev-${records.length + 1}`,
      at: this.clock(),
      target: input.target,
      targetId: input.targetId,
      before: input.before,
      after: input.after,
      reason: input.reason,
      diagnosis: input.diagnosis,
      by: input.by,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
    records.push(record);
    return record;
  }

  list(limit = 30): RevisionRecord[] {
    return [...this.load()].reverse().slice(0, Math.max(1, limit));
  }

  /** 某个目标上次被改是什么时候（算冷却期用）。 */
  lastAt(targetId: string): number | undefined {
    let latest: number | undefined;
    for (const record of this.load()) {
      if (record.targetId !== targetId) continue;
      if (latest === undefined || record.at > latest) latest = record.at;
    }
    return latest;
  }

  markUndone(id: string): void {
    // JSONL 只追加：回滚标记写成新记录（type 里带 undone），不改老行
    const records = this.load();
    const target = records.find((record) => record.id === id);
    if (target === undefined) throw new Error('没有这条修订记录：' + id);
    const marker: RevisionRecord = { ...target, id: `${id}-undo`, at: this.clock(), undone: true, by: 'user' };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(marker)}\n`, 'utf8');
    records.push(marker);
  }
}
