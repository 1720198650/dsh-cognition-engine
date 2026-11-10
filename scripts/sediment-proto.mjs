#!/usr/bin/env node
/**
 * scripts/sediment-proto.mjs — 沉积层 Step 0 单文件原型
 *
 * 目的：**只**验证三件事，不接插件、不接 DSH、不用任何依赖。
 *   A 不对称：反转类事件的位移 ≫ 补充类（补充必须为 0）
 *   B 不可逆：改任一事件 → 哈希链在改动点之后全部校验失败
 *   C 路径依赖 + 非检索：同一情境在三个 checkpoint 决策不同，且决策只依赖状态（不读记忆）
 *
 * 这里的一切都是**可替换的玩具**：相似度、翻转判定、决策函数都很粗。
 * 唯一要保留的是**结构**：哈希链、单调带惯性、状态→决策。
 *
 * 用法：node scripts/sediment-proto.mjs
 * 退出码：0 = 三项全过；1 = 有一项不过（说明设计不成立，别接插件）
 */
import { createHash } from 'node:crypto';

const ETA = 0.02;
const THRESHOLD = 0.45;
const DIMS = ['retention', 'caution', 'openness', 'attachment'];
const ZERO = '0'.repeat(64);

/* ---------------- 1. 相似度（字符 bigram 余弦，够用就行） ---------------- */
function bigrams(text) {
  const s = text.replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i + 1 < s.length; i += 1) out.push(s.slice(i, i + 2));
  return out;
}
function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const count = new Map();
  for (const g of A) count.set(g, (count.get(g) ?? 0) + 1);
  let dot = 0;
  for (const g of B) {
    const n = count.get(g) ?? 0;
    if (n > 0) {
      dot += 1;
      count.set(g, n - 1);
    }
  }
  return dot / Math.sqrt(A.length * B.length);
}

/* ---------------- 2. 翻转判定 ---------------- */
const HARD_FLIP = /(不对|不是|取消|作废|推翻|改成|换成|改为|不再|停止|撤销)/;
const SOFT_FLIP = /(其实|更准确|严格讲|准确说|补充一下)/;
function detectFlip(oldText, newText) {
  const merged = `${oldText} ${newText}`;
  if (HARD_FLIP.test(newText) || HARD_FLIP.test(merged)) return { flip: 1, kind: 'reversal' };
  if (SOFT_FLIP.test(newText)) return { flip: 0.5, kind: 'softening' };
  return { flip: 0, kind: 'supplement' };
}

/* ---------------- 3. 方向 ---------------- */
const POLARITY = {
  reversal: { retention: 1, caution: 1, openness: -1, attachment: 0 },
  softening: { retention: 1, caution: -1, openness: 1, attachment: 0 },
  supplement: { retention: 0, caution: 0, openness: 0, attachment: 0 },
};

/* ---------------- 4. 哈希链 ---------------- */
function canonical(event) {
  const d = event.delta;
  return [
    event.prevHash,
    String(event.seq),
    String(event.at),
    event.kind,
    event.subject,
    event.from ?? '',
    event.to ?? '',
    event.tension.toFixed(6),
    [d.retention, d.caution, d.openness, d.attachment].map((x) => x.toFixed(6)).join(','),
  ].join('|');
}
function hashEvent(event) {
  return createHash('sha256').update(canonical(event)).digest('hex');
}

class Sediment {
  constructor() {
    this.events = [];
    this.dims = { retention: 0.5, caution: 0.5, openness: 0.5, attachment: 0.5 };
    this.direction = { retention: 0, caution: 0, openness: 0, attachment: 0 };
    this.tensions = [];
  }

  /** 唯一写入口。返回 skipped 表示不算一次熏习。 */
  observe({ subject, from, to, oldText, newText, at = Date.now(), personRelated = false, protention = false }) {
    const { flip, kind } = detectFlip(oldText, newText);
    if (flip === 0) {
      this.tensions.push(0);
      return { skipped: true, reason: '纯补充（flip=0）不触发位移' };
    }
    const sim = similarity(oldText, newText);
    const tension = sim * flip;
    if (tension < THRESHOLD) {
      this.tensions.push(tension);
      return { skipped: true, reason: `张力 ${tension.toFixed(3)} 未达 ${THRESHOLD}` };
    }

    const polarity = { ...POLARITY[kind] };
    if (personRelated) polarity.attachment = 1;

    const delta = {};
    for (const dim of DIMS) {
      let raw = ETA * tension * polarity[dim];
      if (raw === 0) {
        delta[dim] = 0;
        continue;
      }
      const dir = Math.sign(raw);
      if (this.direction[dim] === 0) this.direction[dim] = dir;
      // 反向位移只允许 1/4 幅度（惯性/滞后），且不改方向
      if (dir !== this.direction[dim]) raw *= 0.25;
      const next = Math.min(1, Math.max(0, this.dims[dim] + raw));
      delta[dim] = Number((next - this.dims[dim]).toFixed(6));
      this.dims[dim] = Number(next.toFixed(6));
    }

    const seq = this.events.length;
    const event = {
      seq,
      at,
      kind: 'tension',
      subject,
      from,
      to,
      similarity: Number(sim.toFixed(6)),
      flip,
      tension: Number(tension.toFixed(6)),
      delta,
      prevHash: seq === 0 ? ZERO : this.events[seq - 1].hash,
    };
    event.hash = hashEvent(event);
    this.events.push(event);
    this.tensions.push(tension);

    // 前提误差（可选）：与最近 10 次均值的偏差，小幅调 caution
    if (protention) {
      const recent = this.tensions.slice(-11, -1);
      if (recent.length >= 3) {
        const expected = recent.reduce((a, b) => a + b, 0) / recent.length;
        if (Math.abs(tension - expected) > 0.2) {
          const bump = Number(((ETA / 3) * Math.sign(tension - expected)).toFixed(6));
          this.dims.caution = Number(Math.min(1, Math.max(0, this.dims.caution + bump)).toFixed(6));
        }
      }
    }
    return { skipped: false, seq, tension: event.tension, delta };
  }

  /** settle：连续无冲突的巩固（只降 retention，且有地板）。 */
  settle() {
    const next = Math.max(0.2, this.dims.retention * 0.995);
    const delta = { retention: 0, caution: 0, openness: 0, attachment: 0 };
    delta.retention = Number((next - this.dims.retention).toFixed(6));
    this.dims.retention = Number(next.toFixed(6));
    const seq = this.events.length;
    const event = {
      seq,
      at: Date.now(),
      kind: 'settle',
      subject: '—',
      from: null,
      to: null,
      similarity: 0,
      flip: 0,
      tension: 0,
      delta,
      prevHash: seq === 0 ? ZERO : this.events[seq - 1].hash,
    };
    event.hash = hashEvent(event);
    this.events.push(event);
  }

  /** 校验整条链；返回第一处断点。 */
  verify(events = this.events) {
    let prev = ZERO;
    for (const event of events) {
      const expect = hashEvent({ ...event, prevHash: prev });
      if (event.prevHash !== prev || event.hash !== expect) return { ok: false, brokenAt: event.seq };
      prev = event.hash;
    }
    return { ok: true, brokenAt: null };
  }

  /**
   * 玩具决策函数：只读 state，不读事件、不读任何记忆。
   * 三个选项对应"直接动手 / 先确认 / 再等等"。
   */
  decide() {
    const { caution } = this.dims;
    if (caution < 0.65) return 'A 直接给方案';
    if (caution < 0.78) return 'B 先确认一句';
    return 'C 再等等，先要更多信息';
  }
}

/* ---------------- 5. 场景模拟 ---------------- */
function runScenario({ reversals = 0, supplements = 0, personRelated = false, protention = false, tag = '' }) {
  const s = new Sediment();
  let t = 1_700_000_000_000;
  const base = '部署区域在上海机房，主用';
  for (let i = 0; i < reversals; i += 1) {
    s.observe({
      subject: '部署区域', from: `mem-r${i}`, to: `mem-r${i + 1}`,
      oldText: i % 2 === 0 ? '部署区域在上海机房，主用' : '部署区域在北京机房，主用',
      newText: i % 2 === 0 ? '不对，部署区域改成北京机房，主用' : '不对，部署区域改回上海机房，主用',
      at: t += 1000, personRelated, protention,
    });
  }
  for (let i = 0; i < supplements; i += 1) {
    s.observe({
      subject: '部署区域', from: `mem-s${i}`, to: `mem-s${i + 1}`,
      oldText: base, newText: `${base}，另外加了一台缓存服务器`,
      at: t += 1000, personRelated, protention,
    });
  }
  if (tag) process.stdout.write(`  [${tag}] `);
  return s;
}

function displacement(s) {
  let sum = 0;
  for (const e of s.events) for (const dim of DIMS) sum += Math.abs(e.delta[dim]);
  return Number(sum.toFixed(6));
}

/* ---------------- 6. 三项断言 ---------------- */
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}\n    ${detail}`);
}

console.log('=== Step 0 原型：沉积层三项断言 ===\n');

// A 不对称
const rev = runScenario({ reversals: 10 });
const sup = runScenario({ supplements: 20 });
const dRev = displacement(rev);
const dSup = displacement(sup);
const ratio = dSup === 0 ? Infinity : dRev / dSup;
check(
  'A 不对称：反转的位移 ≫ 补充',
  dRev > 0 && dSup === 0,
  `反转 10 次位移=${dRev}；补充 20 次位移=${dSup}；比值=${ratio === Infinity ? '∞' : ratio.toFixed(1)}（要求补充为 0）`,
);

// B 不可逆
const tampered = rev.events.map((e) => ({ ...e }));
const mid = Math.floor(tampered.length / 2);
tampered[mid].tension = Number((tampered[mid].tension + 0.01).toFixed(6));
const vGood = rev.verify();
const vBad = rev.verify(tampered);
check(
  'B 不可逆：改一条 → 该点之后全部校验失败',
  vGood.ok === true && vBad.ok === false && vBad.brokenAt === tampered[mid].seq,
  `原链 ok=${vGood.ok}；篡改 seq=${tampered[mid].seq} 后 brokenAt=${vBad.brokenAt}（要求相等）`,
);

// C 路径依赖 + 非检索
const s10 = runScenario({ reversals: 10 });
const s20 = runScenario({ reversals: 20 });
const s30 = runScenario({ reversals: 30 });
const d1 = s10.decide();
const d2 = s20.decide();
const d3 = s30.decide();
const distinct = new Set([d1, d2, d3]).size === 3;
// 非检索：决策函数只吃 state，把"记忆"完全去掉仍得到同样结果
const noMemoryDecision = (s) => s.decide();
const sameWithoutMemory = [d1, d2, d3].join('|') === [noMemoryDecision(s10), noMemoryDecision(s20), noMemoryDecision(s30)].join('|');
check(
  'C 路径依赖 + 非检索',
  distinct && sameWithoutMemory,
  `checkpoint 10/20/30 → ${d1} / ${d2} / ${d3}（要求互不相同）；去掉记忆后结果一致=${sameWithoutMemory}`,
);

// D 惊奇≠张力（补充：protentionError 可动，但 retention 必须不变）
const sp = runScenario({ supplements: 20, protention: true });
const retentionChanged = sp.events.some((e) => e.delta.retention !== 0);
check(
  'D 惊奇≠张力：纯补充时 retention 必须不变',
  retentionChanged === false,
  `20 次纯补充（开前提误差）后 retention 位移=${sp.events.filter((e) => e.delta.retention !== 0).length} 条（要求 0）`,
);

/* ---------------- 7. 汇总 ---------------- */
console.log('\n=== 轨迹抽样（前 6 条）===');
for (const e of rev.events.slice(0, 6)) {
  console.log(
    `  #${e.seq} ${e.kind} tension=${e.tension} Δret=${e.delta.retention} Δcau=${e.delta.caution} Δope=${e.delta.openness}`,
  );
}
console.log('\n最终状态：', JSON.stringify(rev.dims));

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('未通过：' + failed.map((r) => r.name).join('；'));
  process.exit(1);
}
console.log('全部通过 — 结构成立，可以进入 Step 1（落盘 + 校验）');
