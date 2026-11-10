/**
 * src/playbook.ts — 准则本（Playbook）
 *
 * 把记忆蒸馏成一份常驻上下文的「工作准则」。设计依据：
 *
 *   - ACE (ICLR 2026)：条目是 bullet，带 helpful/harmful 双向计数；
 *     **LLM 只产候选，合并/去重/淘汰由确定性代码做**——这是 delta 优于 rewrite 的根因。
 *   - Dynamic Cheatsheet (EACL 2026)：分节 + 计数；整篇重写会因模型写「...」而逐轮退化，
 *     所以这里条目化存储、单条增删。
 *   - MemGPT/Letta：准则本对应 Core Memory——常驻、短、由调用方维护。
 *
 * 本文件只负责「数据 + 确定性合并 + 渲染」，不调用任何模型。
 */
export declare const PLAYBOOK_SECTIONS: readonly ["约定", "坑", "状态", "未分类"];
export type PlaybookSection = (typeof PLAYBOOK_SECTIONS)[number];
export type PlaybookStatus = 'active' | 'pending' | 'retired' | 'expired';
/** 来源等级：只升不降，agent 不能自封 human。 */
export type PlaybookOrigin = 'human' | 'agent' | 'auto';
/**
 * 使用统计——为什么要把 helpful/harmful 拆开。
 *
 * 调研结论：用户说「不对」时，可能是**准则错**、**模型没用它**、或**理解错需求**。
 * 混在一个 harmful 计数里，检索错误会被记到准则头上，
 * 准则本会因此越用越保守，最后把对的条目也淘汰掉。
 *
 * 所以按「应用 / 应用且好 / 应用且差 / 该用没用 / 用户纠正」分开记，
 * 每次变化都能追到原因。
 */
export interface UsageStats {
    /** 被应用次数（模型点名引用）。 */
    applied: number;
    /** 应用且结果好。**只记外部来源**（用户确认 / 系统判定）。 */
    appliedGood: number;
    /** 应用且结果差（准则可能错）。**只记外部来源**。 */
    appliedBad: number;
    /** 该用而没用（检索/触发条件问题，不是准则错）。 */
    missed: number;
    /** 用户明确纠正。 */
    userCorrected: number;
    /**
     * **模型自报**的「用得好」次数。单独存，绝不参与降级/升级判断。
     *
     * 为什么不合并：把打分权力交给被评的对象，就是在给它刷分的激励。
     * 证据：自评与奖励耦合会诱发 wireheading（arXiv:2511.23092）；
     * 模型自评普遍偏向自己（arXiv:2404.13076）；无参照判官打的是「像不像对」而不是「对不对」
     * （arXiv:2607.05904）。所以自报只作为线索展示，决策只认外部信号。
     */
    selfAppliedGood?: number;
    /** 模型自报的「用得差」次数。同样不参与决策。 */
    selfAppliedBad?: number;
    /** 最近一次变化的说明，便于复盘。 */
    lastTrace?: string;
}
/** 打标的种类。 */
export type UsageKind = keyof Omit<UsageStats, 'lastTrace' | 'selfAppliedGood' | 'selfAppliedBad'>;
/**
 * 打分来源。只有 `user` / `system` 能推动准则升级或降级；
 * `self`（模型自报）只落在 selfApplied* 计数器里。
 */
export type UsageSource = 'user' | 'system' | 'self';
/** 证据链状态。 */
export interface EvidenceState {
    /** 仍然有效的来源记忆 id。 */
    supported: string[];
    /** 已失效的来源记忆 id（被取代 / 删除 / 归档）。 */
    orphaned: string[];
    /** intact=全部有效，weakened=部分失效，orphaned=全部失效。 */
    status: 'intact' | 'weakened' | 'orphaned';
    checkedAt: number;
}
/** 条目的历史版本（revise 时保留，不原地覆盖）。 */
export interface PlaybookHistoryEntry {
    content: string;
    replacedAt: number;
}
export interface PlaybookEntry {
    id: string;
    section: PlaybookSection;
    content: string;
    /** ACE 式双向计数：一个条目既可能被证明有用，也可能误导过。 */
    helpful: number;
    harmful: number;
    /** 来自哪几条记忆（证据链）；手动条目为空。 */
    sourceIds: string[];
    /** 何时生效；null 表示不限。 */
    validFrom: number | null;
    /** 何时失效；null 表示长期有效。P3 才会自动生成。 */
    validTo: number | null;
    status: PlaybookStatus;
    createdAt: number;
    updatedAt: number;
    note: string;
    history: PlaybookHistoryEntry[];
    /** 与哪条准则疑似冲突（入库时检测，人工裁决）。 */
    conflictWith?: string;
    /**
     * 未决冲突组 id。
     *
     * 两条准则互相矛盾、但证据强度差不多时，**不强行选一条**——
     * 都给它们挂同一个组 id，注入时并排呈现，明确标注「存在未决分歧」。
     * 这是 LeAP 的做法：`new ≥ 1.2×old` 才取代，否则两条都 active。
     */
    conflictGroupId?: string;
    /**
     * 墓碑：这条**本来就是错的**，不是被更好的取代。
     *
     * 与 superseded 必须分开记——「被推翻」和「被超越」是两种完全不同的历史。
     */
    tombstone?: {
        revokedAt: number;
        reason: string;
        replacedBy?: string;
    };
    /** 自查：渲染进「开工前自查」清单，要求模型动手前先点名适用项。 */
    guard: boolean;
    /** 拦截：工具调用前校验，违反则直接拒绝执行。需要 trigger + required。 */
    enforce: boolean;
    /** 审计：命中但未拦截时记一次违反，写进审计日志与计数。 */
    audit: boolean;
    /**
     * 拦截/审计的触发条件（正则）。工具名 + 参数 JSON 匹配它才认为「这条准则适用」。
     * 例：`npm\s+publish`。留空则这条的拦截/审计不生效——否则每条准则都会命中所有调用。
     */
    trigger: string;
    /**
     * 适用时「必须满足」的条件（正则）。触发匹配了但它没匹配 → 违反。
     * 例：`--registry`。
     */
    required: string;
    /**
     * 来源等级。
     *
     * - `human`：用户手写或明确确认过
     * - `agent`：模型通过工具写入、但没有人确认
     * - `auto`：蒸馏器自动产出
     *
     * 依据 LeAP/CITE 的四层认识类型：**agent 永远不能自封为 human**，
     * 晋升只能由用户侧触发，且一次一级、不可跳级。
     * 注入时把等级翻译成措辞——human 直接陈述，agent 标「AI 记录，待核实」。
     */
    origin: PlaybookOrigin;
    /**
     * 何时适用（自然语言，如「发布版本时」「改 JS 脚本时」）。
     *
     * forge_dc (NeurIPS 2026) 实测：同一条纠正写成**带触发点的祈使 RULE** 合规 95%，
     * 写成描述性文本只有 55%，且规则方案 token 少约 10 倍。
     * 「带触发点」就是把「什么时候该用它」显式写在条目里。
     *
     * 和下面 trigger（正则，给拦截器机械判定用）不是一回事：
     * when 给人/模型看，trigger 给代码跑。
     */
    when: string;
    /**
     * 归属主题（多对多）。空 = 未归类。
     * 用于「按任务只注入相关准则」——这是主题层对准则本最直接的收益。
     */
    topicIds: string[];
    /**
     * 证据链状态。
     *
     * 依据 Doyle 的 TMS（1979）：**撤回一个信念不是删一条记录**，
     * 而是要让依赖它的下游结论失去支撑。删除源记忆却留下「由它推出的准则」，
     * 准则会变成没有主人的事实——看起来干净了，污染还在。
     *
     * 所以每次源记忆变动都要沿 sourceIds 重算可达性：
     * 只靠已失效前提支撑的准则标 orphaned（不删、不注入），部分失效标 weakened。
     */
    evidence?: EvidenceState;
    /** 分项使用统计（比 helpful/harmful 更细，见 UsageStats 注释）。 */
    usage?: UsageStats;
    /** 累计违反次数。 */
    violations: number;
    /** 最近一次违反时间；从未违反为 null。 */
    lastViolationAt: number | null;
}
export interface PlaybookFile {
    version: number;
    revision: number;
    updatedAt: number;
    entries: PlaybookEntry[];
}
/** 待合并的候选（由 Reflector/Curator 产生，或人工新增）。 */
export interface PlaybookCandidate {
    section?: string;
    content: string;
    /** 来源等级；蒸馏产出一律 auto，用户手写传 human。 */
    origin?: PlaybookOrigin;
    /** 何时适用（自然语言）。 */
    when?: string;
    sourceIds?: string[];
    validTo?: number | null;
}
export interface MergeOutcome {
    accepted: boolean;
    /** 被接受时是新建条目；命中重复则为空。 */
    entry?: PlaybookEntry;
    reason?: string;
    /** 与哪条已有条目重复。 */
    duplicateOf?: string;
}
export interface PlaybookOptions {
    /** 判断一条来源记忆是否仍然有效（未被取代 / 删除 / 归档）。 */
    isSourceAlive?: (id: string) => boolean;
    filePath?: string;
    now?: () => number;
    /** 注入预算（字符）。默认 700。 */
    maxChars?: number;
    /** 条目数上限。默认 12。 */
    maxEntries?: number;
    /** 每个 section 的条数上限。默认 5。 */
    maxPerSection?: number;
    /**
     * 去重阈值（余弦）。
     *
     * 注意：ACE 报告的 0.90 是**稠密向量**口径，不能直接搬。
     * 我们用字二元组词频余弦，实测标定点：
     *   完全相同 1.000 / 只差几个字 0.759 / 同义改写 0.694
     *   / 意思相同措辞不同 0.522 / 无关 0.000
     * 所以取 0.70——能拦住"只差几个字"和"同义改写"，又不至于把无关条目误判成重复。
     */
    dedupeThreshold?: number;
    /** 校验来源 id 是否真实存在；不提供则跳过校验。 */
    validateSourceIds?: (ids: readonly string[]) => string[];
}
export interface PlaybookStats {
    active: number;
    pending: number;
    retired: number;
    expired: number;
    chars: number;
    /** 带冲突标记的条数。 */
    conflicted: number;
    /** 累计违反次数。 */
    violationsTotal: number;
    /** 勾了自查 / 拦截 / 审计的生效条数。 */
    guarded: number;
    enforced: number;
    audited: number;
    helpfulTotal: number;
    harmfulTotal: number;
}
export declare class PlaybookStore {
    private readonly filePath;
    private readonly snapshotDir;
    private readonly clock;
    private readonly maxChars;
    private readonly maxEntries;
    private readonly maxPerSection;
    private readonly dedupeThreshold;
    private readonly validateSourceIds;
    private readonly isSourceAlive;
    private data;
    private seq;
    constructor(options?: PlaybookOptions);
    get path(): string;
    /** 启动时恢复；文件不存在或损坏都按空准则本启动，绝不阻断插件加载。 */
    loadSync(): boolean;
    load(): Promise<boolean>;
    private restore;
    flush(): Promise<void>;
    private snapshot;
    all(): PlaybookEntry[];
    get(id: string): PlaybookEntry | undefined;
    /** 生效中的条目：status=active 且未被 validTo 判过期。 */
    active(now?: number): PlaybookEntry[];
    pending(): PlaybookEntry[];
    stats(): PlaybookStats;
    isExpired(entry: PlaybookEntry, now?: number): boolean;
    /**
     * 提交一个候选。
     *
     * 这里就是 ACE 说的 "lightweight, non-LLM logic"：
     * 去重、长度、分节、来源、套话全部由代码判定，模型只负责提议。
     */
    submit(candidate: PlaybookCandidate): MergeOutcome;
    /**
     * 冲突检测：同 section + 内容相近 + 一方有否定词。
     *
     * 不做自动裁决——自动合并就是另一种「整篇重写」，会悄悄丢掉差异。
     * 只标记，交给人工在审核界面并排看。
     */
    detectConflict(content: string, section: PlaybookSection): string | undefined;
    /** 已过期的条目（status 仍是 active，但 validTo 已过）。 */
    expired(now?: number): PlaybookEntry[];
    /** 延长有效期（复核后确认继续有效）。 */
    extend(id: string, validTo: number | null): boolean;
    /** 人工直接新增（跳过审核，直接 active）。 */
    /** 用户手写/确认的条目，来源直接记 human。 */
    addManual(input: {
        section?: string;
        content: string;
        validTo?: number | null;
        when?: string;
    }): MergeOutcome;
    /**
     * 接受一条待审准则。
     *
     * 如果它与现有生效准则冲突，这里做**确定性裁决**（LeAP 的 1.2× 规则）：
     *   - 新条证据强度 ≥ 1.2×旧条 → 旧条退场（被更强证据取代）
     *   - 旧条 ≥ 1.2×新条          → 拒绝新条（更弱的证据不能推翻更稳的）
     *   - 差不多                    → **两条都生效**，挂同一个 conflictGroupId，
     *                                 注入时并排显示「存在未决分歧」
     *
     * 最后一种最重要：证据差不多时**不强行选一条**。
     * 强行选会静默丢掉分歧，而分歧本身是有价值的信息。
     */
    accept(id: string): boolean;
    /**
     * 活跃条目上限保护。
     *
     * 准则本的价值随条数**先升后降**：预算固定时条目越多，每条被注入的概率越低，
     * 最后等于什么都没说。调研建议上限 300，超过就按证据强度淘汰最弱的。
     */
    private enforceActiveCap;
    /**
     * 人工标记两条准则冲突。
     *
     * 为什么需要这个：**自然语言的矛盾检测不可靠**。
     * 例：「不可跳步」和「不必执行」都含「不」，否定词启发式会判成同极性。
     * 调研结论是「没有 SPO 就不猜」——所以自动检测只当提示，
     * 真正的冲突由人或模型显式标记，再由 confidence 做确定性裁决。
     */
    markConflict(aId: string, bId: string): boolean;
    /**
     * 手动裁决未决冲突：保留哪一条。
     *
     * 调用方在界面上点了「以这条为准」后调用——人做最终决定，代码只执行。
     */
    resolveConflict(keepId: string, dropId: string, reason?: string): boolean;
    /**
     * 立墓碑：这条本来就错了（不是被更好的取代）。
     *
     * 与 retired 的区别见 tombstone 字段注释——「被推翻」和「被超越」是两种历史。
     */
    revoke(id: string, reason: string): boolean;
    reject(id: string): boolean;
    /**
     * 永久删除一条准则（任意状态）。
     *
     * 和 retire 的区别：停用是「不再注入但留着记录」，删除是「当它没存在过」。
     * 删除前 flush() 会先留快照，所以还能从 .snapshots/ 找回来。
     */
    remove(id: string): boolean;
    retire(id: string, reason?: string): boolean;
    revive(id: string): boolean;
    /** 编辑条目：旧内容进 history，不原地丢弃。 */
    revise(id: string, content: string): boolean;
    /** 记录一次使用反馈（ACE 的双向计数）。 */
    mark(id: string, kind: 'helpful' | 'harmful', amount?: number): boolean;
    /**
     * 设置某条准则的三道约束开关。
     *
     * 默认全关：准则本身就是给模型的提醒，强制是例外而非常态。
     */
    setFlags(id: string, flags: {
        guard?: boolean;
        enforce?: boolean;
        audit?: boolean;
        trigger?: string;
        required?: string;
        when?: string;
    }): boolean;
    /**
     * 重算所有条目的证据链状态。
     *
     * 源记忆被取代 / 删除 / 归档后调用。复杂度 O(条款数 × 来源数)，几百条无压力。
     * 返回状态有变化的条目 id。
     */
    recheckEvidence(now?: number): string[];
    /**
     * 条目的有效分值——注入排序用。
     *
     * 依据：
     * - ACE / ExpeL：**计数来自实际使用结果**，不是手填
     * - ReasoningBank：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感
     *   → 所以样本不足时不给强判断，用 Beta 先验收缩
     * - TMS：证据链断裂的条目要沉下去
     */
    effectiveScore(entry: PlaybookEntry): number;
    /**
     * 分项打标。
     *
     * 只有 appliedGood / appliedBad / userCorrected 会影响降级判断——
     * missed 记的是检索问题，不该算到准则头上。
     */
    markUsage(id: string, kind: UsageKind, trace?: string, source?: UsageSource): boolean;
    /**
     * 是否受证据门控保护。
     *
     * 判据只有两条，都可代码判定（不让模型自评）：
     *   1. 来源是用户（origin === 'human'）——人说过的话不该被统计噪声推翻；
     *   2. 证据链完好或没有证据链（undefined 视为未建立，不惩罚）。
     * 证据链已 weakened / orphaned 的**不**保护——它的支撑确实没了。
     */
    isEvidenceProtected(entry: PlaybookEntry): boolean;
    /**
     * 证据强度（confidence）——冲突裁决的依据。
     *
     * 由**代码算**，不让模型自报（LeAP：层级由代码控制，而非模型输出）。
     *
     * 设计原则：**已验证 > 未验证，而不是新 > 旧**（AGM / veritas 的核心立场）。
     *   human + 证据完好 = 1.0（用户确认过，最高）
     *   agent（AI 记录、人确认过）= 0.6
     *   auto（模型自产）= 0.4
     * 证据链部分失效 ×0.7，完全失效 ×0.2。
     */
    confidenceOf(entry: PlaybookEntry): number;
    /**
     * 用时可复用等级（SEU：selective experience use）。
     *
     * 依据 PATH-Bench：检索到的经验**在使用时逐条判断**怎么用——
     * preserve（可直接复用）/ abstract（只取高层模式）/ ignore（忽略），
     * 这一层判断让 FGT 最多降 16.84pp，且不动记忆库本身，是最便宜的抗负迁移。
     *
     * 我们的三档：
     *   reusable  证据完好 + 用户确认 → 可以直接套用
     *   reference 来源是 AI 或样本不足 → 只借鉴思路，别当铁律
     *   doubtful  证据部分失效 / 未决冲突 / 实测差评 → 提出来时标明不确定
     */
    usageHint(entry: PlaybookEntry): 'reusable' | 'reference' | 'doubtful';
    /** 设置证据来源（sourceIds），调用方随后应重算证据链。 */
    setSourceIds(id: string, sourceIds: string[]): boolean;
    /** 设置归属主题（多对多，空数组 = 未归类）。 */
    setTopics(id: string, topicIds: string[]): boolean;
    /** 记一次违反。 */
    recordViolation(id: string, now?: number): boolean;
    /**
     * 校验一次工具调用。
     *
     * 规则：`trigger` 匹配「工具名 + 参数 JSON」→ 这条准则适用；
     * 适用时 `required` 必须也匹配，否则算违反。
     * 只有 `trigger` 非空的条目参与判定——否则每条准则都会命中所有调用。
     *
     * 纯函数，不写盘：调用方决定是拒绝（enforce）还是只记录（audit）。
     */
    checkToolCall(text: string): {
        blocked: PlaybookEntry[];
        violated: PlaybookEntry[];
    };
    /**
     * 自查清单：勾了「自查」的条目会渲染到注入文本最前面。
     *
     * 内容很少（通常一两条），目的是让模型在动手前显式确认，而不是把长清单塞进上下文。
     */
    renderSelfCheck(now?: number): string;
    /**
     * 渲染成注入文本。
     *
     * 格式照 ACE：`[ctxt-00001] helpful=2 harmful=0 :: 正文`——
     * 模型可以点名引用，我们才能回写计数。
     */
    /**
     * 渲染成注入文本。
     *
     * 分组优先级：**有主题就按主题分组**，没主题退回按 section（约定/坑/状态）。
     *
     * 为什么按主题：调研发现业界主流是「主题路由 + 主题摘要注入」。
     * 按主题分组后，模型能先判断当前任务属于哪个主题，只采用相关准则——
     * 而不是 12 条准则不分场合全塞进来。
     *
     * @param topicName 把 topicId 解析成显示名的回调；不传则按 section 分组。
     */
    render(now?: number, budget?: number, topicName?: (id: string) => string | undefined): string;
    /**
     * 同 render，但额外返回被预算挤掉的条数。
     *
     * 低分条目（helpful−harmful×2 靠后）在预算紧张时会被静默丢弃——
     * 调用方据此在注入文本里补一句「另有 N 条省略」，避免用户以为准则丢了。
     */
    renderDetailed(now?: number, budget?: number, topicName?: (id: string) => string | undefined, filter?: (entry: PlaybookEntry) => boolean): {
        text: string;
        omitted: number;
        ruleIds: string[];
    };
    /**
     * 把渲染结果包成可注入的段落；空准则本返回空串，由调用方回退 digest。
     *
     * **maxChars 是整段的总预算**，不是正文预算——自查块、标题、尾注都要先扣掉，
     * 否则总长度会超（实测过 619 > 600）。正文按剩余额度渲染。
     */
    /**
     * 索引模式：只输出「id + 一句话摘要」，正文留给 cognition_recall 取。
     *
     * 依据：Anthropic《The components of agent memory》——注入层只放索引
     * （Claude Code 只加载 MEMORY.md 前 200 行 / 25 KB），正文放在下层按需读。
     * 好处是注入 token 大幅下降；代价是多一步工具调用，所以默认关闭，等实测再定。
     */
    renderIndexOnly(now?: number, topicName?: (id: string) => string | undefined): string;
    renderSection(now?: number, topicName?: (id: string) => string | undefined, filter?: (entry: PlaybookEntry) => boolean): string;
    private entryRef;
    private nextId;
    private markActive;
    private markRetired;
    /** 打分最低的 active 条目（helpful − harmful×2，同分取最旧）。 */
    private worstEntry;
}
