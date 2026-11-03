/**
 * src/playbook.ts — 准则本（Playbook）
 *
 * 把记忆蒸馏成一份常驻上下文的「工作准则」。设计依据：
 *
 *   - ACE (ICLR 2026)：条目是 bullet，带 helpful/harmful 双向计数；
 *     **LLM 只产候选，合并/去重/淘汰由确定性代码做**——这是 delta 优于 rewrite 的根因。
 *   - Dynamic Cheatsheet (EACL 2026)：分节 + 计数；整篇重写会因模型写「...」而逐轮退化，
 *     所以这里条目化存储、单条增删。
 *   - MemGPT/Letta：准则本对应 Core Memory——常驻、短、由调用方维护。
 *
 * 本文件只负责「数据 + 确定性合并 + 渲染」，不调用任何模型。
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { cosine, tokenize } from './memory.ts';
import { resolveInPackage } from './util.ts';

/* ------------------------------------------------------------------ */
/* 类型                                                                 */
/* ------------------------------------------------------------------ */

export const PLAYBOOK_SECTIONS = ['约定', '坑', '状态', '未分类'] as const;
export type PlaybookSection = (typeof PLAYBOOK_SECTIONS)[number];

export type PlaybookStatus = 'active' | 'pending' | 'retired' | 'expired';

/** 条目的历史版本（revise 时保留，不原地覆盖）。 */
export interface PlaybookHistoryEntry {
  content: string;
  replacedAt: number;
}

export interface PlaybookEntry {
  id: string;
  section: PlaybookSection;
  content: string;
  /** ACE 式双向计数：一个条目既可能被证明有用，也可能误导过。 */
  helpful: number;
  harmful: number;
  /** 来自哪几条记忆（证据链）；手动条目为空。 */
  sourceIds: string[];
  /** 何时生效；null 表示不限。 */
  validFrom: number | null;
  /** 何时失效；null 表示长期有效。P3 才会自动生成。 */
  validTo: number | null;
  status: PlaybookStatus;
  createdAt: number;
  updatedAt: number;
  note: string;
  history: PlaybookHistoryEntry[];
  /** 与哪条准则疑似冲突（入库时检测，人工裁决）。 */
  conflictWith?: string;
}

export interface PlaybookFile {
  version: number;
  revision: number;
  updatedAt: number;
  entries: PlaybookEntry[];
}

/** 待合并的候选（由 Reflector/Curator 产生，或人工新增）。 */
export interface PlaybookCandidate {
  section?: string;
  content: string;
  sourceIds?: string[];
  validTo?: number | null;
}

export interface MergeOutcome {
  accepted: boolean;
  /** 被接受时是新建条目；命中重复则为空。 */
  entry?: PlaybookEntry;
  reason?: string;
  /** 与哪条已有条目重复。 */
  duplicateOf?: string;
}

export interface PlaybookOptions {
  filePath?: string;
  now?: () => number;
  /** 注入预算（字符）。默认 600。 */
  maxChars?: number;
  /** 条目数上限。默认 12。 */
  maxEntries?: number;
  /** 每个 section 的条数上限。默认 5。 */
  maxPerSection?: number;
  /**
   * 去重阈值（余弦）。
   *
   * 注意：ACE 报告的 0.90 是**稠密向量**口径，不能直接搬。
   * 我们用字二元组词频余弦，实测标定点：
   *   完全相同 1.000 / 只差几个字 0.759 / 同义改写 0.694
   *   / 意思相同措辞不同 0.522 / 无关 0.000
   * 所以取 0.70——能拦住"只差几个字"和"同义改写"，又不至于把无关条目误判成重复。
   */
  dedupeThreshold?: number;
  /** 校验来源 id 是否真实存在；不提供则跳过校验。 */
  validateSourceIds?: (ids: readonly string[]) => string[];
}

export interface PlaybookStats {
  active: number;
  pending: number;
  retired: number;
  expired: number;
  chars: number;
  /** 带冲突标记的条数。 */
  conflicted: number;
  helpfulTotal: number;
  harmfulTotal: number;
}

/* ------------------------------------------------------------------ */
/* 常量                                                                 */
/* ------------------------------------------------------------------ */

const MAX_SNAPSHOTS = 5;
const CONTENT_MIN = 12;
const CONTENT_MAX = 60;

/**
 * 套话库：这些内容换成任何项目都成立，按 Dynamic Cheatsheet 的 DC-∅ 结论，
 * 它们与「指令本身」没有区别，增益为零，不该进准则本。
 */
const CLICHE_PATTERNS: readonly RegExp[] = Object.freeze([
  /认真(检查|对待|阅读)/,
  /注意(边界|细节|安全)/,
  /(仔细|认真)(思考|核对)/,
  /保持(代码|风格)?(整洁|一致)/,
  /(多|要)写(单元)?测试/,
  /(确保|保证)(正确性|质量|可用)/,
  /遵循(最佳实践|规范)/,
  /(及时|经常)备份/,
  /think (carefully|step by step)/i,
  /follow best practices/i,
  /write (unit )?tests/i,
]);

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

function clampSection(section: string | undefined): PlaybookSection {
  const value = (section ?? '').trim();
  return (PLAYBOOK_SECTIONS as readonly string[]).includes(value) ? (value as PlaybookSection) : '未分类';
}

/** 长度按「字符数」算；中文与英文一视同仁。 */
function normalizeContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 极简否定检测：够用即可，冲突最终由人裁决。 */
function hasNegation(text: string): boolean {
  // 单字「不」也要算：准则里最常见的否定就是「不跳步」「不要用 X」。
  // 这里只是打冲突标记供人工看，误报的代价远小于漏报。
  return /(不|没|无|非|未|别|never|not|don't|do not|avoid)/i.test(text);
}

function isCliche(text: string): boolean {
  return CLICHE_PATTERNS.some((pattern) => pattern.test(text));
}

function emptyFile(): PlaybookFile {
  return { version: 1, revision: 0, updatedAt: 0, entries: [] };
}

/* ------------------------------------------------------------------ */
/* 主体                                                                 */
/* ------------------------------------------------------------------ */

export class PlaybookStore {
  private readonly filePath: string;
  private readonly snapshotDir: string;
  private readonly clock: () => number;
  private readonly maxChars: number;
  private readonly maxEntries: number;
  private readonly maxPerSection: number;
  private readonly dedupeThreshold: number;
  private readonly validateSourceIds: ((ids: readonly string[]) => string[]) | undefined;
  private data: PlaybookFile = emptyFile();
  private seq = 0;

  constructor(options: PlaybookOptions = {}) {
    this.filePath = options.filePath === undefined
      ? resolveInPackage('cognition-playbook.json')
      : resolve(options.filePath);
    this.snapshotDir = join(dirname(this.filePath), '.snapshots', 'playbook');
    this.clock = options.now ?? (() => Date.now());
    this.maxChars = Math.max(200, options.maxChars ?? 600);
    this.maxEntries = Math.max(1, options.maxEntries ?? 12);
    this.maxPerSection = Math.max(1, options.maxPerSection ?? 5);
    this.dedupeThreshold = Math.min(0.99, Math.max(0.5, options.dedupeThreshold ?? 0.7));
    this.validateSourceIds = options.validateSourceIds;
  }

  get path(): string {
    return this.filePath;
  }

  /* ------------------------------ 读写 ------------------------------ */

  /** 启动时恢复；文件不存在或损坏都按空准则本启动，绝不阻断插件加载。 */
  loadSync(): boolean {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      this.restore(JSON.parse(raw) as PlaybookFile);
      return true;
    } catch {
      this.data = emptyFile();
      return false;
    }
  }

  async load(): Promise<boolean> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.restore(JSON.parse(raw) as PlaybookFile);
      return true;
    } catch {
      this.data = emptyFile();
      return false;
    }
  }

  private restore(file: PlaybookFile): void {
    const entries = Array.isArray(file.entries) ? file.entries.filter((entry) => typeof entry?.content === 'string') : [];
    this.data = {
      version: 1,
      revision: Number(file.revision ?? 0),
      updatedAt: Number(file.updatedAt ?? 0),
      entries: entries.map((entry) => ({
        id: String(entry.id ?? ''),
        section: clampSection(entry.section),
        content: normalizeContent(entry.content),
        helpful: Number(entry.helpful ?? 0),
        harmful: Number(entry.harmful ?? 0),
        sourceIds: Array.isArray(entry.sourceIds) ? entry.sourceIds.map(String) : [],
        validFrom: entry.validFrom === null || entry.validFrom === undefined ? null : Number(entry.validFrom),
        validTo: entry.validTo === null || entry.validTo === undefined ? null : Number(entry.validTo),
        status: (entry.status ?? 'active') as PlaybookStatus,
        createdAt: Number(entry.createdAt ?? 0),
        updatedAt: Number(entry.updatedAt ?? 0),
        note: String(entry.note ?? ''),
        history: Array.isArray(entry.history) ? entry.history : [],
      })),
    };
    // 从已有 id 里续上序号，避免重启后 id 冲突
    this.seq = this.data.entries.reduce((max, entry) => {
      const match = /^ctxt-(\d+)$/.exec(entry.id);
      return match === null ? max : Math.max(max, Number(match[1]));
    }, 0);
  }

  async flush(): Promise<void> {
    await this.snapshot();
    this.data.revision += 1;
    this.data.updatedAt = this.clock();
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    const temp = `${this.filePath}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temp, payload, 'utf8');
      await rename(temp, this.filePath);
    } catch {
      // 写盘失败不能变成未捕获拒绝
    }
  }

  private async snapshot(): Promise<void> {
    try {
      await stat(this.filePath);
    } catch {
      return;
    }
    try {
      await mkdir(this.snapshotDir, { recursive: true });
      const name = `${basename(this.filePath)}.${Date.now()}.json`;
      const { copyFile } = await import('node:fs/promises');
      await copyFile(this.filePath, join(this.snapshotDir, name));
      const names = (await readdir(this.snapshotDir)).filter((item) => item.endsWith('.json')).sort();
      for (const old of names.slice(0, Math.max(0, names.length - MAX_SNAPSHOTS))) {
        await rm(join(this.snapshotDir, old), { force: true }).catch(() => undefined);
      }
    } catch {
      // 快照失败不影响写入
    }
  }

  /* ------------------------------ 查询 ------------------------------ */

  all(): PlaybookEntry[] {
    return this.data.entries.map((entry) => ({ ...entry }));
  }

  get(id: string): PlaybookEntry | undefined {
    const entry = this.data.entries.find((item) => item.id === id);
    return entry === undefined ? undefined : { ...entry };
  }

  /** 生效中的条目：status=active 且未被 validTo 判过期。 */
  active(now: number = this.clock()): PlaybookEntry[] {
    return this.data.entries.filter((entry) => entry.status === 'active' && !this.isExpired(entry, now));
  }

  pending(): PlaybookEntry[] {
    return this.data.entries.filter((entry) => entry.status === 'pending');
  }

  stats(): PlaybookStats {
    const now = this.clock();
    const active = this.active(now);
    return {
      active: active.length,
      pending: this.pending().length,
      retired: this.data.entries.filter((entry) => entry.status === 'retired').length,
      expired: this.expired(now).length,
      conflicted: this.data.entries.filter((entry) => entry.status !== 'retired' && entry.conflictWith !== undefined).length,
      chars: this.render(now).length,
      helpfulTotal: active.reduce((sum, entry) => sum + entry.helpful, 0),
      harmfulTotal: active.reduce((sum, entry) => sum + entry.harmful, 0),
    };
  }

  isExpired(entry: PlaybookEntry, now: number = this.clock()): boolean {
    if (entry.validTo === null) return false;
    return entry.validTo <= now;
  }

  /* ---------------------------- 确定性合并 ---------------------------- */

  /**
   * 提交一个候选。
   *
   * 这里就是 ACE 说的 "lightweight, non-LLM logic"：
   * 去重、长度、分节、来源、套话全部由代码判定，模型只负责提议。
   */
  submit(candidate: PlaybookCandidate): MergeOutcome {
    const content = normalizeContent(candidate.content ?? '');
    if (content.length === 0) return { accepted: false, reason: '内容为空' };
    if (content.length < CONTENT_MIN) return { accepted: false, reason: `内容过短（<${CONTENT_MIN} 字）` };
    if (content.length > CONTENT_MAX) return { accepted: false, reason: `内容过长（>${CONTENT_MAX} 字）` };
    if (isCliche(content)) return { accepted: false, reason: '通用套话：换成任何项目都成立，按 DC-∅ 结论增益为零' };

    const sourceIds = Array.isArray(candidate.sourceIds) ? candidate.sourceIds.map(String) : [];
    const validSourceIds = this.validateSourceIds === undefined ? sourceIds : this.validateSourceIds(sourceIds);
    // 明确给了来源却全部无效 → 说明是臆造，丢弃；没给来源则视为手动条目
    if (sourceIds.length > 0 && validSourceIds.length === 0) {
      return { accepted: false, reason: '来源记忆全部不存在（可能已删除）' };
    }

    // 先判冲突，再判重复。
    // 顺序很重要：否定翻转的准则与原文相似度很高（常 >0.7），如果先做去重会被当成
    // 「重复」直接丢掉——但它其实是一条**互相矛盾的**准则，必须留给人工裁决。
    const section = clampSection(candidate.section);
    const conflictWith = this.detectConflict(content, section);

    if (conflictWith === undefined) {
      const own = tokenize(content);
      for (const entry of this.data.entries) {
        if (entry.status === 'retired') continue;
        const similarity = cosine(own, tokenize(entry.content));
        if (similarity >= this.dedupeThreshold) {
          return { accepted: false, reason: `与 ${entry.id} 重复（相似度 ${similarity.toFixed(2)}）`, duplicateOf: entry.id };
        }
      }
    }

    // 数量上限：满了就把打分最低的 retired 掉，而不是拒绝新条目
    if (this.data.entries.filter((entry) => entry.status !== 'retired').length >= this.maxEntries) {
      const victim = this.worstEntry();
      if (victim !== undefined) this.markRetired(victim.id, '条目数超限，按 helpful−harmful×2 淘汰');
    }

    const now = this.clock();
    const entry: PlaybookEntry = {
      id: this.nextId(),
      section,
      content,
      helpful: 0,
      harmful: 0,
      sourceIds: sourceIds.length === 0 ? [] : validSourceIds,
      validFrom: null,
      validTo: candidate.validTo === undefined ? null : candidate.validTo,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      note: conflictWith === undefined ? '' : `与 ${conflictWith} 疑似冲突，待人工裁决`,
      history: [],
      ...(conflictWith === undefined ? {} : { conflictWith }),
    };
    this.data.entries.push(entry);
    return { accepted: true, entry: { ...entry } };
  }

  /**
   * 冲突检测：同 section + 内容相近 + 一方有否定词。
   *
   * 不做自动裁决——自动合并就是另一种「整篇重写」，会悄悄丢掉差异。
   * 只标记，交给人工在审核界面并排看。
   */
  detectConflict(content: string, section: PlaybookSection): string | undefined {
    const own = tokenize(content);
    const ownNegated = hasNegation(content);
    for (const entry of this.active()) {
      if (entry.section !== section) continue;
      const similarity = cosine(own, tokenize(entry.content));
      // 标定：同一句话改否定词 0.915 / 「必须跑」改「不要跑」0.786 /
      // 「不跳步」改「可以跳步」0.420。取 0.38 才能覆盖最后一种。
      // 冲突只是打标记给人看，误报的代价远小于漏报。
      if (similarity < 0.38) continue;
      if (hasNegation(entry.content) !== ownNegated) return entry.id;
    }
    return undefined;
  }

  /** 已过期的条目（status 仍是 active，但 validTo 已过）。 */
  expired(now: number = this.clock()): PlaybookEntry[] {
    return this.data.entries.filter((entry) => entry.status === 'active' && this.isExpired(entry, now));
  }

  /** 延长有效期（复核后确认继续有效）。 */
  extend(id: string, validTo: number | null): boolean {
    const entry = this.entryRef(id);
    if (entry === undefined) return false;
    entry.validTo = validTo;
    entry.updatedAt = this.clock();
    entry.note = validTo === null ? '' : '已延长有效期';
    return true;
  }

  /** 人工直接新增（跳过审核，直接 active）。 */
  addManual(input: { section?: string; content: string; validTo?: number | null }): MergeOutcome {
    const outcome = this.submit(input);
    if (!outcome.accepted || outcome.entry === undefined) return outcome;
    this.markActive(outcome.entry.id);
    return { accepted: true, entry: this.get(outcome.entry.id) };
  }

  /* ------------------------------ 状态流转 ------------------------------ */

  accept(id: string): boolean {
    const entry = this.entryRef(id);
    if (entry === undefined || entry.status !== 'pending') return false;
    this.markActive(id);
    return true;
  }

  reject(id: string): boolean {
    const index = this.data.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    if (this.data.entries[index]?.status !== 'pending') return false;
    this.data.entries.splice(index, 1);
    return true;
  }

  retire(id: string, reason = ''): boolean {
    return this.markRetired(id, reason);
  }

  revive(id: string): boolean {
    const entry = this.entryRef(id);
    if (entry === undefined) return false;
    entry.status = 'active';
    entry.updatedAt = this.clock();
    entry.note = '';
    return true;
  }

  /** 编辑条目：旧内容进 history，不原地丢弃。 */
  revise(id: string, content: string): boolean {
    const entry = this.entryRef(id);
    if (entry === undefined) return false;
    const next = normalizeContent(content);
    if (next.length < CONTENT_MIN || next.length > CONTENT_MAX) return false;
    if (next === entry.content) return false;
    entry.history.push({ content: entry.content, replacedAt: this.clock() });
    entry.content = next;
    entry.updatedAt = this.clock();
    return true;
  }

  /** 记录一次使用反馈（ACE 的双向计数）。 */
  mark(id: string, kind: 'helpful' | 'harmful', amount = 1): boolean {
    const entry = this.entryRef(id);
    if (entry === undefined) return false;
    if (kind === 'helpful') entry.helpful += Math.max(0, amount);
    else entry.harmful += Math.max(0, amount);
    entry.updatedAt = this.clock();

    // 坏条目的伤害大于好条目的收益（ACE：噪声反射 66.7 < 基线 70.7），
    // 所以 harmful 到阈值直接退场，不靠人记得去点。
    if (entry.harmful >= 3 && entry.harmful > entry.helpful) {
      entry.status = 'retired';
      entry.note = '有害标记过多，自动退场';
    }
    return true;
  }

  /* ------------------------------ 渲染 ------------------------------ */

  /**
   * 渲染成注入文本。
   *
   * 格式照 ACE：`[ctxt-00001] helpful=2 harmful=0 :: 正文`——
   * 模型可以点名引用，我们才能回写计数。
   */
  render(now: number = this.clock()): string {
    const active = this.active(now);
    if (active.length === 0) return '';

    // 按 section 分组；组内按 helpful−harmful×2 降序
    const groups = new Map<PlaybookSection, PlaybookEntry[]>();
    for (const entry of active) {
      const list = groups.get(entry.section) ?? [];
      list.push(entry);
      groups.set(entry.section, list);
    }

    const score = (entry: PlaybookEntry): number => entry.helpful - entry.harmful * 2;
    const blocks: string[] = [];
    let used = 0;
    let total = 0;

    for (const section of PLAYBOOK_SECTIONS) {
      const list = (groups.get(section) ?? []).sort((a, b) => score(b) - score(a));
      if (list.length === 0) continue;

      const lines: string[] = [];
      const header = `## ${section}`;
      let blockChars = header.length + 1;
      for (const entry of list) {
        if (lines.length >= this.maxPerSection) break;
        if (total >= this.maxEntries) break;
        const line = `- [${entry.id}] helpful=${entry.helpful} harmful=${entry.harmful} :: ${entry.content}`;
        if (used + blockChars + line.length + 1 > this.maxChars) {
          // 预算不够时，至少保证每个 section 有一条
          if (lines.length === 0) {
            const trimmed = line.length > 80 ? `${line.slice(0, 77)}…` : line;
            lines.push(trimmed);
            blockChars += trimmed.length + 1;
            total += 1;
          }
          break;
        }
        lines.push(line);
        blockChars += line.length + 1;
        total += 1;
      }
      if (lines.length === 0) continue;
      if (used + blockChars > this.maxChars) break;
      blocks.push(`${header}\n${lines.join('\n')}`);
      used += blockChars + 1;
    }

    return blocks.join('\n\n');
  }

  /** 把渲染结果包成可注入的段落；空准则本返回空串，由调用方回退 digest。 */
  renderSection(now: number = this.clock()): string {
    const body = this.render(now);
    if (body.length === 0) return '';
    return `【工作准则】（由记忆蒸馏，累计 helpful/harmful）\n${body}\n（这些是长期约定；需要具体细节时调用 cognition_recall。）`;
  }

  /* ------------------------------ 内部 ------------------------------ */

  private entryRef(id: string): PlaybookEntry | undefined {
    return this.data.entries.find((entry) => entry.id === id);
  }

  private nextId(): string {
    this.seq += 1;
    return `ctxt-${String(this.seq).padStart(5, '0')}`;
  }

  private markActive(id: string): void {
    const entry = this.entryRef(id);
    if (entry === undefined) return;
    entry.status = 'active';
    entry.updatedAt = this.clock();
    // 已有 active 条数超限时，淘汰打分最低的
    while (this.active().length > this.maxEntries) {
      const victim = this.worstEntry();
      if (victim === undefined || victim.id === id) break;
      this.markRetired(victim.id, '条目数超限');
    }
  }

  private markRetired(id: string, reason: string): boolean {
    const entry = this.entryRef(id);
    if (entry === undefined) return false;
    entry.status = 'retired';
    entry.note = reason;
    entry.updatedAt = this.clock();
    return true;
  }

  /** 打分最低的 active 条目（helpful − harmful×2，同分取最旧）。 */
  private worstEntry(): PlaybookEntry | undefined {
    const score = (entry: PlaybookEntry): number => entry.helpful - entry.harmful * 2;
    return this.active()
      .slice()
      .sort((a, b) => score(a) - score(b) || a.updatedAt - b.updatedAt)[0];
  }
}
