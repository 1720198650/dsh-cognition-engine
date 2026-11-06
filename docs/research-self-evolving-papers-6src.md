# 自我进化论文精读（6 篇）

> 严格六源版：只读任务指定的 6 个来源逐篇核验（3 篇核心 + 3 篇综述）。
> 11 篇扩展版见 [research-self-evolving-papers.md](research-self-evolving-papers.md)（278 行，多 5 篇机制论文）。

> 2026-11-06 · 范围：3 篇核心论文 + 3 篇综述（只读任务指定的 6 个来源）
> 目的：为零依赖、纯 JSON、本地运行的中文长期助手插件做 **L2 记忆学习**技术选型
> 方法：读 arXiv 原文（HTML/PDF）；2508.07407 的 HTML 转换在引言后中断，本报告只用其摘要与引言中明确给出的四组件定义（完整 PDF 未逐页读完，未引用其正文数字）。
> 自查：[ctxt-00001] 功能发版流程不适用（不发版）；[ctxt-00002] 文档/版本不适用（只写报告）；[ctxt-00003] 零依赖/纯 JSON/不引入 SQLite **适用**（作为判据）；[ctxt-00005] npm 发布不适用；[gap-1] Cordis client slot 不适用。

---

## 一、逐篇拆解

### 1.1 [SEAgent（arXiv 2508.04700 / ICML 2026）](https://arxiv.org/abs/2508.04700)

| 项 | 内容 |
|---|---|
| **机制** | 三件套：Actor Model（执行动作）+ World State Model（逐步评估）+ Curriculum Generator（出题）。WSM 输入完整轨迹 `H={(s0,a0),(s1,a1),…}`，把每步判成 `aT`（正确/有推进）或 `aF`（失败/冗余循环），并生成 GUI 状态变化描述 `C`；Curriculum Generator 用判断 `J` 和描述 `C` 更新「软件指南书」记忆 `U`，生成下一阶段更难的任务 `I`。成功动作走 GRPO（组内相对优势），失败动作走对抗模仿；最后把 5 个 specialist 的 3.5K 成功轨迹 SFT 进 UI-TARS-7B，再做多软件 RL 得 generalist。 |
| **关键数字** | UI-TARS **11.3% → 34.5%**（+23.2pp）；specialist ensemble **32.2%**；generalist RL **30.6%**；**specialist→generalist 34.5%** 超过 specialist ensemble 与 generalist RL。分软件（专家 RL / 专→通）：VSCode **13.0→37.7/40.5**、GIMP **23.1→38.5/42.3**、Impress **4.26→22.0/22.7**、VLC **11.8→33.3/35.3**、Writer **4.35→29.0/31.8**；人类 **74.5%**。WSM 在 AgentRewardBench 上精确率 **71.6 vs GPT-4o 72.1**（比基线 +7.5%）。首阶段平均 **150.2** 条指令 → **1361.5** 个多轮对话对；蒸馏 **3.5K** 成功轨迹；训练 **3** 个 phase、1k iter、8×A100 80GB、G=8、batch 16、lr 2e-5。 |
| **实验设置** | OSWorld 5 个专业软件；Actor = UI-TARS-7B-DPO；Curriculum Generator = Qwen2.5-72B；WSM = Qwen2.5-VL-7B（仅用 Chrome 的 0.86K 条 GPT-4o 评测训练）；全程无人工标注；结果 3 次平均。 |
| **局限** | 奖励来自 GUI-Judge 而非真实环境信号；任务仍是专家 <20 步的短任务，未验证数小时级真实工作流；需要 GPU 微调与可执行 GUI 环境。 |
| **零依赖可行性** | ❌ 训练/微调/GRPO 不可；✅ 只可借「step-level 正/负判定」与「由易到难的课程」概念。 |
| **能借什么** | 每条准则/记忆的每次使用都记 `appliedGood` / `appliedBad`，按 step 而非整轮总分；失败轨迹抽成 anti-pattern 条目；评测按难度分阶段，不一次性上全量。 |

### 1.2 [Mem2Evolve（arXiv 2604.10923 / ACL 2026）](https://arxiv.org/abs/2604.10923)

| 项 | 内容 |
|---|---|
| **机制** | 双记忆。**Asset Memory** `M_A = Agent Bank ∪ Tool Bank`：agent 条目 `<ρ 角色, ε 专长, σ 策略建议, T_avail 可用工具>`；tool 条目 `<n 名称, d_func 功能说明, c_impl 实现代码, ω_doc 输入输出文档>`（MCP 风格）。**Experience Memory** `M_E = E_agent ∪ E_tool`，每条 `<h_title, d_desc, U_case 适用场景, κ_content>`；κ 存 agent 的策略经验或 tool 的实现/调试经验。前向是「reuse first, create on demand」：任务分解 → 资产招募（相似度 ≥δ 复用 top-1 agent / top-k tools，否则按经验 + 网页检索造新资产）→ ReAct 执行。后向：LLM-as-judge 给 `(r∈{0,1}, c 批评)` → 新资产自纠/验证后入 Asset Memory；轨迹反思按成功泛化/失败诊断蒸馏成 Experience Memory。 |
| **关键数字** | 6 类任务 / 8 benchmark 平均 Pass@1 **70.24%**；比标准 LLM **+18.53%**、比纯经验进化（AFlow）**+11.80%**、比纯资产进化（Alita）**+6.46%**。经验引导使 GAIA 首次通过率相对 **+56.0%**、AIME 调试迭代 **−68%**。消融：去掉 Tool Creation 59.96%（−10.28），去掉 Expert Agent Creation 68.52%（−1.72）。 |
| **实验设置** | 全部用 GPT-5-chat；8 benchmark：GAIA、ALFWorld、WebShop、TravelPlanner、HotpotQA、2WikiMultihopQA、AIME24/25；初始只有 web search 工具；Serper + Crawl4AI + SandboxFusion；指标 Pass@1。 |
| **局限** | 依赖 sandbox 执行自动生成的代码，限制部署到本地文件系统/无限制网络等开放环境；生成资产的稳定性依赖验证循环，失败资产的回收未展开。 |
| **零依赖可行性** | ⚠️ 经验记忆可做（纯 JSON 条目）；资产记忆只能做「文本技能卡」，不能做代码/MCP 执行。 |
| **能借什么** | 四字段经验卡结构；`reuse first, create on demand` 的检索门；成功泛化 + 失败诊断双通道；资产晋升必须验证（用回放测试替代沙盒）。 |

### 1.3 [Do Self-Evolving Agents Forget?（arXiv 2605.09315）](https://arxiv.org/abs/2605.09315)

| 项 | 内容 |
|---|---|
| **机制** | 四条演化通道都会出现 **capability erosion under self-evolution**：workflow（可执行 policy graph / prompt program 被反复改写，结构膨胀）、skill/tool（有界技能库被新技能挤占、旧技能被驱逐）、model（连续自训练覆盖旧参数）、memory（插入/改写/驱逐导致检索竞争）。**CPE（Capability-Preserving Evolution）**：`R_t^CPE = argmin_R L_t(R) + λ Ω_t(R,R_{t-1})`；实现分别是：workflow 用 anchor 行为签名、skill 入库前签名检查 + 语义合并 + 高效用技能保护、model 用 Fisher/EWC 正则、memory 用 evidence-gated preservation（重复自验证的记忆受保护，低证据可压缩）。 |
| **关键数字** | Workflow（GPT-5.1）保留 simple 平均 **41.8% → 52.8%**，complex 平均 **23.9% → 33.4%**；GPT-5 nano simple **46.8 → 55.7%**、complex **22.8 → 26.7%**。Skill（GPT-5 nano）Algebra **84.3 → 85.9**、Geometry **58.9 → 59.3**、Number Theory **85.4 → 87.8**。Model（Qwen3-0.6B）Anatomy **29.4 → 30.5**、Biochemistry **37.2 → 38.4**、Dental **32.2 → 33.0**。Memory 旧域保持 **83.9% → 81.6%（vanilla）→ 83.3%（CPE）**，平均保持差距 **2.3% → 0.7%**。 |
| **实验设置** | Workflow：τ²-Bench 用 GPT-5 nano 分简单/复杂，EvoAgentX 在复杂子集前 20% 演化、后 80% 测试 + 全简单集；GPT-5.1 / GPT-5 nano；最多 40 交互步。Skill：MemSkill 风格，MATH 的 Algebra→Geometry→Number Theory，每阶段 500 训练/1000 测试，技能库上限 30。Model：MedMCQA 的 Anatomy→Biochemistry→Dental，Qwen3-0.6B / Llama3.2-3B，LoRA 4-bit。Memory：Dynamic-Cheatsheet 风格，GPT-4o mini / GPT-5 nano，6 个 domain-backbone 设置。 |
| **局限** | 只验证受控的 sequential distribution shift；CPE 实例是轻量、领域特定的（anchor/合并/Fisher/证据门），不是通用最优；真实开放动态环境和多 agent 未覆盖。 |
| **零依赖可行性** | ✅ workflow / skill / memory 三通道都能用「固定回归集 + 变更前后对比」做纯 JSON 版；model 通道不可。 |
| **能借什么** | 每次记忆/准则变更前跑 50–100 条冻结旧任务，跌幅 >10% 阻止；高证据条目禁止覆盖/删除，只归档；技能卡只 `retired` 不硬删；记录 FGT/BWT 趋势。 |

### 1.4 [A Survey of Self-Evolving Agents（arXiv 2507.21046）](https://arxiv.org/abs/2507.21046)

| 项 | 内容 |
|---|---|
| **机制** | 四问分类。**What**：Models（Policy / Experience）、Context（Memory Evolution / Prompt Optimization）、Tools（Creation / Mastery / Selection）、Architecture（Single-agent / Multi-agent）；**When**：Intra-test-time vs Inter-test-time；**How**：Reward-based（Textual / Internal / External / Implicit）、Imitation & Demonstration、Population-based / Evolutionary，另有 online/offline、on/off-policy、reward granularity 横切；**Where**：General domain 与 Specialized domain（Coding / GUI / Finance / Medical / Education 等）。 |
| **关键数字** | 无实验数字（综述）；提出 **4 个问题维度**；What 下 **4 大类 9 子类**；When 下 **2 类**；How 下 **3 大类**；Where 下 **2 大类**。 |
| **实验设置** | 不适用（综述，无实验）。 |
| **局限** | 领域仍在快速形成，作者自称是 guiding synthesis 而非成熟范式综述；分类是设计空间，不能直接量化比较方法优劣。 |
| **零依赖可行性** | ✅ 直接用作定位框架，无需任何依赖。 |
| **能借什么** | 把 L2 定位为 **Memory × Inter-test-time × Textual feedback × Single-agent / General domain**；优先做记忆与反馈，不碰模型权重和工具自造。 |

### 1.5 [A Comprehensive Survey of Self-Evolving AI Agents（arXiv 2508.07407）](https://arxiv.org/abs/2508.07407)

| 项 | 内容 |
|---|---|
| **机制** | 统一反馈环：**System Inputs → Agent System → Environment → Optimisers**。System Inputs = 任务、数据/实例、约束；Agent System = 基础模型、提示、记忆、工具、工作流、多智能体通信；Environment = 执行环境与评价信号；Optimisers = 定义好的搜索/更新机制（梯度、RL、进化算法、贝叶斯优化、LLM 驱动等）。三条安全律：Endure（安全与稳定）→ Excel（性能保持）→ Evolve（自主演化）。 |
| **关键数字** | 无实验；**4 个组件**、**6 类可演化对象**、**3 个专门领域**（生物医学、编程、金融）。 |
| **实验设置** | 不适用（综述，无实验）。 |
| **局限** | 综述性质，无原始实验与统一基准；统一框架是概念抽象，不能给出各方法强弱排序（原文未设专门局限节，未找到明确自述）。 |
| **零依赖可行性** | ✅ 作为反馈环设计图直接用；把 Optimiser 明确成「规则 + 人」，不做 RL。 |
| **能借什么** | 给插件画清四角色：输入 = 用户消息 + 任务结果；Agent System = 记忆/准则/技能卡；Environment = 会话与工作区；Optimiser = 反思规则 + 用户确认。先安全稳定，再性能保持，最后才谈自主演化。 |

### 1.6 [Self-Evolving Agents as Dynamic Graph Transformation（arXiv 2608.18104）](https://arxiv.org/abs/2608.18104)

| 项 | 内容 |
|---|---|
| **机制** | Agent 状态视为类型图 `G(t)`：节点 = memory / tool / skill / agent；边 = dependency / communication / provenance；演化 = DPO 风格 typed rewrite。四类：**A.1 节点/特征演化**（Insert / Delete / FeatureUpdate / Merge，作用于记忆、技能、工具、agent 状态）；**A.2 边/拓扑演化**（Link / Unlink / Rewire / EdgeFeatureUpdate，作用于工作流、通信、技能-工具依赖）；**A.3 子图激活**（read-only，按任务选 support subgraph，不改变持久图）；**A.4 跨组件协同演化**（跨 ≥2 类组件的 timestamped cascade，含传播/回滚）。 |
| **关键数字** | **46** 个代表性方法映射到 **4** 个分支；**9** 个动态图学习族；**5** 个 graph-aware 评测/治理协议；**6** 个 open challenges。 |
| **实验设置** | 不适用（综述/立场论文，无实证）。 |
| **局限** | 作者自述不追求穷尽，部分图/非图方法会遗漏；DGL→agent 的映射是概念性的，无 empirical evaluation。 |
| **零依赖可行性** | ⚠️ 不需要图数据库：JSON 的 `topicIds` / `sourceIds` / `validFrom` / `validTo` 已能表达大部分节点与边；完整 DPO 引擎不值得。 |
| **能借什么** | 给记忆/准则/技能定义节点类型与三类边；修改前做 affected-subgraph 检查；检索时记录 activation trace；A.4 用于「改一条记忆会影响哪些准则/技能」的级联审计。 |

---

## 二、三套综述 taxonomy 的异同

| 维度 | [2507.21046](https://arxiv.org/abs/2507.21046) | [2508.07407](https://arxiv.org/abs/2508.07407) | [2608.18104](https://arxiv.org/abs/2608.18104) |
|---|---|---|---|
| **组织主线** | 四个问题：What / When / How / Where | 四组件反馈环 | 四类图变换 |
| **分析单位** | 组件/能力 + 学习阶段 | 系统角色与反馈流 | 节点 / 边 / 子图 / 级联 |
| **时间维度** | Intra-test-time vs Inter-test-time | 迭代反馈环（未分阶段） | 持久 / 瞬时、事件时间戳 |
| **谁在优化** | How 里的 reward / imitation / population | **Optimisers 显式**（梯度 / RL / 进化 / 贝叶斯 / LLM） | rewrite 提案者 + 接受/拒绝/回滚 |
| **粒度** | 中（能力分类） | 中（系统组件） | 细（图操作） |
| **对 L2 的用途** | 定位自己该学哪层 | 设计反馈环与责任边界 | 设计 JSON 关系与影响分析 |

**相同点**：三者都把 agent 拆成可演化部件——[2507](https://arxiv.org/abs/2507.21046) 的模型/上下文/工具/架构，[2508](https://arxiv.org/abs/2508.07407) 的模型/提示/记忆/工具/工作流/通信，[2608](https://arxiv.org/abs/2608.18104) 的 memory/tool/skill/agent 节点；三者都把环境反馈当作演化驱动力，都不把「存储更多」等同于「变得更强」。

**差异**：
1. **[2507](https://arxiv.org/abs/2507.21046) 是问题清单**，适合回答「演化哪一层、什么时候演化」；**[2508](https://arxiv.org/abs/2508.07407) 是控制环角色模型**，适合回答「反馈从哪来、谁有权改」；**[2608](https://arxiv.org/abs/2608.18104) 是状态变换本体**，适合回答「改了什么、影响谁、能否回滚」。
2. 只有 **[2507](https://arxiv.org/abs/2507.21046)** 明确区分 intra-test-time / inter-test-time；**[2508](https://arxiv.org/abs/2508.07407)** 的环是迭代但未分时间粒度；**[2608](https://arxiv.org/abs/2608.18104)** 用「持久 vs 瞬时」区分真演化与子图激活。
3. **[2508](https://arxiv.org/abs/2508.07407)** 把 Optimiser 作为一等公民，**[2608](https://arxiv.org/abs/2608.18104)** 把 rewrite / rollback 作为一等公民，**[2507](https://arxiv.org/abs/2507.21046)** 把 reward / feedback 类型作为一等公民。
4. 三者互补：L2 用 [2507](https://arxiv.org/abs/2507.21046) 定位、用 [2508](https://arxiv.org/abs/2508.07407) 画闭环、用 [2608](https://arxiv.org/abs/2608.18104) 落 JSON 结构；不存在「选一个、弃两个」。

---

## 三、L2 记忆学习能借的具体机制（成本按半天 / 1 天 / 3 天）

> L2 = 外部记忆 + 检索 + 反馈，不改模型权重。以下全部可落在纯 JSON + 本地脚本，不引入新依赖。

| 机制 | 来源 | 成本 | 具体落地 |
|---|---|---|---|
| **step 级准则评分** | [SEAgent](https://arxiv.org/abs/2508.04700) | **半天** | 把用户明确纠正/确认接到上一轮注入的准则上：纠正→`appliedBad +1`，确认→`appliedGood +1`；`usage` 已有五项计数，只补自动来源。 |
| **Experience Memory 四字段卡** | [Mem2Evolve](https://arxiv.org/abs/2604.10923) | **半天** | 新增 `experiences.json` 或 `kind: experience`：`title` / `desc` / `use_cases` / `content`；从 reflection 产出，按 `subject + title` 去重。 |
| **Reuse-first 检索门** | [Mem2Evolve](https://arxiv.org/abs/2604.10923) | **半天** | 新建记忆/准则前先按 `subject` + `tags` 检索；相似度高则 update 旧条，不新增重复条；用现有 `lcsSimilarity` 代替 embedding。 |
| **Evidence-gated 记忆保护** | [Do Self-Evolving Agents Forget?](https://arxiv.org/abs/2605.09315) | **1 天** | 记忆加 `evidenceCount` / `lastVerified` / `protected`；高证据条目禁止覆盖/删除，只归档；`validTo` 不能因「看起来没用了」自动提前。 |
| **固定回归集 + 变更闸门** | [Do Self-Evolving Agents Forget?](https://arxiv.org/abs/2605.09315) + [2507.21046](https://arxiv.org/abs/2507.21046) | **1 天** | `cpe.holdout`：50–100 条冻结旧任务，永不用来生成候选；每次批量改准则/记忆前后跑分；`passRate` 下降 >10% 阻止变更并回滚。 |
| **经验 → 技能卡（procedure）** | [Mem2Evolve](https://arxiv.org/abs/2604.10923) | **1 天** | `kind: procedure`：`name` + `description`（何时用）+ `body`（步骤/边界）；连续成功 ≥3 次才晋升；失败案例留 anti-pattern；只 `retired` 不硬删。 |
| **难度递进回归** | [SEAgent](https://arxiv.org/abs/2508.04700) | **1 天** | 回归集分 easy / medium / hard 三档，按档报告成功率；缺口只产出候选任务，人工确认后才加入，不自动生成。 |
| **FGT / BWT 保留看板** | [2507.21046](https://arxiv.org/abs/2507.21046) | **3 天** | 每次回归结果追加事件日志；按 `topic` 算遗忘率（FGT）与后向迁移（BWT）；输出趋势，不把单次波动当结论。 |
| **记忆图关系 + 影响分析** | [2608.18104](https://arxiv.org/abs/2608.18104) | **3 天** | JSON 边：`dependsOn` / `derivedFrom` / `supersedes` / `contradicts`；改动前列受影响条目与技能卡；检索时记录 activation trace 供审计。 |

**优先级建议**：先做 1 个半天（step 评分）+ 1 个 1 天（回归集闸门），这两项直接补上「真实反馈信号」和「能力保留审计」的最大缺口；技能卡与图关系随后。

---

## 四、明确不能借的 + 为什么

| 不能借 | 来源 | 为什么 | 替代 |
|---|---|---|---|
| **GRPO / 对抗模仿 / SFT / LVLM 微调** | [SEAgent](https://arxiv.org/abs/2508.04700) | 需要 GPU 集群、可执行 GUI 环境和成千上万条轨迹；插件没有训练栈 | 只借 step 级正/负判定，不碰训练 |
| **独立 World State Model 奖励模型** | [SEAgent](https://arxiv.org/abs/2508.04700) | 需要单独微调 7B VLM、0.86K 评测数据；本地插件无法承载 | 用户显式反馈 + 规则判定 |
| **自动生成课程任务** | [SEAgent](https://arxiv.org/abs/2508.04700) | 需要可执行环境和可靠 judge；合成任务会污染记忆、无法验证 | 缺口 → 候选任务，人工确认 |
| **可执行工具/专家 agent 自造 + MCP Tool Bank** | [Mem2Evolve](https://arxiv.org/abs/2604.10923) | 代码生成 + 沙箱 + 测试 + 安全审查，违背零外部依赖和纯 JSON | 只做文本 `kind: procedure` 技能卡 |
| **模型通道持续自训练（LoRA / EWC）** | [Do Self-Evolving Agents Forget?](https://arxiv.org/abs/2605.09315) | 没有参数访问权，也没有训练能力 | 不做；只做记忆/准则/技能三通道 |
| **图数据库 / DPO rewrite 引擎** | [2608.18104](https://arxiv.org/abs/2608.18104) | 外部依赖重、复杂度高；JSON 邻接表已够用 | JSON 边 + 手写影响分析 |
| **多智能体通信与拓扑演化** | [2508.07407](https://arxiv.org/abs/2508.07407) / [2507.21046](https://arxiv.org/abs/2507.21046) | 单用户本地插件没有编排层，收益低、复杂度高 | 单 agent 的记忆/准则/技能演化 |
| **自动 LLM-as-judge 直接改记忆（无人工门）** | [Mem2Evolve](https://arxiv.org/abs/2604.10923) | 会自我强化错误、不可审计，错误记忆会代际传播 | 只进 `pending` 候选，用户确认后晋升 |
| **向量库 / 外部 embedding 服务** | [Mem2Evolve](https://arxiv.org/abs/2604.10923) | 破坏零依赖与离线可用性 | 本地 BM25/关键词 + `lcsSimilarity` |

---

## 五、一句话结论

> **[SEAgent](https://arxiv.org/abs/2508.04700)** 说「要逐步评估」；**[Mem2Evolve](https://arxiv.org/abs/2604.10923)** 说「经验和技能要一起长」；**[CPE](https://arxiv.org/abs/2605.09315)** 说「长新的会掉旧的，必须显式保留」。
> 三篇综述分别提供定位（[2507](https://arxiv.org/abs/2507.21046)）、反馈环（[2508](https://arxiv.org/abs/2508.07407)）、图结构（[2608](https://arxiv.org/abs/2608.18104)）。
> 对 L2 的可落地组合是：**step 级 `appliedGood`/`appliedBad` + 经验卡 + 固定回归集闸门 + 只退役不删除的技能卡**；训练、造代码、图数据库都不碰。

---

## 参考（仅这 6 个来源）

1. [SEAgent: Self-Evolving Computer Use Agent with Autonomous Learning from Experience（arXiv:2508.04700）](https://arxiv.org/abs/2508.04700)
2. [Mem2Evolve: Towards Self-Evolving Agents via Co-Evolutionary Capability Expansion and Experience Distillation（arXiv:2604.10923）](https://arxiv.org/abs/2604.10923)
3. [Do Self-Evolving Agents Forget? Capability Degradation and Preservation in Lifelong LLM Agent Adaptation（arXiv:2605.09315）](https://arxiv.org/abs/2605.09315)
4. [A Survey of Self-Evolving Agents: What, When, How, and Where to Evolve on the Path to Artificial Super Intelligence（arXiv:2507.21046）](https://arxiv.org/abs/2507.21046)
5. [A Comprehensive Survey of Self-Evolving AI Agents: A New Paradigm Bridging Foundation Models and Lifelong Agentic Systems（arXiv:2508.07407）](https://arxiv.org/abs/2508.07407)
6. [Self-Evolving Agents as Dynamic Graph Transformation: A Survey and New Perspective（arXiv:2608.18104）](https://arxiv.org/abs/2608.18104)
