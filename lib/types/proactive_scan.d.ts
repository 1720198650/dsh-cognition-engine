/**
 * src/proactive_scan.ts — 主动闸门接火（S7）
 *
 * ## 现状与目标
 *
 * `src/proactive.ts` 里的 `ProactiveGate` 是**群聊语境**的（冷场 + 点名 + 准入矩阵）。
 * 我们这里是单人长期助手，真正值得主动提的东西不是「该不该插话」，而是
 * **「有几件事你可能忘了，要不要现在处理」**：待办逾期、未解决缺口、
 * 证据链断裂的准则、过期准则。
 *
 * ## 三阶段（默认停在 P1）
 *
 *   P1 record-only   只记录「本来会提醒什么」，零主动消息  ← 默认
 *   P2 用户规则      只有用户明确写了规则（如「每天 9 点提醒待办」）才发
 *   P3 学习后放开    采纳率 ≥70% 且样本 ≥20 才允许自主判断
 *
 * **为什么默认 P1 而且门槛这么硬**：主动提醒做错的代价不对称——
 * 漏提醒只是少一次帮助，误提醒是打断注意力、并且会让人开始无视所有提醒。
 * 先证明「我提的你都用得上」，再谈自主。
 *
 * ## 打分
 *
 * 沿用 MaiBot `turn_trigger` 的**逻辑回归形态**（可解释、可手调），
 * 但信号换成我们自己的场景。没有用它的系数——那是在群聊数据上拟合的，
 * 直接搬过来只是把别人的先验当真理。
 */
export type ProactivePhase = 'P1' | 'P2' | 'P3';
/** 扫描输入：都是**可观测的计数**，不做主观判断。 */
export interface ScanInput {
    pendingDue: number;
    unresolvedGaps: number;
    brokenEvidence: number;
    expiredRules: number;
    /** 距上次交互多久（毫秒）。 */
    silenceMs?: number;
}
export type WouldDoKind = 'pending-due' | 'unresolved-gap' | 'broken-evidence' | 'expired-rule';
/**
 * 工单阶段（S10）。
 *
 * 为什么在「三种状态」之外还要阶段：状态只回答「做没做」，
 * 阶段回答「卡在哪、下一步该谁动」。真实的长任务经常停在
 * 「我做完了但你要验一下」——没有 `review` 这一档，它只能被硬塞进
 * `done`，然后没人验，或者一直挂在 `doing` 里假装还在做。
 */
export type TicketStage = 'draft' | 'open' | 'doing' | 'review' | 'done';
/** 阶段到基础状态的映射：状态用于既有列表/筛选，阶段是更细的那一层。 */
export declare const STAGE_TO_STATUS: Readonly<Record<TicketStage, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>>;
export interface WouldDo {
    id: string;
    /** 去重键：同一件事反复扫到只更新不新增。 */
    key: string;
    kind: WouldDoKind;
    at: number;
    lastSeenAt: number;
    /** 见了几次（≥2 说明一直没处理）。 */
    seen: number;
    /** 具体指哪一条（任务/缺口/准则 id）。 */
    targetId: string;
    /** 触发时算出的分。 */
    score: number;
    /** 一句话：本来会提醒什么。 */
    action: string;
    /** 用户需要做什么。 */
    userAction: string;
    /** 用户能得到什么。 */
    benefit: string;
    status: 'pending' | 'adopted' | 'dismissed' | 'stale';
    /** 下线/处理时留下的说明。 */
    note?: string;
    /** 工单阶段。缺省时按 `status` 推测（老数据兼容）。 */
    stage?: TicketStage;
    /** 做完要交什么（产物）：文件路径、一份结论、一个数值。 */
    deliverable?: string;
    /** 为什么做 / 卡在哪（自由文本，几条即可）。 */
    background?: string;
    /** 依赖：这些工单没完成，这条就动不了。 */
    blockedBy?: string[];
    /** 阶段变更历史（谁在什么时候推到哪一步）。 */
    history?: Array<{
        at: number;
        from: TicketStage | null;
        to: TicketStage;
        by: 'user' | 'agent';
        note?: string;
    }>;
    /**
     * 关联到 dsh-superagent 的工单 id。
     *
     * **只做关联，不合并**：两套工单的语义不同（它的是外部授权工单，带 Mandate/Policy；
     * 我们的是本地待办）。合并会让外部工单污染本地待办列表，也会搅乱授权语义。
     */
    linkedTicket?: string;
}
export interface ProactiveDoc {
    schema: 'cognition.proactive';
    version: 1;
    phase: ProactivePhase;
    /** P2 的用户规则（自然语言，由人写）。 */
    rules: Array<{
        id: string;
        text: string;
        createdAt: number;
        active: boolean;
    }>;
    items: WouldDo[];
    stats: {
        adopted: number;
        dismissed: number;
        lastScanAt: number | null;
        lastScore: number | null;
    };
}
export interface ProactiveStoreOptions {
    filePath?: string;
    now?: () => number;
    /** 历史保留多少条。 */
    keep?: number;
}
/**
 * 算分，返回可用于解释的分解。
 *
 * 纯函数：同样的输入永远同样的分，便于事后复盘「当时为什么提醒/没提醒」。
 */
export declare function scoreScan(input: ScanInput): {
    score: number;
    logit: number;
    parts: Record<string, number>;
};
/** 供 scan 生成 wouldDo 的原始条目（由调用方从各存储里取）。 */
export interface ScanSource {
    dueTasks: Array<{
        id: string;
        description: string;
        overdueHours: number;
    }>;
    gaps: Array<{
        id: string;
        text: string;
    }>;
    brokenRules: Array<{
        id: string;
        content: string;
    }>;
    expiredRules: Array<{
        id: string;
        content: string;
    }>;
}
/** 把输入 + 来源转成 wouldDo 草稿（不含入库逻辑，纯函数，便于测试）。 */
export declare function buildWouldDo(source: ScanSource, score: number): Array<Omit<WouldDo, 'id' | 'at' | 'lastSeenAt' | 'seen' | 'status'>>;
export declare class ProactiveStore {
    #private;
    private readonly filePath;
    private readonly clock;
    private readonly keep;
    private doc;
    private loaded;
    private saveError;
    constructor(options?: ProactiveStoreOptions);
    loadSync(): boolean;
    get path(): string;
    get lastSaveError(): string | undefined;
    get document(): ProactiveDoc;
    get phase(): ProactivePhase;
    /**
     * 切阶段。**升级到 P3 有门槛**：采纳率 ≥70% 且样本 ≥20。
     * 降到 P1 随时允许（安全方向不该设门槛）。
     */
    setPhase(phase: ProactivePhase): {
        ok: boolean;
        phase: ProactivePhase;
        reason?: string;
    };
    /** 采纳率（adopted / (adopted + dismissed)）；没样本时为 0。 */
    adoptionRate(): number;
    addRule(text: string): {
        ok: boolean;
        id?: string;
        reason?: string;
    };
    removeRule(id: string): boolean;
    /**
     * 记一次扫描结果。
     *
     * 同 key 的条目**只更新不新增**，并把 `seen` 加一——「同一件事被反复扫到」
     * 本身就是最有价值的信息（说明一直没处理）。
     */
    recordScan(source: ScanSource, score: number): WouldDo[];
    /** 明确清掉某一条目标（任务/缺口/准则）对应的待处理提醒。即时联动用。 */
    clearByTarget(targetId: string, reason?: string): number;
    /** 当前待处理的 wouldDo（新的在前）。 */
    pending(): WouldDo[];
    /**
     * 当前工单（不含已下线/已删除）。
     *
     * 与 `pending()` 的区别：`pending()` 是「还没处理的提醒」，
     * 这里返回所有活着的工单（含已推进到 doing/review 的），供工单板按阶段分组。
     */
    tickets(): WouldDo[];
    /**
     * 推进工单阶段。
     *
     * 允许任意跳转（比如直接 `open → done`）：真实的活儿经常一步到位，
     * 强制逐级推进会让人为了走流程多点三次。
     * 但**不允许从 `done` 悄悄改回去**——那要走 `reopen`，留下痕迹。
     */
    setStage(id: string, stage: TicketStage, options?: {
        by?: 'user' | 'agent';
        note?: string;
    }): {
        ok: boolean;
        stage?: TicketStage;
        reason?: string;
        unblocked?: string[];
    };
    /** 补/改工单字段（产物、背景、依赖）。 */
    update(id: string, patch: {
        deliverable?: string;
        background?: string;
        blockedBy?: string[];
    }): boolean;
    /**
     * 关联/取消关联一条外部工单（dsh-superagent 的 Ticket）。
     *
     * `externalId` 传空串或 null 表示取消关联。只存引用，不改状态机、不动阶段——
     * 两套工单各走各的，只在界面上互相指一下。
     */
    linkTicket(id: string, externalId: string | null): boolean;
    /**
     * 标记已采纳。
     *
     * 采纳 = 用户点了「好，我去处理」。这个计数是 P3 的入场券。
     * S10 起顺带推进到 `doing`（「我去处理」= 开始做了）。
     */
    adopt(id: string): boolean;
    /** 标记不需要（也算一次负样本，用来算采纳率）。冷却期内不会再提同一件事。 */
    dismiss(id: string): boolean;
    /** 工单板分组（按阶段），新的在前。 */
    board(): Array<{
        stage: TicketStage;
        label: string;
        items: WouldDo[];
    }>;
    /**
     * 这一轮到底能不能真的发消息。
     *
     * P1 永远不发；P2 只在有启用的用户规则时发；P3 才允许按分数自主。
     */
    canSpeak(score: number, threshold?: number): {
        speak: boolean;
        reason: string;
    };
}
