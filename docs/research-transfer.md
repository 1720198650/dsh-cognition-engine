# 跨项目知识迁移调研（对应 cognition-engine 插件）

调研日期 2026-11-19。目标：给「subject + BM25 + playbook(boundaryEnvs/confidence) + 立场层 + scope world/user」加最小可用字段与判据。
标 [实测] 的是我核实过摘要/正文的数字；标 [未核实] 的是只见到二手引用。

## 一、跨任务迁移的做法对照表

| 系统/工作 | 怎么判断"这条经验适用于新任务" | 负迁移/风险证据 |
|---|---|---|
| ExpeL（AAAI-24）[arXiv](https://arxiv.org/abs/2308.10144) | 双重：①经验池用 embedding kNN 按**任务描述相似度**取 top-k 成功轨迹；②insight 列表**全量**注入，不检索。insight 靠 UPVOTE/DOWNVOTE/EDIT 维持计分，计分归零删除 | 论文假设"同分布共享知识"，跨域迁移用目标域少量样本"微调"insight 来缓解，未给负迁移数字 |
| Voyager（2023）[arXiv](https://arxiv.org/abs/2305.16291) | 技能库=代码；用 GPT-3.5 给技能写**功能描述**，描述嵌入作键，新任务的做法文字+环境反馈作查询，取 top-5 | 只在 Minecraft 同一世界内验证；新世界的复用只在摘要层面声明，无失败率统计 |
| AWM（ICML 2025）[arXiv](https://arxiv.org/abs/2409.07429) | 语义相似 → 注入 workflow。原文只给增量（WebArena +51.1% 相对、Mind2Web +24.6% 相对；跨网站/跨域 +8.9~14.0 绝对点） | **无显式适用条件**。另文指出其去重只查"语义重叠"，不查对错，错误 workflow 进库后会被一直检索到 |
| 检索即注入的代价 [arXiv:2606.15017](https://arxiv.org/html/2606.15017v2) | — | WebArena 四域三模型：**同预算下 vanilla 智能体优于 AWM/ASI/ReasoningBank**（Gemini 3 Flash 均值 SR 44.78 vs AWM 39.34/ASI 41.02/RBank 39.33）；附录称 Gemini 3 Flash Shopping 板块里 AWM 诱导的 workflow 有 **49.5% 来自失败轨迹** |
| 何时迁移（NeurIPS 2026 workshop）[页面](https://neurips.cc/virtual/2026/loc/atlanta/165606) | 不看相似度、不看 LLM 判断，而是**测量该记忆对该请求的转移增益**（带它跑一遍 vs 不带），在多次上下文中泛化 | 短程设定下：共享**工具调用结构**的记忆有益，即使用在不同对象上；**词面更近但动作不对**的记忆有害，且 agent 仍偏向像的那个；相似度分数与 LLM 裁判对有害样本的排序**不如随机**；伤害随执行器规模增大而增大 |
| SELM（2026）[arXiv](https://arxiv.org/abs/2610.24630) | 关键词：**utility-aware 检索**——先按任务类别选，再按相关性 + **历史有用性**排序；维护 confidence/utility 与生命周期（删留） | 摘要未给负迁移数字 |
| SkillHone（EMNLP 2026 Industry）[ACL](https://aclanthology.org/2026.emnlp-industry.105/) | 判定依据是**证据**：每次技能修订绑定一次评测，留结构化病史（诊断/修订/证据/结果）；候选技能在 practice probe 上真跑 | GAIA +15.8、WebWalkerQA-EN +3.2、内部场景平均 +18.8 点；无负迁移数字 |

结论：**没有哪个系统靠"关键词"做适用判断而奏效**。能用的只有三类可证伪判据——结构匹配（工具调用/步骤骨架）、显式前置条件、以及本地实测增益。

## 二、适用边界的最小结构

### 2.1 证据：边界本身直接影响路由准确率 [实测]

- Scaling Laws of Skills [ar5iv](https://ar5iv.labs.arxiv.org/html/2605.16508)：15 个模型、1141 个技能、300 万次路由。单步路由准确率 `Acc(N)=a-b·lnN`（R²>0.97），**库每翻一倍掉约 3 个百分点**。
- 同样的库，描述只有名字（L1）时准确率 11–72%，带约束/示例描述（L4）时 71–90%；衰减斜率 b 从 0.32 降到 0.08。→ **边界写得越具体，路由越稳**。
- 危险区是**中等语义相似带 [0.55,0.75)**；竞争指数 CI 对单条失败的解释力 R²=0.55，高于库规模 N 的 0.26。→ 你的 BM25 top-k 里真正会出错的，就是"有点像但不是它"的那几条。
- 边界重写单项贡献 **+12.8%** 路由准确率，删除"过度抽象的万能条" **+4.9%**。
- L4→L5 悖论：小库里加反例能锐化边界；大库里反例反而把"近邻混淆项"推到注意力前台。→ 反例只在**族内条目少**时才值得加。

### 2.2 太宽/太窄的后果

- 太宽：退化成"万能条"（论文的 black-hole skill），大库里吸走不成比例的路由份额；且弱任务锚 + 模糊技能描述二者同时出现才会触发捕获（单一条件不够）。
- 太窄：条目在 BM25 里查不出来，等于是死记录；论文未量化。但 More Skills, Worse Agents?（ICML 2026 workshop）[页面](https://ICML.cc/virtual/2026/77891) 给出反面数字：**技能库从"已知有用的小集合"扩到 202 条，通过率最多掉 21%**，分解后主要是"选错技能"（skill shadowing），上下文变大（context overhead）效应≈0。→ **问题在选错，不在条目多**。

### 2.3 最小可用字段（TypeScript，零依赖、纯 JSON 可序列化）

```ts
export type EnvKey = string; // 由 harness 每轮自动产出的环境键，如 "profile:local"
export interface BoundaryCond {
  key: EnvKey;                       // 只允许封闭词表，禁止自由文本
  op: 'eq' | 'neq' | 'has' | 'none';
  value?: string;                    // op=has 时填特征名，如 "ui-diff"
  source: 'observed' | 'inferred';   // inferred 的权重减半，且不得单独否决
}
export interface PlaybookBoundary {
  require: BoundaryCond[];   // 全部满足 ⇒ 可用
  forbid: BoundaryCond[];    // 任一满足 ⇒ 不可用（失效条件，优先于 require）
  whenNot: string[];         // 自然语言失效条件，只给人看，不参与判定
  exemplars: string[];       // 记忆 id：验证过适用 / 验证过不适用
}
export interface TransferStats {  // 与 confidence 分开存，只由结果回填
  n: number; hit: number; miss: number;
  lastEvalAt: number;
}
```

判据（全部可编程、可单测）：

1. **匹配等级**：`require` 全 true 且 `forbid` 全 false → `applicable`；任一 `forbid` 命中 → `rejected`；`require` 里有缺键 → `unknown`。`unknown` 不允许静默当 `applicable`。
2. **排序**：`score = bm25 * conf * (0.5 + 0.5*hitRate)`，`hitRate = hit/(hit+miss+1)`（拉普拉斯平滑，避免冷启动 1/0）。
3. **强制仲裁**：BM25 候选里存在两条相似度落在 [0.55,0.75) 且 `boundary.require` 不交集 → 两条都不注入，改注入"需确认"。
4. **负例落库**：用户纠正（"这不还在吗"）必须写回 `forbid` 条件或 `exemplars` 负例，否则等于没学。
5. **迁移判据**：新场景首轮只注入索引（id+标题），agent 选中后**先声明"我打算用 X，因为 require 全满足"**，再执行；执行结果写 `TransferStats`。这就是 NeurIPS 那篇的"测量增益"在低成本下的近似。

## 三、「越用越好」的实证与天花板

有实证，但**曲线先升后平，再往后会掉**。

- 上升段有据：AWM 在线学习在 **0–40 个样本**内快速爬升，之后"逐渐稳定在最高点"，不再涨 [原文 §3.1.2](https://arxiv.org/html/2409.07429v1)。ExpeL 称"随着经验累积持续提升"，未给曲线数字。
- 记忆量本身不是保护：Controlled Memory Interference [arXiv:2608.07622](https://arxiv.org/abs/2608.07622) 明确"**良性累积影响有限**"，真正伤人的是关系型干扰（同一事实的旧版本/冲突版本同时"相关"）。
- 陈旧假设污染有硬数字：When Retrieval Is Not Enough [arXiv:2610.36308](https://arxiv.org/abs/2610.36308) 用 BM25，Qwen2.5-7B 在 6K 历史上 **检索证据预算 64→512 token，准确率从 45% 掉到 32%**（正确新事实其实已检索到）；把一条无关证据换成"同主题旧版本"，准确率 **100%→44.6%**（Qwen3-14B 100%→87.8%）。→ **BM25 召得更多，不一定答得更对；同 subject 的旧事实是最大的毒**。
- 过时过滤也会反向伤：When Should LLM Agents Forget? [REALM 2026](https://aclanthology.org/2026.realm-1.16/) 标签可靠时硬删得 +0.186~+0.230，最不可靠时变 **−0.176~−0.181**，且**假删比假留更伤**。→ 自动判"已过时"要保守。
- 检索排名随库增长而掉：二手引用称加入 1000 个无关技能后已加载技能召回 73.6%→27.4% [未核实，只见引文](https://huggingface.co/datasets/thaki-AI/daily-paper-2026-10-20-mint-vs-route-break-even/raw/main/main.tex)，未找到原文核实。
- 拐点数字总结：单步路由 ≈ 每翻倍 −3 个百分点（对数衰减，无硬拐点）；技能库 202 条 → 最多 −21%（单项目内）；BM25 证据预算翻 8 倍 → −13 个百分点。

必须加的保护机制（缺一个就会"越学越差"）：

1. **同 subject 冲突检测**：入库前查同 subject 现役事实，冲突就走 supersede，绝不允许两条并存。
2. **注入预算上限**：同 subject 只注入一条权威版本 + 至多一条历史版本，超出丢弃（对应上面 64/512 token 的教训）。
3. **检索裁决**：top-k 相似度差太小就不注入（见二.3 第 3 条）。
4. **有用性计数**：每条 playbook 带 `hit/miss`，低于阈值降权而非删除；ExpeL 的计分归零删除是唯一被验证过的淘汰机制。
5. **定期"陈旧审计"**：只对 `source:'observed'` 的边界自动判定失效；`source:'inferred'` 的必须人确认（对应假删更伤的结论）。

## 四、「分辨力」这个类比的成立范围

**成立的部分**：

- 1-NN 分类器与 CBR 检索-复用循环在数学上是同一件事（检索=相似度打分，复用=取最近样本的标签/解），心理学里的 exemplar 模型对应 1-NN，prototype 模型对应最近中心分类器 [Zubek & Kuncheva, arXiv:1806.01130](https://ar5iv.labs.arxiv.org/html/1806.01130)。你的 `subject + BM25 top-1` 本质就是 1-NN，所以"知识越多、分辨力越强"在**类别之间清晰可分**时成立。
- 工程上已经量化的"分辨力"= 路由准确率，可用 `Acc(N)=a-b·lnN` 预测；边界质量（描述具体程度）能把 b 从 0.32 压到 0.08。也就是说：**加分辨力的正路是加约束/示例，不是加条数**。
- 论文同时给出实例选择（prototype/instance selection）的做法：保留"边界样本"和"代表样本"两类，删掉冗余；编辑法（误分类样本先清洗）通常提升泛化。这正是你该做的：库变大后要**主动精选**，不是只追加。

**过度类比的坑**：

- exemplar 模型"存全部样本"能拟合人的判断，但**泛化能力本身就受质疑**，且参数多易过拟合；1-NN 的理论最优性依赖真实分布采样，而 agent 记忆是**非均匀、有偏、被污染**的采样 → 条数多了不等于覆盖全。
- "分辨力"在人那里包含**类别边界判断**；在 BM25 里只有**词面/词频重叠**。词面近 ≠ 动作对——NeurIPS 那篇正好证明"看起来更相关但动作错的记忆更有害"。所以这个类比在**检索层成立、在适用性判断层不成立**。
- in-context learning "示例越多判别力越强"：**未找到可靠来源**支持这条泛化的说法；能查到的只有 ICL 选择相关工作，未核到"更多示例提升判别力"的直接实验。这一条按无证据处理。
- 原型/典范理论在机器学习里的对应（最近中心分类器）**在类别为单峰时好用，多峰时明显弱于 1-NN/exemplar**；你的 subject 多半多峰，别指望"每个 subject 一条规范事实"。

## 五、落地建议（每条一句话，标成本）

1. 给 playbook 的 `boundaryEnvs: string` 扩成 `require/forbid` 结构化条件，`boundaryEnvs` 原文保留为 `whenNot` 只读展示。**成本：半天 + 迁移脚本。**
2. 环境键用封闭词表（profile / 有无 UI 改动 / 单仓库或多仓库 / 是否发版），由 harness 每轮算出，禁止自由文本。**成本：1 天。**
3. 检索加分改为 `bm25 * conf * (0.5+0.5*hitRate)`，新增 `TransferStats` 字段随结果回填。**成本：半天。**
4. 注入前加"并列冲突仲裁"：两条相似度同处 [0.55,0.75) 且 require 不交集 → 都不注入，改问一句。**成本：半天。**
5. 入库前做同 subject 冲突检查，冲突强制走 supersede，禁止并存（这是 45%→32% 那个坑的唯一解）。**成本：1 天。**
6. 给注入设硬上限：每轮同 subject 最多一条权威事实 + 一条历史。**成本：2 小时。**
7. 用户纠正必须落成 `forbid` 条件或负例 exemplar，不能只写"用户说不对"。**成本：半天。**
8. 每月跑一次"边界卫生"审计：找相似度落在中等带的条目对，重写边界或合并（论文实测 +12.8%）。**成本：每月 1 小时。**
9. 禁止把"万能条"（不带任何 require 的 playbook）留在库里；要么补条件，要么删（实测 +4.9%）。**成本：一次性清理。**
10. 建 5~10 条固定回归任务当 practice probe，每次改检索/边界后跑一遍，比看单轮表现靠谱（SkillHone 的"证据绑定修订"）。**成本：半天建库，之后每次 10 分钟。**
11. 不要靠 LLM 裁判判断"这条适用不适用"——相似度和 LLM 裁判对有害记忆的排序不如随机（NeurIPS 2026），只用结构条件 + 实测结果。**成本：0（省下的）。**

## 未找到可靠来源

- "更多 in-context 示例提升判别力"的直接实验证据。
- SkillHone 的负迁移/退化数字（论文只报增益）。
- SELM 的负迁移数字（摘要未给）。
- "加 1000 个无关技能 → 召回 73.6%→27.4%"的原文（只见到二手引文，未核实）。
- 负迁移（negative transfer）在 agent 记忆系统里的统一定义与跨系统可比数字：未找到；现有数字都是单篇自设基准。
