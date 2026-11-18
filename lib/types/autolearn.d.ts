/**
 * src/autolearn.ts — 「工作 → 你觉得不对 → 反思 → 自动联网学习 → 解决问题」的确定性零件。
 *
 * 这一层只做**不调模型**的部分：把一段纠正/缺口变成检索词、从搜索结果里挑值得抓的、
 * 记录每次自动学习干了什么（可审计、可回滚）。模型调用与抓取在 index.ts 里。
 *
 * 三条硬约束（用户 2026-11-18 定）：
 *   1. 自动联网默认关，面板有开关；
 *   2. 自动修订默认关，且**必须留修改前存档**；
 *   3. 自动学到的东西一律带出处（url + 来源 id），不写"无来源的事实"。
 */
/** 检索词：把用户/缺口的一句话压成 1~2 个能搜的短句。 */
export declare function buildSearchQueries(text: string, maxQueries?: number): string[];
export interface SearchSourceLike {
    url: string;
    title?: string;
    snippet?: string;
    summary?: string;
}
/**
 * 从搜索结果里挑要抓的链接。
 *
 * 只挑 http(s)、跳过明显是聚合页/下载页的 URL；同一域名最多取 1 条，
 * 免得一次自动学习把同一个站抓一堆。按"有没有摘要/标题长度"排序。
 */
export declare function pickSources(sources: readonly SearchSourceLike[], limit?: number, perHost?: number): SearchSourceLike[];
export interface AutoLearnRecord {
    at: number;
    /** 触发原因：correction / gap / manual */
    reason: 'correction' | 'gap' | 'manual';
    query: string;
    /** 实际抓成功并入库的来源 */
    imported: Array<{
        sourceId: string;
        url: string;
        chars: number;
    }>;
    /** 抓失败的地址与原因 */
    failed: Array<{
        url: string;
        reason: string;
    }>;
    /** 这次用的是哪个搜索 provider */
    provider?: string;
}
