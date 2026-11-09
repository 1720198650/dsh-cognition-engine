/**
 * src/ambiguity.ts — 开工前的歧义检查
 *
 * ## 为什么需要
 *
 * 依据：arXiv:2604.21505《Clarity Is Not Assumed: Understanding LLM-Based Code Generation
 * under Ambiguous Requirements》——需求歧义会稳定拉低所有模型的产出，**越强的模型掉得越多**；
 * 而且模型**不会主动发现歧义**，会直接挑一种解释往下做。
 *
 * 该文把歧义分四类：词汇（lexical）、句法（syntactic）、语义（semantic）、模糊（vagueness）。
 *
 * ## 这里做什么
 *
 * 只做**规则判定**，不调模型：给出「这个词在需求里缺乏指代对象」这类信号，
 * 然后**只问一个问题**（用户明确反感一次抛三个问题）。
 *
 * 这是"闸门"，不是"理解器"：判出来也可能误报，所以命中只提示「先问一句」，
 * 不阻断任何操作。
 */

export type AmbiguityType = 'lexical' | 'syntactic' | 'semantic' | 'vagueness';

export interface AmbiguityFinding {
  type: AmbiguityType;
  /** 命中的原文片段，便于让人看到"到底哪句话不清楚"。 */
  span: string;
  /** 为什么算歧义。 */
  why: string;
}

export interface AmbiguityReport {
  ambiguous: boolean;
  findings: AmbiguityFinding[];
  /** 只问一个问题；不歧义时为空串。 */
  question: string;
}

/** 指代词：没有先行词的「那个/这个/它」是典型词汇歧义。 */
const DEICTIC = /(?:那个|这个|那些|这些|它|该文件|那块|那份|上一版)/;
/** 模糊量词/程度词。 */
const VAGUE = /(?:优化一下|改进一下|弄好|搞一下|整理一下|差不多|尽量|适当|合理|一些|若干|更好|更清晰)/;
/** 句法歧义：并列项挂靠不明（"A 和 B 的 C"）。 */
const SYNTACTIC = /[\u4e00-\u9fff]{2,}和[\u4e00-\u9fff]{2,}的[\u4e00-\u9fff]{2,}/;
/** 语义歧义：同一动作可指多件事。 */
const SEMANTIC = /(?:更新|修改|调整|处理|修复|对齐)(?:一下)?(?:文档|数据|配置|版本|格式|样式)/;

/** 判断一句话里是否出现指代词但没有任何具体名词作先行词（粗略：没有"的"+名词结构）。 */
function hasUnboundDeictic(text: string): string | undefined {
  const hit = DEICTIC.exec(text);
  if (hit === null) return undefined;
  // 后面紧跟具体名词（如「那个文件」「这份文档」）就不算无先行词
  const tail = text.slice(hit.index + hit[0].length, hit.index + hit[0].length + 6);
  if (/^(?:文件|文档|目录|表|图|段|行|版本|配置|脚本|页面)/.test(tail.trim())) return undefined;
  return hit[0];
}

/**
 * 检查一条需求。纯函数，不依赖任何服务。
 */
export function inspectRequirement(text: string): AmbiguityReport {
  const input = (text ?? '').trim();
  const findings: AmbiguityFinding[] = [];
  if (input.length === 0) {
    return { ambiguous: true, findings: [{ type: 'vagueness', span: '', why: '没有需求内容' }], question: '这次要改的是哪一项？' };
  }

  const deictic = hasUnboundDeictic(input);
  if (deictic !== undefined) {
    findings.push({ type: 'lexical', span: deictic, why: `「${deictic}」没有明确指向哪一份东西` });
  }
  const vague = VAGUE.exec(input);
  if (vague !== null) {
    findings.push({ type: 'vagueness', span: vague[0], why: `「${vague[0]}」没有可验收的标准` });
  }
  const syntactic = SYNTACTIC.exec(input);
  if (syntactic !== null) {
    findings.push({ type: 'syntactic', span: syntactic[0], why: '并列项的修饰关系不清（是 A 和「B 的 C」，还是「A 和 B」的 C）' });
  }
  const semantic = SEMANTIC.exec(input);
  if (semantic !== null && !/(?:README|readme|文件路径|第\s*\d+\s*行)/.test(input)) {
    findings.push({ type: 'semantic', span: semantic[0], why: `「${semantic[0]}」可能指多个动作，范围不明确` });
  }

  const ambiguous = findings.length > 0;
  const question = ambiguous ? buildQuestion(findings) : '';
  return { ambiguous, findings, question };
}

/** 只生成一个问题——把最需要确认的那点问出来，别的等回答再说。 */
function buildQuestion(findings: AmbiguityFinding[]): string {
  const first = findings[0]!;
  switch (first.type) {
    case 'lexical':
      return `「${first.span}」具体指哪一份（给个文件名或路径）？`;
    case 'vagueness':
      return `「${first.span}」达到什么程度算完成？给一条可验收的标准。`;
    case 'syntactic':
      return `这句话里「${first.span}」的修饰关系是哪种？能改成更明确的说法吗？`;
    case 'semantic':
    default:
      return `这次只做「${first.span}」里的哪一件事？其余的要不要一起动？`;
  }
}
