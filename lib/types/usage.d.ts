export interface UsageEntry {
    at: number;
    purpose: string;
    promptChars: number;
    outputChars: number;
    model: string;
}
export declare function recordUsage(filePath: string, entry: UsageEntry): void;
export interface UsageSummary {
    injection: {
        turns: number;
        totalChars: number;
        todayChars: number;
        monthChars: number;
        estTokens: number;
    };
    model: {
        calls: number;
        monthCalls: number;
        todayCalls: number;
        promptChars: number;
        outputChars: number;
        estTokens: number;
        byPurpose: Record<string, number>;
    };
    pricePerMTokens: number;
    /** 估算花费（元），注入 + 输出的粗略合计 */
    estCostYuan: number;
    estTokensPerTurn: number;
}
export declare function summarizeUsage(options: {
    injectionFile: string;
    usageFile: string;
    now?: number;
    pricePerMTokens?: number;
}): UsageSummary;
