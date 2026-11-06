# 2026「自我进化 / 自我学习 Agent」核心论文精读与零依赖插件技术选型

> **调研对象**：`dsh-cognition-engine` 0.11.0（零 npm 运行时依赖、纯 JSON、本地运行、无数据库/向量库/GPU/训练）
> **调研日期**：2026-11-06
> **方法**：逐篇读 arXiv HTML 全文 / ICML poster 页；查不到的一律写「未找到」，不补全。
> **适用准则自查**：本次适用 **[ctxt-00003]**（插件保持零外部依赖，记忆存储只用纯 JSON，不引入 SQLite）。**[ctxt-00001]**（功能发版六步）、**[ctxt-00002]**（纯文档只推 commit / 功能修复才升版本）、**[ctxt-00005]**（npm 发布加 `--registry`）均不适用：本次只产出研究报告，不发版、不发布 npm、不改插件代码。

---

## 0. 结论先行

1. **真正能落地的不是「训练一个会进化的模型」，而是「把记忆/准则当成可版本化、可回归审计的知识库」。** 2026 年这批论文里，凡是带 GRPO、SFT、on-policy distillation、参数更新、自动造工具/造代码的，全部超出零依赖插件的边界。
2. **最值得借的四篇**：[Do Self-Evolving Agents Forget?（CPE）](https://arxiv.org/abs/2605.09315) → 回归审计 + 证据门控保护；[Darwin-Claw](https://arxiv.org/abs/2610.23574) → 经验单元（EU）生命周期；[COVE](https://arxiv.org/abs/2608.01234) → volatile/stable/strategic 知识路由；[Dynamic Graph Transformation 综述](https://arxiv.org/abs/2608.18104) → typed nodes/edges + rewrite audit。
3. **三套 taxonomy 是互补的，不是三选一**：2507 管「演化什么 / 何时演化」（范围图）；2508 管「谁在什么反馈环里优化谁」（系统架构）；2608 管「状态用什么数据结构存、怎么改、怎么审计」（存储与治理）。
4. **我们的插件已经具备 70% 需要的字段**：双时态、`sourceIds` 证据链、`evidence` 三态、`appliedGood/appliedBad/missed/userCorrected` 分项计数、`topicIds`、`linkedBy`、`validTo`、快照/审计 JSONL。缺的主要是：**volatility 标签、稳定性分级、准则生命周期、回归门禁、依赖影响清单**。
5. **优先级建议**：先做半天级 4 项（数据字段级），再做 1 天级的「回归审计门禁 + 生命周期」，3 天级的 JSON 图/级联重验只有在记忆规模超过 300 条或多跳追溯成为高频需求时才做。**不要上图数据库、向量库、SQLite，也不要让模型自动改代码。**

---

## 1. 逐篇精读

### 1.1 SEAgent: Self-Evolving Computer Use Agent（ICML 2026，poster 65711；arXiv 2508.04700）

链接：[ICML poster 65711](https://icml.cc/virtual/2026/poster/65711) · [arXiv 2508.04700](https://arxiv.org/abs/2508.04700) · [HTML 全文](https://arxiv.org/html/2508.04700v1)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 自主探索闭环：Actor 执行 → World State Model（WSM）逐步判定 → Curriculum Generator 更新「软件指南书」并生成更难的题 → RL 更新 Actor。成功步用 GRPO + 可验证奖励；失败步用对抗模仿惩罚。specialist→generalist：先按软件练专家，再用成功轨迹 SFT 合体，最后在多软件上 RL。 | WSM 输入完整轨迹 `H={(s0,a0),(s1,a1),…}`，逐步输出 `a_T`（正确推进）/`a_F`（失败或冗余循环），并给出 `Correctness`、`First Error Step`、`Redundant steps`；Curriculum 维护 `Software guidebook U`（文本知识库）+ 任务缓冲；初始任务集平均 150.2 条，轨迹解析平均 1361.5 个多轮对话对。 | UI-TARS-7B-DPO 在 OSWorld 五软件平均 **11.3%→32.2%（专家 RL）/34.5%（专→通）**；VSCode 13.0→37.7/40.5、GIMP 23.1→38.5/42.3、Impress 4.26→22.0/22.7、VLC 11.8→33.3/35.3、Writer 4.35→29.0/31.8；人类 74.5%。WSM（w/ CD）AgentRewardBench 精确率 71.6 vs GPT-4o 72.1。 | Actor=UI-TARS-7B-DPO；WSM=Qwen2.5-VL-7B（0.86K GPT-4o 标注轨迹 + 1K 变化描述样本，LoRA rank=128，2000 iter）；Curriculum=Qwen2.5-72B；8×A100 80GB，1K iter/阶段 ×3 阶段，G=8，batch=16，lr=2e-5。 | WSM 是 GUI-Judge 代理奖励，不是环境真信号；任务只需人类专家 <20 步，未验证小时级长流程；v1 正文未给 AndroidWorld 数字（摘要提到，但未找到）；训练成本极高。 | 🔴 仅概念可借。需要 7B VLM 判官 + GRPO/对抗模仿/SFT + 多卡训练，零依赖插件不可能。 | ①把 WSM 的评分维度借到现有 eval checker：任务是否完成 / 首次出错步 / 冗余步；②把「software guidebook」映射为「主题手册」：每个主题维护一页可增补的领域知识；③「先专精再合体」只适用于多专家系统，不适合单插件。 |

**WSM 具体怎么评估每一步（原文口径）**：输入整条状态-动作轨迹，而不是只看最后截图；输出结构化判断后按三种情况打标——①全成功且无冗余：所有动作记为 `a_T`；②成功但有冗余：冗余开始前的动作为 `a_T`；③失败：首个错误步之前为 `a_T`，错误动作本身为 `a_F`。这套「首次出错步 + 冗余步」的判定，是我们能直接借的评估粒度。

**Curriculum Generator 怎么由易到难**：①初始 GUI 截图 → WSM 做按钮/OCR 级密集描述 → 生成初始任务集 `I0` 与初始指南书 `U0`；②每阶段 Actor 执行后，WSM 输出 `Exam`（任务成败）与 `CD_list`（状态变化描述）；③Curriculum 把新知识（例如矩形的填充/透明度属性）并入指南书，并生成「加绿色矩形」「加 50% 透明度红色矩形」这类更难任务进入任务缓冲；④下一阶段从任务缓冲采样，指南书充当长期记忆，循环 3 个阶段。任务数到约 100 条后收益饱和；变化描述 50–100 条最佳，200 条反而因上下文过长变差。

**GRPO 怎么用**：成功动作 `a_T` → 奖励 `r = I(type 匹配) + r_dist`；`r_dist` 对 click 用归一化 L1、drag/select 用 IoU、type 用字符级 BLEU，全部归一化到 `[0,1]`；GRPO 用组内相对优势 `A(i)=(r(i)-mean)/std`，`G=8`。失败动作 `a_F` → 对抗模仿损失 `L_AI = E[-log πθ(a|s,I)/πref(a_F|s,I)]`（类似 DPO 只取负项）；总损失 `L = L_GRPO + γ·L_AI`，`γ=0.2`（消融：0.2 最好，37.7%）。

**specialist→generalist 整合**：先训练 5 个软件专家；收集各专家训练期间生成的任务指令，让专家执行，得到 **3.5K 条成功轨迹 + 推理链**；SFT 进 UI-TARS-7B 基座；再在 5 个软件上做 SEAgent RL。结果 34.5% 超过专家集成 32.2%、直接 general RL 30.6%、general SFT 27.9%。

---

### 1.2 Mem²Evolve（ACL 2026 Main；arXiv 2604.10923）

链接：[arXiv 2604.10923](https://arxiv.org/abs/2604.10923) · [HTML 全文](https://arxiv.org/html/2604.10923v1)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 双记忆协同进化：**Experience Memory**（经验）+ **Asset Memory**（资产：工具/专家 agent）。前向推理「先复用、按需造」：子任务若能在 Asset Memory 匹配到高相似资产就复用，否则用 Experience Memory + 网页搜索指导创建新资产；任务结束后反向进化：验证通过的资产进 Asset Memory，成功/失败轨迹反思进 Experience Memory。 | `M_A = B_agt ∪ B_tool`。专家 agent：`m_agt = <ρ 角色, ε 专长, σ 行为建议, T_avail 可用工具集>`；工具：`m_tool = <n 名称, d_func 功能描述, c_impl 实现代码, ω_doc 输入输出文档>`（MCP 格式）。经验条目：`e = <h_title 标题, d_desc 上下文, U_case 适用场景, κ_content 核心知识>`，知识分「agent 经验」与「tool 经验」。 | 6 类任务 / 8 个 benchmark，平均 Pass@1 **70.24%**；比标准 LLM 最高 **+18.53%**、比纯经验进化（AFlow）**+11.80%**、比纯资产创建（Alita）**+6.46%**。消融：去掉工具创建 −10.28pp，去掉专家 agent 创建 −1.72pp，去掉 agent memory −4.73pp，去掉 tool memory −3.13pp。 | Backbone=GPT-5-chat；8 个 benchmark：GAIA、ALFWorld、WebShop、TravelPlanner、HotpotQA、2WikiMultihopQA、AIME24、AIME25；初始只有 Web Search 工具；工具执行用 SandboxFusion，检索用 Serper + Crawl4AI。 | 需要沙箱执行自动生成的代码，部署范围受限（作者明确说这是 limitation）；依赖外部搜索/执行服务；没有单独的失败案例章节（未找到）。 | 🟡 数据结构可借，执行不可借：我们不做代码生成/沙箱，但可以把「经验条目」四字段直接变成反思输出结构，把「资产」降级为 JSON 里的「方法卡/技能卡」注册表。 | ①`Experience Memory` 四字段：标题、上下文、适用场景、核心知识；②成功经验做「策略泛化」、失败经验做「反模式 + 失败-修复对」；③资产的概念可映射为「可复用方法卡」，但只存描述和步骤，不存可执行代码。 |

**两者怎么互相促进**：经验 → 资产：创建工具/专家时检索 `E_tool` 相关经验，作为生成约束，提高首次成功率（GAIA 首次有效率 32.7%→51.0%，相对 +56.0%；AIME 修复迭代次数约 −68%）。资产 → 经验：新资产执行后的轨迹与评审又沉淀为经验条目；形成「能力扩张 ↔ 经验蒸馏」闭环。

**「资产」指什么**：两类——①**工具**：符合 MCP 的可执行工具，有名称/功能/实现代码/输入输出文档；②**专家 agent**：有角色、专长、行为建议、可用工具集的专家规格。不是泛指数据或文档。

**失败案例**：论文没有专门的自失败章节（未找到）；可引用的失败对照是附录案例——无经验引导时生成的工具只用 pandas 读 Excel，丢失单元格颜色属性导致任务失败；限制部分是「依赖沙箱执行，无法用于需要直接访问本地文件系统或无限制网络的环境」。

---

### 1.3 Do Self-Evolving Agents Forget?（arXiv 2605.09315）⭐ 对本项目最重要

链接：[arXiv 2605.09315](https://arxiv.org/abs/2605.09315) · [HTML 全文](https://arxiv.org/html/2605.09315v1) · [作者博客解读](https://dream.ischool.illinois.edu/blogs/recursive_self_improvement_agents_forget.html)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 提出 **capability erosion（能力侵蚀）**：自我进化是非单调的，适应新任务分布会破坏旧能力。**CPE（Capability-Preserving Evolution）** 在每次更新时加保留正则：`R_t^CPE = argmin_R L_t(R) + λ·Ω_t(R, R_{t-1})`；四个通道各自实例化（workflow 锚点、skill 合并、model Fisher/EWC、memory 证据门控）。 | 把 agent 状态抽象为「可变能力仓库」`R_t`：workflow 是可执行策略图/提示程序；skill 是有限容量技能库；model 是参数；memory 是外部记忆库。CPE 不改变原进化管线，只在更新目标里加 `Ω`。 | Workflow（EvoAgentX，τ²-Bench，GPT-5.1）：保留简单任务平均 **41.8%→52.8%**，复杂任务平均 23.9%→33.4%；GPT-5 nano：简单 46.8%→55.7%，复杂 22.8%→26.7%。Skill（MATH）：GPT-4o mini Algebra 82.6→84.4、Geometry 50.8→51.1、Number Theory 73.5→76.1。Model（MedMCQA）：Qwen3-0.6B Anatomy 29.4→30.5、Biochemistry 37.2→38.4、Dental 32.2→33.0。Memory：六个 domain-backbone 设置平均旧域 83.9%→81.6%（vanilla），CPE 83.3%；平均 retention gap 2.3%→0.7%。 | 四个独立实验：①Workflow：EvoAgentX on τ²-Bench，GPT-5.1/GPT-5 nano，简单任务种子 workflow 后在复杂子集进化，最终在简单子集（保留）和复杂子集（适应）上评；②Skill：MemSkill on MATH，Algebra→Geometry→Number Theory 顺序，GPT-4o mini/GPT-5 nano，技能库上限 30；③Model：STaR + LoRA on MedMCQA，Qwen3-0.6B/Llama3.2-3B，A100；④Memory：Dynamic-Cheatsheet 风格外部记忆，GPT-4o mini/GPT-5 nano，固定模型只改记忆库。 | 作者自述 CPE 只是「轻量、领域特定的约束实例」，更复杂的自适应正则/联合优化未做；实验是受控的序列分布迁移，不是开放世界；model 通道需要 GPU 训练。 | 🟢 memory 通道完全可做：证据门控 = 纯 JSON 字段 + 规则；回归审计 = 现有 eval 框架 + 固定用例。workflow/model 通道不可做（我们不改工作流、不训练）。 | ①**回归审计**：每次准则/记忆更新后，在固定旧任务探针上对比变更前/后通过率，算 `FGT`；②**证据门控保护**：反复被自验证支持的记忆条目升级为「受保护」，禁止自动改写/驱逐；③**合并而非删除**：同义/相关条目合并保留，不直接覆盖；④**release gate**：新版本准则本在 golden set 上不得低于旧版本，否则回滚。 |

**四条通道的能力侵蚀分别怎么表现**：
- **Workflow**：反复重写会插入过多验证算子与结构绕路（structural detours），工作流越来越「防御性」，对稍微非标准但语义合法的动作误判、提前终止；简单任务性能下降。
- **Skill/Tool**：有限容量技能库中，新任务专用技能占据检索频率与容量，旧通用技能被压低使用率直至被淘汰（repository overwrite）。
- **Model**：持续自训练/继续微调会覆盖先前领域支持的参数区域，典型的 catastrophic forgetting；新旧领域顺序越远越明显。
- **Memory**：新任务记忆不断插入/改写/驱逐，旧记忆被挤出、抑制或在检索中竞争失败；即使底座模型冻结，旧任务保留性能也会下降（论文 83.9→81.6 就是固定模型、只改记忆库的结果）。

**41.8%→52.8% 的实验设置**：EvoAgentX 在 τ²-Bench 上；先用「简单任务子集」构造共享种子 workflow，再让 vanilla 与 CPE 两个分支在「复杂任务子集」上并行自进化（失败轨迹反馈给优化器 LLM 改写 workflow，CPE 注入种子 workflow 的锚点行为签名：核心任务目标、输出约束、失败规避行为）；进化结束后在完整简单子集上测「保留能力」、在 held-out 复杂子集上测「适应能力」。GPT-5.1 下 vanilla 简单平均 41.8、CPE 52.8；复杂 23.9→33.4。所以不是「换模型」，而是「同一优化预算下加了保留约束」。

**对「回归审计」的直接启示（最重要的落地结论）**：
1. 把每次「准则蒸馏 / 合并 / 过期 / 记忆重写」都视为一次 evolution update，必须有**变更前→变更后**的固定探针对比。
2. 探针要覆盖「旧能力」而不是只测新任务；按主题维护 10–30 条 golden cases，记录 `retainedScore` 与 `FGT = before - after`。
3. 阈值建议先宽后紧：首版 `FGT > 10pp` 阻止自动应用、`5–10pp` 标黄交人工；稳定后再收紧到 5pp。
4. 保护对象要可解释：`appliedGood ≥ 5`、跨 ≥2 个会话、最近 N 次无 `appliedBad` 的条目进入 `protected`，只允许人工修改/退休。
5. 审计记录不只记总分，要记「这条结论由哪些记忆支撑」（support-subgraph accuracy 的思想，见 1.4.3）。

---

### 1.4 三篇综述

#### 1.4.1 A Survey of Self-Evolving Agents: What, When, How, and Where（arXiv 2507.21046）

链接：[arXiv 2507.21046](https://arxiv.org/abs/2507.21046) · [HTML 全文](https://arxiv.org/html/2507.21046)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 用四个问题组织整个领域：What（演化什么）/ When（何时演化）/ How（怎么演化）/ Where（在哪演化）。定位是「能力视角的坐标系」，不是具体算法。 | 见下方「What/When/How/Where 具体分类表」。 | —（综述，无新实验） | 文献综述，覆盖模型/上下文/工具/架构四类演化对象，按评测、安全等章节展开。 | 分类是描述性的，不提供实现优先级；不同论文可以同时落在多个格子，边界会重叠。 | 🟢 作为设计地图完全可用。 | 帮我们明确自我定位：我们只做 **What=Context（Memory + Prompt/准则）**、**When=Inter-test-time**、**How=文本反馈/规则蒸馏（非 RL）**、**Where=通用个人长期助手**。这个「四至」应写进设计文档，防止越界做训练/工具自造。 |

**What/When/How/Where 具体分类表（论文口径）**

| 维度 | 一级分类 | 二级分类 / 含义 |
|---|---|---|
| **What（演化什么）** | Models | Policy（策略/参数更新）、Experience（经验内化） |
| | Context | Prompt（提示词/指令）、Memory（长期记忆） |
| | Tools | Creation（自造工具）、Mastery（工具使用熟练）、Selection（工具选择） |
| | Architecture | Single（单 agent 结构）、Multi（多 agent 协作/拓扑） |
| **When（何时演化）** | Intra-test-time | 任务执行中即时适应；可用 ICL / SFT / RL 实现（如 Reflexion、AdaPlanner、LADDER） |
| | Inter-test-time | 任务结束后复盘、跨任务保留；可用 ICL / SFT / RL 实现（如 ExpeL、STaR、WebRL、DigiRL） |
| **How（怎么演化）** | Reward-based | 文本反馈、内部置信度、外部奖励、隐式奖励（Reflexion、Self-Refine、Self-Rewarding 等） |
| | Imitation / Demonstration | 模仿成功轨迹或高质量示范（STaR、V-STaR、SiriuS、RISE 等） |
| | Population-based / Evolutionary | 维护候选群体，用选择/变异/交叉/竞争（DGM、EvoMAC、GENOME、SPIN 等） |
| **Where（在哪演化）** | General domain | 通用数字助手：记忆机制、课程驱动训练、模型-agent 协同进化 |
| | Specialized domain | 编程、GUI、金融、医疗、教育、其他垂直领域 |

#### 1.4.2 A Comprehensive Survey of Self-Evolving AI Agents（arXiv 2508.07407）

链接：[arXiv 2508.07407](https://arxiv.org/abs/2508.07407) · [alphaXiv 结构化解读（含五步循环）](https://www.alphaxiv.org/abs/2508.07407)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 统一反馈闭环：**System Inputs → Agent System → Environment → Optimisers →（更新后的）Agent System**。输入给出任务/数据/约束；Agent 系统执行并与环境交互；环境返回任务指标或 LLM evaluator 等评价信号；优化器在定义好的空间里搜索并修改模型参数、提示、工具或结构；循环直到性能阈值或收敛。 | 四组件：**System Inputs**（任务、数据、实例）；**Agent System**（基础模型、prompts、memory、tools、workflow、multi-agent 的 communication/topology）；**Environment**（执行环境 + 评价信号）；**Optimisers**（搜索/更新机制：梯度、RL、进化算法、贝叶斯优化、LLM 驱动优化等）。 | —（综述，无新实验；“55 页”为二手介绍，未在原文逐页核实） | 文献综述；单 agent 优化、多 agent 优化、领域专用优化（生物医学/编程/金融/法律）三大部分。 | 框架是「概念地图」，不是可执行算法；不保证每个方法都包含全部组件；对评估/安全的讨论停留在原则层。 | 🟢 作为系统架构检查表完全可用；但它不会替我们选实现。 | 把我们的系统画成同一张图：**System Inputs = 用户消息 + 主题 + 项目约束；Agent System = 记忆/准则/主题/任务/缺口；Environment = 用户确认 + 运行结果 + 审计；Optimisers = 确定性规则蒸馏 + 人工审批（不是 RL）**。这张图可以直接放进设计文档，明确「我们不训练模型」。 |

#### 1.4.3 Self-Evolving Agents as Dynamic Graph Transformation（arXiv 2608.18104）

链接：[arXiv 2608.18104](https://arxiv.org/abs/2608.18104) · [HTML 全文](https://arxiv.org/html/2608.18104v1)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 把 agent 状态建模为**动态图** `G(t)=(V(t),E(t),X_V(t),X_E(t),Y(t))`；演化=模式约束的图重写（DPO 形式：`L←K→R`）。四类演化：节点/特征、边/拓扑、子图激活、跨组件级联。 | 节点四类：**memory / tool / skill / agent**；边三族：**dependency（依赖）/ communication（通信）/ provenance（证据溯源）**；节点/边带时间戳、有效期、激活状态、策略标签。重写算子：Insert/Delete/FeatureUpdate/Merge；Link/Unlink/Rewire/EdgeFeatureUpdate；子图激活是只读选择；跨组件是带时间戳的 cascade trace（触发原因→受影响子图→重验/回滚目标）。 | 覆盖 **46 篇**代表性动态图/图结构自进化方法；提出 5 类图感知评估与治理协议：无泄漏时间评估、隐私与删除检查、安全监控、回滚分析、审计。 | 综述 + 新视角（非实验论文）；给出形式化定义、重写 schema 和评估指标（support-subgraph accuracy、rewrite locality）。 | 偏理论/结构，实际落地需要图存储或至少邻接表；46 篇方法的实验条件不统一，不能横向比较。 | 🟢 纯 JSON 可实现轻量版（节点数组 + 邻接表 + rewrite log），不需要图数据库。 | ①把记忆/准则/主题/任务/缺口建成 typed nodes；②用 `derived_from`、`supersedes`、`conflicts_with`、`applies_to`、`depends_on`、`provenance` 建边；③每次变更记录 rewrite 类型、受影响子图、回滚目标；④评估不只看答案，还要看「激活了哪些证据」。 |

**四类演化的定义（报告口径）**：
- **节点/特征演化（Node and Feature Evolution）**：单个组件节点的插入、删除、属性更新、合并/归档；例如新增一条记忆、修改准则内容、合并两个技能。强调更新要带「证据强度 / 有效性 / 影响范围」，否则只是静默改写。
- **边/拓扑演化（Edge and Topology Evolution）**：组件之间关系的建立/断开/重连/属性更新；例如记忆→技能依赖、工具→工作流依赖、agent 间通信。核心是「拓扑变了，下游是否要重验」。
- **子图激活（Subgraph Activation）**：任务时只读地选择一张「支撑子图」，不提交持久变更；例如按当前任务召回相关记忆+技能+工具+工作流片段。对应我们的 `cognition_recall` 的 top-k / 主题分组 / `expand`。
- **跨组件协同演化（Cross-Component Co-Evolution）**：一个局部更新触发依赖级联，形成带时间戳的 rewrite trace（原因、受影响子图、重验/回滚）；例如记忆被取代导致依赖它的准则失效，准则失效又导致引用它的任务需要复核。

#### 1.4.4 三套 taxonomy 的异同与各自最适合指导什么

| 维度 | 2507 What/When/How/Where | 2508 System Inputs→Agent System→Environment→Optimisers | 2608 Dynamic Graph Transformation |
|---|---|---|---|
| **组织轴** | 能力问题（演化对象、时机、学习范式、应用域） | 系统反馈环（谁在什么环境里被谁优化） | 数据结构（节点、边、子图、重写） |
| **回答的核心问题** | 「改什么、什么时候改、用什么机制改、在哪个领域改」 | 「输入是什么、被优化的本体是什么、反馈从哪来、优化器是谁」 | 「状态怎么表示、一次修改影响哪些依赖、怎么审计/回滚」 |
| **相同点** | 都把 agent 看成多组件可变的系统；都把 memory 作为可演化对象；都强调环境/反馈 | 同左 | 同左，并进一步给出形式化 |
| **差异/盲区** | 不回答「谁执行优化」；对组件间依赖和结构演化着墨少 | 把 optimizer 作为一等公民，但不展开拓扑/依赖；偏系统视角 | 不规定学习算法和演化时机；偏结构/治理 |
| **最适合指导的设计决策** | 产品范围与路线图：先确定「我们只做哪一格」，防止越界 | 架构边界：明确哪些是输入、哪些可更新、优化器是规则/人还是训练算法 | 存储与审计：如何把现有 `sourceIds`/`topicIds` 升级为 typed graph，如何做级联重验与回滚 |
| **对本插件的一句话** | 定位：Context/Memory × Inter-test-time × 文本反馈 × 通用助手 | 结论：Optimiser 应是「确定性规则 + 人工审批」，不是 RL | 结论：不需要图数据库，但需要「边 + rewrite log + 影响清单」 |

---

### 1.5 其他值得读的 5 篇（机制 + 与零依赖插件的关系）

#### 1.5.1 Learning What to Remember and What to Internalize（COVE，arXiv 2608.01234）

链接：[arXiv 2608.01234](https://arxiv.org/abs/2608.01234)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 双通道自进化：harness-based（外部记忆/技能，快而浅）vs parameter-based（更新权重，深而慢）。COVE 用 **task-aware router** 按任务/反馈选通道，**stage-aware scheduler** 用 plateau / data sufficiency / cold-start failure 触发切换，**KnowledgePO** 做双模态知识优化，并用 **anti-recitation** 惩罚防止易变的 API 名称被背进参数。 | 知识条目带 `volatility ∈ {volatile, stable, strategic}` 标签：volatile=库版本/API 名等易变表层；stable=算法惯用法/领域推理；strategic=调试计划等高阶启发式。每条经验创建时由 judge 打标签；stable 可在训练后从在线检索中释放（A/B 测试确认已内化），volatile 永不释放。 | Lean 定理证明中，记忆条目从 2 提到 8 条，成功率提升仍 **<3%**；API 改名后直接参数学习模型 API 调用正确率 **96.50%→54.00%**；直接内化 API 知识导致成功率 **−59.3%**；主结果平均比 Parametric-only 少 **86%** 训练 token。 | Qwen3-8B，4×A100 80GB；5 个任务：Lean4、APPS、TableQA、HotpotQA、MATH；对比 Base、Evo-Memory、Self-Challenging。 | parameter-based 部分需要训练（4×A100）；router/scheduler 也依赖 judge 模型；volatile/stable 的判定本身会出错。 | 🟡 只有 harness 侧可借：volatility 标签、路由规则、知识分层；parameter 侧（SFT/GRPO/anti-recitation reward）不可借。 | ①**volatility 三分类**直接变成记忆字段；②volatile 记忆永不进准则本，只做临时检索；③stable/strategic 才允许进入准则候选；④`stable` 条目在多次自验证后可「毕业」为 protected。 |

#### 1.5.2 Darwin-Claw（arXiv 2610.23574）

链接：[arXiv 2610.23574](https://arxiv.org/abs/2610.23574)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 环境自适应经验整合：异步 Evolver-Critic 处理会话日志 → 结构化 **Experience Unit（EU）** → 因果归因 + 多维评分 → 写入 `SKILL.md` 的技能槽位；技能槽有严格生命周期（Nursery 试用 → Active 竞争 → 淘汰/归档），不改模型参数。 | EU：触发条件、关键词、可执行处理策略，分 `exploit`（利用）与 `explore`（探索）两类；评分 `S = w1·effect + w2·coverage + w3·efficiency`，其中 effect=任务完成率增量、coverage=关键词命中率、efficiency=无效工具调用减少；每个技能最多 6 个 active slots（3 exploit + 3 explore），Nursery 有 TTL，需 `e>0` 才能晋升；负效应或超时自动驱逐归档；用户可 pin/evict。 | WildClawBench 60 个长程多模态任务（6 类），平均每任务约 8 分钟、>20 次工具调用；相比基线总体 **+24.1%**（web +27.3%、tool-use +31.6%、reasoning +22.7%、long-horizon +23.8%）；难度分层 +18.5%（easy）/ +23.6%（medium）/ +29.4%（hard）/ +33.2%（extreme）；skill 方式 vs context 方式：28.42%→31.91%。 | OpenClaw+GPT-5.5、Claude Code+Sonnet 5/Opus 4.8、Codex+GPT-5.6 Terra/Sol；WildClawBench 60 任务 + RSIBench 自动研究；隔离 Docker 环境。 | 使用向量检索的本地经验池；自动改写 `SKILL.md` 有提示注入/漂移风险；实验依赖多种闭源大模型；未给出零依赖实现。 | 🟢 生命周期与字段可完全用 JSON 实现；向量检索可降级为 BM25/关键词；`SKILL.md` 写入可改为「生成候选、人工批准后写入准则本」。 | ①EU 字段：trigger/keywords/strategy/kind/evidence；②Nursery（试用）+ TTL + 3 exploit/3 explore 槽位；③多维评分 coverage/effect/efficiency；④negative evidence 自动降级、用户可 pin。这是本报告里第二值得直接落地的机制。 |

#### 1.5.3 MemEvolve（arXiv 2512.18746）

链接：[arXiv 2512.18746](https://arxiv.org/abs/2512.18746)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 元进化：不仅让 agent 积累经验，还让**记忆架构本身**进化。把记忆系统分解为 `Encode → Store → Retrieve → Manage` 四模块；外层元进化算子选择高绩效记忆系统、诊断并生成新架构，内层 agent 用该架构积累经验。 | 记忆系统 `Ω = (E, U, R, G)`：Encode 感知/格式化经验，Store 提交信息，Retrieve 上下文召回，Manage 整合与遗忘；每个架构是四个模块程序实现的组合（“genotype”）。 | 4 个 benchmark 上最高 **+17.06%**（Kimi K2 在 WebWalkerQA）；跨任务/跨模型还能保持 2.0–9.09% 增益；xBench 51%→57%（+6pp，pass@3 68%）；WebWalkerQA 58.82→61.18%；GAIA pass@3 80.61%。 | GPT-5-mini 为 backbone；SmolAgent / Flash-Searcher / CK-Pro 等 agent 框架；TaskCraft、WebWalkerQA、xBench-DS、GAIA；每轮 40 条轨迹，3 轮元进化。 | 元进化需要生成/执行不同的记忆系统实现，工程复杂；只在共享任务域内泛化，跨到具身等根本不同任务不保证；成本高。 | 🔴 整体不可借：它需要代码级生成与执行、多个候选系统并行评测。🟡 但四模块是很好的「设计词汇」。 | ①用 `encode/store/retrieve/manage` 四模块审视现有插件；②做「每主题记忆 profile」：同一套 JSON 上切换不同召回/注入策略；③不自动改代码，只做配置级 A/B。 |

#### 1.5.4 Co-Evolution in Agentic Systems（arXiv 2608.10299）

链接：[arXiv 2608.10299](https://arxiv.org/abs/2608.10299)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 综述：把「共同进化」按演化自由度分三阶段——**Agent–Agent**（对抗/协作/组织）、**Agent–Environment**（任务空间/反馈空间/交互空间）、**Meta Co-Evolution**（演化机制本身可演化）。核心区分：共同进化要求至少两个演化单元互相塑造，而不只是交换信息。 | 演化机制 `Ω` 的五个决策：what / when / how / where / how to evaluate；三阶段逐级放开「人可以预设的约束」。 | —（综述，无新实验） | 文献综述 + 跨论文证据汇总（Figure 4），不做统一 benchmark。 | Meta co-evolution 仍处早期；只讨论安全/治理 desiderata，没有具体防护协议。 | ⚪ 概念参考：我们只有一个 agent + 一个用户，不存在真正的多单元共同进化。 | 借它的**评估思想**：用 held-out evaluator、cross-play、组件消融来检查「进化是否真的有效」，而不是只看任务成功率。我们可用「换一批旧任务/换一个主题」做 held-out 审计。 |

#### 1.5.5 OPD-Evolver（arXiv 2606.17628）

链接：[arXiv 2606.17628](https://arxiv.org/abs/2606.17628)

| 机制 | 数据结构 | 关键数字 | 实验设置 | 局限 | 零依赖可行性 | 我们能借什么 |
|---|---|---|---|---|---|---|
| 慢-快双循环：快循环让 agent 在环境中与**四级记忆**交互（选择、使用、写入、维护）；慢循环用 outcome-calibrated memory attribution + privileged hindsight 做 on-policy self-distillation，把「选/用/写/管」四种能力蒸馏进同一个策略。 | 四级记忆：**trajectory（轨迹）/ tips（提示）/ skills（技能）/ tools（工具）**；记忆条目有 value/confidence/usage/redundancy 统计；维护动作包括 merge/delete，周期 Q=30。 | 比 ReasoningBank 最高 **+11.5%**；比 Skill0 约 **+5.8%**；OPD-Evolver-9B 在 OS 65.00% vs 61.00%、AMA-SA 52.92% vs 48.00%、InterCode-CTF 57.00% vs 53.00%；去掉 memory attribution 后 InterCode 平均 38.67%→32.13%。 | Qwen3.5-4B/9B；训练数据来自 Agent World Model、Nemotron-Terminal-Corpus、EnvScaler；5 benchmark / 10 subset：LifelongAgentBench DB/OS、MemoryArena Math/Physics、AMA-Bench 三子集、InterCode Bash/CTF/SQL、MiniHack。 | 需要模型训练/蒸馏，不是零依赖能做的；评测多在合成/受控环境；四层记忆的价值依赖训练后的策略。 | 🔴 训练部分不可借；🟡 四级记忆结构和「记忆价值分」可用确定性规则近似。 | ①`layer: trajectory\|tip\|skill\|tool` 四层标签；②记忆价值分 = 使用次数 + 任务结果关联 + 冗余惩罚；③维护周期（如每 30 次任务清理一次）。 |

---

## 2. L2（记忆学习）能借的具体机制清单

> 成本口径：**半天** = 0.5 人日，改字段 + 规则 + 单测；**1 天** = 1 人日，含测试与简单 UI 提示；**3 天** = 3 人日，含数据迁移、审计视图、回滚。全部不新增 npm 运行时依赖，只改 TypeScript 和 JSON。

### 2.1 半天级（先做，性价比最高）

| # | 机制 | 具体做法（可直接改代码） | 依据 |
|---|---|---|---|
| H1 | **记忆条目加 `volatility` 三分类** | `TemporalFact` 增加 `volatility?: 'volatile' \| 'stable' \| 'strategic'`，默认 `stable`；`cognition_remember` 入参可选。规则：`volatile` 永不进入准则蒸馏候选，只做记忆召回；`stable` 可进候选；`strategic` 需 ≥2 次独立成功证据才可进候选。 | COVE（2608.01234）volatile/stable/strategic |
| H2 | **准则加 `stabilityTier` + `stabilityEvidence`** | `PlaybookEntry` 增加 `stabilityTier: 'provisional' \| 'stable' \| 'protected'` 与 `stabilityEvidence: { appliedGood: number; sessions: number; lastVerifiedAt: number \| null; appliedBadSince: number }`。`protected` 条件：`appliedGood ≥ 5`、跨 ≥2 会话、`appliedBadSince == 0`；protected 禁止自动归并/降级，只允许人工操作。 | CPE 记忆通道（2605.09315）evidence-gated preservation |
| H3 | **记忆价值分 `valueScore`（只影响排序/清理，不影响真假）** | 纯函数：`value = 3·appliedGood + 1·recallCount + 0.5·recencyScore − 2·appliedBad − 1·missed`；写入 `MemoryStats` 或实时计算；归档/合并候选按 value 升序处理，但 `importance=1` 或 `human` 来源永不自动清理。 | OPD-Evolver（2606.17628）memory value 的确定性近似 |
| H4 | **经验单元（EU）字段** | 反思输出增加结构化字段：`title`、`trigger`（何时适用）、`keywords[]`、`strategy`（可执行步骤）、`kind: 'exploit' \| 'explore'`、`evidence: { coverage: number; effect: number; efficiency: number }`、`sourceIds[]`。先存为 `layer='tip'` 的记忆，人工确认后可升为准则候选。 | Darwin-Claw（2610.23574）EU 结构 |

### 2.2 1 天级（形成闭环）

| # | 机制 | 具体做法 | 依据 |
|---|---|---|---|
| D1 | **准则生命周期（Nursery → Active → Archive）** | 在现有 `pending/active/retired/expired` 上增加：`pending` 即 Nursery，带 `ttl`（默认 14 天）与 `probationSlots`（每 section 最多 3 条）；每次 `appliedGood` 给 +1 证据，达到 2 次且无 `appliedBad` 才可 `promote()` 到 active；active 按 section 限制 3 条 exploit + 3 条 explore；负证据或超 TTL 自动 `retire()` 并归档，保留历史。 | Darwin-Claw 的 slot 生命周期 |
| D2 | **回归审计门禁（最小版）** | 扩展 `evals/cases.json` 增 `memory.retention` 组：每个主题 10–30 条「旧能力」探针（问法、期望召回/准则、期望答案要点）。新增脚本 `npm run eval -- --retention`：在当前准则本/记忆库上跑一遍记录 baseline；每次蒸馏/合并/过期前跑 candidate，输出 `retainedScore` 与 `FGT = before − after`。`FGT > 10pp` 阻止自动应用，`5–10pp` 标黄人工确认。 | CPE（2605.09315）+ 现有 `src/eval.ts` 基线 diff |
| D3 | **四层记忆标签** | 给记忆/准则增加 `layer: 'trajectory' \| 'tip' \| 'skill' \| 'tool'`：原始对话=trajectory；反思结论=tip；准则/方法卡=skill；工具描述（未来）=tool。注入时按 layer 分配预算：tip ≤ 30%、skill ≤ 50%、trajectory 只做召回不主动注入。 | OPD-Evolver 四级记忆 |
| D4 | **变更影响清单（Affected Scope）** | 每次记忆/准则变更后，用 `sourceIds`、`topicIds`、`linkedBy`、`conflictGroupId` 计算受影响集合：`affectedMemories`、`affectedPlaybook`、`affectedTasks`、`affectedGaps`；写入审计 JSONL 的 `affected` 字段，并在 UI 显示「本次变更影响 N 条准则 / M 个任务」。 | Graph 综述（2608.18104）cascade trace + 现有证据链 |
| D5 | **蒸馏路由规则（记忆 vs 准则）** | `cognition_reflect action=playbook` 前先跑确定性路由：`volatile` → 只写记忆；`stable` → 候选准则；`strategic` → 先写记忆，连续 2 次被引用且成功才候选。路由结果写入 `note`，可审计。 | COVE + 插件现有 `sourceIds`/usage |
| D6 | **主题级记忆 profile** | `Topic` 增加 `memoryProfile: { retrieve: 'bm25' \| 'recent' \| 'graph-expand'; topK: number; injectBudget: number }`；不同主题用不同召回策略；每季度用固定探针做 A/B，保留较优 profile。 | MemEvolve 四模块 + EvolveLab「没有 universally optimal memory architecture」 |

### 2.3 3 天级（规模上来再做）

| # | 机制 | 具体做法 | 依据 |
|---|---|---|---|
| T1 | **纯 JSON 的 typed graph** | 新增 `cognition-graph.json`（或 `state.graph`）：`nodes[]`（`id/type: memory\|playbook\|topic\|task\|gap`、`attrs`、`createdAt/updatedAt`、`validFrom/validTo`）、`edges[]`（`from/to/type: derived_from\|supersedes\|conflicts_with\|applies_to\|depends_on\|provenance`、`weight`、`createdAt`）。不引入图数据库，查询用邻接表 + BFS，规模 <1000 节点时毫秒级。 | 2608.18104 节点/边 schema |
| T2 | **级联重验 + 回滚** | 当节点被 edit/merge/delete，沿 `depends_on`/`derived_from` 边遍历，把下游准则标 `stale` 并生成 `reviewTask`；保存旧版本到 `.snapshots/`，支持按 rewrite trace 回滚；审计记录 `rewriteType / cause / affectedSubgraph / rollbackTo`。 | 2608.18104 cross-component cascade + CPE |
| T3 | **完整回归审计台** | 在 D2 基础上增加：`FGT`（遗忘）、`BWT`（后向迁移）、`adaptScore`（新任务提升）、`cost`（token/时间）；输出 Markdown 报告；支持 `--update-baseline` 仅在人工确认后执行；可作为发布前门禁。 | CPE 四通道指标 + 2507 评测章节（adaptivity/retention/generalization/efficiency/safety） |
| T4 | **准则本「能力保留」版本门禁** | 准则本每次蒸馏生成 `vN` 快照；发布前自动跑 T3；新版本在 golden set 上低于旧版本超过阈值则拒绝发布并回滚；把结果写进 `CHANGELOG`/状态页。 | CPE 的核心思想工程化 |

### 2.4 建议落地顺序（两周内可完成 1–2 周版本）

1. **第 1 周**：H1 → H2 → H4 → D2（先把「volatility + 稳定性 + 回归门禁」跑通，这是最低成本的差异化）。
2. **第 2 周**：D1 → D4 → D5（生命周期、影响清单、蒸馏路由）。
3. **暂缓**：T1–T4。现有插件是 10² 条记忆规模，README 已记录「自动聚类/GraphRAG 在此规模无收益/有伤害」；图化的价值在**审计和溯源**，不在召回，所以先做「边 + 审计日志」，不要先做图查询 UI。
4. **绝不做**：任何训练、任何代码自动生成执行、任何自动改插件源码。

---

## 3. 明确不能借的（以及为什么）

| 对象 | 为什么不能借（训练/算力/依赖/风险） | 结论 |
|---|---|---|
| **SEAgent 全套** | 需要 7B VLM（WSM）+ 72B Curriculum + UI-TARS-7B Actor，8×A100 80GB×3 阶段训练，GRPO + 对抗模仿 + SFT；插件无 GPU、无训练管线、无 GUI 执行环境。 | ❌ 只借「评分维度 / 指南书」概念。 |
| **Mem²Evolve 的 Asset Creation** | 需要 LLM 生成 Python 工具、MCP 执行、沙箱验证、自动修复循环；零依赖插件没有代码执行器，且自动执行生成代码是重大安全风险。 | ❌ 只借「经验条目」四字段与「方法卡」概念。 |
| **CPE 的 workflow / model 通道** | Workflow 通道要改写可执行工作流，插件不拥有 agent 工作流；model 通道要 STaR/LoRA 训练（A100）。 | ❌ 只借 memory 通道：证据门控 + 回归审计。 |
| **COVE 的 parameter-based 通道** | Qwen3-8B、4×A100、SFT/GRPO、anti-recitation reward；需要训练基础设施。 | ❌ 只借 volatility 标签与路由规则。 |
| **MemEvolve 的 meta-evolution** | 需要自动生成/执行多个记忆系统实现、并行评测候选架构；工程复杂、成本高、不可控；且「自动改代码」与插件「纯 JSON、零依赖」直接冲突。 | ❌ 只借 encode/store/retrieve/manage 四模块作为设计词汇。 |
| **OPD-Evolver 的 slow loop** | 4B/9B 模型 on-policy self-distillation，需要 GPU 训练与大量轨迹；插件没有策略模型。 | ❌ 只借四级记忆 + 价值分。 |
| **Darwin-Claw 的向量经验池 / 自动写 SKILL.md** | 向量检索需要 embedding 模型/向量库（违反零依赖）；自动改写技能文件有提示注入、能力漂移、不可回滚风险。 | 🟡 用 BM25/关键词替代向量；技能改写改为「候选 + 人工批准」。 |
| **图数据库 / DPO 引擎 / SQLite** | `ctxt-00003` 明确要求纯 JSON、不引入 SQLite；图数据库/DPO 引擎都是外部依赖，且 10² 规模无收益。 | ❌ 用 JSON 邻接表 + 手写 rewrite 函数即可。 |
| **多 agent 共同进化 / self-play** | 插件是单用户、单 agent、单进程；没有多 agent 环境，也没有对手/评估器生态。 | ❌ 只借评估思想（held-out evaluator）。 |
| **完全自主的自我修改（无人工审批）** | 记忆投毒、错误归因、评估器 gaming、权限扩散（SEAgent 论文自己也提到恶意自动化风险）；插件现有设计核心是「模型提议、代码校验、人工确认」。 | ❌ 保持「propose vs verified state」分离。 |
| **大规模合成任务 / 自动课程** | SEAgent 的 Curriculum 依赖可执行 GUI 环境和奖励模型；插件没有环境，也没有可靠 judge。 | ❌ 只做「缺口 → 人工确认的候选任务」。 |

---

## 4. 与现有插件字段的映射（改造清单）

| 论文概念 | 现有字段/模块 | 需要新增 | 工作量 |
|---|---|---|---|
| Experience Memory 四字段 | `TemporalFact.content` + `tags` + `topicIds` | `title/useCase/volatility/layer` | 半天 |
| Evidence-gated preservation | `evidence.status` + `UsageStats` | `stabilityTier/stabilityEvidence` | 半天 |
| EU 生命周期 | `PlaybookStatus`（pending/active/retired/expired） | `ttl/probationSlots/exploitSlots/exploreSlots` | 1 天 |
| 回归审计 | `src/eval.ts` + `evals/cases.json` + `evals/baseline.json` | `memory.retention` 用例组 + `FGT/BWT` 报告 | 1 天 |
| 图节点/边 | `sourceIds` / `topicIds` / `linkedBy` | `cognition-graph.json` + 邻接查询 + rewrite log | 3 天 |
| 影响清单 | `sourceIds` 重算 | `affected` 写入审计 + UI 展示 | 1 天 |
| 四层记忆 | 现有 memory/playbook | `layer` 字段 + 注入预算 | 1 天 |

---

## 5. 参考链接与核查说明

- [SEAgent ICML 2026 poster 65711](https://icml.cc/virtual/2026/poster/65711)
- [SEAgent arXiv 2508.04700](https://arxiv.org/abs/2508.04700) / [HTML](https://arxiv.org/html/2508.04700v1)
- [Mem²Evolve arXiv 2604.10923](https://arxiv.org/abs/2604.10923) / [HTML](https://arxiv.org/html/2604.10923v1)
- [Do Self-Evolving Agents Forget? arXiv 2605.09315](https://arxiv.org/abs/2605.09315) / [HTML](https://arxiv.org/html/2605.09315v1)
- [A Survey of Self-Evolving Agents arXiv 2507.21046](https://arxiv.org/abs/2507.21046) / [HTML](https://arxiv.org/html/2507.21046)
- [A Comprehensive Survey of Self-Evolving AI Agents arXiv 2508.07407](https://arxiv.org/abs/2508.07407) / [alphaXiv 结构化解读](https://www.alphaxiv.org/abs/2508.07407)
- [Self-Evolving Agents as Dynamic Graph Transformation arXiv 2608.18104](https://arxiv.org/abs/2608.18104) / [HTML](https://arxiv.org/html/2608.18104v1)
- [Learning What to Remember and What to Internalize (COVE) arXiv 2608.01234](https://arxiv.org/abs/2608.01234)
- [Darwin-Claw arXiv 2610.23574](https://arxiv.org/abs/2610.23574)
- [MemEvolve arXiv 2512.18746](https://arxiv.org/abs/2512.18746)
- [Co-Evolution in Agentic Systems arXiv 2608.10299](https://arxiv.org/abs/2608.10299)
- [OPD-Evolver arXiv 2606.17628](https://arxiv.org/abs/2606.17628)

**核查说明（避免误导）**：
1. 以上所有“关键数字”均来自对应论文的 HTML/摘要或 alphaXiv 结构化摘要，未使用二手博客数字（2508 的四组件定义除 arXiv 摘要外，还核对了 alphaXiv 对 Figure 3 的五步循环描述）。
2. **未找到**：SEAgent v1 正文的 AndroidWorld 具体数字（摘要提到该 benchmark，但正文 Table 2/5 只报告 OSWorld 与 ScienceBoard）；Mem²Evolve 自身的失败案例专节（只有 limitation 与基线失败对照）；2508 的完整 PDF 因网络限速未逐页读完（四组件定义与摘要一致，未引用其正文数字）。
3. 本报告没有把「综述里的二手引用」当成这些论文自己的实验结果；所有实验数字都来自对应论文的实验章节。
