/**
 * src/voice.ts — 语感层：从公开讨论里学「怎么说」，不学「说什么」。
 *
 * 为什么单独一层（用户 2026-11-19）：
 *   事实层管"什么是真的"，准则管"该怎么做"，立场管"按什么判断"，
 *   但都不管"话说出来像不像人"。语感是第四条腿。
 *
 * 三条边界：
 *   1. **只取表达，不取观点**。评论里的立场一律不可信，只学句子的形状。
 *   2. **样本不是规则**。"要用短句"这种是套话，写了没用；给几条真句子当锚才有效
 *      （研究与实测同一结论：描述从"只有名字"换成"带示例"后效果显著变好）。
 *   3. **预算极小**：≤120 字、3 条。语感是调味，不能挤掉事实和准则。
 *
 * 零依赖：纯 JSON。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

interface VoiceFile {
  samples: VoiceSample[];
  nextId: number;
}

/** 语感样本的字数区间：太短没内容，太长不像说话。 */
export const VOICE_MIN_CHARS = 12;
export const VOICE_MAX_CHARS = 100;
/** 点赞门槛：0 赞的样本大概率是灌水。 */
export const VOICE_MIN_LIKES = 20;

const PURE_EMOJI = /^[\s[\]\w]+$/;
/** 纯应援/灌水：整句只有这些词 */
const CHEER_ONLY = /^(支持|加油|沙发|前排|第一|打卡|签到|马克|收藏了|笑死|哈哈哈+|太强了|牛逼|nb|好耶|爷青回)[!！。.~～\s]*$/i;
/** 脏话与攻击：这类句子学了会让输出变脏，直接扔 */
const ABUSIVE = /(傻逼|煞笔|脑残|智障|尼玛|你妈|妈的|操你|草你|滚你|去死|我tm|特么|wtm|nmsl)/i;

export function isVoiceWorthy(text: string, likes: number): { ok: boolean; reason?: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length < VOICE_MIN_CHARS) return { ok: false, reason: '太短' };
  if (clean.length > VOICE_MAX_CHARS) return { ok: false, reason: '太长（像文章不像说话）' };
  if (likes < VOICE_MIN_LIKES) return { ok: false, reason: '点赞太少' };
  if (CHEER_ONLY.test(clean)) return { ok: false, reason: '纯应援' };
  if (ABUSIVE.test(clean)) return { ok: false, reason: '含攻击性用语' };
  // 表情占位符超过 1/3 长度 → 基本是刷梗
  const emojiChars = (clean.match(/\[[^\]]{1,8}\]/g) ?? []).join('').length;
  if (emojiChars / clean.length > 0.34) return { ok: false, reason: '表情太多' };
  // 全是链接或纯符号
  if (PURE_EMOJI.test(clean)) return { ok: false, reason: '没有实际文字' };
  return { ok: true };
}

/** 字面相似度（二元组 Dice），用于去重：同一句被抄来抄去很常见。 */
function dice(a: string, b: string): number {
  const grams = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    const chars = [...text.replace(/\s+/g, '')];
    for (let i = 0; i < chars.length - 1; i += 1) {
      const gram = chars[i]! + chars[i + 1]!;
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let common = 0;
  for (const [gram, count] of ga) common += Math.min(count, gb.get(gram) ?? 0);
  return (2 * common) / (ga.size + gb.size);
}

export class VoiceStore {
  readonly filePath: string;
  private readonly clock: () => number;
  private data: VoiceFile | undefined;

  constructor(options: { filePath: string; now?: () => number }) {
    this.filePath = options.filePath;
    this.clock = options.now ?? (() => Date.now());
  }

  private load(): VoiceFile {
    if (this.data !== undefined) return this.data;
    this.data = { samples: [], nextId: 1 };
    if (!existsSync(this.filePath)) return this.data;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '')) as Partial<VoiceFile>;
      const samples = Array.isArray(parsed.samples) ? (parsed.samples as VoiceSample[]) : [];
      this.data = { samples, nextId: Number(parsed.nextId ?? samples.length + 1) || 1 };
    } catch {
      this.data = { samples: [], nextId: 1 };
    }
    return this.data;
  }

  private persist(): void {
    const data = this.load();
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 收一条样本：先用 isVoiceWorthy 筛，再和已有样本去重（Dice ≥ 0.7 视为重复）。
   *
   * 返回是否收录与原因——被拒的原因要能说出来，不然用户不知道漏掉了什么。
   */
  add(input: { text: string; from: string; url?: string; likes: number }): { added: boolean; reason?: string } {
    const text = input.text.replace(/\s+/g, ' ').trim();
    const worthy = isVoiceWorthy(text, input.likes);
    if (!worthy.ok) return { added: false, reason: worthy.reason };
    const data = this.load();
    for (const sample of data.samples) {
      if (dice(sample.text, text) >= 0.7) return { added: false, reason: '与已有样本重复' };
    }
    data.samples.push({
      id: `vs-${data.nextId}`,
      text,
      from: input.from,
      ...(input.url === undefined ? {} : { url: input.url }),
      likes: input.likes,
      chars: text.length,
      addedAt: this.clock(),
    });
    data.nextId += 1;
    // 样本只留最近的 200 条：这是调味料，不是资料库
    if (data.samples.length > 200) data.samples = data.samples.slice(-200);
    this.persist();
    return { added: true };
  }

  list(limit = 50): VoiceSample[] {
    const samples = this.load().samples;
    return [...samples].reverse().slice(0, limit);
  }

  remove(id: string): boolean {
    const data = this.load();
    const index = data.samples.findIndex((sample) => sample.id === id);
    if (index < 0) return false;
    data.samples.splice(index, 1);
    this.persist();
    return true;
  }

  stats(): { total: number; sources: number } {
    const samples = this.load().samples;
    return { total: samples.length, sources: new Set(samples.map((sample) => sample.from)).size };
  }

  /**
   * 挑注入样本：赞高优先，但**保证长度和来源有差异**。
   *
   * 全挑长句会让我说话变啰嗦，全挑同一个视频会变成那个圈子的腔调。
   */
  pick(count = 3): VoiceSample[] {
    const samples = this.load().samples;
    if (samples.length === 0) return [];
    // 入库时筛过一遍，这里再筛一遍：规则会改严，老样本不能因为"已经存了"就绕过新规则。
    const byLikes = samples
      .filter((sample) => isVoiceWorthy(sample.text, sample.likes).ok)
      .sort((a, b) => b.likes - a.likes);
    const picked: VoiceSample[] = [];
    // 按**具体出处**去重，不是按平台名：三条都来自同一个视频时，
    // 学到的是那个圈子的腔调，不是"人说话的样子"（2026-11-19 实测踩到）。
    const sourceKey = (sample: VoiceSample): string => sample.url ?? sample.from;
    const usedSources = new Set<string>();
    for (const sample of byLikes) {
      if (picked.length >= count) break;
      const key = sourceKey(sample);
      if (usedSources.has(key)) continue;
      picked.push(sample);
      usedSources.add(key);
    }
    // 出处不够多时才允许补：宁可少给，也不要一个视频刷三句
    for (const sample of byLikes) {
      if (picked.length >= count) break;
      if (picked.includes(sample)) continue;
      picked.push(sample);
    }
    return picked;
  }

  /**
   * 渲染注入段：只给样本，不给"规则"。
   *
   * 写成规则（"说话要短"）就是套话，等于没说；给真句子才是锚。
   */
  render(maxChars = 120, count = 3): string {
    const samples = this.pick(count);
    if (samples.length === 0) return '';
    const lines: string[] = [];
    let used = 0;
    const head = '【语感参考】别人说话的样子（学句式，不学观点）：';
    if (head.length > maxChars) return '';
    lines.push(head);
    used += head.length;
    for (const sample of samples) {
      const line = '· ' + sample.text;
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.length <= 1 ? '' : lines.join('\n');
  }
}
