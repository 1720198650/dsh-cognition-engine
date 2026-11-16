import type { WikiPage, WikiSections, WikiSourceFact, WikiSourceRule, WikiSourceTask } from './wiki.ts';
export type WikiSectionKey = 'stance' | 'avoid' | 'done' | 'open';
export declare const SECTION_ORDER: readonly WikiSectionKey[];
/** 来源事实指纹：内容/取代关系/重要度任一变化，哈希就变。 */
export declare function digestFacts(facts: readonly WikiSourceFact[]): Record<string, string>;
export interface WikiDiff {
    added: string[];
    removed: string[];
    changed: string[];
    total: number;
}
export declare function diffDigest(prev: Record<string, string> | undefined, next: Record<string, string>): WikiDiff;
/** 按固定结构把分节拼成 markdown（与 buildWiki 的格式保持一致）。 */
export declare function renderWikiMarkdown(topicName: string, sections: WikiSections): string;
export interface IncrementalResult {
    changed: boolean;
    page: WikiPage;
    diff: WikiDiff;
    /** 人工改过、这次被跳过的节（需要人确认是否接受新内容）。 */
    suggestions: WikiSectionKey[];
}
/**
 * 增量更新一页。
 *
 * 三条硬规则：
 * 1. **没有变化就不写文件**（changed=false，调用方据此跳过 save，mtime 不变）；
 * 2. **人工改过的节不覆盖**，只进 suggestions；
 * 3. 每次更新后仍检查 1.0× 体积上限。
 */
export declare function updateWikiIncrementally(input: {
    prev: WikiPage | undefined;
    topicId: string;
    topicName: string;
    facts: readonly WikiSourceFact[];
    rules?: readonly WikiSourceRule[];
    tasks?: readonly WikiSourceTask[];
    now?: number;
}): IncrementalResult;
