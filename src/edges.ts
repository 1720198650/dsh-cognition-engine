/**
 * src/edges.ts — 图式边的类型与纯函数
 *
 * 从 graph.ts 抽出来的原因：边的「类型判定」和「叙事生成」是不依赖任何状态的纯函数，
 * 和 SchemaGraphManager 的图算法（聚类、PPR、层次）不是同一类关注点。
 *
 * 结构参照 memoryweb 的 `Edge{from,to,relationship,narrative}` 与
 * Graphiti 的时序边；类型划分的理论依据见 Kumiho（arXiv:2603.17244）的 typed dependency edges。
 */

/** 图式之间边的语义类型。 */
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

/** 判定边类型需要的最小图式信息（避免 edges.ts 反向依赖 graph.ts）。 */
export interface EdgeEndpoint {
  readonly label: string;
  readonly polarity: number;
}

/**
 * 由现有信号推导边的类型——不需要 LLM。
 *
 * 只有「极性相反」这一条是可靠的：它由分词后的否定词检测而来。
 * 「细化 vs 并列」在二元组粒度上无法可靠区分（实测会把
 * 「四个空格」与「两个空格」误判为细化），因此不做自动推断。
 */
export function classifyEdge(a: EdgeEndpoint, b: EdgeEndpoint): EdgeKind {
  if (Math.sign(a.polarity) !== Math.sign(b.polarity)) return 'contradict';
  return 'support';
}

/** 一句话说明这条边为什么存在。 */
export function narrativeFor(kind: EdgeKind, a: EdgeEndpoint, b: EdgeEndpoint): string {
  const left = a.label.slice(0, 24);
  const right = b.label.slice(0, 24);
  switch (kind) {
    case 'contradict':
      return `「${left}」与「${right}」主题相近但结论相反`;
    case 'refine':
      return `「${left}」是「${right}」的细化`;
    case 'supersede':
      return `「${left}」取代了「${right}」`;
    default:
      return `「${left}」与「${right}」相互支撑`;
  }
}
