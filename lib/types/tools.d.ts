/**
 * src/tools.ts — 七个工具的定义
 *
 * 从 index.ts 拆出来的原因：index.ts 只该负责「接线」（建实例、注册、路由、清理），
 * 工具的参数表和执行体属于另一层关注点，混在一起会让入口文件膨胀到八百多行。
 *
 * 所有工具都是纯函数式定义，状态全部来自 deps，不持有任何自己的状态。
 */
import { TemporalMemoryStore } from './memory.ts';
import type { TopicStore } from './topics.ts';
import type { DialecticalReflectionEngine } from './reflection.ts';
import { ProactiveGate } from './proactive.ts';
import { LongHorizonTaskManager } from './task_manager.ts';
/** 工具定义用到的全部外部依赖。 */
export interface ToolDeps {
    memory: TemporalMemoryStore;
    /** 记忆变更后重算准则证据链（作废会传染）。 */
    refreshEvidence?: () => void;
    /** 沉积层：一次真实取代发生时调用（旧 id → 新 id）。失败不影响记忆写入。 */
    sedimentObserve?: (oldId: string, newId: string, reason?: string) => void;
    /** 登记知识缺口。 */
    gapRecorder?: (text: string, context?: string) => {
        id: string;
        duplicate: boolean;
        open: number;
    };
    /** 分项打标。 */
    playbookRate?: (id: string, kind: 'applied', trace?: string) => boolean;
    /** 主题注册表：用于按主题分组展示矛盾。 */
    topics: TopicStore;
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
        conflictHintThreshold?: number;
    };
    /** 读取当前反思引擎模式（off / local / real）。 */
    currentReflectionMode?: () => string;
    /** 准则蒸馏：从记忆提炼候选并给现有准则打标。 */
    distillPlaybook?: (options: {
        maxCandidates?: number;
    }) => Promise<Record<string, unknown>>;
    /** 读取当前反思引擎模式（off / local / real）。 */
    reflectionMode?: () => string;
    /**
     * 召回日志钩子（S8 检索度量）。
     *
     * 只传 query / mode / 返回的 id 与分数，**不传记忆正文**——
     * 正文已经存在 state 文件里，日志再抄一份既浪费又扩大隐私面。
     */
    onRecall?: (info: {
        query: string;
        mode: string;
        ids: string[];
        scores: number[];
        count: number;
        rendered?: boolean;
    }) => void;
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
            supersedeReason: {
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
            ruleId: {
                type: string;
                description: string;
            };
            usageKind: {
                type: string;
                description: string;
            };
            evidence: {
                type: string;
                description: string;
            };
            action: {
                type: string;
                enum: string[];
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
            evidence: {
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
}, {
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
