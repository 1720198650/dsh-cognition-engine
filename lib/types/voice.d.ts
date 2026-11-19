export interface VoiceSample {
    id: string;
    text: string;
    /** 来源平台与外链，便于回查 */
    from: string;
    url?: string;
    /** 点赞数：只作为"有人认可这个说法"的弱信号，不当质量标准 */
    likes: number;
    chars: number;
    addedAt: number;
}
/** 语感样本的字数区间：太短没内容，太长不像说话。 */
export declare const VOICE_MIN_CHARS = 12;
export declare const VOICE_MAX_CHARS = 100;
/** 点赞门槛：0 赞的样本大概率是灌水。 */
export declare const VOICE_MIN_LIKES = 20;
export declare function isVoiceWorthy(text: string, likes: number): {
    ok: boolean;
    reason?: string;
};
export declare class VoiceStore {
    readonly filePath: string;
    private readonly clock;
    private data;
    constructor(options: {
        filePath: string;
        now?: () => number;
    });
    private load;
    private persist;
    /**
     * 收一条样本：先用 isVoiceWorthy 筛，再和已有样本去重（Dice ≥ 0.7 视为重复）。
     *
     * 返回是否收录与原因——被拒的原因要能说出来，不然用户不知道漏掉了什么。
     */
    add(input: {
        text: string;
        from: string;
        url?: string;
        likes: number;
    }): {
        added: boolean;
        reason?: string;
    };
    list(limit?: number): VoiceSample[];
    remove(id: string): boolean;
    stats(): {
        total: number;
        sources: number;
    };
    /**
     * 挑注入样本：赞高优先，但**保证长度和来源有差异**。
     *
     * 全挑长句会让我说话变啰嗦，全挑同一个视频会变成那个圈子的腔调。
     */
    pick(count?: number): VoiceSample[];
    /**
     * 渲染注入段：只给样本，不给"规则"。
     *
     * 写成规则（"说话要短"）就是套话，等于没说；给真句子才是锚。
     */
    render(maxChars?: number, count?: number): string;
}
