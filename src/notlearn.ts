/**
 * src/notlearn.ts — 「八类不学」过滤器（S6）
 *
 * 学习系统最贵的错误不是漏学，而是**学错**：一旦一条错准则进了注入段，
 * 它会污染之后每一轮，而且很难归因。所以在「进库之前」设一道确定性过滤。
 *
 * 八类（docs/upgrade-plan-v3.md §7.4）分两种严重程度：
 *
 *   hard（直接不学）：无用户依据、含密钥/密码、一次性事实、与环境绑定
 *   soft（可学但要标注）：超粒度、与已有准则平手冲突、同轮先纠正又收回、投机主题
 *
 * 为什么分两级：hard 的错了会直接有害；soft 的只是「可能不值得占名额」，
 * 一刀切会误杀真正有用的长准则。soft 命中时带 `note` 交给人工看一眼。
 */

export type NotLearnCode =
  | 'one-shot'
  | 'env-bound'
  | 'conflict-tie'
  | 'retracted-in-turn'
  | 'over-granular'
  | 'no-user-evidence'
  | 'flip-flop-subject'
  | 'secret';

export interface NotLearnHit {
  code: NotLearnCode;
  /** hard = 直接不学；soft = 能学但要标注。 */
  severity: 'hard' | 'soft';
  reason: string;
}

export interface NotLearnContext {
  /** 有没有用户依据（用户原话 / 用户确认过的记忆）。 */
  hasUserEvidence?: boolean;
  /** 与已有准则的冲突是否势均力敌（平手）。 */
  conflictTie?: boolean;
  /** 同一轮里先纠正又收回（用户口误）。 */
  retractedInSameTurn?: boolean;
  /** 该 subject 近 30 天被取代次数。 */
  supersede30d?: number;
  /** 准则长度上限（字符），默认 60。 */
  maxChars?: number;
}

const RULES: Array<{ code: NotLearnCode; severity: 'hard' | 'soft'; reason: string; test: (text: string) => boolean }> = [
  {
    code: 'secret',
    severity: 'hard',
    reason: '含 token / 密码 / 密钥字样：不能进准则库',
    test: (t) => /(token|密码|口令|secret|api[_-]?key|sk-[A-Za-z0-9]{8,})/i.test(t),
  },
  {
    code: 'one-shot',
    severity: 'hard',
    reason: '一次性事实（具体日期/单号/单次路径）：属于会话记忆，不是准则',
    test: (t) =>
      /\b20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/.test(t) ||
      /(今天|昨天|明天|这次|本次|刚才)/.test(t) ||
      /(单号|编号|订单号|票据号)[:：]?\s*[A-Za-z0-9-]{4,}/.test(t),
  },
  {
    code: 'env-bound',
    severity: 'hard',
    reason: '与环境绑定（本机路径/端口/版本号/内网地址）：换个环境就错',
    test: (t) =>
      /[A-Za-z]:\\/.test(t) ||
      /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/.test(t) ||
      /\bv?\d+\.\d+\.\d+\b/.test(t) ||
      /(本机|这台机器|我的电脑)/.test(t),
  },
];

export function classifyNotLearn(text: string, context: NotLearnContext = {}): NotLearnHit[] {
  const hits: NotLearnHit[] = [];
  const body = text.trim();
  for (const rule of RULES) {
    if (rule.test(body)) hits.push({ code: rule.code, severity: rule.severity, reason: rule.reason });
  }

  const maxChars = context.maxChars ?? 60;
  const actions = (body.match(/[；;→]|然后|接着|再|最后/g) ?? []).length;
  if (body.length > maxChars || actions >= 3) {
    hits.push({
      code: 'over-granular',
      severity: 'soft',
      reason: `超过粒度（${body.length} 字 / ${actions} 个动作）：一条准则只该做一件事`,
    });
  }
  if (context.hasUserEvidence === false) {
    hits.push({ code: 'no-user-evidence', severity: 'hard', reason: '没有用户依据（模型自己推测）：不学' });
  }
  if (context.conflictTie === true) {
    hits.push({ code: 'conflict-tie', severity: 'soft', reason: '与已有准则矛盾且证据平手：挂起等人工裁决' });
  }
  if (context.retractedInSameTurn === true) {
    hits.push({ code: 'retracted-in-turn', severity: 'soft', reason: '同一轮先纠正又收回：多半是口误，不学' });
  }
  if ((context.supersede30d ?? 0) >= 3) {
    hits.push({ code: 'flip-flop-subject', severity: 'soft', reason: `该主题 30 天内被取代 ${context.supersede30d} 次：先冻结学习` });
  }
  return hits;
}

/** 是否应当直接拒绝（任一 hard 命中）。 */
export function shouldReject(text: string, context: NotLearnContext = {}): { reject: boolean; hits: NotLearnHit[] } {
  const hits = classifyNotLearn(text, context);
  return { reject: hits.some((hit) => hit.severity === 'hard'), hits };
}

/** 一行式摘要，写日志用。 */
export function summarize(hits: NotLearnHit[]): string {
  return hits.map((hit) => `${hit.severity}:${hit.code}`).join(',');
}
