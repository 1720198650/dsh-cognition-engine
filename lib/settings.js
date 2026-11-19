/**
 * src/settings.ts — 少量运行时可改的设置（目前只有注入方式）
 *
 * 为什么单独存一个小文件：`cordis.patch.yml` 是启动配置，运行中被应用覆盖；
 * 用户在面板上改的偏好必须落在自己的小文件里，重启后仍然有效。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function isLearnLevel(value) {
    return value === 'off' || value === 'fast' || value === 'deep';
}
/** 由三档推出老的两个布尔量（保持既有代码路径不用改）。 */
export function resolveLearnLevel(settings) {
    if (isLearnLevel(settings.learnLevel))
        return settings.learnLevel;
    if (settings.deepResearch === true)
        return 'deep';
    if (settings.autoLearn === true)
        return 'fast';
    return 'off';
}
export function isInjectMode(value) {
    return value === 'off' || value === 'index' || value === 'full';
}
/**
 * 决定最终注入方式。
 * 优先级：显式配置 > 面板保存 > 旧开关（injectMemory / injectIndexOnly）> 默认 index。
 */
export function resolveInjectMode(input) {
    if (isInjectMode(input.configured))
        return input.configured;
    if (isInjectMode(input.saved))
        return input.saved;
    if (input.injectMemory === false)
        return 'off';
    if (input.injectIndexOnly === false)
        return 'full';
    return 'index';
}
export class SettingsStore {
    filePath;
    cached;
    constructor(filePath) {
        this.filePath = filePath;
    }
    read() {
        if (this.cached !== undefined)
            return this.cached;
        if (!existsSync(this.filePath)) {
            this.cached = {};
            return this.cached;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
            this.cached = parsed !== null && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            this.cached = {};
        }
        return this.cached;
    }
    writeInjectMode(mode) {
        const next = { ...this.read(), injectMode: mode };
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        this.cached = next;
        return next;
    }
    /** 改自动学习/自动修订开关（面板按钮）。 */
    writeToggles(patch) {
        const next = { ...this.read() };
        if (patch.autoLearn !== undefined)
            next.autoLearn = patch.autoLearn;
        if (patch.autoRevise !== undefined)
            next.autoRevise = patch.autoRevise;
        if (patch.autoAccept !== undefined)
            next.autoAccept = patch.autoAccept;
        if (patch.deepResearch !== undefined)
            next.deepResearch = patch.deepResearch;
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
