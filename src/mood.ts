/**
 * src/mood.ts — MoodStateMachine
 *
 * 两个连续量 + 一个带迟滞的状态标签：
 *   energy      0..100    精力，随时间自然衰减，休息回补
 *   favorability -100..100 好感度，事件驱动，随时间向 0 缓慢回归
 *
 * 「迟滞（hysteresis）」是关键：进入「戒备」的门槛是 -20，退出要回到 -12 以上，
 * 避免好感在阈值附近抖动时状态条疯狂跳字。
 */

export type MoodEvent =
  | 'praise'
  | 'insult'
  | 'success'
  | 'failure'
  | 'conflict'
  | 'rest'
  | 'ignore';

export type MoodLabel = '兴奋' | '愉悦' | '平静' | '戒备' | '敌意' | '疲惫';

export interface MoodDelta {
  energy: number;
  favorability: number;
}

export interface MoodSnapshot {
  energy: number;
  favorability: number;
  mood: MoodLabel;
  /** 状态条文本，例如 `[能量 ███████░░░ 72%] [好感 ██████░░░░ +18] 状态:平静`。 */
  bar: string;
  at: number;
}

/** 一个数值区间的含义。 */
export interface MoodBand {
  /** 区间下界（含）。 */
  min: number;
  /** 区间上界（不含）。 */
  max: number;
  label: string;
  /** 这个区间代表工作处于什么状态。 */
  meaning: string;
}

/** 「为什么是这个值 + 这个值说明什么」。 */
export interface MoodReading {
  value: number;
  initial: number;
  /** 事件造成的累计变化。 */
  fromEvents: number;
  /** 时间流逝造成的累计变化。 */
  fromTime: number;
  band: string;
  meaning: string;
  /** 一句话解释：初值 + 哪些事件 + 时间 = 当前值。 */
  reason: string;
  /** 是否被上下限钳住。 */
  clamped: 'none' | 'min' | 'max';
  events: Array<{ event: MoodEvent; at: number; delta: MoodDelta }>;
}

export interface MoodExplanation {
  energy: MoodReading;
  favorability: MoodReading;
  mood: { label: MoodLabel; reason: string; meaning: string };
  /** 数值是否真的会自己变化（当前插件里 tick 未被调用时为 false）。 */
  timeDriven: boolean;
}

/** 能量的四档含义。 */
export const ENERGY_BANDS: readonly MoodBand[] = Object.freeze([
  { min: 0, max: 15, label: '精疲力竭', meaning: '只适合收尾和简单确认，不建议开新任务' },
  { min: 15, max: 40, label: '疲劳', meaning: '能干活但容易出错，建议把任务拆小、缩短回合' },
  { min: 40, max: 70, label: '正常', meaning: '可以持续处理常规任务' },
  { min: 70, max: 101, label: '充沛', meaning: '适合处理复杂、长链路的任务' },
]);

/** 好感的五档含义。 */
export const FAVORABILITY_BANDS: readonly MoodBand[] = Object.freeze([
  { min: -101, max: -60, label: '敌意', meaning: '倾向拒绝与顶撞，交互需要先修复关系' },
  { min: -60, max: -20, label: '戒备', meaning: '回答更短更谨慎，不主动多说' },
  { min: -20, max: 20, label: '平静', meaning: '中性协作，就事论事' },
  { min: 20, max: 60, label: '愉悦', meaning: '更愿意配合，可以适当主动' },
  { min: 60, max: 101, label: '兴奋', meaning: '投入度高，可能过度热情' },
]);

const EVENT_NAMES: Readonly<Record<MoodEvent, string>> = Object.freeze({
  praise: '表扬',
  insult: '侮辱',
  success: '成功',
  failure: '失败',
  conflict: '冲突',
  rest: '休息',
  ignore: '忽视',
});

export interface MoodOptions {
  energy?: number;
  favorability?: number;
  now?: () => number;
  /** 每分钟自然流失的精力，默认 1.5。 */
  energyDrainPerMinute?: number;
  /** 每分钟好感向 0 回归的速度，默认 0.5。 */
  favorabilityDriftPerMinute?: number;
  /** 状态条格子数，默认 10。 */
  barWidth?: number;
}

/** 每种事件对两个连续量的基础影响。 */
export const MOOD_DELTAS: Readonly<Record<MoodEvent, MoodDelta>> = Object.freeze({
  praise: { energy: 2, favorability: 12 },
  insult: { energy: -6, favorability: -18 },
  success: { energy: 5, favorability: 6 },
  failure: { energy: -8, favorability: -5 },
  conflict: { energy: -10, favorability: -12 },
  rest: { energy: 14, favorability: 1 },
  ignore: { energy: -2, favorability: -3 },
});

/** 迟滞阈值。 */
const ENTER_WARY = -20;
const EXIT_WARY = -12;
const ENTER_HOSTILE = -60;
const EXIT_HOSTILE = -50;
const ENTER_EXCITED = 60;
const EXIT_EXCITED = 52;
const ENTER_HAPPY = 25;
const EXIT_HAPPY = 18;
const ENTER_TIRED = 15;
const EXIT_TIRED = 25;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 可落盘的心情状态。 */
export interface MoodState {
  energy: number;
  favorability: number;
  log: Array<{ event: MoodEvent; at: number; delta: MoodDelta }>;
}

export class MoodStateMachine {
  private energyValue: number;
  private favorabilityValue: number;
  private label: MoodLabel = '平静';
  private readonly clock: () => number;
  private readonly energyDrainPerMinute: number;
  private readonly favorabilityDriftPerMinute: number;
  private readonly barWidth: number;
  private lastTickAt: number;
  private readonly log: Array<{ event: MoodEvent; at: number; delta: MoodDelta }> = [];
  /** 启动时的初值，用来解释「为什么现在是这个数」。 */
  private readonly initialEnergy: number;
  private readonly initialFavorability: number;
  /** 时间流逝造成的累计变化（tick 从未被调用时恒为 0）。 */
  private drainedEnergy = 0;
  private driftedFavorability = 0;
  /** tick 被真正推进过几次：为 0 说明数值只会被事件改变。 */
  private tickCount = 0;

  constructor(options: MoodOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.energyValue = clamp(options.energy ?? 70, 0, 100);
    this.favorabilityValue = clamp(options.favorability ?? 0, -100, 100);
    this.initialEnergy = this.energyValue;
    this.initialFavorability = this.favorabilityValue;
    this.energyDrainPerMinute = options.energyDrainPerMinute ?? 1.5;
    this.favorabilityDriftPerMinute = options.favorabilityDriftPerMinute ?? 0.5;
    this.barWidth = Math.max(4, options.barWidth ?? 10);
    this.lastTickAt = this.clock();
    this.recomputeLabel();
  }

  get energy(): number {
    return this.energyValue;
  }

  get favorability(): number {
    return this.favorabilityValue;
  }

  get mood(): MoodLabel {
    return this.label;
  }

  /** 施加一个事件，返回新快照。intensity 是力度倍数，默认 1。 */
  apply(event: MoodEvent, intensity = 1): MoodSnapshot {
    const base = MOOD_DELTAS[event];
    const scale = Math.max(0, intensity);
    const delta: MoodDelta = {
      energy: base.energy * scale,
      favorability: base.favorability * scale,
    };
    this.energyValue = clamp(this.energyValue + delta.energy, 0, 100);
    this.favorabilityValue = clamp(this.favorabilityValue + delta.favorability, -100, 100);
    this.log.push({ event, at: this.clock(), delta });
    if (this.log.length > 100) this.log.shift();
    this.recomputeLabel();
    return this.snapshot();
  }

  /** 推进时间：精力自然流失，好感向 0 回归。 */
  tick(dtMs: number): MoodSnapshot {
    const minutes = Math.max(0, dtMs) / 60000;
    if (minutes > 0) {
      this.tickCount += 1;
      const before = this.energyValue;
      this.energyValue = clamp(
        this.energyValue - this.energyDrainPerMinute * minutes,
        0,
        100,
      );
      this.drainedEnergy += before - this.energyValue;

      const drift = this.favorabilityDriftPerMinute * minutes;
      const favBefore = this.favorabilityValue;
      if (this.favorabilityValue > 0) {
        this.favorabilityValue = clamp(this.favorabilityValue - drift, 0, 100);
      } else if (this.favorabilityValue < 0) {
        this.favorabilityValue = clamp(this.favorabilityValue + drift, -100, 0);
      }
      this.driftedFavorability += this.favorabilityValue - favBefore;
    }
    this.lastTickAt += Math.max(0, dtMs);
    this.recomputeLabel();
    return this.snapshot();
  }

  /** 按真实时钟推进到当前时刻。 */
  sync(): MoodSnapshot {
    const now = this.clock();
    const dt = now - this.lastTickAt;
    return this.tick(dt);
  }

  snapshot(): MoodSnapshot {
    return {
      energy: round1(this.energyValue),
      favorability: round1(this.favorabilityValue),
      mood: this.label,
      bar: this.statusBar(),
      at: this.clock(),
    };
  }

  /** 渲染状态条。 */
  statusBar(): string {
    const energyRatio = clamp(this.energyValue / 100, 0, 1);
    const favRatio = clamp((this.favorabilityValue + 100) / 200, 0, 1);
    const fav = this.favorabilityValue;
    const favText = fav >= 0 ? `+${Math.round(fav)}` : `${Math.round(fav)}`;
    return [
      `[能量 ${this.bar(energyRatio)} ${Math.round(this.energyValue)}%]`,
      `[好感 ${this.bar(favRatio)} ${favText}]`,
      `状态:${this.label}`,
    ].join(' ');
  }

  /** 最近事件流水（最多 100 条）。 */
  history(): ReadonlyArray<{ event: MoodEvent; at: number; delta: MoodDelta }> {
    return this.log;
  }

  /** 导出当前状态，供落盘。 */
  serialize(): MoodState {
    return {
      energy: this.energyValue,
      favorability: this.favorabilityValue,
      log: this.log.map((entry) => ({ ...entry, delta: { ...entry.delta } })),
    };
  }

  /** 从落盘状态恢复。 */
  restore(state: MoodState): void {
    if (typeof state.energy === 'number') this.energyValue = clamp(state.energy, 0, 100);
    if (typeof state.favorability === 'number') {
      this.favorabilityValue = clamp(state.favorability, -100, 100);
    }
    this.log.length = 0;
    for (const entry of (state.log ?? []).slice(-100)) {
      this.log.push({ event: entry.event, at: entry.at, delta: { ...entry.delta } });
    }
    this.recomputeLabel();
  }

  /** 回到初始值（页面的「清空心情」用）。 */
  reset(): void {
    this.energyValue = this.initialEnergy;
    this.favorabilityValue = this.initialFavorability;
    this.log.length = 0;
    this.drainedEnergy = 0;
    this.driftedFavorability = 0;
    this.tickCount = 0;
    this.recomputeLabel();
  }

  /**
   * 解释当前数值：为什么是这个值、这个值说明工作处于什么状态。
   * 只读，不改变任何状态。
   */
  explain(): MoodExplanation {
    const energyEvents = this.log.filter((entry) => entry.delta.energy !== 0);
    const favorEvents = this.log.filter((entry) => entry.delta.favorability !== 0);

    const energy = this.reading(
      this.energyValue,
      this.initialEnergy,
      energyEvents.reduce((sum, entry) => sum + entry.delta.energy, 0),
      -this.drainedEnergy,
      ENERGY_BANDS,
      energyEvents,
      0,
      100,
      'energy',
    );
    const favorability = this.reading(
      this.favorabilityValue,
      this.initialFavorability,
      favorEvents.reduce((sum, entry) => sum + entry.delta.favorability, 0),
      this.driftedFavorability,
      FAVORABILITY_BANDS,
      favorEvents,
      -100,
      100,
      'favorability',
    );

    return {
      energy,
      favorability,
      mood: {
        label: this.label,
        reason: this.labelReason(),
        meaning: LABEL_MEANING[this.label],
      },
      timeDriven: this.tickCount > 0,
    };
  }

  private reading(
    value: number,
    initial: number,
    fromEvents: number,
    fromTime: number,
    bands: readonly MoodBand[],
    events: Array<{ event: MoodEvent; at: number; delta: MoodDelta }>,
    min: number,
    max: number,
    axis: 'energy' | 'favorability',
  ): MoodReading {
    const band = bands.find((entry) => value >= entry.min && value < entry.max) ?? bands[bands.length - 1]!;
    const total = fromEvents + fromTime;
    const clamped: MoodReading['clamped'] =
      Math.round(value) === min && total < 0 ? 'min' : Math.round(value) === max && total > 0 ? 'max' : 'none';

    const parts: string[] = [`启动时 ${round1(initial)}`];
    const summary = summarizeEvents(events, axis);
    if (summary.length > 0) parts.push(`事件：${summary}`);
    if (fromTime !== 0) parts.push(`时间流逝：${signed(round1(fromTime))}`);
    if (summary.length === 0 && fromTime === 0) {
      parts.push('之后没有收到任何事件，也没有时间流逝');
    } else {
      parts.push(`合计 ${signed(round1(total))} → ${round1(value)}`);
    }
    if (clamped === 'min') parts.push(`已到下限 ${min}，再低也不会更低`);
    if (clamped === 'max') parts.push(`已到上限 ${max}，再高也不会更高`);

    return {
      value: round1(value),
      initial: round1(initial),
      fromEvents: round1(fromEvents),
      fromTime: round1(fromTime),
      band: band.label,
      meaning: band.meaning,
      reason: parts.join('；'),
      clamped,
      events: events.map((entry) => ({ ...entry })),
    };
  }

  private labelReason(): string {
    const energy = round1(this.energyValue);
    const favor = round1(this.favorabilityValue);
    switch (this.label) {
      case '疲惫':
        return energy <= ENTER_TIRED
          ? `能量 ${energy} ≤ ${ENTER_TIRED}（疲惫进入线，优先于其他标签）`
          : `能量 ${energy} 已回到 ${EXIT_TIRED} 以上，刚从疲惫退出`;
      case '敌意':
        return favor <= ENTER_HOSTILE
          ? `好感 ${favor} ≤ ${ENTER_HOSTILE}（敌意进入线）`
          : `好感 ${favor} 已高于退出线 ${EXIT_HOSTILE}，正从敌意回落`;
      case '戒备':
        return favor <= ENTER_WARY
          ? `好感 ${favor} ≤ ${ENTER_WARY}（戒备进入线）`
          : `好感 ${favor} 已高于退出线 ${EXIT_WARY}，但还没回到平静，仍算戒备（迟滞）`;
      case '兴奋':
        return favor >= ENTER_EXCITED
          ? `好感 ${favor} ≥ ${ENTER_EXCITED}（兴奋进入线）`
          : `好感 ${favor} 低于进入线 ${ENTER_EXCITED}，但没跌破退出线 ${EXIT_EXCITED}，仍算兴奋（迟滞）`;
      case '愉悦':
        return favor >= ENTER_HAPPY
          ? `好感 ${favor} ≥ ${ENTER_HAPPY}（愉悦进入线）`
          : `好感 ${favor} 低于进入线 ${ENTER_HAPPY}，但没跌破退出线 ${EXIT_HAPPY}，仍算愉悦（迟滞）`;
      default:
        return `能量 ${energy} > ${ENTER_TIRED}，且好感 ${favor} 落在 ${ENTER_WARY} ~ ${ENTER_HAPPY} 之间，属平静区间`;
    }
  }

  /* ---------------------------------------------------------------- */

  private bar(ratio: number): string {
    const filled = Math.round(ratio * this.barWidth);
    return '█'.repeat(filled) + '░'.repeat(this.barWidth - filled);
  }

  private recomputeLabel(): void {
    const fav = this.favorabilityValue;
    const energy = this.energyValue;
    let next = this.label;

    if (this.label === '疲惫') {
      if (energy >= EXIT_TIRED) next = '平静';
    } else if (energy <= ENTER_TIRED) {
      next = '疲惫';
    }

    if (next !== '疲惫') {
      if (this.label === '敌意') {
        if (fav > EXIT_HOSTILE) next = fav <= EXIT_WARY ? '戒备' : '平静';
      } else if (fav <= ENTER_HOSTILE) {
        next = '敌意';
      } else if (this.label === '戒备') {
        if (fav > EXIT_WARY) next = fav >= ENTER_HAPPY ? '愉悦' : '平静';
      } else if (fav <= ENTER_WARY) {
        next = '戒备';
      } else if (this.label === '兴奋') {
        if (fav < EXIT_EXCITED) next = fav >= ENTER_HAPPY ? '愉悦' : '平静';
      } else if (fav >= ENTER_EXCITED) {
        next = '兴奋';
      } else if (this.label === '愉悦') {
        if (fav < EXIT_HAPPY) next = '平静';
      } else if (fav >= ENTER_HAPPY) {
        next = '愉悦';
      }
    }

    this.label = next;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/** 把事件流水压成「表扬 ×2（+4）、休息 ×1（+14）」。 */
function summarizeEvents(
  events: ReadonlyArray<{ event: MoodEvent; delta: MoodDelta }>,
  axis: 'energy' | 'favorability',
): string {
  const buckets = new Map<MoodEvent, { count: number; sum: number }>();
  for (const entry of events) {
    const bucket = buckets.get(entry.event) ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += entry.delta[axis];
    buckets.set(entry.event, bucket);
  }
  return [...buckets]
    .map(([event, bucket]) => `${EVENT_NAMES[event]} ×${bucket.count}（${signed(round1(bucket.sum))}）`)
    .join('、');
}

/** 每个状态标签代表什么。 */
const LABEL_MEANING: Readonly<Record<MoodLabel, string>> = Object.freeze({
  兴奋: '好感高、能量足，互动最积极',
  愉悦: '状态良好，愿意配合',
  平静: '中性协作，就事论事',
  戒备: '最近被否定较多，回答会更短更谨慎',
  敌意: '连续负面互动，倾向拒绝；需要先修复关系',
  疲惫: '能量见底，适合收尾而不是开新任务',
});
