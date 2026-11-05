/**
 * src/injection_log.ts — 注入快照 + 反馈识别
 *
 * 解决的问题：整个「学习」链条是断的——
 *
 *   模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己
 *
 * appliedGood / appliedBad 字段早就有了，但没有自动来源。
 * 这里补上两个东西：
 *   1. 每轮注入了哪些准则（快照）
 *   2. 用户下一轮的反应（纠正 / 确认）→ 回写给上一轮的准则
 *
 * 关键设计：**单次纠正不降级**。
 * ReasoningBank 的结论：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感。
 * 所以累计 appliedBad ≥ 3 且 > appliedGood 才进入 disputed（由 playbook.markUsage 处理）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDataFile } from './util.ts';

/** 一条注入快照（一轮一行）。 */
export interface InjectionSnapshot {
  at: number;
  sessionId: string;
  turn: number;
  /** 本轮注入的准则 id。 */
  ruleIds: string[];
  /** 注入总字符数。 */
  chars: number;
  /** 反馈回写状态：pending 还没判定，scored 已回写，neutral 判定为中性的。 */
  verdict?: 'pending' | 'scored' | 'neutral';
  /** 回写时的反馈类型。 */
  feedback?: FeedbackKind;
}

/** 用户反应的判定结果。 */
export type FeedbackKind = 'correction' | 'confirmation' | 'neutral';

/**
 * 纠正信号。
 *
 * 只用正则，**不调 LLM**：每轮都调成本太高；正则能覆盖绝大多数明确表达，
 * 剩下的靠其他信号（比如用户直接改代码）补。
 *
 * 注意：要匹配「开头」或「独立短句」，避免「不是这样，但也差不多」这种误判。
 */
const CORRECTION_PATTERNS: RegExp[] = [
  /^(不对|错了|不是这样|不是这个|你搞错|搞错了|弄错了|算错了)[，。,.!！\s]/,
  /^(重新|重来|再做一次|再试试)/,
  /^(不是这个意思|理解错了|误会了)/,
  /(你)?(刚才|上次)(说的|做的)(不对|错了)/,
];

/** 确认信号。 */
const CONFIRMATION_PATTERNS: RegExp[] = [
  // 「没错」「对」「是的」这类本身就是完整回答，结尾有无标点都算
  /^(没错|是的|对的|正确|就是这样|正解|完美)$/,
  /^(对|是的|没错|就是这样|正确|可以|好的|行|嗯)[，。,.!！\s]/,
  /^(就是这样|正解|完美|厉害了|棒)/,
  /^(继续|接着来|下一步)/,
];

/**
 * 判定用户这句话是「纠正」「确认」还是「中性」。
 *
 * 只取消息**开头**前 30 字判断——用户的反应通常在句首。
 */
export function classifyFeedback(message: string): FeedbackKind {
  const head = message.trim().slice(0, 30);
  if (head.length === 0) return 'neutral';
  for (const re of CORRECTION_PATTERNS) if (re.test(head)) return 'correction';
  for (const re of CONFIRMATION_PATTERNS) if (re.test(head)) return 'confirmation';
  return 'neutral';
}

export interface InjectionLogOptions {
  filePath?: string;
  now?: () => number;
  /** 内存保留最近多少条（默认 200，足够回溯）。 */
  keepRecent?: number;
}

/**
 * 注入快照日志。
 *
 * 一轮一行 JSONL；读取时只保留最近 N 条在内存。
 * 回写反馈时用 `markVerdict()` 追加一条带 verdict 的记录（不改原行），
 * 读取时以后出现的为准——同样是「append-only」的思路。
 */
export class InjectionLog {
  private readonly filePath: string;
  private readonly clock: () => number;
  private readonly keepRecent: number;
  private snapshots: InjectionSnapshot[] = [];
  private loaded = false;

  constructor(options: InjectionLogOptions = {}) {
    this.filePath = options.filePath === undefined ? resolveDataFile('cognition-injection.jsonl') : resolve(options.filePath);
    this.clock = options.now ?? (() => Date.now());
    this.keepRecent = options.keepRecent ?? 200;
  }

  loadSync(): boolean {
    if (this.loaded) return true;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return false;
      const text = readFileSync(this.filePath, 'utf8');
      const rows: InjectionSnapshot[] = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          rows.push(JSON.parse(trimmed) as InjectionSnapshot);
        } catch {
          /* 单行坏了跳过 */
        }
      }
      // 同 (sessionId, turn) 以最后一条为准（verdict 回写是追加的）
      const map = new Map<string, InjectionSnapshot>();
      for (const r of rows) map.set(`${r.sessionId}#${r.turn}`, r);
      this.snapshots = [...map.values()].sort((a, b) => a.at - b.at).slice(-this.keepRecent);
      return true;
    } catch {
      return false;
    }
  }

  /** 记录一轮注入。 */
  record(sessionId: string, turn: number, ruleIds: string[], chars: number): void {
    this.loadSync();
    const snap: InjectionSnapshot = {
      at: this.clock(),
      sessionId,
      turn,
      ruleIds: [...ruleIds],
      chars,
      verdict: 'pending',
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > this.keepRecent) this.snapshots.shift();
    this.#append(snap);
  }

  /**
   * 给某一轮打反馈判定。返回该轮注入的准则 id（供调用方批量 markUsage）。
   *
   * 找不到该轮返回空数组。
   */
  markVerdict(sessionId: string, turn: number, feedback: FeedbackKind): string[] {
    this.loadSync();
    const snap = this.snapshots.find((s) => s.sessionId === sessionId && s.turn === turn);
    if (snap === undefined) return [];
    if (snap.verdict === 'scored') return []; // 已回写过，幂等
    snap.verdict = feedback === 'neutral' ? 'neutral' : 'scored';
    snap.feedback = feedback;
    this.#append(snap);
    return feedback === 'neutral' ? [] : [...snap.ruleIds];
  }

  /** 最近 N 条快照（新的在前）。 */
  recent(limit = 10): InjectionSnapshot[] {
    this.loadSync();
    return this.snapshots.slice(-limit).reverse();
  }

  /** 找最近一轮（用于「用户这句话是针对上一轮」）。 */
  latest(sessionId?: string): InjectionSnapshot | undefined {
    this.loadSync();
    const pool = sessionId === undefined ? this.snapshots : this.snapshots.filter((s) => s.sessionId === sessionId);
    return pool[pool.length - 1];
  }

  statistics(): { total: number; pending: number; corrected: number; confirmed: number } {
    this.loadSync();
    let pending = 0;
    let corrected = 0;
    let confirmed = 0;
    for (const s of this.snapshots) {
      if (s.verdict === 'pending' || s.verdict === undefined) pending += 1;
      else if (s.feedback === 'correction') corrected += 1;
      else if (s.feedback === 'confirmation') confirmed += 1;
    }
    return { total: this.snapshots.length, pending, corrected, confirmed };
  }

  get path(): string {
    return this.filePath;
  }

  #append(snap: InjectionSnapshot): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify(snap) + '\n', 'utf8');
    } catch {
      /* 落盘失败不影响内存 */
    }
  }
}
