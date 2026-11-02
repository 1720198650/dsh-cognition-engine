/**
 * src/tools.ts — 七个工具的定义
 *
 * 从 index.ts 拆出来的原因：index.ts 只该负责「接线」（建实例、注册、路由、清理），
 * 工具的参数表和执行体属于另一层关注点，混在一起会让入口文件膨胀到八百多行。
 *
 * 所有工具都是纯函数式定义，状态全部来自 deps，不持有任何自己的状态。
 */
import { TemporalMemoryStore } from './memory.ts';
import { SchemaGraphManager } from './graph.ts';
import type { DialecticalReflectionEngine } from './reflection.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
/** 工具定义用到的全部外部依赖。 */
export interface ToolDeps {
    memory: TemporalMemoryStore;
    graph: SchemaGraphManager;
    taskManager: LongHorizonTaskManager;
    proactive: ProactiveGate;
    reflection: DialecticalReflectionEngine;
    touch: () => void;
    persistReflection: (result: {
        query: string;
        synthesis: string;
    }) => {
        id: string;
        subject: string;
    };
    tasksReady: Promise<unknown>;
    config: {
        heartbeatHours: number;
        patrolIntervalHours: number;
    };
    /** 读取当前反思引擎模式（off / local / real）。 */
    currentReflectionMode?: () => string;
    /** 读取当前反思引擎模式（off / local / real）。 */
    reflectionMode?: () => string;
}
export declare function createTools(deps: ToolDeps): readonly [{
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            text: {
                type: string;
                description: string;
            };
            subject: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            importance: {
                type: string;
                description: string;
            };
            validFrom: {
                type: string;
                description: string;
            };
            supersedes: {
                type: string;
                description: string;
            };
            source: {
                type: string;
                description: string;
            };
            kind: {
                type: string;
                enum: string[];
                description: string;
            };
            scope: {
                type: string;
                enum: string[];
                description: string;
            };
        };
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(args: unknown, exec?: unknown): Promise<string>;
}, {
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            query: {
                type: string;
                description: string;
            };
            mode: {
                type: string;
                enum: string[];
                description: string;
            };
            validTime: {
                type: string[];
                description: string;
            };
            recordedTime: {
                type: string[];
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            subject: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            render: {
                type: string;
                description: string;
            };
            inlineChars: {
                type: string;
                description: string;
            };
            expand: {
                type: string;
                description: string;
            };
            scope: {
                type: string;
                enum: string[];
                description: string;
            };
        };
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(args: unknown, exec?: unknown): Promise<string>;
}, {
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {
            id: {
                type: string;
                description: string;
            };
            source: {
                type: string;
                description: string;
            };
            subject: {
                type: string;
                description: string;
            };
        };
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(args: unknown): Promise<string>;
}, {
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            query: {
                type: string;
                description: string;
            };
            draft: {
                type: string;
                description: string;
            };
            save: {
                type: string;
                description: string;
            };
        };
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(args: unknown): Promise<string>;
}, {
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {};
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(): Promise<string>;
}, {
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {};
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(): Promise<string>;
}, {
    name: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            action: {
                type: string;
                enum: string[];
                description: string;
            };
            description: {
                type: string;
                description: string;
            };
            id: {
                type: string;
                description: string;
            };
            status: {
                type: string;
                enum: string[];
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            startAt: {
                type: string;
                description: string;
            };
            order: {
                type: string;
                description: string;
            };
            parallel: {
                type: string;
                description: string;
            };
        };
    };
    output: {
        schema: {
            type: "string";
        };
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
        presentationMeta: (_args: unknown, value: unknown) => Record<string, unknown>;
    };
    execute(args: unknown): Promise<string>;
}];
