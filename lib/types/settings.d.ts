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
}
export declare function isInjectMode(value: unknown): value is InjectMode;
/**
 * 决定最终注入方式。
 * 优先级：显式配置 > 面板保存 > 旧开关（injectMemory / injectIndexOnly）> 默认 index。
 */
export declare function resolveInjectMode(input: {
    configured?: string;
    saved?: string;
    injectMemory?: boolean;
    injectIndexOnly?: boolean;
}): InjectMode;
export declare class SettingsStore {
    readonly filePath: string;
    private cached;
    constructor(filePath: string);
    read(): PersistedSettings;
    writeInjectMode(mode: InjectMode): PersistedSettings;
    /** 改自动学习/自动修订开关（面板按钮）。 */
    writeToggles(patch: {
        autoLearn?: boolean;
        autoRevise?: boolean;
        autoAccept?: boolean;
        deepResearch?: boolean;
    }): PersistedSettings;
}
