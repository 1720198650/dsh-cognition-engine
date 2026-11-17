export type InjectMode = 'off' | 'index' | 'full';
export interface PersistedSettings {
    injectMode?: InjectMode;
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
}
