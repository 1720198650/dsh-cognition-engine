# L3 自动修订：触发门槛、存档、标注

一句话：**只在有外部证据时改、一次只改一个对象、改前先落事件和快照、标注写在数据里。**
三条最关键：① 无外部反馈的自我修订在实验里是**掉分**的（Huang 2024），所以"模型觉得该改"不能当触发条件；② 存档用**事件日志 + 对象快照**，不是每次存完整前后对象，因为事实本来就有旧版本、规则体量小；③ 标注必须是数据字段（`origin`/`by`），渲染前缀只是显示，不能写进 `content`。

---

## 一、触发门槛

先摆证据（都核过原文/原文引用）：

| 工作 | 机制 | 关键数字 |
|---|---|---|
| [ExpeL](https://arxiv.org/abs/2308.10144) | insight 带整数重要度：新增 = **2**，UPVOTE/EDIT +1，DOWNVOTE −1，**降到 0 自动删除**（无 REMOVE 操作） | 论文未给阈值的消融；2 这个起点是设计选择 |
| [ACE](https://arxiv.org/abs/2510.04618) §3.1–3.2 | bullet = 唯一 id + helpful/harmful 计数 + 内容；grow-and-refine：新 id 追加、原地更新计数、语义去重，去重可**周期性或惰性**（上下文超限才做） | 实证：全量重写会 collapse——18,282 tokens/66.7 分 → 122 tokens/**57.1** 分，低于不改的 63.7 |
| [SkillHone](https://aclanthology.org/2026.emnlp-industry.105/) | 每步一条决策记录 `h=(诊断 q, 修订 r, 证据 e, 结果 o)`，o ∈ {accept, revise, reject, defer} | 消融去掉决策历史：GAIA **−13.4**、WebWalkerQA-EN **−10.9** |
| [Huang et al. 2024](https://arxiv.org/abs/2310.01798) | 无外部反馈的 intrinsic self-correction | GPT-3.5 GSM8K 75.9→75.1→**74.7**；CommonSenseQA 75.8→**38.1**；Llama-2 GSM8K 62.0→**36.5**；GPT-4 95.5→**89.0**；74.7% 的情况根本不该改初答 |
| [Reflexion](https://arxiv.org/abs/2303.11366) | 自我反思写入记忆 | 其推理实验依赖 oracle 标签（Huang 表 1 点名），**不能当"自我修订有效"的证据** |

三条可操作结论：**触发只能来自外部信号**（用户纠正 / 使用后 appliedBad / 用户明说"以后都"）；**轮数越多越差**，所以一次修订只允许一轮，不做"改完再自查再改"；**模型自查最多产出候选**，不许直接落库。

| # | 条件 | 阈值 | 依据强度 |
|---|---|---|---|
| 1 | 用户明确纠正（"不对"/"应该是"/"以后都…"） | **≥1 次**即触发 | **有实验支持**：外部反馈是唯一可靠修正信号（Huang 2024 全文结论） |
| 2 | 同一对象收到相反证据 | **≥2 条独立反证**（不同会话/不同 `trace`）才降级或改写 | **工程惯例**：ExpeL 的"2 次净反对才删"照搬，但其阈值无数值消融 |
| 3 | 模型自查认为"应改写" | **0 次触发**，只写进候选队列 | **有实验支持**：intrinsic self-correction 全线下滑（上表数字） |
| 4 | 冷却期 | 同一对象 **24h 内最多自动改 1 次** | **我的推测**，无来源；理由是防止同一轮对话里反复横跳 |
| 5 | 成本闸门 | **≤5 次自动修订/天**，每次 **≤1 条模型调用**；超预算转候选 | **我的推测**（成本约束）；ACE 的增量合并省成本有数据，但不含此阈值 |
| 6 | 单次影响面 | 每次只改 **1 个对象、1 条内容**，禁止全库重写 | **有实验支持**：ACE 的 context collapse 数字 |
| 7 | 删除 | **永不自动删**；只置 `status=retired` 或降置信度 | **工程惯例**：Fowler 指出可逆性要么靠差分、要么靠事件自存旧值 |

补一条区分：用户**纠正现有条目**算外部证据；用户只是**表达偏好**（"我喜欢简洁点"）算新增素材，不算修订依据——否则会拿闲聊去改准则。

---

## 二、存档结构与保留策略

**结论：操作日志为主、对象快照为辅；不存"每次修改前的完整对象副本"。**

- 事件溯源里，可反转的事件要么本身是差分，要么**由事件自带被改值的旧值**（"storing the previous values on any value that is changed"）；快照只是回放性能优化——"所有反转能力都可以用回到过去快照再重放事件来实现"（[Fowler, Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)）。
- 我们的事实层已经是双时态：旧记录不删，留 `validTo`/`supersededBy`/`supersedeReason`。**事实的"改前存档"就是旧记录本身**，不需要再复制一份。
- 只有准则（`cognition-playbook.json`）需要显式 `before`，单条 < 2 KB，存得起。
- 不要存全量前后对象还有一个实测理由：ACE 的 collapse 数字说明"每次重写整篇"是危险的，存档同理会把每次修订膨胀成整库拷贝。

保留策略：

| 项 | 规则 | 现状/估算 |
|---|---|---|
| 事件日志 `cognition-playbook-events.jsonl` | 追加写、永不删、单文件 5 MB 轮转 | 现 6.5 KB / 30 条；一次修订 ≈ 400 B |
| 对象快照 `.snapshots/` | **修订前只快照被改对象**；每 20 条事件或每天 1 次全量 | 单对象 < 2 KB；五年 500 次 ≈ 1.2 MB |
| 轮转文件上限 | 5 MB ≈ 1.2 万条；保留最近 5 个 = 约 6 万条 / 25 MB 封顶 | 超出删最老轮转，不删当前 |
| 快照份数 | 滚动保留 20 份（沿用现有 `.snapshots/` 目录） | 约 40 KB–2 MB |

最小 JSON（字段名对齐现有 `RuleAccepted`/`RuleRetired` 事件与 `history[]`）：

```json
{"v":1,"seq":31,"at":1795000000000,"type":"RuleRevised","ruleId":"ctxt-00007","by":"auto",
 "trigger":"user_correction","reason":"用户明确：地点口径一律写「户外场地」",
 "before":{"content":"…户外设备场地…","confidence":0.6,"updatedAt":1794000000000},
 "after":{"content":"…户外场地…","confidence":0.8},
 "evidence":["mem-39-551d9a","turn:2026-11-07T18:38"],"prevAutoRev":0,"revId":"rev-0012"}
```

```json
{"takenAt":1795000000000,"why":"before_autorevise","seq":31,
 "objects":[{"kind":"rule","id":"ctxt-00007","value":{}}]}
```

回滚：按 `seq` 取事件里的 `before` → **写一条补偿事件 `RuleReverted`（不删原事件）** → 回填字段；找不到事件就回落到该 seq 之前的快照。历史只追加、不改写。

---

## 三、标注与链式修订规则

**结论：数据里落字段是唯一依据，渲染前缀只是显示。**

ACE 的 bullet 元数据，论文列出的只有"唯一 id + helpful/harmful 计数"，**未提来源/作者字段**（[§3.1](https://arxiv.org/html/2510.04618v1)）——所以 ACE 本身不满足"标注"，能抄的是 SkillHone 的决策历史。Anthropic 对 memory 的口径是用户**逐条可见、可编辑、可删除**，写入敏感主题时给可见提示（[Claude memory](https://claude.com/resources/articles/claudes-memory-works-everywhere-and-you-decide-whats-in-it)）：可审计性靠"用户看得见并能改"，不靠模型自述。SkillHone 的消融则证明**留下决策历史本身值 10 分以上**。

要落的字段：

| 位置 | 字段 | 值 |
|---|---|---|
| 条目 | `origin` | 新增 `auto_revise`（现有 `human`/`agent_tool`/`ui`） |
| 条目 | `autoRev` | `{count, lastAt, chain:[revId], locked}` |
| 条目 `history[]` | `diagnosis`/`evidence`/`outcome` | 对齐 SkillHone 的 q/r/e/o（见 `research-skillhone-pybot.md` P4-1） |
| 事件 | `by` | 新增 `auto`（现有 `user`/`system`） |
| 事件 | `trigger`/`evidence`/`reason` | 三者必填，缺一不许落库 |

渲染：面板列表与注入文本对自动改过的条目加「[自动修订]」前缀，**前缀不进 `content`**（否则污染哈希、检索，还会在下一轮被重复套娃）。显示层从 `origin` 推导。

链式修订规则：

1. 自动改过的内容**允许再次自动改**，但门槛递增：第 2 次起要 ≥2 条**新**反证，冷却期 24h→72h。
2. 用户手动改过（`origin=human` 或 `locked=true`）的条目，自动修订**只出建议**，写进候选，不改本体。
3. `autoRev.count` 上限 3；到 3 强制转人工复核，之后不再自动改。
4. 回滚只回退链尾一步，不跳步；跳步要人工确认。
5. `outcome` 允许是 `defer`/`reject`——"这轮不改"也是合法结果，SkillHone 明确列了这四个取值。

依据强度：1、2、3 是**我的推测**（工程惯例，无实验）；4 是工程惯例；5 有论文支持。

---

## 四、最小可落地清单

| # | 做什么 | 验收 |
|---|---|---|
| 1 | 设置项 `autoRevise:{enabled:false, dailyCap:5, cooldownH:24, maxChain:3}`，面板默认关 | 关掉后一次模型调用都不发（查 usage 日志为零） |
| 2 | 只接三个免费信号：用户纠正词、`appliedBad`、用户明说"以后都"；命中才进候选 | 无信号时事件日志零增长 |
| 3 | 先写 `RuleRevised` 事件 + 对象快照，**落盘成功后才改内存与本体** | `kill` 进程后重放事件能还原到改前 |
| 4 | 回滚按 `seq` 写 `RuleReverted` 补偿事件 | 回滚后 `content`/`hash`/计数与快照一致 |
| 5 | 标注：`origin:"auto_revise"` + 面板前缀 + 面板展示 `trigger`/`evidence`/`reason` | 注入文本里 grep 不到「[自动修订]」 |
| 6 | 事实走已有 supersede（旧记录天然留档），准则走事件+快照；**不新增第四套存储** | 数据文件数不增加 |
| 7 | 明确不做：自动删除、自动改用户锁定条目、一次改多条、无外部证据的模型自查 | 代码里搜不到自动 delete 路径 |

**未找到可靠来源**：ExpeL 的"初始 2 分"没有阈值消融；ACE 的去重阈值论文未给数字（实现里是 embedding 阈值 + 惰性触发）；"24h 冷却""每天 5 次"没有任何文献支撑，是本方案的工程取值，第一次跑观察期后应按实际误改率调整。
