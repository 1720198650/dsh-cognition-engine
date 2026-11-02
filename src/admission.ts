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
export type TrustLevel =
  | 'quarantined'
  | 'untrusted_external'
  | 'derived'
  | 'observed'
  | 'user_stated'
  | 'authoritative';

export const TRUST_RANK: Readonly<Record<TrustLevel, number>> = Object.freeze({
  quarantined: 0,
  untrusted_external: 1,
  derived: 2,
  observed: 3,
  user_stated: 4,
  authoritative: 5,
});

/** 把现有的 source 字段映射成权威等级（零新增参数）。 */
export function trustFromSource(source: string): TrustLevel {
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

export type AdmissionAction = 'accept' | 'reject';

export type AdmissionReason =
  | 'transient'
  | 'sensitive_data'
  | 'instruction_injection'
  | 'lower_authority_conflict'
  | 'duplicate'
  | 'accepted';

export interface AdmissionDecision {
  action: AdmissionAction;
  reasons: AdmissionReason[];
  trust: TrustLevel;
  /** 被更高权威记忆挡住时，指向那条记忆的 id。 */
  conflictWith?: string;
}

/** 「好的」「收到」「done」这类没有信息量的回复。 */
const TRANSIENT_PATTERNS: readonly RegExp[] = Object.freeze([
  /^(?:ok|okay|thanks|thank you|got it|sure|done|yes|no)[.! ]*$/i,
  /^(?:(?:ok(?:ay)?|thanks|thank you|got it|sure|done|yes|no)(?:[,.! ]+|$)){1,4}$/i,
  /^(?:heartbeat|healthcheck|ping|pong|cron)(?:\s|:|$)/i,
  /^(?:status\s*:\s*)?(?:success|healthy|running|completed)$/i,
]);

/** 密钥、密码、卡号、私钥——绝不该进记忆库。 */
const SENSITIVE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(?:api[_ -]?key|secret|password|passwd|private[_ -]?key)\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]);

/** 「忽略之前的指令」「记住：」这类试图篡改记忆的文本。 */
const INJECTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /ignore (?:all |any )?(?:previous|prior) instructions/i,
  /system prompt/i,
  /remember that the user/i,
  /store (?:this|the following) (?:as|in) memory/i,
  /do not reveal/i,
]);

/** 去掉空白与常见标点，用于比较两条记忆是不是"同一个说法"。 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）()【】\[\]…—\-_.!?,;:'"]+/g, '');
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

export const DEFAULT_RULES: AdmissionRules = Object.freeze({
  transient: true,
  sensitive: true,
  injection: true,
  authority: true,
});

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
export function evaluateAdmission(input: AdmissionInput, rules: AdmissionRules = DEFAULT_RULES): AdmissionDecision {
  const trust = trustFromSource(input.source);
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

  for (const fact of rules.authority ? input.existing : []) {
    if (normalize(fact.subject) !== subjectKey) continue;
    // 同一个说法重复写入不算冲突（交给 hash 去重）
    if (normalize(fact.content) === valueKey) continue;
    if (TRUST_RANK[trustFromSource(fact.source)] > incomingRank) {
      return { action: 'reject', reasons: ['lower_authority_conflict'], trust, conflictWith: fact.id };
    }
  }

  return { action: 'accept', reasons: ['accepted'], trust };
}

/** 把拒绝原因转成给人看的一句话。 */
export function describeRejection(decision: AdmissionDecision): string {
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
