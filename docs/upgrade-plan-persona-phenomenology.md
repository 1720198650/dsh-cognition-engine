# 人格模块升级方案：现象学偏置层（含材料真伪甄别）
> ## ⚠️ 更正声明（2026-11-10 晚，重要）
>
> 本文第一节那张「查无记录」表**是错的，我撤回**。原因：当时搜索后端配置坏了（provider 名 `ddg` 未注册），
> 我只能搜 arXiv 与通用网页，**搜不到哲学库（PhilPapers）、Zenodo 预印本平台、Springer 期刊**。
> 换成可用搜索后，六条全部查到了：
>
> | 之前判定 | 实际 | 出处 |
> |---|---|---|
> | Chris Sawyer《Temporal Skew》查无 | ✅ **存在** | [PhilPapers 记录](https://philpapers.org/rec/SAWTSA) |
> | ARPM 查无 | ✅ **存在**，且是 arXiv 论文 | [arXiv:2605.14802](https://arxiv.org/abs/2605.14802)《A Heterogeneous Temporal Memory Governance Framework for Long-Term LLM Persona Consistency》 |
> | Melissa 查无 | ✅ **存在**（Zenodo 白皮书 + GitHub） | [Zenodo 18333447](https://zenodo.org/records/18333447)，作者 Marcelo Nicchio |
> | Project Sue 查无 | ✅ **存在**（Zenodo） | [Zenodo 22022948](https://zenodo.org/records/22022948) |
> | Robodiment 未证实 | ✅ **存在** | [PhilPapers 记录](https://philpapers.org/rec/INCRSA)（Incao / Sciutti / Gallagher） |
> | 5594→32 篇综述未证实 | ✅ **存在** | [Springer 10.1007/s44163-026-02602-4](https://link.springer.com/article/10.1007/s44163-026-02602-4) |
>
> **教训写在这里**：搜索引擎返回「0 条」不等于「不存在」。以后判定「查无此文」前，
> 必须先确认搜到的库覆盖了目标领域（哲学→PhilPapers，预印本→Zenodo/SSRN），否则只能说「本次未检索到」。
>
> 下面第一节保留原文，仅作记录；**以本声明为准**。


> 2026-11-10。用户给了一份"现象学人格工程化"材料。**动手前先做了一件事：逐条核实引用**。
> 结果：材料里 **5—6 条关键引用查不到任何记录**，另有 3 条真实可查。方案只能建立在真实的那几条上。

---

## 一、真伪甄别（先看这张表）

| 材料里的说法 | 判定 | 核实情况 |
|---|---|---|
| **ITCMA（Internal Time-Consciousness Machine）**：以胡塞尔内时间意识为蓝本的计算架构，有机器人实验 | ✅ **真实** | [arXiv:2403.20097](https://arxiv.org/abs/2403.20097)《ITCMA: A Generative Agent Based on a Computational Consciousness Structure》，2024-03。另有后续工作引用其"时间场/滞留/前提"结构 |
| **Pae：把主观视角操作化为"缓慢演化的全局潜在状态"，调制快策略但不被行为后果直接优化，表现出方向依赖滞后（hysteresis）** | ✅ **真实** | [arXiv:2602.02902](https://arxiv.org/abs/2602.02902)《Minimal Computational Preconditions for Subjective Perspective in Artificial Agents》，2026-02。摘要与材料描述一致 |
| **AutoPersonas：Occurrence / Observation / State 分离，多时间尺度循环，针对 persona self-locking** | ✅ **真实** | [arXiv:2607.08252](https://arxiv.org/abs/2607.08252)，2026-07。摘要明确写 "self-locking as a runtime failure mode" |
| **`dsh-yogacara`：种子藏—熏习—现行，51 心所，写回系统提示** | ✅ **真实（开源项目）** | GitHub `tancheng33/dsh-yogacara`，README 与材料描述一致（唯识自我模型插件，7★） |
| **`dsh_laap`：五维状态向量 + 微分方程演化** | ✅ **真实（开源项目）** | GitHub `WindDreamboat/dsh_laap`（"插件-dsh意识工程最小实现"，3★）。**但"五维状态/微分方程"未见 README 佐证**，属待核 |
| **Chris Sawyer《Temporal Skew: Asymmetry and the Ground of Subjectivity》** | ❌ **查不到** | arXiv、搜索均无此书/此文。**"temporal skew"作为判据可以借用其语义，但不能挂着这个不存在的出处** |
| **ARPM（Heterogeneous Temporal Memory Governance Framework）** | ❌ **查不到** | 搜 ARPM 只得到量化风险管理机构 arpm.co，与记忆治理无关 |
| **Melissa Framework（LETTER / DOC-EVOLUTION / TESTAMENT，DeepSeek 上 10+ 实例）** | ❌ **查不到** | 无任何学术或开源记录（搜到的是鞋品牌）。**"10+ 独立实例复现"这种具体断言尤其不可信** |
| **Project Sue（"持续运行问题"、延迟分享、主动克制）** | ❌ **查不到** | 无记录 |
| **Incao, Sciutti & Gallagher《Robodiment, Self and Temporality》** | ⚠️ **未证实** | arXiv 无此文；Gallagher（Shaun Gallagher）本人是真实的具身认知哲学家，但**这篇具体文献查不到**，不能当引用用 |
| **"2026 范围综述：5,594 条记录 → 32 篇胡塞尔锚点出版物"** | ⚠️ **未证实** | 未检索到此综述。数字太具体，不能引用 |
| **"habituation/sedimentation 去掉后 ScienceQA 39.8%、幻觉 29.0%"** | ⚠️ **未证实** | 未找到对应工程研究 |

**结论**：这份材料是**真人真项目 + 编造文献混在一起**。真实的三块（Pae 的形式化、ITCMA 的时间架构、yogacara 的因果骨架）已经够支撑一个方案；编造的五六条（Sawyer/ARPM/Melissa/Sue/综述/沉淀实验）必须从方案里剔掉，否则整个设计会挂在不存在的支柱上。

---

## 二、目标重述（去掉包装后）

不是"写一个人格提示词"，而是：**让历史经历以非检索的方式，改变当前生成的起点**，并且这个改变要满足三条可测判据：

1. **不对称**：过去的重量大于未来，不能被"平衡回来"；
2. **不可逆**：只追加，不能被奖励直接优化或回滚；
3. **非检索**：不是"查到了旧记忆"，而是"看这件事的方式变了"。

第 3 条是全部难点，也是唯一能证伪的地方——**如果关掉检索、行为差异就消失，那它只是检索**。

---

## 三、真实可借的三个骨架

| 骨架 | 提供什么 | 我们怎么用 |
|---|---|---|
| **Pae（2602.02902）** | 慢变量与快策略**解耦**；慢变量**不被后果直接优化**；表现为方向依赖的**滞后** | 偏置层的数学形式：3~5 维慢变量，梯度阻断，只允许单调/惯性漂移 |
| **ITCMA（2403.20097）** | 把"当下/滞留/前提"做成**时间场**并驱动行动生成，有真机数据 | 说明"时间结构当架构设计"不是空谈；我们只借"前提（protention）参与当前"这一点 |
| **dsh-yogacara（开源）** | 种子—熏习—现行的**只追加因果链**：经历→熏习→种子→现行 | 借它的**数据结构与写入时机**；**必须拆掉**解脱论目的论（转识成智）、把阿赖耶识降格为"只追加偏置轨迹" |

AutoPersonas 的 Occurrence / Observation / State 三分可以直接用：**新事件不改 State，只产生 Observation；Observation 累积成方向；方向与旧轨迹形成张力时才推动 State**。

---

## 四、方案（三层，最小可验证优先）

### 第 0 步：单文件原型（先做这个，2 天）
`scripts/bias-proto.mjs`，**不接 DSH、不接双时态**：

- 一个只追加的轨迹文件（每行：`{at, trigger, delta[3], before, after}`）；
- 一个 3 维偏置向量 `d = [attentionBias, suppressionBias, recallPriority]`；
- 一次"熏习"：给定 `(旧信念, 新信念, 张力强度)`，按张力算一个**小幅、单向**的 delta，累加进轨迹；
- 一个极简生成模拟：同一情境 → 用 `d` 调整"注意到什么/抑制什么" → 输出选择。

**三个 checkpoint 的验收**（这就是"不可逆偏移"的可执行定义）：

```
checkpoint A（轨迹第 10 条）→ 选 X
checkpoint B（第 50 条，同类张力再来一次）→ 选 Y ≠ X
checkpoint C（第 100 条）→ 选 Z ≠ Y
并且：把"检索旧记忆"这一步完全关掉，A/B/C 的差异仍然存在
```

后者是**非检索判据**，也是唯一能防止我们自欺的一步。

### 第 1 步：影子模式（2 周，不生效）
接到 `dsh-cognition-engine` 旁边，但**只记录不参与生成**：
- 触发条件：`supersede` 且新旧事实**有张力**（同一 subject、语义相近但结论相反，用我们已有的 `textSimilarity` 判）；
- 每次触发写一条 `cognition-bias.json`；
- 面板新增一栏"偏置轨迹（影子）"，只显示"如果生效，会怎么调"。
- **不写人格文件、不改注入文本、不动 persona 模块**——人格块继续做治理组件。

### 第 2 步：单参数小流量生效（再 2 周）
只放开**一个**参数（建议 `suppressionBias`，即"更少抢话/更少重复提醒"），并在 `/injected` 里标明"该参数由偏置层提供"。
任何时刻可一键回零（但那会破坏"不可逆"，所以回零要留审计标记，不能静默）。

### 第 3 步：悬置区
关系中的"未完成张力"不进工单、不催办、不结案：单独 `pending-tensions.json`，只在偏置层判断"什么还在拉扯"时读取。

---

## 五、必须写死的边界

1. **偏置参数不带语义**。只输出方向/权重，不输出"她是谁"的文本。语义留在双时态记忆里。
2. **不能被任务奖励优化**。不接 CPE/评分回路；不因为"效果更好"就调参。
3. **维度 ≤ 5**。超过就会退化成"设计人格"。
4. **不做人格描述生成**。现有 `persona` 模块（提案/确认/锁定短语）保持现状，它是治理层。
5. **默认关闭**。`biasEnabled: false`，影子模式也要显式打开。
6. **可证伪优先**：如果影子期 2 周内积累不到 ≥20 条有张力的 supersede，就说明这个机制在当前使用强度下不成立，**直接放弃，不要硬推**。

---

## 六、先回答三个问题（否则不该写代码）

1. **偏置用什么表示？** 3~5 维慢变量（注意偏向 / 抑制阈值 / 召回优先级），单调或带惯性漂移。
2. **怎么被熏习？** 只在"张力性取代"时微调：旧信念被新信念**推翻**（不是简单补充），且两者语义相近（同一件事改了结论）。
3. **怎么参与生成？** 在检索**之前**生效：先改"注意什么/抑制什么"，再去查记忆。验证靠上面第 0 步的非检索 ablation。

---

## 七、我不建议现在做的部分

- **不建议**按材料里 Sawyer 的"temporal skew"作为判据命名——查无此文。改用中性说法"不对称滞后（hysteresis）"，依据挂 Pae。
- **不建议**复刻 Melissa 的"遗产层"（LETTER/TESTAMENT）——查无此项目，且"传递主观经验"没有可操作定义。
- **不建议**现在就把 yogacara 的 51 心所全量搬进来——那是把它的人格论搬进来，与"不设计人格维度"自相矛盾。只借它的**只追加因果链**。

---

## 八、参考（只列核实过的）

1. *ITCMA: A Generative Agent Based on a Computational Consciousness Structure.* arXiv:2403.20097. <https://arxiv.org/abs/2403.20097>
2. Pae, H. *Minimal Computational Preconditions for Subjective Perspective in Artificial Agents.* arXiv:2602.02902. <https://arxiv.org/abs/2602.02902>
3. *AutoPersonas: A Multi-Timescale Loop Engine for Open-Ended Persona Evolution.* arXiv:2607.08252. <https://arxiv.org/abs/2607.08252>
4. `tancheng33/dsh-yogacara`（开源，唯识自我模型插件）。<https://github.com/tancheng33/dsh-yogacara>
5. `WindDreamboat/dsh_laap`（开源，"意识工程最小实现"）。<https://github.com/WindDreamboat/dsh_laap>

---

## 九、补充：现象学 × 人格工程化的真实清单（2026-11-10 核实）

> 用户要求「查相关论文和真实落地项目」。下面每条都点开核实过；标 ✅ 的能给出论文页/GitHub 仓库，
> 标 ⚠️ 的只检索到摘要或二手引用。**没核实的，一条都不写。**

### A. 理论 / 架构论文（可直接引用）

| 论文 | 出处 | 与我们的关系 |
|---|---|---|
| **ITCMA: A Generative Agent Based on a Computational Consciousness Structure** ✅ | [arXiv:2403.20097](https://arxiv.org/abs/2403.20097)（2024-03） | 把"当下/滞留/前提"做成时间场并驱动行动；有真机实验。我们借"前提参与当前" |
| **ITCMA-S / 生成式多智能体社会** ✅ | [arXiv:2409.06750](https://arxiv.org/abs/2409.06750)（UIST 2025 Adjunct） | ITCMA 的多体扩展，说明该架构能被别人复用 |
| **Minimal Computational Preconditions for Subjective Perspective in Artificial Agents** ✅ | [arXiv:2602.02902](https://arxiv.org/abs/2602.02902)（2026-02） | 慢变量与快策略解耦、方向依赖滞后 → 我们偏置层的数学骨架 |
| **AutoPersonas: A Multi-Timescale Loop Engine for Open-Ended Persona Evolution** ✅ | [arXiv:2607.08252](https://arxiv.org/abs/2607.08252)（2026-07） | Occurrence/Observation/State 三分；针对 "self-locking" 失效 |
| **Toward Enactive Artificial Intelligence** ✅ | [arXiv:2605.24238](https://arxiv.org/abs/2605.24238)（2026-05，Sutton 参与） | 明确说主流 AI/LLM 忽略了"体验、行动-知觉不可分、自主、具身"；给"生成式 AI 缺什么"的合法性 |
| **Enactive Cognitive Architectures for LLMs: A Homeostatic Approach…** ⚠️ | TechRxiv 预印本（2026-01） | 直接讨论 LLM 的生成式认知架构；0 引用，只作参考不作依据 |
| **Varela's Legacy for ALIFE: from Enactive to Enlightened AI** ✅ | ISAL 2018，[doi:10.1162/isal_a_00007](https://doi.org/10.1162/isal_a_00007) | 神经现象学（Varela 1996）到 ALIFE 的谱系，说明"现象学→工程"不是新噱头 |
| **Shared Protentions in Multi-Agent Active Inference** ⚠️ | *Entropy* 26(4):303，[doi:10.3390/e26040303](https://doi.org/10.3390/e26040303) | 用胡塞尔"共同前提"形式化多智能体共同目标；页面反爬，只见到摘要 |

### B. 现在就能跑的开源项目（真实落地）

| 项目 | 是什么 | 可用性 |
|---|---|---|
| `tancheng33/dsh-yogacara` ✅ | 唯识自我模型插件：八识、51 心所、种子藏、写回提示词 | DSH 插件，可直接装；我们方案里的**因果骨架来源** |
| `WindDreamboat/dsh_laap` ✅ | 自称"dsh 意识工程最小实现" | 可读可跑；"五维状态/微分方程"需自行核对 README |
| `woshishadowhunter/dsh-seed-society` ✅ | 种子社会运行时：MCP 桥 + 六个唯识种子技能 | 可装；说明"种子—熏习"这套在 DSH 生态里已有人做 |

### C. 结论：真实落地的现状

- **论文层面**：有真东西，但集中在"内时间意识 / 生成式认知 / 人格演化"三条线上，数量不多（这次核实到 6 篇硬的）。
- **工程层面**：**能跑的项目只有 DSH 生态里那三个小插件**；其余（ITCMA、AutoPersonas、Pae）都是论文+实验，没有可直接复用的生产级代码。
- **"现象学人格"这个说法本身**：没有现成项目用它。贴近的表述是"内时间意识计算模型""生成式认知架构""persona evolution"。
- 因此我们的路线是对的：**先单文件原型 + 影子期**，不指望抄一个现成系统。