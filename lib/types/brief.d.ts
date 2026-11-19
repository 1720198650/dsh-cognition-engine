export interface BriefFact {
    id: string;
    subject: string;
    content: string;
    importance: number;
    supersededBy?: string | null;
    supersedeReason?: string;
}
export interface BriefRule {
    id: string;
    content: string;
    section?: string;
    boundaryEnvs?: string[];
}
export interface BriefInput {
    task: string;
    facts: readonly BriefFact[];
    rules?: readonly BriefRule[];
    wikiExcerpt?: string;
    /** 完成判定（来自任务本身或用户指定） */
    completion?: string;
    /** 命中的主题名（含别名）。命中主题的事实直接进简报（相关性加权） */
    preferredSubjects?: readonly string[];
    maxFacts?: number;
    maxRules?: number;
    maxChars?: number;
    /**
     * 事实相关性下限，低于它视为"与任务无关"，只按重要度兜底。
     *
     * **0.15 是经验值、没有标定**（audit-evidence.md 判为弱支撑）：
     * 依据只是"低于这个值的多半只共用几个常见字"，没有人工标注扫描支撑。
     */
    minRelevance?: number;
}
export interface BriefResult {
    markdown: string;
    picked: {
        facts: {
            id: string;
            score: number;
        }[];
        rules: {
            id: string;
            score: number;
        }[];
    };
    chars: number;
    notes: string[];
}
export declare function buildTaskBrief(input: BriefInput): BriefResult;
