/**
 * src/agents_file.ts — 把「人格 + 准则本」同步进 `$DSH_HOME/AGENTS.md` 的受控块
 *
 * ## 为什么需要这条通道
 *
 * 实测（2026-11-08）：`dsh-superagent` 的执行器会话用的是 preset 声明的 agent 作用域，
 * 而 preset 里的插件**注册 `systemPrompt.section` 到不了该 agent 的提示**（注册隔离）——
 * 我们验证过 apply 执行了、服务拿得到、两段都注册成功，那条会话的系统提示里依旧没有。
 *
 * 但 `@deepseek-ai/dsh-agent-instructions` 会把 `$DSH_HOME/AGENTS.md`（user-global 链）
 * 读进**每一个** agent，worker 也不例外。所以只剩这一条可达通道。
 *
 * ## 为什么要「受控块」而不是直接写文件
 *
 * 那是用户的全局指令文件，里面可能有他自己写的东西。所以：
 *
 * 1. 只认 `<!-- cognition-engine:begin -->` … `<!-- cognition-engine:end -->` 之间；
 * 2. **标记外一个字都不动**；
 * 3. 文件不存在就新建，内容只有这一块；
 * 4. 标记残缺（只有一半）时不猜——把新块**追加**到末尾，并在结果里明确告知，绝不吞掉原文；
 * 5. 写入用「临时文件 + rename」，并返回旧内容，方便回滚。
 *
 * ## 默认关闭
 *
 * 它会改用户的文件，所以 `agentsFileSync` 默认 false。只有用户明确开启才会写。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const BEGIN_MARKER = '<!-- cognition-engine:begin -->';
export const END_MARKER = '<!-- cognition-engine:end -->';

/** 默认路径：`$DSH_HOME/AGENTS.md`，DSH_HOME 缺省 `~/.dsh`。 */
export function defaultAgentsFilePath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim().length > 0
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'AGENTS.md');
}

/** 把正文包成受控块。 */
export function wrapBlock(body: string): string {
  const trimmed = body.trim();
  return `${BEGIN_MARKER}\n${trimmed}\n${END_MARKER}`;
}

/** 读出已存在的受控块正文；没有就返回 undefined。 */
export function readManagedBlock(content: string): string | undefined {
  const begin = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (begin < 0 || end < 0 || end <= begin) return undefined;
  return content.slice(begin + BEGIN_MARKER.length, end).replace(/^\n/, '').replace(/\n$/, '');
}

export interface UpsertResult {
  /** 合并后的完整文件内容。 */
  content: string;
  /** 是否真的变了（幂等：内容一样就不变）。 */
  changed: boolean;
  /**
   * 标记是否残缺（只找到一半）。
   * true 时新块被追加到末尾，**原文保留**——这是刻意的保守策略。
   */
  malformed: boolean;
}

/**
 * 把 `body` 合并进 `existing`（纯函数，不碰磁盘）。
 *
 * 四种情况：
 * - existing 为 null/空       → 只有受控块
 * - 有完整标记                → 只替换标记之间
 * - 标记残缺                  → 追加新块，原文保留，`malformed: true`
 * - 没有标记但有内容          → 追加到末尾（前面留一个空行）
 */
export function upsertManagedBlock(existing: string | null, body: string): UpsertResult {
  const block = wrapBlock(body);

  if (existing === null || existing.trim().length === 0) {
    return { content: `${block}\n`, changed: true, malformed: false };
  }

  const begin = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);
  const hasBegin = begin >= 0;
  const hasEnd = end >= 0;

  if (hasBegin !== hasEnd || (hasBegin && hasEnd && end <= begin)) {
    // 残缺：不猜、不删，追加并在结果里说明
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    return { content: `${existing}${sep}${block}\n`, changed: true, malformed: true };
  }

  if (hasBegin && hasEnd) {
    const before = existing.slice(0, begin);
    const after = existing.slice(end + END_MARKER.length);
    const next = `${before}${block}${after}`;
    return { content: next, changed: next !== existing, malformed: false };
  }

  // 没有标记：追加
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${existing}${sep}${block}\n`, changed: true, malformed: false };
}

export interface AgentsFileSyncOptions {
  filePath?: string;
  now?: () => number;
}

export interface SyncResult {
  ok: boolean;
  filePath: string;
  changed: boolean;
  malformed?: boolean;
  /** 写入前的旧内容（文件原本不存在则为 null），供回滚。 */
  previous?: string | null;
  reason?: string;
}

export class AgentsFileSync {
  private readonly filePath: string;

  constructor(options: AgentsFileSyncOptions = {}) {
    this.filePath = options.filePath === undefined ? defaultAgentsFilePath() : options.filePath;
  }

  get path(): string {
    return this.filePath;
  }

  /** 预览：算出合并结果，不写盘。 */
  preview(body: string): UpsertResult & { filePath: string; previous: string | null } {
    const previous = existsSync(this.filePath) ? readFileSync(this.filePath, 'utf8') : null;
    return { ...upsertManagedBlock(previous, body), filePath: this.filePath, previous };
  }

  /** 真正写盘（临时文件 + rename）。失败返回 ok:false，不抛。 */
  apply(body: string): SyncResult {
    try {
      const preview = this.preview(body);
      if (!preview.changed) {
        return { ok: true, filePath: this.filePath, changed: false, previous: preview.previous };
      }
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.cognition-tmp`;
      writeFileSync(tmp, preview.content, 'utf8');
      renameSync(tmp, this.filePath);
      return {
        ok: true,
        filePath: this.filePath,
        changed: true,
        malformed: preview.malformed,
        previous: preview.previous,
      };
    } catch (error) {
      return {
        ok: false,
        filePath: this.filePath,
        changed: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 回滚到给定内容；传 null 表示删掉文件（仅当确认是本次新建时才用）。 */
  rollback(previous: string | null): boolean {
    try {
      if (previous === null) {
        if (existsSync(this.filePath)) writeFileSync(this.filePath, '', 'utf8');
        return true;
      }
      writeFileSync(this.filePath, previous, 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}
