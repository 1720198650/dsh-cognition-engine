# 认知引擎升级方案 v2.1

> 起草：2026-11-05
> 定位重估：从「记忆插件」→「**信念库**（belief store）」
> 两份调研报告：[research-philosophy-engineering.md](research-philosophy-engineering.md)（304 行）、[research-frozen-weight-learning.md](research-frozen-weight-learning.md)（206 行）

---

## 一、重新定位

现在 README 写的是「给 AI 装一层记忆」——**这把我们放进了红海**，所有记忆插件都在做「记得住」。

真实差异化一直很清楚：

> **别的插件回答「我记得什么」，我们回答「我凭什么信、什么时候该作废」。**

| 层次 | 内容 | 类比 | 现状 |
|---|---|---|---|
| 材料 | 双时态记忆 | 证据 | ✅ |
| 分类 | 主题（适用范围键） | 卷宗 | ✅ |
| 结论 | 准则本 | 判例 | ✅ |
| **依据** | **凭什么是它、什么时候失效** | **判决理由 + 撤销机制** | ❌ **空** |

第四层叫 belief revision（信念修正），哲学与 AI 交叉研究了 40 年。**这是我们要补的。**

---

## 二、先纠正三个被证伪的说法

调研的重要价值之一是**否掉**听起来对的东西：

| 说法 | 核实结果 |
|---|---|
| 「veritas-tms 的可借鉴机制」 | ❌ **项目不存在**。GitHub 搜索 total=0；相近的 Veritas 仓库只有 279 字节 README、无代码 |
| 「HADES 的 `anchoredTo` 字段」 | ❌ **0 命中**。仓库 201 个文件全文搜索无此字段 |
| 「HADES 整体可借鉴」 | ❌ 依赖 ArangoDB + Jina V4 2048 维 + RGCN/GraphSAGE，**零依赖不可实现**，只留公理门控概念 |

但有两项**比预期更好**：

| 发现 | 说明 |
|---|---|
| **LeAP/CITE 有真实开源实现** | [engrammic-ai/primitives](https://github.com/engrammic-ai/primitives)，四层认识类型有完整代码，**最值得抄** |
| **ftl-reasons 是真 TMS 实现** | `benthomasson/ftl-reasons`，IN/OUT 节点、SL/CP justification、依赖定向回溯、**entrenchment 公式**、211 个测试 |

---

## 三、六条机制（按可落地性排序）

### M0 形式改造：祈使句 + 触发条件（**证据最强，成本最低**）

**证据**：[forge_dc](https://openreview.net/forum?id=7XhMLOsQoA)（NeurIPS 2026 PALM）

> 同一条用户纠正，写成**祈使 RULE** 注入决策点 = **95% 合规**；
> 作为描述性文本检索进上下文 = **55%**，且规则方案 token 少约 **10 倍**。
> —— "Only Rules Rule"

**对我们的意义**：我们的准则是祈使句，方向对了，但**缺显式触发条件**。

**改造**：每条准则必须有 `trigger`（什么时候适用），格式：

```
[ctxt-00001] 当要发布版本时：依次执行卸载验证→兼容性检查→代码优化→README 覆盖→安装验证，不可跳步
```

我们已有 `trigger` 字段（用于拦截判定），但**注入时不显示**。改成注入时带上。

---

### M1 来源分层 + 写入门控（半天，堵住「模型写什么都算数」）

**依据**：[LeAP/CITE](https://github.com/engrammic-ai/primitives) 的四层认识类型 + 写权限分离。

**核心原则**：
- Agent 工具只能写 **低两级**（`auto` / `agent`）
- `human` 只能由用户侧产生，**只能用户提升**
- 晋升一次一级，**不可降级、不可跳级**
- 没有 `grounding.quote`（原文引用）的条目只能是 candidate，不进生效集

**数据结构**：

```ts
type Origin = 'human' | 'agent' | 'auto';

interface Trust {
  origin: Origin;
  /** 晋升历史，只增不减 */
  originHistory: Array<{ from: Origin; to: Origin; at: number; by: 'agent' | 'user' }>;
  /** 原文引用：凭什么信这条 */
  grounding?: {
    quote: string;      // 原话/原文片段
    sourceId: string;   // 来自哪条记忆
    location?: string;  // 可选：文件/行/时间
    ratifiedBy: string;
    ratifiedAt: number;
  };
}
```

**写入门控（代码写死，不由模型决定）**：
- `cognition_remember` 工具 schema 只接受 `origin: 'agent' | 'auto'`
- 蒸馏产出的候选一律 `auto`，人工确认后升 `agent`
- 用户手动新增/确认 → `human`
- 无 `grounding` 的准则只能是 `pending`，不进注入

**行为**：注入时把等级花在措辞上——
`human` → 直接陈述；`agent` → 加「（AI 记录，待核实）」；`auto` → 不进注入。

---

### M2 证据链与依赖传播（1–2 天，**核心差异化**）

**依据**：[Doyle TMS 1979](https://dspace.mit.edu/handle/1721.1/6197)、
[de Kleer ATMS 1986](https://hivebook.wiki/wiki/belief-expiry-is-a-graph-reachability-operation-not-a-delete-retraction-orphans-downstream-inferences)、
[ftl-reasons](https://github.com/benthomasson/ftl-reasons)。

**核心洞察**：

> 撤回一个信念**不是删一行**。删除那条记录会留下所有由它推导出来的下游结论——
> 它们成为没有主人的事实，**撤回看起来完成了，污染却还在**。
> 正确操作是图操作：砍掉被撤回节点的出边，从存活支持重新计算可达性。

**我们现在就犯着这个错**（代码已核实）：

```
sourceIds 只在两处被用：
  ① submit 时校验 id 存在
  ② 蒸馏时排除已引用记忆
❌ 从来没有：记忆变更后回头检查依赖它的准则
```

**数据结构**：

```ts
interface Justification {
  in: string[];   // AND：这些都在才算成立
  out?: string[]; // 可选
}

interface DepNode {
  id: string;
  /** 外层数组 = OR（任一组成立即可） */
  justifications: Justification[];
  dependents: string[];
  status: 'active' | 'suspect' | 'superseded' | 'revoked';
  /** 因为哪些前提失效而可疑 */
  staleBecause?: string[];
}
```

**传播算法**：
1. 记忆 `supersede` / `delete` / expire 时，沿 `dependents` BFS
2. 当某节点的**所有** justification 都失效 → `status = 'suspect'`，记 `staleBecause`
3. **不删、不改真值**——恢复前提时反向重算可自动回 `active`
4. 复杂度 O(n+e)，几百条无压力

**entrenchment 公式**（照 ftl-reasons，用于冲突时决定牺牲谁）：

```
entrenchment = (human ? 100 : agent ? 50 : 20)
             + (grounding ? 50 : 0)
             + dependents.length × 10
             + (principle ? 40 : observation ? 20 : 10)
```

冲突时**牺牲 entrenchment 最低的**。

---

### M3 结构矛盾 + 1.2× 优势 + 未决（1–2 天）

**依据**：LeAP/CITE 的结构矛盾判定 + `new ≥ 1.2×old` 阈值。

**判定**：同主题 + 同 `(subject, predicate)` + 不同 `object` → 矛盾。

**裁决（代码算，不由模型报）**：

| 条件 | 动作 |
|---|---|
| `new.confidence ≥ 1.2 × old.confidence` | 旧条 `validTo = 新条.validFrom`、`supersededBy = new.id`、`supersedeReason = 'contradiction'` |
| `old.confidence ≥ 1.2 × new.confidence` | 新条 rejected |
| **都不满足** | 两条都 active，共享 `conflictGroupId`，**并排召回**（明确告诉模型「存在未决分歧」） |

**tombstone（墓碑）**：区分两种作废，**必须分开记**：

| | 含义 | 字段 |
|---|---|---|
| `superseded` | 有更好的证据取代了它 | `supersededBy` + `supersedeReason` |
| `revoked` | 发现它**本来就是错的** | `tombstone: { revokedAt, reason, replacedBy? }` |

**confidence 计算公式**（代码算，不由模型报）：

```
confidence = tier(origin: human 1.0 / agent 0.6 / auto 0.4)
           × (1 − e^(−0.5 × 独立来源数))
           × (有 grounding ? 0.85 : 0.6)
```

**对散文条目**：没有 SPO 三元组的，**不做矛盾判定**（不猜）。

---

### M4 「不对」归因四象限（2–3 天，**让反馈真正可用**）

**这一条解决我用自己提出的难题**：用户说「不对」时，怎么知道是准则错了还是模型理解错了？

**依据**：[MemPrompt](https://arxiv.org/abs/2201.06009)（先输出理解、让用户纠正理解）+
[forge_dc](https://openreview.net/forum?id=7XhMLOsQoA)（从人类纠正提取信号）+ ACE 的自标注。

**做法**：

**第一步：事前留痕**。回答前输出两行：

```
我理解你要的是：<一句话复述>
[应用: ctxt-00001, ctxt-00005]
```

（注入文本里带 id，模型点名引用 → 我们能知道它用了哪几条）

**第二步：用户说「不对」时，先二选一**：

> 是 **(a) 我理解错了你的要求**，还是 **(b) 理解对了但做法/规则不对**？

**第三步：四象限归因**

| 象限 | 判定 | 动作 |
|---|---|---|
| 理解不匹配 | 用户选 (a) | **不改计数**，记 `retrieval_miss`，收窄 trigger |
| 理解匹配 + 应用了 + 输出违反准则 | 用户选 (b) 且模型该做没做 | **执行问题**：改写祈使句/前移，**不降级** |
| 理解匹配 + 应用了 + 符合准则但结果差 | 用户选 (b) 且模型照做了 | **准则错**：`harmful +1`，强制挂证据链，**≥2 次独立纠正才降级** |
| 理解匹配 + 没应用 | 溯源发现该用没用 | 记 `retrieval_miss`，补 trigger |

**第四步：争议条目做反事实重放**（带/不带该条各跑一遍），**只有去掉后变好才算因果**。

**关键改造：拆计数**。现在的 `helpful / harmful` 太粗，改成：

```ts
interface UsageStats {
  applied: number;        // 被引用次数
  appliedGood: number;    // 用了且结果好
  appliedBad: number;     // 用了且结果差
  missed: number;         // 该用没用
  userCorrected: number;  // 用户纠正
  lastTrace?: string;     // 每次变化必须挂 trace
}
```

> **不拆的话，检索错误会被记到准则头上，准则本会越用越保守。**

**降级阈值**（[ReasoningBank](https://arxiv.org/abs/2509.25140) 的噪声结论：判官只有 72.7% 准确，但 70–90% 噪声下性能不敏感）：

- `Beta(1,1)` 先验
- `appliedGood / applied < 0.3` **且** 样本 ≥ 5 才降级
- **单次纠正永不删除**

---

### M5 两层注入 + 使用时准入（半天）

**依据**：[ExpeL](https://arxiv.org/abs/2308.10144)（insight 列表**全量拼进提示**）+
[PATH-Bench SEU](https://arxiv.org/abs/2608.01149)（使用时逐条判 preserve / abstract / ignore，**FGT 最多降 16.84pp**）。

**注入结构改成两层**：

```
常驻核心（20–40 条，全量注入，占 ≤500 字符）
  └ 高 entrenchment 的准则
每轮相关（3–5 条，按当前任务检索）
  └ 匹配主题/触发条件的准则
```

**上限 300 条**，超过按 entrenchment 淘汰。

**SEU 准入**：注入时给每条标注可用方式：

| 标记 | 含义 | 模型该怎么做 |
|---|---|---|
| `[可复用]` | 证据充分、已验证 | 直接套用 |
| `[仅参考]` | 未验证/证据弱 | 只借鉴思路 |
| `[存疑]` | 有反证/证据断裂 | 提出但标明不确定 |

比现在的「全部平铺 + 预算截断」精确得多。

---

## 四、学习闭环：从被动积累到主动补缺

调研结论：**风识（dsh-engram-relay）的「自动补卡」是现成的学习闭环**——
agent 求助无答案 → 生成知识卡 → 下次即有（当日上限 5 张防噪声）。

我们没有这个。我们的准则是**离线蒸馏**出来的，不来自实际卡壳处。

**方案（P6，3–5 天）**：

1. 新增工具 `cognition_gap`：模型承认「我不知道」时调用，记录**问题文本 + 当时上下文**
2. 进「待补清单」（`gaps.json`）
3. 下次有相关记忆写入 → 提示「这个问题现在能回答了」
4. 蒸馏时把 gap 纳入输入，让它**针对性地产候选**

**为什么重要**：这是从「被动积累」到「主动发现知识缺口」的转折。

---

## 五、明确不做（含纠正我自己的错误）

| 不做 | 理由 |
|---|---|
| **时间衰减参与真实性判断** | **语义错误**。arXiv 2604.11364：**「最近没被访问 ≠ 不太真」**。衰减只能用于**排序/提醒**（查询期），不能改 `status`（存储期） |
| Oblivion 式衰减（本插件规模） | 那是 120K 跨度设计；**几十条规模别默认开** |
| 向量检索 / embedding | 破坏零依赖；10² 规模不需要 |
| 自动聚类 / 自动成簇 | SubtleMemory 与 PATH-Bench 都证明小规模结构化是净损失 |
| 五层证据枚举 | 5 条准则时全部同值，零行为差异 |
| HADES 整体 | 依赖 ArangoDB + Jina V4 + GNN |
| GRACE 完整 defeasible logic | 定理证明对几百条准则是过度工程，只借「规则有显式优先级」 |
| ITEM 迭代效用打分 | 需要多轮 LLM 调用，宿主 agent 代劳即可，插件只存分数 |
| 独立公理文件 axioms.json | 用 `pinned: boolean` 字段即可 |

**另外纠正我自己 v2.0 里的错误**：我原先写「衰减参与注入排序」，需要改成——
**衰减只能作为同分时的 tiebreaker，不能压过 entrenchment**。

---

## 六、分阶段路线

| 阶段 | 内容 | 成本 | 验收 |
|---|---|---|---|
| **P0** | 准则注入带触发条件（祈使句 + 何时适用） | 半天 | 注入文本每条都有触发语境 |
| **P1** | 来源分层 + 写入门控 | 1 天 | agent 写的只能是 `agent`；无 grounding 不进生效集 |
| **P2** | 证据链传播 + suspect | 1–2 天 | 作废基础记忆 → 依赖准则 `suspect` 不消失；恢复后自动回 active |
| **P3** | 拆计数 + 归因四象限 | 2–3 天 | 「不对」能区分四种原因，单次纠正不删条目 |
| **P4** | 结构矛盾 + 1.2× + 未决并排 | 1–2 天 | 1.1× 时两条都 active 且标未决；1.3× 时旧条 superseded 但可检索 |
| **P5** | 两层注入 + SEU 准入 | 半天 | 注入分 `[可复用]`/`[仅参考]`/`[存疑]` |
| **P6** | 学习闭环 `cognition_gap` | 3–5 天 | 承认不知道 → 进待补 → 下次能回答 |
| **P7** | 遗忘度量（FGT 式） | 1–2 天 | 能量化「加准则后旧准则命中率下降多少」 |

**总成本约 10–15 个工作日。建议一次只做一个阶段，每个阶段独立验收后再往下。**

---

## 七、验收标准

升级是否成功，看这些**能不能测出来**：

| 指标 | 现在 | 目标 |
|---|---|---|
| 准则 `helpful` 总计数 | 2（手动假值） | 自动产生，且拆成 5 类 |
| 证据链断裂检测 | 0 条 | 记忆变更后自动发现 |
| 「不对」归因 | 无 | 四象限可区分 |
| 未决分歧 | 静默选一条 | 并排呈现给模型 |
| 遗忘度量 | 无 | 有 FGT 式指标 |

**最重要的一条**：

> 升级后要能用真实数据回答——**加了证据链，模型遵守准则的行为有没有可观测地变好？**
> 如果测不出来，说明这层治理也是空转。

这个判断标准来自我们自己的教训：753 行自动聚类，四个月零产出。

---

## 八、诚实清单（调研未能证实的）

调研明确标出的空白，也是我们的机会：

1. **没有**严格对照「写进系统提示 vs 只做检索」的论文（只有 4 组间接证据，都指向「形式比通道更决定成败」）
2. **没有**专门研究 agent 隐式反馈学习的论文
3. **没有**把「用户纠正」当记忆降级信号并做**因果归因**的系统——**这是空白，可作差异化**
4. 2026 年这批新工作（PATH-Bench / Oblivion 等）**均未见独立复现**

---

## 九、文档关系

| 文档 | 内容 |
|---|---|
| [research-philosophy-engineering.md](research-philosophy-engineering.md) | 哲学工程化项目的逐项核实与机制提取 |
| [research-frozen-weight-learning.md](research-frozen-weight-learning.md) | 冻结权重下的学习/遗忘论文与数字 |
| [topic-research.md](topic-research.md) | 主题层为什么不用自动聚类 |
| [in-context-learning-research.md](in-context-learning-research.md) | 「学习」在这个插件里指什么 |
| [evaluation-review-and-learning.md](evaluation-review-and-learning.md) | 对外部评估备忘的反驳与采纳 |
| 本文 | **六条机制 + 八阶段路线 + 验收标准** |
