/**
 * src/settings.ts — 少量运行时可改的设置（目前只有注入方式）
 *
 * 为什么单独存一个小文件：`cordis.patch.yml` 是启动配置，运行中被应用覆盖；
 * 用户在面板上改的偏好必须落在自己的小文件里，重启后仍然有效。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type InjectMode = 'off' | 'index' | 'full';

export interface PersistedSettings {
  injectMode?: InjectMode;
  /** 自动联网学习：出现纠正/缺口时自己检索并抓资料。默认关。 */
  autoLearn?: boolean;
  /** 自动修订：学到更普适的版本时自动改之前学的。默认关，且必须留存档。 */
  autoRevise?: boolean;
  /** 自动采用候选：学到的直接生效，人不用一条条点。默认开（用户 2026-11-19：减少人的操作）。 */
  autoAccept?: boolean;
  /** 深研开关。默认关（一次约 ¥0.1，手动触发时才花）。 */
  deepResearch?: boolean;
  /**
   * 联网学习三档（合并了原来的 autoLearn + deepResearch 两个开关）：
   *   off  = 完全不联网
   *   fast = 快学（单次检索 + 抓 1~2 篇 + 提炼）
   *   deep = 深研（多源 + 交叉核对，约 ¥0.1/次）
   * 老字段仍然兼容：自动从 autoLearn/deepResearch 推出来。
   */
  learnLevel?: LearnLevel;
}

export type LearnLevel = 'off' | 'fast' | 'deep';

export function isLearnLevel(value: unknown): value is LearnLevel {
  return value === 'off' || value === 'fast' || value === 'deep';
}

/** 由三档推出老的两个布尔量（保持既有代码路径不用改）。 */
export function resolveLearnLevel(settings: PersistedSettings): LearnLevel {
  if (isLearnLevel(settings.learnLevel)) return settings.learnLevel;
  if (settings.deepResearch === true) return 'deep';
  if (settings.autoLearn === true) return 'fast';
  return 'off';
}

export function isInjectMode(value: unknown): value is InjectMode {
  return value === 'off' || value === 'index' || value === 'full';
}

/**
 * 决定最终注入方式。
 * 优先级：显式配置 > 面板保存 > 旧开关（injectMemory / injectIndexOnly）> 默认 index。
 */
export function resolveInjectMode(input: {
  configured?: string;
  saved?: string;
  injectMemory?: boolean;
  injectIndexOnly?: boolean;
}): InjectMode {
  if (isInjectMode(input.configured)) return input.configured;
  if (isInjectMode(input.saved)) return input.saved;
  if (input.injectMemory === false) return 'off';
  if (input.injectIndexOnly === false) return 'full';
  return 'index';
}

export class SettingsStore {
  readonly filePath: string;
  private cached: PersistedSettings | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read(): PersistedSettings {
    if (this.cached !== undefined) return this.cached;
    if (!existsSync(this.filePath)) {
      this.cached = {};
      return this.cached;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '')) as PersistedSettings;
      this.cached = parsed !== null && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.cached = {};
    }
    return this.cached;
  }

  writeInjectMode(mode: InjectMode): PersistedSettings {
    const next: PersistedSettings = { ...this.read(), injectMode: mode };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    this.cached = next;
    return next;
  }

  /** 改自动学习/自动修订开关（面板按钮）。 */
  writeToggles(patch: { autoLearn?: boolean; autoRevise?: boolean; autoAccept?: boolean; deepResearch?: boolean; learnLevel?: LearnLevel }): PersistedSettings {
    const next: PersistedSettings = { ...this.read() };
    if (patch.autoLearn !== undefined) next.autoLearn = patch.autoLearn;
    if (patch.autoRevise !== undefined) next.autoRevise = patch.autoRevise;
    if (patch.autoAccept !== undefined) next.autoAccept = patch.autoAccept;
    if (patch.deepResearch !== undefined) next.deepResearch = patch.deepResearch;
    if (patch.learnLevel !== undefined) {
      // 三档是唯一真相：写它的时候顺手把老两个布尔量对齐，避免两套状态打架
      next.learnLevel = patch.learnLevel;
      next.autoLearn = patch.learnLevel !== 'off';
      next.deepResearch = patch.learnLevel === 'deep';
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    this.cached = next;
    return next;
  }
}
