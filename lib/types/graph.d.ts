/**
 * src/graph.ts — SchemaGraphManager
 *
 * 建构主义图式网络，机制对齐 CAM（rui9812/CAM）的
 * `prototype/constructivist_memory.py`：
 *
 *   - 增量建图：新片段先算相似度，够阈值就挂到已有图式上（同化 / assimilation），
 *     否则新建一个图式节点，并与最相近的旧图式连一条边（顺应 / accommodation）。
 *   - 重叠聚类：CAM 里 `community_dict.setdefault(n, []).append(idx)` 让一个节点
 *     可以同时属于多个社区；这里用 overlapThreshold 复现「一个观察可被多个图式吸收」。
 *   - 超图（super graph）：CAM 的 `_build_super_graph` 为每个社区生成摘要节点，
 *     并在社区重叠处连边；这里的 `summarize()` 输出同样的社区摘要视图。
 *   - 社区大小上限：对齐 `_limit_community_size`，超过 maxClusterSize 就切分。
 *
 * 认知失调（本次新增）：
 *   - 图式节点带 `isConflict` 标记；
 *   - 同化时若某个待并入图式与观察极性相反、或顺应由极性冲突引起，
 *     返回 `cognitiveDissonance = true`，供上层联动情绪。
 *
 * 存储：纯 TypeScript + Map / Set，无任何外部数据库。
 */
import type { TemporalMemoryStore } from './memory.ts';
export interface Observation {
    readonly id: string;
    readonly text: string;
    readonly tokens: Map<string, number>;
    /** +1 肯定陈述，-1 否定陈述。 */
    readonly polarity: 1 | -1;
    readonly at: number;
}
export interface SchemaNode {
    readonly id: string;
    readonly label: string;
    readonly createdAt: number;
    updatedAt: number;
    /** 层次代号：0 为原始图式，越大越抽象（对应 CAM 的 level）。 */
    generation: number;
    readonly centroid: Map<string, number>;
    readonly members: Set<string>;
    polarity: number;
    weight: number;
    /**
     * 是否为「冲突图式」。
     * 当一条观察与某个图式语义相反、无法同化时，新建的图式会被标为 true。
     */
    isConflict: boolean;
    /** 层次节点的抽取式摘要（取自成员原文，不是 LLM 生成）。 */
    summary?: string;
}
/** 图式之间边的语义类型（参照 memoryweb / Graphiti 的 typed edges）。 */
export type EdgeKind = 'support' | 'contradict' | 'refine' | 'supersede';
/** 一条带类型与叙事说明的边。 */
export interface SchemaEdge {
    readonly from: string;
    readonly to: string;
    readonly kind: EdgeKind;
    readonly weight: number;
    /** 一句话说明「为什么这条边存在」（memoryweb 的 narrative 设计）。 */
    readonly narrative: string;
    readonly createdAt: number;
}
export type IngestMode = 'assimilation' | 'accommodation';
export interface IngestOutcome {
    mode: IngestMode;
    schemaId: string;
    similarity: number;
    /** 本次观察同时落入的图式（重叠聚类）。 */
    matchedSchemaIds: string[];
    createdSchemaId?: string;
    linkedTo?: {
        schemaId: string;
        weight: number;
    };
    /** 内容相近但极性相反时，记录它顶撞了哪个图式。 */
    conflictWith?: string;
    /** 顺应时与旧图式建立关联的理由（A-MEM 风格的动态链接解释）。 */
    linkedBy?: {
        schemaId: string;
        score: number;
        terms: string[];
        kind: EdgeKind;
        narrative: string;
    };
    /** 本次操作是否检测到语义冲突（产生了 isConflict 图式或撞上已有冲突图式）。 */
    cognitiveDissonance: boolean;
}
export interface SchemaGraphOptions {
    assimilateThreshold?: number;
    overlapThreshold?: number;
    communityThreshold?: number;
    maxClusterSize?: number;
    now?: () => number;
}
export interface CommunitySummary {
    id: string;
    schemaIds: string[];
    size: number;
    label: string;
    /** 该社区里是否存在冲突图式。 */
    hasConflict: boolean;
}
export interface GraphStats {
    schemas: number;
    observations: number;
    edges: number;
    communities: number;
    assimilations: number;
    accommodations: number;
    conflicts: number;
    /** isConflict = true 的图式数量。 */
    dissonantSchemas: number;
}
export declare class SchemaGraphManager {
    private readonly schemas;
    private readonly edges;
    private readonly observations;
    private readonly clock;
    private readonly assimilateThreshold;
    private readonly overlapThreshold;
    private readonly communityThreshold;
    private readonly maxClusterSize;
    private seq;
    private assimilations;
    private accommodations;
    private conflicts;
    /** 子图式 → 父图式。 */
    private readonly parentOf;
    /** 父图式 → 子图式列表。 */
    private readonly childrenOf;
    /** 已构建的层次（level 1..N）。 */
    private hierarchyLevels;
    /** 上次构建层次时的 seq；seq 不变说明没有新建图式，可以跳过重建。 */
    private hierarchyBuiltFor;
    /** 边 → 连接理由（共享词与相似度）。 */
    private readonly linkMeta;
    constructor(options?: SchemaGraphOptions);
    get schemaCount(): number;
    /**
     * 处理一条新观察：能同化就同化，同化不了就顺应。
     * 这是 CAM「增量重叠聚类」的最小闭环。
     */
    ingest(text: string, options?: {
        label?: string;
        at?: number;
    }): IngestOutcome;
    /**
     * 同化：把观察并入图式（含重叠归属），并按成员数做质心增量更新。
     *
     * 若某个待并入的图式与观察极性相反（重叠聚类可能带来这种图式），
     * 不污染它的质心，而是把它标成 isConflict 并返回 cognitiveDissonance。
     */
    assimilate(obs: Observation, schemaId: string, ranked?: RankedSchema[]): IngestOutcome;
    /**
     * 顺应：新建图式节点，并向最相近的旧图式连一条边（CAM 的超图重叠边）。
     * 传入 conflictWith 时，新节点标记为 isConflict 并返回 cognitiveDissonance。
     */
    accommodate(obs: Observation, best?: RankedSchema, conflictWith?: string): IngestOutcome;
    /** 取某条边的连接理由。 */
    linkReason(a: string, b: string): {
        score: number;
        terms: string[];
    } | undefined;
    private linkKey;
    /** 无向加权连边，带类型与叙事说明。 */
    connect(a: string, b: string, weight: number, kind?: EdgeKind, narrative?: string): void;
    neighbors(id: string, minWeight?: number): Array<{
        schemaId: string;
        weight: number;
        kind: EdgeKind;
        narrative: string;
    }>;
    get(id: string): SchemaNode | undefined;
    all(): SchemaNode[];
    observation(id: string): Observation | undefined;
    /** 找出包含这段原文的图式（用于把图式接进召回）。 */
    schemasForText(text: string): string[];
    /** 某个图式下所有成员的原文（去重，保持插入顺序）。 */
    memberTexts(schemaId: string): string[];
    /**
     * 重叠社区：按边权阈值求连通分量，再按 maxClusterSize 切分。
     * 对应 CAM 的 persona-graph 聚类 + `_limit_community_size`。
     */
    communities(): string[][];
    /** 对给定节点集合求重叠社区（连通分量 + 上限切分）。 */
    private communitiesOf;
    /** 社区摘要视图（CAM 的 super graph：每个社区一个摘要节点）。 */
    summarize(): CommunitySummary[];
    stats(): GraphStats;
    /**
     * 构建多级图式层次（对齐 CAM 的 `run_hierarchy`）：
     * level 0 的图式先按社区聚成 level 1 的摘要图式，再对 level 1 继续聚类，
     * 直到社区数不再减少或到达 maxLevel。
     */
    buildHierarchy(maxLevel?: number): Array<{
        level: number;
        schemaIds: string[];
    }>;
    /** 父图式。 */
    parent(id: string): string | undefined;
    /** 子图式列表。 */
    children(id: string): string[];
    /** 已构建的层次快照。 */
    hierarchy(): Array<{
        level: number;
        schemaIds: string[];
    }>;
    /**
     * Personalized PageRank（HippoRAG 的核心检索信号，arXiv:2405.14831）。
     *
     * 以命中图式为种子，在加权图上做幂迭代，把相关度沿边传播出去——
     * 比单纯看余弦相似度更能带出「隔一层但相关」的图式。
     */
    personalizedPageRank(seeds: readonly string[], alpha?: number, iterations?: number): Map<string, number>;
    /**
     * 抽取式代表：挑与图式质心最接近的成员原文（RAPTOR 摘要的零成本替代）。
     */
    representatives(schemaId: string, limit?: number): string[];
    reset(): void;
    private makeObservation;
    private rank;
    private compatible;
    private mergeCentroid;
    private edgeBucket;
}
export interface RankedSchema {
    schemaId: string;
    similarity: number;
}
/** 图式扩展带出的一条关联记忆。 */
export interface RelatedMemory {
    id: string;
    content: string;
    schema: string;
    current: boolean;
}
/**
 * 图式接进召回：对每条命中，找出它所属的图式，把同图式的其他成员记忆带出来。
 * 这是 GraphRAG「用社区扩展检索结果」的最小实现，只做一层，不递归。
 */
export declare function expandBySchema(store: TemporalMemoryStore, graph: SchemaGraphManager, seedContents: readonly string[], limit?: number): RelatedMemory[];
