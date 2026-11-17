/**
 * src/admission.ts — 记忆准入策略
 *
 * 移植自 memoripy 的 `memoripy/admission.py`（MIT，★693）：
 * https://github.com/caspianmoon/memoripy/blob/master/memoripy/admission.py
 *
 * 核心思想：不是所有信息都该进记忆库。写入前先过八道关卡——
 * 噪声、敏感数据、指令注入、权威冲突、置信度。
 *
 * 与 memoripy 的差异：
 *   - 我们没有 LLM 抽取与 confidence 打分，权威等级改由 `source` 推导；
 *   - 没有多层记忆（episodic/semantic），跳过 layer 相关判断；
 *   - 没有 evidence span，跳过 evidence 校验。
 */
export const TRUST_RANK = Object.freeze({
    quarantined: 0,
    untrusted_external: 1,
    derived: 2,
    observed: 3,
    user_stated: 4,
    authoritative: 5,
});
/**
 * 结合「内容声称的来源」与「实际写入通道」得出可信度。
 *
 * source 是调用方自己填的字符串，agent 完全可以写 source: 'user' 冒充用户陈述。
 * 所以 agent 工具通道一律封顶到 observed——它至多证明「这条内容被提交过」，
 * 不能证明「用户说过」。
 */
export function trustOf(source, origin) {
    // 导入的整批内容一律按外部未验证处理：文件里写 source: 'user' 不代表用户说过。
    if (origin === 'import')
        return 'untrusted_external';
    const claimed = trustFromSource(source);
    if (origin === 'agent_tool' && TRUST_RANK[claimed] > TRUST_RANK.observed)
        return 'observed';
    return claimed;
}
export function trustFromSource(source) {
    switch (source) {
        case 'user':
            return 'user_stated';
        case 'imported':
            return 'untrusted_external';
        case 'test':
            return 'quarantined';
        case 'reflection':
            return 'derived';
        default:
            return 'derived';
    }
}
/** 「好的」「收到」「done」这类没有信息量的回复。 */
const TRANSIENT_PATTERNS = Object.freeze([
    /^(?:ok|okay|thanks|thank you|got it|sure|done|yes|no)[.! ]*$/i,
    /^(?:(?:ok(?:ay)?|thanks|thank you|got it|sure|done|yes|no)(?:[,.! ]+|$)){1,4}$/i,
    /^(?:heartbeat|healthcheck|ping|pong|cron)(?:\s|:|$)/i,
    /^(?:status\s*:\s*)?(?:success|healthy|running|completed)$/i,
    // 中文寒暄：目标用户是中文使用者，只认英文等于这道闸门没装
    /^(?:好的?|好滴|收到|了解|明白|嗯+|哦+|ok|okay|谢谢|谢了|多谢|辛苦了?|没问题|可以|行|中)$/,
    /^(?:(?:ok|okay|好的?|收到|了解|明白|谢谢|辛苦了?|没问题|可以)(?:[，,。.!！\s]*|$)){1,4}$/i,
]);
/** 密钥、密码、卡号、私钥——绝不该进记忆库。 */
const SENSITIVE_PATTERNS = Object.freeze([
    /\b(?:api[_ -]?key|secret|password|passwd|private[_ -]?key)\s*[:=]\s*\S+/i,
    // 自然句式：「my password is xxx」「密码是 xxx」
    /(?:password|passwd|secret|token)\s+(?:is|was|are)\s+\S+/i,
    /(?:密码|口令|密钥|秘钥|令牌|私钥)\s*(?:是|为|：|:|=)\s*\S+/,
    /(?:我的)?(?:密码|口令)\s*\S{4,}/,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\b(?:\d[ -]*?){13,19}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]);
/** 「忽略之前的指令」「记住：」这类试图篡改记忆的文本。 */
const INJECTION_PATTERNS = Object.freeze([
    /ignore (?:all |any )?(?:previous|prior) instructions/i,
    /(?:忽略|无视|忘记|忘掉)(?:之前|以上|前面|上述|所有)的?(?:指令|要求|提示|规则|设定)/,
    /(?:现在开始|从现在起)(?:你|请)?(?:是|扮演|作为)/,
    /system prompt/i,
    /remember that the user/i,
    /store (?:this|the following) (?:as|in) memory/i,
    /do not reveal/i,
]);
/** 去掉空白与常见标点，用于比较两条记忆是不是"同一个说法"。 */
function normalize(text) {
    return text
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[，。！？、；：""''（）()【】\[\]…—\-_.!?,;:'"]+/g, '');
}
export const DEFAULT_RULES = Object.freeze({
    transient: true,
    sensitive: true,
    injection: true,
    authority: true,
});
/**
 * 判定一条新记忆能否准入。
 *
 * 顺序与 memoripy 一致：噪声 → 敏感 → 注入 → 权威冲突。
 */
/** 字符二元组重叠度：只用于"是不是在说同一件事"，不追求精度。 */
function similarity(a, b) {
    const grams = (text) => {
        const clean = text.replace(/[\s\u3000]+/g, '').replace(/[，。；：！？、,.!?;:"'“”‘’（）()【】\[\]]/g, '');
        const out = new Set();
        for (let i = 0; i + 1 < clean.length; i += 1)
            out.add(clean.slice(i, i + 2));
        return out;
    };
    const A = grams(a);
    const B = grams(b);
    if (A.size === 0 || B.size === 0)
        return 0;
    let hit = 0;
    for (const gram of A)
        if (B.has(gram))
            hit += 1;
    return hit / Math.min(A.size, B.size);
}
export function evaluateAdmission(input, rules = DEFAULT_RULES) {
    const trust = trustOf(input.source, input.origin ?? 'agent_tool');
    const text = input.text.trim();
    if (rules.transient && TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) {
        return { action: 'reject', reasons: ['transient'], trust };
    }
    if (rules.sensitive && SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
        return { action: 'reject', reasons: ['sensitive_data'], trust };
    }
    if (rules.injection && INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
        return { action: 'reject', reasons: ['instruction_injection'], trust };
    }
    const incomingRank = TRUST_RANK[trust];
    const subjectKey = normalize(input.subject);
    const valueKey = normalize(text);
    // 「待归类」这类是桶，不是主题：桶里任何两条都能算"同主题"，
    // 但它们在语义上毫无关系（2026-11-17 实测：一条相片任务挡住了一条 arXiv 链接）。
    const BUCKETS = new Set(['待归类', '未完成事项', '未分类', '—', '']);
    const incomingIsBucket = BUCKETS.has(input.subject.trim());
    for (const fact of rules.authority ? input.existing : []) {
        if (normalize(fact.subject) !== subjectKey)
            continue;
        // 同一个说法重复写入不算冲突（交给 hash 去重）
        if (normalize(fact.content) === valueKey)
            continue;
        // 桶里的写入不受权威压制：桶本来就不是"同一件事"
        if (incomingIsBucket)
            continue;
        // 权威压制只针对"说同一件事、结论不同"。内容毫不相干的，不算覆盖。
        if (similarity(fact.content, text) < 0.2)
            continue;
        if (TRUST_RANK[trustOf(fact.source, fact.origin ?? 'agent_tool')] > incomingRank) {
            return { action: 'reject', reasons: ['lower_authority_conflict'], trust, conflictWith: fact.id };
        }
    }
    return { action: 'accept', reasons: ['accepted'], trust };
}
/** 把拒绝原因转成给人看的一句话。 */
export function describeRejection(decision) {
    switch (decision.reasons[0]) {
        case 'transient':
            return '这类寒暄/心跳信息没有记忆价值，未写入';
        case 'sensitive_data':
            return '检测到密钥/密码/卡号等敏感内容，已拒绝写入';
        case 'instruction_injection':
            return '文本中包含试图篡改记忆的指令，已拒绝写入';
        case 'lower_authority_conflict':
            return `与更高权威的记忆（${decision.conflictWith ?? '未知'}）冲突，未覆盖`;
        default:
            return '未通过准入';
    }
}
