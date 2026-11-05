/**
 * src/injection_log.ts — 注入快照 + 反馈识别 + 轮次跟踪
 *
 * 解决的问题：整个「学习」链条是断的——
 *
 *   模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己
 *
 * appliedGood / appliedBad 字段早就有了，但没有自动来源。
 * 这里补上三个东西：
 *   1. 每轮注入了哪些准则（快照）
 *   2. 用户下一轮的反应（纠正 / 确认）→ 回写给上一轮的准则
 *   3. 用宿主真实轮次推进状态机（见 TurnFeedbackTracker）
 *
 * ## v2：为什么必须改成按「真实轮次」记
 *
 * v1 把 `record()` 放在 `buildInjectedContext()` 里，而这个函数有三个调用点：
 * 系统提示段（每次拼提示都调）、页面 `/state` 快照（面板每 2 秒轮询一次）、
 * `/injected` 路由。结果 2026-11-05 实测：88 分钟写了 2432 行，
 * 其中绝大多数是面板轮询，真正的用户轮次只有几十个。
 *
 * 这不是「日志多了一点」，而是**整个度量被污染**：轮次号变成轮询计数器，
 * 「注入→反馈」的归因链断了。
 *
 * v2 的做法：
 *   - 渲染函数**纯化**（不再有副作用），面板轮询多少次都不写一行；
 *   - 只在宿主的 `session/event` 上推进：turn/start 记本轮注入，
 *     turn/end 用这一轮的用户消息给上一轮打分——一轮 1 行（有反馈时 2 行）。
 *   - 旧行（没有 `v: 2`）读的时候直接跳过，不动文件、不删数据。
 *
 * 关键设计：**单次纠正不降级**。
 * ReasoningBank 的结论：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感。
 * 所以累计 appliedBad ≥ 3 且 > appliedGood 才进入 disputed（由 playbook.markUsage 处理）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDataFile } from './util.ts';

/** 当前记录格式版本。旧行没有这个字段，读取时跳过。 */
export const INJECTION_LOG_VERSION = 2;

/** 一条注入快照（一轮一行）。 */
export interface InjectionSnapshot {
  /** 记录格式版本；v1 没有这个字段。 */
  v?: number;
  at: number;
  sessionId: string;
  /** 宿主给的轮次号（session/event 的 turn/start.data.turn）。 */
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
 * 也要匹配「整句只有这个词」的情况——用户最常见的反馈就是「不对」两个字，没有标点。
 */
const CORRECTION_PATTERNS: RegExp[] = [
  /^(不对|错了|不是这样|不是这个意思|你搞错|搞错了|弄错了|算错了|理解错了|误会了)[，。,.!！\s]/,
  /^(不对|错了|不是这样|不是这个意思|你搞错了?|弄错了|算错了|理解错了|误会了)$/,
  /^(重新|重来|再做一次|再试试)/,
  /(你)?(刚才|上次)(说的|做的)(不对|错了)/,
];

/**
 * 确认信号。
 *
 * 刻意**只收明确肯定**。v1 把「可以 / 好的 / 行 / 嗯」也算确认，
 * 但这些词多半是「同意下一步动作」而不是「你这条准则用对了」，
 * 误判会直接抬高 appliedGood，把整条证据链洗白。
 */
const CONFIRMATION_PATTERNS: RegExp[] = [
  /^(没错|是的|对的|正确|就是这样|正解|完美|完全正确)$/,
  /^(对|是的|没错|就是这样|正确)[，。,.!！\s]/,
  // 「继续」只在整句时算——「继续做 X」是在下指令，不是确认
  /^(继续|接着来|下一步)$/,
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

/**
 * 从一条 user 消息里取出纯文本。
 *
 * 宿主的 `UserMessage.content` 是内容块数组（text / image / file / tool-*），
 * 一条用户消息还可能被拆成多个事件（见 session 日志）。这里只拼 text 块，
 * 图片和附件对「用户在说什么」没有贡献。
 *
 * 写成容错形式：宿主换了表示法也不要抛异常——事件监听器里抛错会污染会话。
 */
export function extractUserText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message === null || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (block === null || typeof block !== 'object') continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text);
  }
  return parts.join('\n');
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
  /** 读文件时被跳过（v1 格式）的行数，供面板显示「旧日志已忽略」。 */
  private legacyRows = 0;

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
      let legacy = 0;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const row = JSON.parse(trimmed) as InjectionSnapshot;
          // v1 行是「面板轮询」和「真实轮次」混在一起的，无法区分，直接跳过。
          // 不删文件里的旧行，只是不认它们。
          if (row.v !== INJECTION_LOG_VERSION) {
            legacy += 1;
            continue;
          }
          rows.push(row);
        } catch {
          /* 单行坏了跳过 */
        }
      }
      this.legacyRows = legacy;
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
      v: INJECTION_LOG_VERSION,
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
    if (snap.verdict === 'scored' || snap.verdict === 'neutral') return []; // 已判定过，幂等
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

  /** 找最近一轮（用于手动 `/feedback` 与排查）。 */
  latest(sessionId?: string): InjectionSnapshot | undefined {
    this.loadSync();
    const pool = sessionId === undefined ? this.snapshots : this.snapshots.filter((s) => s.sessionId === sessionId);
    return pool[pool.length - 1];
  }

  statistics(): {
    total: number;
    pending: number;
    corrected: number;
    confirmed: number;
    /** v1 旧行数（已被跳过）；大于 0 说明这个文件里有历史噪声。 */
    legacyRows: number;
  } {
    this.loadSync();
    let pending = 0;
    let corrected = 0;
    let confirmed = 0;
    for (const s of this.snapshots) {
      if (s.verdict === 'pending' || s.verdict === undefined) pending += 1;
      else if (s.feedback === 'correction') corrected += 1;
      else if (s.feedback === 'confirmation') confirmed += 1;
    }
    return { total: this.snapshots.length, pending, corrected, confirmed, legacyRows: this.legacyRows };
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

/* ------------------------------------------------------------------ */
/* 轮次跟踪：把「宿主轮次」翻译成「上一轮注入了什么 + 用户怎么反应」      */
/* ------------------------------------------------------------------ */

/** 当前应该注入的准则（由调用方从准则本现算）。 */
export interface InjectionBudget {
  ruleIds: string[];
  chars: number;
}

/** 判定出反馈后的回调（调用方负责 markUsage / 写事件日志）。 */
export interface TurnFeedbackHooks {
  /** 开新轮时调一次，取这一轮将要注入的准则。 */
  injection(): InjectionBudget;
  /** 判出非中性反馈时调一次；ruleIds 是**被测那一轮**注入的准则。 */
  onFeedback(feedback: FeedbackKind, ruleIds: string[], reaction: string): void;
}

interface TurnSlot {
  turn: number;
  ruleIds: string[];
  chars: number;
  /** 这一轮的用户文本（可能由多个事件拼成）。 */
  text: string;
  /** 是否已落盘为 pending 行（避免重复写）。 */
  recorded: boolean;
}

/**
 * 用宿主真实轮次推进「注入 → 反馈」状态机。
 *
 * 时序（实测自 session 日志）：
 *
 *   agent/inbox/spliced → turn/start[T] → step/start → system/message
 *     → user/message × N（一条用户消息可能拆成多个事件）
 *     → 若干 step → turn/end[T]
 *
 * 所以：
 *   - `turn/start[T]` 时，T-1 的注入内容还在手上 → 挪进 pending；
 *   - `user/message` 累加到当前轮的 text；
 *   - `turn/end[T]` 时，用**当前轮**的 text 给 **pending（T-1）** 打分。
 *     「用户对上一轮的纠正」正是这个时序：这句话出现在第 T 轮，针对第 T-1 轮。
 *
 * 没反馈信号（neutral）也落一行，这样分母是真实的，不会被「只记成功」拉偏。
 */
export class TurnFeedbackTracker {
  private readonly log: InjectionLog;
  private readonly hooks: TurnFeedbackHooks;
  /** 当前轮（还没结束）。 */
  private readonly current = new Map<string, TurnSlot>();
  /** 上一轮（等这一轮的用户文本打分）。 */
  private readonly pending = new Map<string, TurnSlot>();

  constructor(log: InjectionLog, hooks: TurnFeedbackHooks) {
    this.log = log;
    this.hooks = hooks;
  }

  /** 宿主开了一轮。 */
  beginTurn(sessionId: string, turn: number): void {
    const prev = this.current.get(sessionId);
    if (prev === undefined) this.pending.delete(sessionId);
    else this.pending.set(sessionId, prev);
    const budget = this.hooks.injection();
    this.current.set(sessionId, {
      turn,
      ruleIds: [...budget.ruleIds],
      chars: budget.chars,
      text: '',
      recorded: false,
    });
  }

  /** 这一轮里用户说了一句话（可能被拆成多个事件）。 */
  appendUserText(sessionId: string, text: string): void {
    if (text.length === 0) return;
    const cur = this.current.get(sessionId);
    if (cur === undefined) return;
    cur.text += text;
  }

  /** 宿主结束一轮：给上一轮打分，并把这一轮落盘等下一轮打。 */
  endTurn(sessionId: string): void {
    const cur = this.current.get(sessionId);
    const prev = this.pending.get(sessionId);
    const reaction = cur === undefined ? '' : cur.text;

    if (prev !== undefined) {
      if (!prev.recorded) {
        this.log.record(sessionId, prev.turn, prev.ruleIds, prev.chars);
        prev.recorded = true;
      }
      const kind = classifyFeedback(reaction);
      const scored = this.log.markVerdict(sessionId, prev.turn, kind);
      if (scored.length > 0) this.hooks.onFeedback(kind, scored, reaction.slice(0, 60));
    }

    // 本轮注入也落一行：万一下一轮永远不来（关窗/断电），数据不至于丢。
    if (cur !== undefined && !cur.recorded && cur.ruleIds.length > 0) {
      this.log.record(sessionId, cur.turn, cur.ruleIds, cur.chars);
      cur.recorded = true;
    }
  }

  /** 会话销毁时清掉内存槽，避免长跑进程里越积越多。 */
  forget(sessionId: string): void {
    this.current.delete(sessionId);
    this.pending.delete(sessionId);
  }

  /** 排查用：这个会话现在等着被打分的那一轮。 */
  pendingOf(sessionId: string): { turn: number; ruleIds: string[] } | undefined {
    const prev = this.pending.get(sessionId);
    return prev === undefined ? undefined : { turn: prev.turn, ruleIds: [...prev.ruleIds] };
  }

  /** 排查用：这个会话正在进行的那一轮。 */
  currentOf(sessionId: string): { turn: number; ruleIds: string[]; chars: number } | undefined {
    const cur = this.current.get(sessionId);
    return cur === undefined ? undefined : { turn: cur.turn, ruleIds: [...cur.ruleIds], chars: cur.chars };
  }
}
