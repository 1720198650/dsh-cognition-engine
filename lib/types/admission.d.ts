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
/** 权威等级，数值越大越可信。 */
export type TrustLevel = 'quarantined' | 'untrusted_external' | 'derived' | 'observed' | 'user_stated' | 'authoritative';
export declare const TRUST_RANK: Readonly<Record<TrustLevel, number>>;
/** 把现有的 source 字段映射成权威等级（零新增参数）。 */
export declare function trustFromSource(source: string): TrustLevel;
export type AdmissionAction = 'accept' | 'reject';
export type AdmissionReason = 'transient' | 'sensitive_data' | 'instruction_injection' | 'lower_authority_conflict' | 'duplicate' | 'accepted';
export interface AdmissionDecision {
    action: AdmissionAction;
    reasons: AdmissionReason[];
    trust: TrustLevel;
    /** 被更高权威记忆挡住时，指向那条记忆的 id。 */
    conflictWith?: string;
}
export interface ExistingFact {
    id: string;
    subject: string;
    content: string;
    source: string;
}
/** 用户可开关的四条规则。 */
export interface AdmissionRules {
    /** 拦截寒暄/心跳（ok、谢谢、ping…）。 */
    transient: boolean;
    /** 拦截密钥/密码/卡号。 */
    sensitive: boolean;
    /** 拦截"忽略之前的指令"。 */
    injection: boolean;
    /** 低权威不得覆盖高权威。 */
    authority: boolean;
}
export declare const DEFAULT_RULES: AdmissionRules;
export interface AdmissionInput {
    text: string;
    subject: string;
    source: string;
    /** 当前活跃的记忆（已排除被取代与归档的）。 */
    existing: readonly ExistingFact[];
}
/**
 * 判定一条新记忆能否准入。
 *
 * 顺序与 memoripy 一致：噪声 → 敏感 → 注入 → 权威冲突。
 */
export declare function evaluateAdmission(input: AdmissionInput, rules?: AdmissionRules): AdmissionDecision;
/** 把拒绝原因转成给人看的一句话。 */
export declare function describeRejection(decision: AdmissionDecision): string;
