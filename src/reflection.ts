/**
 * src/reflection.ts — DialecticalReflectionEngine
 *
 * 三段式辩证反思，Prompt 编排对齐 Hegelion（Hmbown/Hegelion）的
 * `hegelion/core/prompt_dialectic.py` 与 `hegelion/mcp/handlers/dialectic.py`：
 *
 *   THESIS      → 给出初始立场，要求承认不确定性
 *   ANTITHESIS  → 拿到 thesis 后做对抗性批判，按 `CONTRADICTION:` / `EVIDENCE:` 成对输出
 *   SYNTHESIS   → 同时拿到 thesis 与 antithesis，要求「超越两者」，并明确禁止
 *                 「thesis 对」「antithesis 对」「两者都有道理」这三种偷懒答案
 *
 * 三次调用严格串行：后一次调用的入参来自前一次的输出，绝不并发。
 * `callLLM` 由外部注入，测试与离线场景使用 `MockDialecticalLLM`。
 */

export type DialecticalPhase = 'thesis' | 'antithesis' | 'synthesis';

export type CallLLM = (prompt: string, phase: DialecticalPhase) => string | Promise<string>;

export interface Contradiction {
  description: string;
  evidence: string;
}

export interface DialecticalCall {
  phase: DialecticalPhase;
  prompt: string;
  output: string;
  startedAt: number;
  finishedAt: number;
}

export interface DialecticalResult {
  query: string;
  thesis: string;
  antithesis: string;
  contradictions: Contradiction[];
  synthesis: string;
  calls: DialecticalCall[];
  durationMs: number;
  /**
   * 结果的可信度标记。
   *
   * - `synthesized`：反题里至少给出了一条 CONTRADICTION/EVIDENCE 对，合题建立在它上面。
   * - `no-contradiction`：反题**没找到任何具体矛盾**。此时不产出合题，因为
   *   「没找到矛盾」不等于「没有问题」——它也可能只是模型自洽地走过场。
   *
   * 依据：LLM 自评普遍偏正面，"judged itself correct every time" 是已知失效模式
   * （arXiv:2607.28576 里 Reflexion 在小模型上从未触发过一次重试）；
   * 而「检测到矛盾」才能推出「至少一方错」，「没检测到」什么都证明不了
   * （Consistency Is Not Correctness, 2026）。所以这里 fail-closed。
   */
  verdict: 'synthesized' | 'no-contradiction';
  /** 给调用方看的一句话说明（verdict 为 no-contradiction 时必填）。 */
  note?: string;
}

export interface ReflectionOptions {
  now?: () => number;
  /** 传给 synthesis 的批判原文上限，避免 prompt 无限膨胀。 */
  maxAntithesisChars?: number;
  /**
   * 反题没给出任何 CONTRADICTION/EVIDENCE 对时，是否跳过合题（默认 true）。
   *
   * 关掉它 = 允许「零矛盾的批判」也能产出合题，等于把「结构走完」当成「认知发生」，
   * 而证据表明这两件事经常不是一回事。只有明确知道自己要什么时才关。
   */
  failClosedOnNoContradiction?: boolean;
}

/* ------------------------------------------------------------------ */
/* Prompt 模板                                                         */
/* ------------------------------------------------------------------ */

export function buildThesisPrompt(query: string): string {
  return `You are in the THESIS phase of Hegelian dialectical reasoning.

QUERY: ${query}

Your task:
1. Provide a comprehensive, well-reasoned initial position on this query
2. Consider multiple perspectives and build a strong foundational argument
3. Be thorough but clear in your reasoning
4. Acknowledge uncertainty where appropriate
5. Think carefully before responding, then present a polished thesis

Generate your THESIS response now.`;
}

export function buildAntithesisPrompt(query: string, thesis: string): string {
  return `You are in the ANTITHESIS phase of Hegelian dialectical reasoning.

ORIGINAL QUERY: ${query}

THESIS TO CRITIQUE: ${thesis}

Your task as the critical voice:
1. Find contradictions, inconsistencies, or logical gaps in the thesis
2. Identify unexamined assumptions and hidden premises
3. Propose alternative framings that challenge the thesis
4. Find edge cases or scenarios where the thesis breaks down
5. Be adversarial but intellectually honest

For each significant problem you identify, use this EXACT format:
CONTRADICTION: [brief description]
EVIDENCE: [detailed explanation of why this is problematic]

// 语言化采样（Verbalized Sampling, arXiv:2510.01171）：先给 3 条候选批判并各自标概率，\n// 再取概率最高的那条展开。免训练、成本只多一点，但能明显减少「只挑最顺的一种反驳」。\nStep 1: list 3 candidate critiques, each with its own stated probability, in the form 1) [critique] — p=0.xx.\nStep 2: take the highest-probability one and expand it into the CONTRADICTION/EVIDENCE pairs below.\nDo not include the candidate list in your final answer.`;
}

export function buildSynthesisPrompt(
  query: string,
  thesis: string,
  antithesis: string,
  contradictions: readonly Contradiction[] = [],
): string {
  const contradictionsText =
    contradictions.length === 0
      ? ''
      : `\nIDENTIFIED CONTRADICTIONS:\n${contradictions
          .map((item) => `- ${item.description}`)
          .join('\n')}\n`;

  return `You are in the SYNTHESIS phase of Hegelian dialectical reasoning.

ORIGINAL QUERY: ${query}

THESIS: ${thesis}

ANTITHESIS (critique): ${antithesis}
${contradictionsText}
Your task:
1. Generate a SYNTHESIS that TRANSCENDS both thesis and antithesis
2. Resolve or reframe the contradictions by finding a higher-level perspective
3. Make predictions that NEITHER thesis nor antithesis would make alone
4. Ensure your synthesis is testable or falsifiable when possible

Requirements for a valid SYNTHESIS:
- Must not simply say "the thesis is right" or "the antithesis is right"
- Must not just say "both have merit"
- Must offer a genuinely novel perspective
- Should be more sophisticated than either original position

Generate your SYNTHESIS now.`;
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

/** 从 antithesis 文本里抽出 `CONTRADICTION:` / `EVIDENCE:` 成对结构。 */
export function extractContradictions(text: string): Contradiction[] {
  const lines = text.split(/\r?\n/);
  const out: Contradiction[] = [];
  let pending: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const contradictionMatch = /^CONTRADICTION\s*[:：]\s*(.+)$/i.exec(line);
    if (contradictionMatch !== null) {
      if (pending !== null) out.push({ description: pending, evidence: '' });
      pending = contradictionMatch[1]?.trim() ?? '';
      continue;
    }
    const evidenceMatch = /^EVIDENCE\s*[:：]\s*(.+)$/i.exec(line);
    if (evidenceMatch !== null) {
      const evidence = evidenceMatch[1]?.trim() ?? '';
      if (pending !== null) {
        out.push({ description: pending, evidence });
        pending = null;
      } else {
        out.push({ description: '(未命名的矛盾)', evidence });
      }
    }
  }
  if (pending !== null) out.push({ description: pending, evidence: '' });
  return out;
}

/* ------------------------------------------------------------------ */
/* JSON 输出契约（对齐 Hegelion 的 response_style = 'json'）            */
/* ------------------------------------------------------------------ */

const JSON_CONTRACTS: Readonly<Record<DialecticalPhase, string>> = Object.freeze({
  thesis: `OUTPUT FORMAT (JSON ONLY):
Return ONLY a JSON object:
{"phase":"thesis","thesis":"...","assumptions":["..."],"uncertainties":["..."]}
No markdown, no commentary outside the JSON.` + '\n\n用与 QUERY 相同的语言回答。',
  antithesis: `OUTPUT FORMAT (JSON ONLY):
Return ONLY a JSON object:
{"phase":"antithesis","antithesis":"...","contradictions":[{"description":"...","evidence":"..."}]}

REQUIREMENTS:
- "contradictions" MUST contain at least 2 entries. An empty array is a failed answer.
- Each entry needs a concrete "description" and a supporting "evidence".
- Do not put the critique only in "antithesis" and leave "contradictions" empty.
- No markdown, no commentary outside the JSON.` + '\n\n用与 QUERY 相同的语言回答。',
  synthesis: `OUTPUT FORMAT (JSON ONLY):
Return ONLY a JSON object:
{"phase":"synthesis","synthesis":"...","research_proposals":[{"proposal":"...","testable_prediction":"..."}]}
No markdown, no commentary outside the JSON.` + '\n\n用与 QUERY 相同的语言回答。',
});

/** 给提示词追加 JSON 输出契约。 */
export function withJsonContract(prompt: string, phase: DialecticalPhase): string {
  return `${prompt}\n\n${JSON_CONTRACTS[phase]}`;
}

/** 去掉 ```json 围栏后尝试解析；失败返回 null。 */
export function tryParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 从 JSON 输出里取某个字符串字段；不是 JSON 就原样返回。 */
export function unwrapField(text: string, field: string): string {
  const parsed = tryParseJson(text);
  const value = parsed?.[field];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();

  // JSON 被截断（超出 maxTokens）时解析会失败，此时用正则把字段抢救出来，
  // 否则调用方拿到的是一整段 {"phase":"synthesis",...} 原文。
  const rescued = rescueField(text, field);
  if (rescued !== undefined) return rescued;

  return text.trim();
}

/** 从残缺 JSON 里尽量取出一个字符串字段（允许未闭合）。 */
function rescueField(text: string, field: string): string | undefined {
  const marker = '"' + field + '"';
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  const colon = text.indexOf(':', at + marker.length);
  if (colon < 0) return undefined;
  const quote = text.indexOf('"', colon + 1);
  if (quote < 0) return undefined;

  let out = '';
  for (let i = quote + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next !== undefined) out += next;
      i += 1;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 解析 antithesis：优先 JSON 的 contradictions 数组，回退到文本格式。 */
/**
 * 从 markdown / 编号列表里抽矛盾条目。
 *
 * 模型经常把批判写成「1. xxx」「- xxx」列表而不是 CONTRADICTION:/EVIDENCE: 对，
 * 只认后者会让 contradictions 恒为空数组——反方阶段等于白跑。
 */
export function extractListContradictions(text: string): Contradiction[] {
  const lines = text.split(/\r?\n/);
  const out: Contradiction[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const match = line.match(/^(?:\d+[.、)]|[-*•])\s+(.{8,})$/);
    if (match === null) continue;
    const body = (match[1] ?? '').trim();
    if (body.length === 0) continue;
    // 拆成「问题 / 理由」：优先按「：」或「——」分
    const split = body.split(/[：:]|——/);
    const description = (split[0] ?? '').trim();
    const evidence = split.slice(1).join('：').trim() || body;
    if (description.length >= 4) out.push({ description, evidence });
  }
  return out;
}

export function parseAntithesis(text: string): { text: string; contradictions: Contradiction[] } {
  const parsed = tryParseJson(text);
  const list = parsed?.['contradictions'];
  if (Array.isArray(list)) {
    const contradictions = list
      .map((item) => {
        const record = item as { description?: unknown; evidence?: unknown };
        return {
          description: String(record?.description ?? '').trim(),
          evidence: String(record?.evidence ?? '').trim(),
        };
      })
      .filter((item) => item.description.length > 0);
    if (contradictions.length > 0) {
      const body = parsed?.['antithesis'];
      return {
        text: typeof body === 'string' && body.trim().length > 0 ? body.trim() : text.trim(),
        contradictions,
      };
    }
  }
  // 模型把内容都写进 antithesis 字段、contradictions 留空时，
  // 原来的回退会拿整段 JSON 原文去找 "CONTRADICTION:" 文本，必然找不到。
  // 这里先取出正文，再从正文里抽矛盾。
  const body = parsed?.['antithesis'];
  const bodyText = typeof body === 'string' && body.trim().length > 0 ? body.trim() : text.trim();
  const fromBody = extractContradictions(bodyText);
  if (fromBody.length > 0) return { text: bodyText, contradictions: fromBody };
  const fromList = extractListContradictions(bodyText);
  if (fromList.length > 0) return { text: bodyText, contradictions: fromList };
  if (bodyText !== text.trim()) {
    const fromRaw = extractContradictions(text);
    if (fromRaw.length > 0) return { text: bodyText, contradictions: fromRaw };
  }
  return { text: bodyText, contradictions: [] };
}

/* ------------------------------------------------------------------ */
/* 引擎                                                                */
/* ------------------------------------------------------------------ */

export class DialecticalReflectionEngine {
  private readonly callLLM: CallLLM;
  private readonly clock: () => number;
  private readonly maxAntithesisChars: number;
  /** 零矛盾时是否跳过合题（fail-closed）。 */
  private readonly failClosedOnNoContradiction: boolean;
  /** 结果缓存：同样的 query + draft 不重复调用模型。 */
  private readonly cache = new Map<string, DialecticalResult>();

  constructor(callLLM: CallLLM, options: ReflectionOptions = {}) {
    this.callLLM = callLLM;
    this.clock = options.now ?? (() => Date.now());
    this.maxAntithesisChars = options.maxAntithesisChars ?? 4000;
    this.failClosedOnNoContradiction = options.failClosedOnNoContradiction !== false;
  }

  /**
   * 串行执行 thesis → antithesis → synthesis。
   * 任何一次返回空串都会抛错，因为空输出会让下一次调用的入参失去意义。
   */
  async reflect(query: string): Promise<DialecticalResult> {
    return this.run(query, false);
  }

  /**
   * 把「已有的回答」接进反思：草稿直接当 thesis，跳过第一步生成，
   * 只做对抗性批评与合成。省一次调用，也让真正要发出去的内容被审一遍。
   */
  async reflectDraft(query: string, draft: string): Promise<DialecticalResult> {
    return this.run(query, false, draft);
  }

  /**
   * Worker 异步隔离版：每一段都用 setTimeout 让出事件循环，
   * 把三次串行调用排到后台宏任务里跑，调用方（主线程）不会被占住。
   */
  async reflectInBackground(query: string): Promise<DialecticalResult> {
    return this.run(query, true);
  }

  private async run(query: string, background: boolean, seed?: string): Promise<DialecticalResult> {
    const trimmed = query.trim();
    if (trimmed.length === 0) throw new Error('reflect: query 不能为空');

    const startedAt = this.clock();
    const calls: DialecticalCall[] = [];

    // 命中缓存直接返回（durationMs=0 表示未真正调用模型）
    const cacheKey = `${trimmed}\u0000${seed ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return { ...cached, durationMs: 0 };

    let thesis: string;
    if (seed !== undefined && seed.trim().length > 0) {
      thesis = seed.trim();
      const at = this.clock();
      calls.push({ phase: 'thesis', prompt: '(调用方提供的草稿，跳过生成)', output: thesis, startedAt: at, finishedAt: at });
    } else {
      const rawThesis = await this.step(
        'thesis',
        withJsonContract(buildThesisPrompt(trimmed), 'thesis'),
        calls,
        background,
      );
      thesis = unwrapField(rawThesis, 'thesis');
    }

    const rawAntithesis = await this.step(
      'antithesis',
      withJsonContract(buildAntithesisPrompt(trimmed, thesis), 'antithesis'),
      calls,
      background,
    );
    const parsedAntithesis = parseAntithesis(rawAntithesis);
    const antithesis = parsedAntithesis.text;
    const contradictions = parsedAntithesis.contradictions;
    const clipped =
      antithesis.length > this.maxAntithesisChars
        ? `${antithesis.slice(0, this.maxAntithesisChars)}\n…(truncated)`
        : antithesis;

    // fail-closed：反题没给出任何具体矛盾 → 不产出合题。
    // 理由见 DialecticalResult.verdict 的注释：零矛盾什么都证明不了，
    // 而多调一次 synthesis 只会把「没批判」包装成「已升华」。
    if (contradictions.length === 0 && this.failClosedOnNoContradiction) {
      const result: DialecticalResult = {
        query: trimmed,
        thesis,
        antithesis,
        contradictions,
        synthesis: '',
        calls,
        durationMs: this.clock() - startedAt,
        verdict: 'no-contradiction',
        note:
          '反题没有给出任何 CONTRADICTION/EVIDENCE 对，因此没有产出合题。' +
          '这不代表正题成立，只代表这次批判没有找到具体问题——可能真没问题，' +
          '也可能只是模型在自洽地走过场。要下结论，换一个更具体的问法，' +
          '或补充外部证据（真实结果、日志、用户反馈）后再反思。',
      };
      this.cache.set(cacheKey, result);
      if (this.cache.size > 50) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return result;
    }

    const rawSynthesis = await this.step(
      'synthesis',
      withJsonContract(buildSynthesisPrompt(trimmed, thesis, clipped, contradictions), 'synthesis'),
      calls,
      background,
    );
    const synthesis = unwrapField(rawSynthesis, 'synthesis');

    const result: DialecticalResult = {
      query: trimmed,
      thesis,
      antithesis,
      contradictions,
      synthesis,
      calls,
      durationMs: this.clock() - startedAt,
      verdict: 'synthesized',
    };

    this.cache.set(cacheKey, result);
    if (this.cache.size > 50) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    return result;
  }

  /** 三段结果的纯文本报告。 */
  renderTranscript(result: DialecticalResult): string {
    const lines: string[] = [];
    lines.push(`# 辩证反思：${result.query}`);
    lines.push('');
    lines.push('## THESIS');
    lines.push(result.thesis.trim());
    lines.push('');
    lines.push('## ANTITHESIS');
    lines.push(result.antithesis.trim());
    lines.push('');
    lines.push(`## 矛盾（${result.contradictions.length} 条）`);
    for (const item of result.contradictions) {
      lines.push(`- ${item.description}`);
      if (item.evidence.length > 0) lines.push(`  证据：${item.evidence}`);
    }
    lines.push('');
    lines.push('## SYNTHESIS');
    if (result.verdict === 'no-contradiction') {
      lines.push('（未产出合题）');
      if (result.note !== undefined) lines.push(result.note);
      return lines.join('\n');
    }
    lines.push(result.synthesis.trim());
    return lines.join('\n');
  }

  private async step(
    phase: DialecticalPhase,
    prompt: string,
    calls: DialecticalCall[],
    background: boolean,
  ): Promise<string> {
    if (background) await yieldToEventLoop();
    const startedAt = this.clock();
    const output = await this.callLLM(prompt, phase);
    if (background) await yieldToEventLoop();
    const finishedAt = this.clock();
    const text = typeof output === 'string' ? output.trim() : '';
    if (text.length === 0) throw new Error(`reflect: ${phase} 阶段返回空内容`);
    calls.push({ phase, prompt, output: text, startedAt, finishedAt });
    return text;
  }
}

/* ------------------------------------------------------------------ */
/* Mock LLM                                                            */
/* ------------------------------------------------------------------ */

/**
 * 确定性的 Mock 模型：不联网、不随机，但严格按 Hegelion 的输出格式作答，
 * 因此可以用来验证「三次串行 + 上一段输出喂给下一段」这条链路本身。
 */
export class MockDialecticalLLM {
  private readonly calls: DialecticalPhase[] = [];

  /** 记录调用顺序，测试用来断言串行性。 */
  get callOrder(): readonly DialecticalPhase[] {
    return this.calls;
  }

  reset(): void {
    this.calls.length = 0;
  }

  readonly call: CallLLM = (prompt, phase) => {
    this.calls.push(phase);
    switch (phase) {
      case 'thesis': {
        const query = matchSection(prompt, 'QUERY:') ?? '(未知问题)';
        return [
          `THESIS: 关于「${query}」，主张先建立最小可行方案再迭代。`,
          '1. 先锁定可验证的边界条件。',
          '2. 用可回滚的小步试错替代一次性大改。',
          '3. 承认在长周期场景下证据仍然不足。',
        ].join('\n');
      }
      case 'antithesis': {
        const thesis = matchSection(prompt, 'THESIS TO CRITIQUE:') ?? '';
        const keyword = thesis.split(/[，。；\s]/).filter((part) => part.length > 0)[1] ?? '该主张';
        return [
          `CONTRADICTION: 「${keyword}」被当成前提而非结论`,
          'EVIDENCE: 该前提在需求剧烈变化时会让小步迭代失去方向，回滚成本被低估。',
          '',
          'CONTRADICTION: 证据不足这一点没有被转化为可执行的验证动作',
          'EVIDENCE: 只声明不确定性而不安排验证，等于把风险留给未来。',
        ].join('\n');
      }
      case 'synthesis': {
        const thesis = matchSection(prompt, 'THESIS:') ?? '';
        const antithesis = matchSection(prompt, 'ANTITHESIS (critique):') ?? '';
        // 只数「矛盾清单」那一段，不能把下面 requirements 的条目也算进来。
        const contradictionBlock = matchSection(prompt, 'IDENTIFIED CONTRADICTIONS:') ?? '';
        const count = (contradictionBlock.match(/^- /gm) ?? []).length;
        return [
          'SYNTHESIS: 把「先小步试错」升级为「带方向约束的试错」——',
          `方向来自对 ${count} 条矛盾的持续登记，而不是来自一次性判断。`,
          `它同时保留了 thesis 的节奏（${firstLine(thesis)}）与 antithesis 的警惕（${firstLine(antithesis)}），`,
          '但新增了一个两者都没有的东西：每轮迭代都必须留下可复盘的矛盾清单。',
        ].join('\n');
      }
      default: {
        return '';
      }
    }
  };
}

function matchSection(prompt: string, marker: string): string | null {
  const index = prompt.indexOf(marker);
  if (index < 0) return null;
  const rest = prompt.slice(index + marker.length);
  const end = rest.search(/\n\s*\n/);
  const value = (end < 0 ? rest : rest.slice(0, end)).trim();
  return value.length === 0 ? null : value;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((item) => item.trim().length > 0) ?? '';
  return line.trim().slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Worker 异步隔离                                                     */
/* ------------------------------------------------------------------ */

/** 让出一次事件循环：把后续工作排到后台宏任务，主线程先跑。 */
export function yieldToEventLoop(): Promise<void> {
  // 注意：这里不能 unref。unref 的定时器不保活进程，会让 await 中的进程直接退出。
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export type WorkerJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface WorkerJob {
  id: string;
  query: string;
  status: WorkerJobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

/**
 * 串行 Worker：把反思任务排进队列，最多 maxConcurrent 个并行，
 * 每个任务都在后台宏任务里推进，绝不阻塞调用方。
 */
export class ReflectionWorker {
  private readonly engine: DialecticalReflectionEngine;
  private readonly maxConcurrent: number;
  private readonly clock: () => number;
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly records = new Map<string, WorkerJob>();
  private seq = 0;

  constructor(engine: DialecticalReflectionEngine, maxConcurrent = 1, now: () => number = () => Date.now()) {
    this.engine = engine;
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.clock = now;
  }

  /** 排队执行，返回结果 Promise。 */
  submit(query: string): Promise<DialecticalResult> {
    const id = `job-${++this.seq}`;
    const record: WorkerJob = { id, query, status: 'queued', queuedAt: this.clock() };
    this.records.set(id, record);

    return new Promise<DialecticalResult>((resolve, reject) => {
      const start = (): void => {
        this.running += 1;
        record.status = 'running';
        record.startedAt = this.clock();
        this.engine.reflectInBackground(query).then(
          (result) => {
            record.status = 'done';
            record.finishedAt = this.clock();
            this.finish();
            resolve(result);
          },
          (error: unknown) => {
            record.status = 'error';
            record.finishedAt = this.clock();
            record.error = error instanceof Error ? error.message : String(error);
            this.finish();
            reject(error);
          },
        );
      };
      this.waiting.push(start);
      this.pump();
    });
  }

  /** 队列与历史任务快照。 */
  jobs(): WorkerJob[] {
    return [...this.records.values()].map((job) => ({ ...job }));
  }

  get pending(): number {
    return this.running + this.waiting.length;
  }

  private finish(): void {
    this.running = Math.max(0, this.running - 1);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next !== undefined) next();
    }
  }
}
