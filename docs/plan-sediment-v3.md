# 实施方案 v3：沉积层怎么落地（分步骤）

> 2026-11-10。前两版在做"要不要做/做什么"，这版只回答**怎么做**。
> 依据：宪章（[charter-phenomenological-persona.md](charter-phenomenological-persona.md)）、
> 三家工程参考（[tri-phenomenology-engineering-refs.md](tri-phenomenology-engineering-refs.md)）、
> ARPM 的检索结论（[upgrade-plan-memory-v5.md](upgrade-plan-memory-v5.md) §七）。

---

## 一、先把接口钉死（写代码前必须定）

**单向流**：事实层 →（只读）→ 沉积层 →（只出参数）→ 生成层。**任何回写路径都不存在。**

```ts
// 沉积层对外只有四个方法，别的不许加
interface Sediment {
  observe(input: TensionInput): ObserveResult;   // 唯一写入口
  state(now?: number): SedimentState;            // 4 维当前值（只给代码用，不给界面）
  biasFor(subject: string): SedimentBias;        // 生成前读取：阈值/权重/排序修正
  log(limit?: number): SedimentEvent[];          // 只读事件日志（给界面）
}
```

`SedimentBias` 三个字段，**不带任何语义文本**：

```ts
interface SedimentBias {
  strictThresholdDelta: number; // -0.05 ~ +0.15，叠加到记忆 strict 阈值
  cautionWeight: number;        // 0 ~ 1，注入里"先确认再动手"的权重
  relateBoost: number;          // 0 ~ 1，同一 subject/同一人的排序加权
}
```

## 二、数据结构：哈希链（不可逆的结构性保证）

文件：`~/.dsh/cognition-engine/cognition-sediment.jsonl`，一行一个事件。

```json
{"seq":12,"at":1794318397354,"kind":"tension","subject":"部署区域",
 "from":"mem-1a","to":"mem-3f","similarity":0.81,"flip":1,"tension":0.81,
 "delta":{"retention":0.016,"caution":0.016,"openness":-0.008,"attachment":0},
 "prevHash":"9f2c…","hash":"a71b…"}
```

**规范序列化**（保证同一事件永远同一哈希）：字段按固定顺序、数字保留 6 位、无空格。

```
hash = sha256( prevHash + "|" + seq + "|" + at + "|" + kind + "|" + subject + "|" +
               from + "|" + to + "|" + tension.toFixed(6) + "|" + JSON(delta 固定顺序) )
```

`seq=0` 的 `prevHash` 用 64 个 0。校验：任一事件不匹配 → 该点之后全部标记 `broken`，**不自动修复**。

## 三、算法（四个公式，全部可单测）

### 3.1 张力（唯一写入口的判定）

```
similarity = textSimilarity(oldContent, newContent)          // 复用 memory.ts
flip       = 1.0  若命中否定/反义标记（不/别/取消/改成/推翻/作废/换成…）
             0.5  若只是语气弱化（其实/更准确说/严格讲）
             0.0  其余（纯补充）
tension    = similarity × flip
门槛：tension ≥ 0.45 才写事件（否则 return {skipped:true}）
```

**证据绑定**（ARPM 教训）：`from` 和 `to` 必须都是真实存在的事实 id，否则拒绝写入。

### 3.2 位移（哪个方向动哪一维）

| flip 场景 | retention | caution | openness | attachment |
|---|---|---|---|---|
| 旧结论被**推翻**（信→不信） | + | + | − | 0 |
| 旧结论被**放宽**（严格→宽松） | + | − | + | 0 |
| 涉及**具体的人/承诺**被推翻 | + | 0 | − | + |

```
delta[i] = η × tension × polarity[i]        η = 0.02
每维 clamp 到 [0,1]；同维只允许朝"已定方向"走（见 3.3）
```

### 3.3 单调与惯性（不对称的机制）

每维记录 `direction`（初始 0）：
- 第一次位移 → 定方向；
- 后续同向 → 继续累加（每次不超过 η）；
- 反向位移 → **只允许以 1/4 幅度抵消**，且不许一次翻向（模拟滞后，Evo-chat 的 2× 阈值同理）。

### 3.4 前提误差与巩固

```
expectedTension = 最近 10 次同主题事件 tension 的均值
若 |actual − expected| > 0.2 → 记 protentionError，delta 幅度 = η/3
同主题连续 ≥ 8 轮无 tension → 记 settle：retention *= 0.995（地板 0.2）
```

## 四、接进生成：三处钩子（都要能一键关掉）

| 钩子 | 位置 | 改什么 | 关闭后 |
|---|---|---|---|
| 召回阈值 | `cognition_recall` 前的 options | `strictThreshold + strictThresholdDelta` | 回到原阈值 |
| 注入权重 | `renderInjectedContext` | `caution` 高时把"先确认再动手"那段加权/置前 | 不插入 |
| 排序加权 | `memory.recall` 排序函数 | 同 subject 的 `score × (1 + 0.1×relateBoost)` | 不加权 |

作用域：`biasFor(subject)` 只对最近 **K=20 轮**出现过的 subject 返回非中性值，其余返回 `{0,0,0}`。

**关键点**：钩子只读 `biasFor`，**绝不读事件日志内容**。日志是给人看的，不是给生成用的。

## 五、代码结构与配置

```
src/sediment.ts          核心：哈希链、状态、张力、biasFor（约 300 行，零依赖）
src/index.ts             接线：实例化、/sediment/* 路由、三个钩子
client.js                面板「沉积」页签：只显示事件日志（不显示参数值）
src/test.ts              §[30] 单测：哈希链、单调性、钳制、bias 作用域
scripts/sediment-proto.mjs  M0 单文件原型（不接 DSH）
```

配置（默认全关）：

```yaml
sedimentEnabled: false      # 总开关
sedimentShadow: true        # 只记不生效（M1 用）
sedimentEta: 0.02
sedimentScopeTurns: 20
sedimentMaxDim: 4           # 硬上限，写死不可配
```

路由：
- `POST /cognition-engine/sediment/event`（手动补录，审计用）
- `GET  /cognition-engine/sediment/log?limit=50`（日志，面板用）
- `GET  /cognition-engine/sediment/verify`（哈希链校验，返回 brokenAt 或 ok）

## 六、分步骤（每步都有验收，过不了就停）

### Step 0：单文件原型（1 天，不接插件）
`scripts/sediment-proto.mjs`：内存里的哈希链 + 4 维 + 模拟 30 个事件（10 反转 / 20 补充）。
**验收**：
- 反转/补充的位移范数比 ≥ 5×（不对称）；
- 改任一事件 → `verify` 返回 brokenAt 且之后全断（不可逆）；
- checkpoint 10/20/30 决策模拟互不相同（路径依赖）。

### Step 1：落盘 + 校验（0.5 天）
把原型搬进 `src/sediment.ts`，写真实 JSONL，实现 `verify`。
**验收**：单测覆盖"正常链 ok / 篡改中间一条 → brokenAt 正确 / 追加后仍 ok"。

### Step 2：接 supersede（0.5 天）
两个写入口：`cognition_remember(supersedes)` 与 `POST /memory/supersede` 成功后调用 `sediment.observe`。
**验收**：真实数据里做一次取代 → 日志多一条，`from/to` 是真实 id；做纯补充 → 日志不增加。

### Step 3：影子期（3 天 + 观察 2 周）
`sedimentShadow: true`：只记录，`biasFor` 一律返回中性；面板「沉积」页签显示日志。
**验收**：连续两周日志里有 ≥20 条 tension 且无异常；**少于 20 条就放弃这个模块**。

### Step 4：只放一个参数（2 天 + 观察 2 周）
只启用 `cautionWeight`（注入里"先确认再动手"的权重），其余两个钩子仍关。
**验收**：用户能感知"她更常先问一句"；若收到"怎么变固执了"→ 立刻回滚到 Step 3。

### Step 5：全量 + 评估（2 天）
三条硬测 + 一条附加判据（见下）全过才允许默认开。

## 七、验收（五条，缺一不可）

| # | 判据 | 怎么测 |
|---|---|---|
| A | 不对称 | 反转 vs 补充的位移范数比 ≥ 5× |
| B | 不可逆 | 篡改任一事件 → brokenAt 之后全断 |
| C | 非检索 | 强制 recall 返回空，三个 checkpoint 的差异仍在 |
| D | 惊奇≠张力 | 相似但不矛盾（flip=0）→ 允许 protentionError，retention 必须不变 |
| E | 不可归纳 | 用户两周后**说不出**"她是什么样的人"；能一句话概括 → 判退化成人设 |

## 八、风险与回滚

| 风险 | 触发信号 | 处置 |
|---|---|---|
| 变成固执 | 用户说"怎么变固执了" | 回滚 Step 4，`caution` 权重归零（追加 manual 事件，不改历史） |
| 被少数事件带偏 | 单维 7 天内变动 > 0.15 | 触发上限告警，暂停写入，人工看日志 |
| 空转（没素材） | 2 周 < 20 条 tension | **放弃模块**，不硬推 |
| 自欺（变了但用户无感） | 影子期结束用户说"没差别" | 回到 Step 0 重新设计，不许拿日志糊弄 |

**所有"回滚"都只能是追加 `manual` 事件把方向掰回来，永远不许改历史行** —— 这是 B 判据的题中之义。

## 九、总量

Step 0–2：2 天；Step 3：观察 2 周；Step 4：2 天 + 观察 2 周；Step 5：2 天。
**最短可见效果：约 3 周**（含两段观察期）。不含任何外部依赖。
