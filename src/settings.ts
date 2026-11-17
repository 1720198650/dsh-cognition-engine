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
}
