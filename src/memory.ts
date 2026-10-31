/**
 * src/memory.ts — TemporalMemoryStore
 *
 * 双时态记忆存储，工程机制对齐 LongMemory（CaviraOSS/LongMemory）的
 * `src/core/temporal/bitemporal.ts` 与 `docs/temporal.md`：
 *
 *   - 两条独立时间轴：
 *       valid time    → validFrom / validTo     （事实在「世界」里何时为真）
 *       recorded time → recordedAt / supersededAt（系统在「事务时间」何时知道）
 *   - `validTo === null`     表示「仍然有效」
 *   - `supersededAt === null` 表示「仍是当前版本」
 *   - 闭合区间（写 validTo / supersededAt）不改变内容的 durable identity：
 *     hash 只由 subject + content + validFrom 计算，被取代的事实保留原 id 与 hash，
 *     只是从「当前视图」里退场。
 *   - 严格召回只取 current truth；历史召回保留被取代的真值（point-in-time truth）。
 *
 * 存储：纯 TypeScript + Map，无任何外部数据库。
 */

/** 召回口径。 */
export type RecallMode = 'strict' | 'historical' | 'belief';

/** 一条不可变记忆事实。内容字段创建后不再改写（闭合区间时整体替换为新对象）。 */
export interface TemporalFact {
  readonly id: string;
  /** 冲突检测的归一化主题键。 */
  readonly subject: string;
  readonly content: string;
  /** 内容指纹：subject + content + validFrom。不含 validTo / supersededAt。 */
  readonly hash: string;
  readonly validFrom: number;
  readonly validTo: number | null;
  readonly recordedAt: number;
  readonly supersededAt: number | null;
  readonly supersededBy: string | null;
  readonly tags: readonly string[];
  readonly source: string;
  readonly importance: number;
  /** 强化量（每次 recall 命中或被显式 reinforce 时增加），不参与 hash。 */
  readonly activation: number;
  readonly lastAccessedAt: number;
}

/** ingest 入参。 */
export interface IngestInput {
  content: string;
  subject?: string;
  tags?: readonly string[];
  source?: string;
  importance?: number;
  validFrom?: number;
  validTo?: number | null;
  recordedAt?: number;
  /** 显式声明本条取代哪条旧事实（LongMemory 的 supersedeNode）。 */
  supersedes?: string;
}

export interface RecallOptions {
  mode?: RecallMode;
  /** historical 模式下「那时」的世界时间。 */
  validTime?: number;
  /** belief 模式下「那时」的事务时间。 */
  recordedTime?: number;
  limit?: number;
  minScore?: number;
  subject?: string;
  tags?: readonly string[];
}

export interface RecallHit {
  fact: TemporalFact;
  score: number;
  similarity: number;
  decay: number;
}

export interface Conflict {
  subject: string;
  leftId: string;
  rightId: string;
  overlapFrom: number;
  overlapTo: number | null;
}

/**
 * Inline & Spill 渲染参数。
 * 机制来源：dsh-superagent-prototype 的上下文装载——正文在额度内直接 inline，
 * 超限只给 `chars` 与 read pointer（docs/007-architecture.md 第 594 行）。
 */
export interface RenderOptions extends RecallOptions {
  /** 单条 inline 正文上限，超出只保留前缀并标记 truncated。 */
  inlineChars?: number;
  /** 多久以内算「近期」，超出则只给 ID 引用。 */
  inlineMaxAgeMs?: number;
}

export interface InlineMemory {
  id: string;
  content: string;
  chars: number;
  truncated: boolean;
  validFrom: number;
}

export interface SpilledMemory {
  id: string;
  chars: number;
  pointer: string;
  validFrom: number;
}

export interface RenderedMemory {
  inline: InlineMemory[];
  spilled: SpilledMemory[];
  /** 可直接塞进 prompt 的文本。 */
  text: string;
  stats: { inline: number; spilled: number; savedChars: number };
}

export interface MemoryStats {
  total: number;
  current: number;
  superseded: number;
  subjects: number;
  conflicts: number;
}

export interface MemoryOptions {
  now?: () => number;
  /** 衰减半衰期，默认 7 天。 */
  halfLifeMs?: number;
  idPrefix?: string;
}

const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 时间可见性：逐条对齐 LongMemory bitemporal.ts                        */
/* ------------------------------------------------------------------ */

/** 事实在世界时间 t 是否为真（含被取代的历史真值）。 */
export function isValidAt(fact: TemporalFact, validTime: number): boolean {
  return fact.validFrom <= validTime && (fact.validTo === null || validTime < fact.validTo);
}

/** 系统在事务时间 t 是否已经知道这条事实（含后来被取代的版本）。 */
export function isRecordedAt(fact: TemporalFact, recordedTime: number): boolean {
  return (
    fact.recordedAt <= recordedTime &&
    (fact.supersededAt === null || recordedTime < fact.supersededAt)
  );
}

/** 是否「此刻的当前真值」：未被取代 + 已知 + 当前有效。 */
export function isCurrent(fact: TemporalFact, now: number): boolean {
  return fact.supersededAt === null && fact.recordedAt <= now && isValidAt(fact, now);
}

/* ------------------------------------------------------------------ */
/* 轻量文本相似度（无第三方库、无向量服务）                             */
/* ------------------------------------------------------------------ */

const CJK = /[\u4e00-\u9fff]+/g;
const LATIN = /[a-z0-9_]+/g;

/** 英文按词、中文按二元组切分，返回词频表。 */
export function tokenize(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lower = text.toLowerCase();
  for (const word of lower.match(LATIN) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  for (const run of lower.match(CJK) ?? []) {
    if (run.length === 1) {
      counts.set(run, (counts.get(run) ?? 0) + 1);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
}

/** 余弦相似度。 */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [term, va] of a) {
    na += va * va;
    const vb = b.get(term);
    if (vb !== undefined) dot += va * vb;
  }
  for (const vb of b.values()) nb += vb * vb;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** FNV-1a 32 位内容指纹（纯 TS，不依赖 node:crypto）。 */
export function contentHash(...parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const payload = parts.join('\u0000');
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 从正文推导主题键：优先取冒号前的短语，否则取前 16 个字符。 */
export function deriveSubject(content: string): string {
  const trimmed = content.trim();
  const sep = trimmed.search(/[:：]/);
  const head = sep > 0 ? trimmed.slice(0, sep) : trimmed.slice(0, 16);
  return head.replace(/\s+/g, ' ').trim().toLowerCase();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/* ------------------------------------------------------------------ */
/* TemporalMemoryStore                                                 */
/* ------------------------------------------------------------------ */

export class TemporalMemoryStore {
  private readonly facts = new Map<string, TemporalFact>();
  private readonly bySubject = new Map<string, Set<string>>();
  private readonly tokens = new Map<string, Map<string, number>>();
  private readonly clock: () => number;
  private readonly halfLifeMs: number;
  private readonly idPrefix: string;
  private seq = 0;

  constructor(options: MemoryOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    this.idPrefix = options.idPrefix ?? 'mem';
  }

  /** 当前时钟。 */
  now(): number {
    return this.clock();
  }

  get size(): number {
    return this.facts.size;
  }

  /**
   * 写入一条记忆。内容与时间戳立即冻结；重复内容（同 hash）直接返回既有事实，
   * 不做覆盖写，这就是「不可变内容」的落地方式。
   */
  ingest(input: IngestInput): TemporalFact {
    const content = input.content.trim();
    if (content.length === 0) throw new Error('ingest: content 不能为空');

    const subject = (input.subject ?? deriveSubject(content)).trim();
    let validFrom = input.validFrom ?? this.clock();

    // 同一毫秒内写入的「取代」会把旧区间压成空集 [T, T)，历史真值就丢了。
    // 这里保证新事实严格晚于被取代的旧事实开始生效。
    if (input.supersedes !== undefined) {
      const previous = this.facts.get(input.supersedes);
      if (previous !== undefined && validFrom <= previous.validFrom) {
        validFrom = previous.validFrom + 1;
      }
    }

    const hash = contentHash(subject, content, String(validFrom));

    const existing = this.findByHash(hash);
    if (existing !== undefined) return existing;

    const fact: TemporalFact = Object.freeze({
      id: `${this.idPrefix}-${++this.seq}-${hash.slice(0, 6)}`,
      subject,
      content,
      hash,
      validFrom,
      validTo: input.validTo ?? null,
      recordedAt: input.recordedAt ?? this.clock(),
      supersededAt: null,
      supersededBy: null,
      tags: Object.freeze([...(input.tags ?? [])]),
      source: input.source ?? 'manual',
      importance: clamp01(input.importance ?? 0.5),
      activation: 0,
      lastAccessedAt: this.clock(),
    });

    this.facts.set(fact.id, fact);
    this.tokens.set(fact.id, tokenize(`${fact.subject} ${fact.content}`));
    const bucket = this.bySubject.get(fact.subject) ?? new Set<string>();
    bucket.add(fact.id);
    this.bySubject.set(fact.subject, bucket);

    if (input.supersedes !== undefined) this.supersede(input.supersedes, fact.id, validFrom);
    return this.facts.get(fact.id) ?? fact;
  }

  get(id: string): TemporalFact | undefined {
    return this.facts.get(id);
  }

  all(): readonly TemporalFact[] {
    return [...this.facts.values()];
  }

  /** 删除一条事实（连同索引与分词缓存）。用于纠正错误数据、清理测试数据。 */
  remove(id: string): boolean {
    const fact = this.facts.get(id);
    if (fact === undefined) return false;
    this.facts.delete(id);
    this.tokens.delete(id);
    const bucket = this.bySubject.get(fact.subject);
    if (bucket !== undefined) {
      bucket.delete(id);
      if (bucket.size === 0) this.bySubject.delete(fact.subject);
    }
    return true;
  }

  /** 按来源批量删除，返回删除条数。 */
  removeBySource(source: string): number {
    const targets = [...this.facts.values()].filter((fact) => fact.source === source);
    for (const fact of targets) this.remove(fact.id);
    return targets.length;
  }

  /** 按主题批量删除，返回删除条数。 */
  removeBySubject(subject: string): number {
    const ids = [...(this.bySubject.get(subject) ?? [])];
    for (const id of ids) this.remove(id);
    return ids.length;
  }

  /**
   * 用新事实取代旧事实：给旧事实闭合 validTo 与 supersededAt，并记下 supersededBy。
   * id / hash 不变——被取代的版本仍然可以被「历史召回」找回。
   */
  supersede(
    oldId: string,
    newId: string,
    at: number = this.clock(),
  ): { superseded: TemporalFact; current: TemporalFact } {
    const old = this.facts.get(oldId);
    const current = this.facts.get(newId);
    if (old === undefined) throw new Error(`supersede: 未知的旧事实 ${oldId}`);
    if (current === undefined) throw new Error(`supersede: 未知的新事实 ${newId}`);
    if (oldId === newId) throw new Error('supersede: 不能用自己取代自己');

    const closeAt = old.validTo !== null && old.validTo < at ? old.validTo : at;
    const superseded: TemporalFact = Object.freeze({
      ...old,
      validTo: closeAt,
      supersededAt: at,
      supersededBy: newId,
    });
    this.facts.set(oldId, superseded);
    return { superseded, current };
  }

  /** 记忆衰减：距上次访问越久，权重越低（指数半衰期）。 */
  decay(factOrId: TemporalFact | string, now: number = this.clock()): number {
    const fact = typeof factOrId === 'string' ? this.facts.get(factOrId) : factOrId;
    if (fact === undefined) return 0;
    const elapsed = Math.max(0, now - fact.lastAccessedAt);
    return Math.pow(0.5, elapsed / this.halfLifeMs);
  }

  /** 显式强化：提升激活量并重置衰减计时。 */
  reinforce(id: string, amount = 0.3, now: number = this.clock()): TemporalFact {
    const fact = this.facts.get(id);
    if (fact === undefined) throw new Error(`reinforce: 未知事实 ${id}`);
    const next: TemporalFact = Object.freeze({
      ...fact,
      activation: fact.activation + Math.max(0, amount),
      lastAccessedAt: now,
    });
    this.facts.set(id, next);
    return next;
  }

  /**
   * 按时间口径召回。
   *   strict     → 当前真值（被取代的、尚未生效的都不返回）
   *   historical → 在 validTime 那个时刻为真的事实（含被取代的历史版本）
   *   belief     → 在 recordedTime 那个事务时刻系统已经知道的版本
   */
  recall(query: string, options: RecallOptions = {}): RecallHit[] {
    const mode = options.mode ?? 'strict';
    const now = this.clock();
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;
    const queryTokens = tokenize(query);

    const hits: RecallHit[] = [];
    for (const fact of this.facts.values()) {
      if (!this.visible(fact, mode, options, now)) continue;
      if (options.subject !== undefined && fact.subject !== options.subject) continue;
      if (options.tags !== undefined && options.tags.length > 0) {
        const own = new Set(fact.tags);
        if (!options.tags.every((tag) => own.has(tag))) continue;
      }

      const factTokens = this.tokens.get(fact.id) ?? tokenize(fact.content);
      const similarity = cosine(queryTokens, factTokens);
      const decay = this.decay(fact, now);
      const score =
        0.6 * similarity +
        0.25 * decay +
        0.15 * fact.importance +
        0.1 * Math.min(1, fact.activation);
      if (score < minScore) continue;
      hits.push({ fact, score, similarity, decay });
    }

    hits.sort((a, b) => b.score - a.score || b.fact.validFrom - a.fact.validFrom);
    const top = hits.slice(0, limit);
    for (const hit of top) {
      const bumped: TemporalFact = Object.freeze({
        ...hit.fact,
        activation: hit.fact.activation + 0.1,
        lastAccessedAt: now,
      });
      this.facts.set(hit.fact.id, bumped);
      hit.fact = bumped;
    }
    return top;
  }

  /**
   * Inline & Spill：按需装载。
   * 近期记忆直接给正文（可截断并标记 chars / truncated），
   * 久远记忆只给 ID 引用（pointer），由调用方决定要不要再取一次。
   */
  render(query: string, options: RenderOptions = {}): RenderedMemory {
    const inlineChars = options.inlineChars ?? 240;
    const inlineMaxAgeMs = options.inlineMaxAgeMs ?? 24 * 60 * 60 * 1000;
    const now = this.clock();
    const hits = this.recall(query, options);

    const inline: InlineMemory[] = [];
    const spilled: SpilledMemory[] = [];
    let savedChars = 0;

    for (const hit of hits) {
      const { fact } = hit;
      const age = Math.max(0, now - fact.recordedAt);
      const chars = fact.content.length;

      if (age <= inlineMaxAgeMs) {
        const truncated = chars > inlineChars;
        inline.push({
          id: fact.id,
          content: truncated ? `${fact.content.slice(0, inlineChars)}…` : fact.content,
          chars,
          truncated,
          validFrom: fact.validFrom,
        });
        continue;
      }

      spilled.push({ id: fact.id, chars, pointer: `memory://${fact.id}`, validFrom: fact.validFrom });
      savedChars += chars;
    }

    const lines: string[] = [];
    if (inline.length > 0) {
      lines.push('近期记忆（inline）：');
      for (const item of inline) {
        lines.push(`- [${item.id}] ${item.content}${item.truncated ? `（全文 ${item.chars} 字，已截断）` : ''}`);
      }
    }
    if (spilled.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('久远记忆（仅 ID 引用，需要时再按 id 取回）：');
      for (const item of spilled) {
        lines.push(`- ${item.id} (chars=${item.chars}, pointer=${item.pointer})`);
      }
    }

    return {
      inline,
      spilled,
      text: lines.join('\n'),
      stats: { inline: inline.length, spilled: spilled.length, savedChars },
    };
  }

  /** 同一 subject 的完整时间线（按 validFrom 升序）。 */
  history(subject: string): TemporalFact[] {
    const ids = this.bySubject.get(subject) ?? new Set<string>();
    return [...ids]
      .map((id) => this.facts.get(id))
      .filter((fact): fact is TemporalFact => fact !== undefined)
      .sort((a, b) => a.validFrom - b.validFrom);
  }

  /**
   * 冲突检测：同一 subject 下，两条内容不同的事实其有效区间发生重叠，
   * 说明系统同时持有两个互斥的「当前真值」。
   */
  conflicts(): Conflict[] {
    const out: Conflict[] = [];
    for (const [subject, ids] of this.bySubject) {
      const list = [...ids]
        .map((id) => this.facts.get(id))
        .filter((fact): fact is TemporalFact => fact !== undefined)
        .sort((a, b) => a.validFrom - b.validFrom);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const left = list[i];
          const right = list[j];
          if (left === undefined || right === undefined) continue;
          if (left.hash === right.hash) continue;
          const overlapFrom = Math.max(left.validFrom, right.validFrom);
          const leftEnd = left.validTo ?? Number.POSITIVE_INFINITY;
          const rightEnd = right.validTo ?? Number.POSITIVE_INFINITY;
          const overlapTo = Math.min(leftEnd, rightEnd);
          if (overlapFrom >= overlapTo) continue;
          out.push({
            subject,
            leftId: left.id,
            rightId: right.id,
            overlapFrom,
            overlapTo: Number.isFinite(overlapTo) ? overlapTo : null,
          });
        }
      }
    }
    return out;
  }

  stats(): MemoryStats {
    const now = this.clock();
    let current = 0;
    let superseded = 0;
    for (const fact of this.facts.values()) {
      if (fact.supersededAt !== null) superseded += 1;
      if (isCurrent(fact, now)) current += 1;
    }
    return {
      total: this.facts.size,
      current,
      superseded,
      subjects: this.bySubject.size,
      conflicts: this.conflicts().length,
    };
  }

  /** 导出为纯 JSON（可自行落盘到 .json 文件，仍然不依赖数据库）。 */
  serialize(): TemporalFact[] {
    return [...this.facts.values()].map((fact) => ({ ...fact }));
  }

  /** 从 serialize() 的结果恢复。 */
  restore(facts: readonly TemporalFact[]): void {
    for (const fact of facts) {
      const frozen = Object.freeze({ ...fact, tags: Object.freeze([...fact.tags]) });
      this.facts.set(frozen.id, frozen);
      this.tokens.set(frozen.id, tokenize(`${frozen.subject} ${frozen.content}`));
      const bucket = this.bySubject.get(frozen.subject) ?? new Set<string>();
      bucket.add(frozen.id);
      this.bySubject.set(frozen.subject, bucket);
      const tail = Number.parseInt(frozen.id.split('-')[1] ?? '0', 10);
      if (Number.isFinite(tail) && tail > this.seq) this.seq = tail;
    }
  }

  private visible(
    fact: TemporalFact,
    mode: RecallMode,
    options: RecallOptions,
    now: number,
  ): boolean {
    switch (mode) {
      case 'strict':
        return isCurrent(fact, now);
      case 'historical':
        return isValidAt(fact, options.validTime ?? now);
      case 'belief':
        return isRecordedAt(fact, options.recordedTime ?? now);
      default:
        return false;
    }
  }

  private findByHash(hash: string): TemporalFact | undefined {
    for (const fact of this.facts.values()) {
      if (fact.hash === hash) return fact;
    }
    return undefined;
  }
}
