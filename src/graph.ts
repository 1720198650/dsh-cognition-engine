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

import { cosine, isCurrent, tokenize } from './memory.ts';
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
}

export type IngestMode = 'assimilation' | 'accommodation';

export interface IngestOutcome {
  mode: IngestMode;
  schemaId: string;
  similarity: number;
  /** 本次观察同时落入的图式（重叠聚类）。 */
  matchedSchemaIds: string[];
  createdSchemaId?: string;
  linkedTo?: { schemaId: string; weight: number };
  /** 内容相近但极性相反时，记录它顶撞了哪个图式。 */
  conflictWith?: string;
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

const NEGATIONS = ['不', '没', '无', '非', '未', '别', 'never', 'not', 'no ', "n't", 'without'];

function detectPolarity(text: string): 1 | -1 {
  const lower = text.toLowerCase();
  return NEGATIONS.some((marker) => lower.includes(marker)) ? -1 : 1;
}

export class SchemaGraphManager {
  private readonly schemas = new Map<string, SchemaNode>();
  private readonly edges = new Map<string, Map<string, number>>();
  private readonly observations = new Map<string, Observation>();
  private readonly clock: () => number;
  private readonly assimilateThreshold: number;
  private readonly overlapThreshold: number;
  private readonly communityThreshold: number;
  private readonly maxClusterSize: number;
  private seq = 0;
  private assimilations = 0;
  private accommodations = 0;
  private conflicts = 0;
  /** 子图式 → 父图式。 */
  private readonly parentOf = new Map<string, string>();
  /** 父图式 → 子图式列表。 */
  private readonly childrenOf = new Map<string, string[]>();
  /** 已构建的层次（level 1..N）。 */
  private hierarchyLevels: Array<{ level: number; schemaIds: string[] }> = [];
  /** 上次构建层次时的 seq；seq 不变说明没有新建图式，可以跳过重建。 */
  private hierarchyBuiltFor = -1;

  constructor(options: SchemaGraphOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.assimilateThreshold = options.assimilateThreshold ?? 0.55;
    this.overlapThreshold = options.overlapThreshold ?? 0.42;
    this.communityThreshold = options.communityThreshold ?? 0.3;
    this.maxClusterSize = options.maxClusterSize ?? 8;
  }

  get schemaCount(): number {
    return this.schemas.size;
  }

  /**
   * 处理一条新观察：能同化就同化，同化不了就顺应。
   * 这是 CAM「增量重叠聚类」的最小闭环。
   */
  ingest(text: string, options: { label?: string; at?: number } = {}): IngestOutcome {
    const obs = this.makeObservation(text, options.at);
    const ranked = this.rank(obs);
    const best = ranked[0];

    if (best !== undefined && best.similarity >= this.assimilateThreshold) {
      const schema = this.schemas.get(best.schemaId);
      if (schema !== undefined && this.compatible(obs, schema)) {
        return this.assimilate(obs, best.schemaId, ranked);
      }
      // 相似但极性相反 → 旧图式解释不了，必须顺应，并标为冲突图式。
      const outcome = this.accommodate(obs, best, best.schemaId);
      this.conflicts += 1;
      return outcome;
    }
    return this.accommodate(obs, best);
  }

  /**
   * 同化：把观察并入图式（含重叠归属），并按成员数做质心增量更新。
   *
   * 若某个待并入的图式与观察极性相反（重叠聚类可能带来这种图式），
   * 不污染它的质心，而是把它标成 isConflict 并返回 cognitiveDissonance。
   */
  assimilate(obs: Observation, schemaId: string, ranked?: RankedSchema[]): IngestOutcome {
    const primary = this.schemas.get(schemaId);
    if (primary === undefined) throw new Error(`assimilate: 未知图式 ${schemaId}`);

    const candidates = ranked ?? this.rank(obs);
    const matched = candidates
      .filter((entry) => entry.similarity >= this.overlapThreshold)
      .map((entry) => entry.schemaId);
    if (!matched.includes(schemaId)) matched.unshift(schemaId);

    let cognitiveDissonance = false;
    let conflictWith: string | undefined;

    for (const id of matched) {
      const schema = this.schemas.get(id);
      if (schema === undefined) continue;
      if (!this.compatible(obs, schema)) {
        schema.isConflict = true;
        schema.updatedAt = obs.at;
        cognitiveDissonance = true;
        conflictWith = conflictWith ?? id;
        continue;
      }
      this.mergeCentroid(schema, obs);
    }

    this.assimilations += 1;
    const similarity = candidates.find((entry) => entry.schemaId === schemaId)?.similarity ?? 0;
    return {
      mode: 'assimilation',
      schemaId,
      similarity,
      matchedSchemaIds: matched,
      cognitiveDissonance,
      ...(conflictWith === undefined ? {} : { conflictWith }),
    };
  }

  /**
   * 顺应：新建图式节点，并向最相近的旧图式连一条边（CAM 的超图重叠边）。
   * 传入 conflictWith 时，新节点标记为 isConflict 并返回 cognitiveDissonance。
   */
  accommodate(obs: Observation, best?: RankedSchema, conflictWith?: string): IngestOutcome {
    const id = `schema-${++this.seq}`;
    const label = obs.text.trim().slice(0, 24) || id;
    const schema: SchemaNode = {
      id,
      label,
      createdAt: obs.at,
      updatedAt: obs.at,
      generation: 0,
      centroid: new Map(obs.tokens),
      members: new Set([obs.id]),
      polarity: obs.polarity,
      weight: 1,
      isConflict: conflictWith !== undefined,
    };
    this.schemas.set(id, schema);
    this.edgeBucket(id);

    let linkedTo: { schemaId: string; weight: number } | undefined;
    if (best !== undefined) {
      const weight = Math.max(best.similarity, 0.01);
      this.connect(id, best.schemaId, weight);
      linkedTo = { schemaId: best.schemaId, weight };
    }

    this.accommodations += 1;
    return {
      mode: 'accommodation',
      schemaId: id,
      similarity: best?.similarity ?? 0,
      matchedSchemaIds: [id],
      createdSchemaId: id,
      cognitiveDissonance: conflictWith !== undefined,
      ...(linkedTo === undefined ? {} : { linkedTo }),
      ...(conflictWith === undefined ? {} : { conflictWith }),
    };
  }

  /** 无向加权连边。 */
  connect(a: string, b: string, weight: number): void {
    if (a === b) return;
    const ab = this.edgeBucket(a);
    const ba = this.edgeBucket(b);
    ab.set(b, Math.max(ab.get(b) ?? 0, weight));
    ba.set(a, Math.max(ba.get(a) ?? 0, weight));
  }

  neighbors(id: string, minWeight = 0): Array<{ schemaId: string; weight: number }> {
    const bucket = this.edges.get(id);
    if (bucket === undefined) return [];
    return [...bucket]
      .filter(([, weight]) => weight >= minWeight)
      .map(([schemaId, weight]) => ({ schemaId, weight }))
      .sort((a, b) => b.weight - a.weight);
  }

  get(id: string): SchemaNode | undefined {
    return this.schemas.get(id);
  }

  all(): SchemaNode[] {
    return [...this.schemas.values()];
  }

  observation(id: string): Observation | undefined {
    return this.observations.get(id);
  }

  /** 找出包含这段原文的图式（用于把图式接进召回）。 */
  schemasForText(text: string): string[] {
    const out: string[] = [];
    for (const schema of this.schemas.values()) {
      for (const memberId of schema.members) {
        if (this.observations.get(memberId)?.text === text) {
          out.push(schema.id);
          break;
        }
      }
    }
    return out;
  }

  /** 某个图式下所有成员的原文（去重，保持插入顺序）。 */
  memberTexts(schemaId: string): string[] {
    const schema = this.schemas.get(schemaId);
    if (schema === undefined) return [];
    const texts: string[] = [];
    for (const id of schema.members) {
      const text = this.observations.get(id)?.text;
      if (text !== undefined && !texts.includes(text)) texts.push(text);
    }
    return texts;
  }

  /**
   * 重叠社区：按边权阈值求连通分量，再按 maxClusterSize 切分。
   * 对应 CAM 的 persona-graph 聚类 + `_limit_community_size`。
   */
  communities(): string[][] {
    return this.communitiesOf([...this.schemas.values()].filter((schema) => schema.generation === 0));
  }

  /** 对给定节点集合求重叠社区（连通分量 + 上限切分）。 */
  private communitiesOf(list: SchemaNode[]): string[][] {
    const allowed = new Set(list.map((schema) => schema.id));
    const seen = new Set<string>();
    const groups: string[][] = [];
    for (const node of list) {
      const id = node.id;
      if (seen.has(id)) continue;
      const stack = [id];
      const group: string[] = [];
      seen.add(id);
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) continue;
        group.push(current);
        for (const { schemaId } of this.neighbors(current, this.communityThreshold)) {
          if (allowed.has(schemaId) && !seen.has(schemaId)) {
            seen.add(schemaId);
            stack.push(schemaId);
          }
        }
      }
      group.sort();
      if (group.length <= this.maxClusterSize) {
        groups.push(group);
      } else {
        for (let i = 0; i < group.length; i += this.maxClusterSize) {
          groups.push(group.slice(i, i + this.maxClusterSize));
        }
      }
    }
    return groups;
  }

  /** 社区摘要视图（CAM 的 super graph：每个社区一个摘要节点）。 */
  summarize(): CommunitySummary[] {
    return this.communities().map((schemaIds, index) => {
      const labels = schemaIds
        .map((id) => this.schemas.get(id)?.label ?? id)
        .slice(0, 3)
        .join(' / ');
      const hasConflict = schemaIds.some((id) => this.schemas.get(id)?.isConflict === true);
      return { id: `summary-${index + 1}`, schemaIds, size: schemaIds.length, label: labels, hasConflict };
    });
  }

  stats(): GraphStats {
    let edgeCount = 0;
    for (const bucket of this.edges.values()) edgeCount += bucket.size;
    let dissonantSchemas = 0;
    for (const schema of this.schemas.values()) {
      if (schema.isConflict) dissonantSchemas += 1;
    }
    return {
      schemas: this.schemas.size,
      observations: this.observations.size,
      edges: Math.floor(edgeCount / 2),
      communities: this.communities().length,
      assimilations: this.assimilations,
      accommodations: this.accommodations,
      conflicts: this.conflicts,
      dissonantSchemas,
    };
  }

  /**
   * 构建多级图式层次（对齐 CAM 的 `run_hierarchy`）：
   * level 0 的图式先按社区聚成 level 1 的摘要图式，再对 level 1 继续聚类，
   * 直到社区数不再减少或到达 maxLevel。
   */
  buildHierarchy(maxLevel = 3): Array<{ level: number; schemaIds: string[] }> {
    // 没有新建图式时跳过：父层连边是 O(n²)，不值得每次写记忆都重跑
    if (this.hierarchyBuiltFor === this.seq && this.hierarchyLevels.length > 0) {
      return this.hierarchyLevels;
    }
    this.hierarchyLevels = [];
    let current = [...this.schemas.values()].filter((schema) => schema.generation === 0);
    let level = 0;

    while (level < maxLevel && current.length > 1) {
      const groups = this.communitiesOf(current).filter((group) => group.length >= 2);
      // 没有可合并的社区，或合并后没有变少 → 收敛
      if (groups.length === 0 || groups.length >= current.length) break;

      const parents: SchemaNode[] = [];
      for (const group of groups) {
        const children = group
          .map((id) => this.schemas.get(id))
          .filter((schema): schema is SchemaNode => schema !== undefined);
        if (children.length < 2) continue;

        const members = new Set<string>();
        const centroid = new Map<string, number>();
        for (const child of children) {
          for (const memberId of child.members) members.add(memberId);
          for (const [term, value] of child.centroid) {
            centroid.set(term, (centroid.get(term) ?? 0) + value);
          }
        }
        for (const [term, value] of centroid) centroid.set(term, value / children.length);

        const id = `schema-L${level + 1}-${++this.seq}`;
        const parent: SchemaNode = {
          id,
          label: children.map((child) => child.label).slice(0, 3).join(' / '),
          createdAt: children[0]?.createdAt ?? this.clock(),
          updatedAt: this.clock(),
          generation: level + 1,
          centroid,
          members,
          polarity: children.reduce((sum, child) => sum + Math.sign(child.polarity), 0) || 1,
          weight: children.length,
          isConflict: children.some((child) => child.isConflict),
        };
        this.schemas.set(id, parent);
        this.childrenOf.set(id, children.map((child) => child.id));
        for (const child of children) this.parentOf.set(child.id, id);
        parents.push(parent);
      }

      if (parents.length === 0) break;

      // 父层之间连边：任意两个父图式只要子图式之间有边，就连起来（CAM 的超图非重叠边）
      for (let i = 0; i < parents.length; i += 1) {
        const left = parents[i];
        if (left === undefined) continue;
        const leftChildren = this.childrenOf.get(left.id) ?? [];
        for (let j = i + 1; j < parents.length; j += 1) {
          const right = parents[j];
          if (right === undefined) continue;
          const rightChildren = new Set(this.childrenOf.get(right.id) ?? []);
          const linked = leftChildren.some((childId) =>
            this.neighbors(childId, this.communityThreshold).some((neighbor) =>
              rightChildren.has(neighbor.schemaId),
            ),
          );
          if (linked) this.connect(left.id, right.id, 1);
        }
      }

      this.hierarchyLevels.push({ level: level + 1, schemaIds: parents.map((parent) => parent.id) });
      current = parents;
      level += 1;
    }

    this.hierarchyBuiltFor = this.seq;
    return this.hierarchyLevels;
  }

  /** 父图式。 */
  parent(id: string): string | undefined {
    return this.parentOf.get(id);
  }

  /** 子图式列表。 */
  children(id: string): string[] {
    return this.childrenOf.get(id) ?? [];
  }

  /** 已构建的层次快照。 */
  hierarchy(): Array<{ level: number; schemaIds: string[] }> {
    return this.hierarchyLevels.map((entry) => ({ ...entry, schemaIds: [...entry.schemaIds] }));
  }

  reset(): void {
    this.schemas.clear();
    this.edges.clear();
    this.observations.clear();
    this.parentOf.clear();
    this.childrenOf.clear();
    this.hierarchyLevels = [];
    this.hierarchyBuiltFor = -1;
    this.seq = 0;
    this.assimilations = 0;
    this.accommodations = 0;
    this.conflicts = 0;
  }

  /* ---------------------------------------------------------------- */

  private makeObservation(text: string, at?: number): Observation {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('ingest: text 不能为空');
    const obs: Observation = {
      id: `obs-${this.observations.size + 1}`,
      text: trimmed,
      tokens: tokenize(trimmed),
      polarity: detectPolarity(trimmed),
      at: at ?? this.clock(),
    };
    this.observations.set(obs.id, obs);
    return obs;
  }

  private rank(obs: Observation): RankedSchema[] {
    const ranked: RankedSchema[] = [];
    for (const schema of this.schemas.values()) {
      ranked.push({ schemaId: schema.id, similarity: cosine(obs.tokens, schema.centroid) });
    }
    ranked.sort((a, b) => b.similarity - a.similarity);
    return ranked;
  }

  private compatible(obs: Observation, schema: SchemaNode): boolean {
    // 只有一个成员的图式还没有稳定立场，任何观察都可以同化进去。
    if (schema.members.size < 2) return true;
    return Math.sign(schema.polarity) === Math.sign(obs.polarity);
  }

  private mergeCentroid(schema: SchemaNode, obs: Observation): void {
    const n = schema.members.size;
    for (const [term, value] of obs.tokens) {
      const current = schema.centroid.get(term) ?? 0;
      schema.centroid.set(term, (current * n + value) / (n + 1));
    }
    schema.members.add(obs.id);
    schema.polarity = Math.sign(schema.polarity + obs.polarity) || schema.polarity;
    schema.weight += 1;
    schema.updatedAt = obs.at;
  }

  private edgeBucket(id: string): Map<string, number> {
    const bucket = this.edges.get(id) ?? new Map<string, number>();
    this.edges.set(id, bucket);
    return bucket;
  }
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
export function expandBySchema(
  store: TemporalMemoryStore,
  graph: SchemaGraphManager,
  seedContents: readonly string[],
  limit = 5,
): RelatedMemory[] {
  const out: RelatedMemory[] = [];
  const seen = new Set<string>();
  const all = store.all();
  const now = Date.now();

  for (const content of seedContents) {
    for (const seedSchemaId of graph.schemasForText(content)) {
      // 爬到最高层祖先：层次越高，带出的关联越"宏观"
      let schemaId = seedSchemaId;
      for (let guard = 0; guard < 8; guard += 1) {
        const parent = graph.parent(schemaId);
        if (parent === undefined) break;
        schemaId = parent;
      }
      for (const text of graph.memberTexts(schemaId)) {
        if (text === content) continue;
        const fact = all.find((item) => item.content === text);
        if (fact === undefined || seen.has(fact.id)) continue;
        seen.add(fact.id);
        out.push({ id: fact.id, content: fact.content, schema: schemaId, current: isCurrent(fact, now) });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
