# 自我进化论文精读（2026）

> 2026-11-05
> 目的：为一个零依赖、纯 JSON、本地运行的中文长期助手插件做技术选型。
> 方法：读 arXiv 原文（HTML 全文版），不是只看摘要或二手解读。

---

## 一、逐篇拆解

### 1.1 SEAgent（arXiv 2508.04700 / ICML 2026）

| 项 | 内容 |
|---|---|
| **机制** | 三个组件：Actor Model（执行动作）+ World State Model（逐步评估）+ Curriculum Generator（生成任务） |
| **World State Model** | Qwen2.5-VL 微调；输入**完整轨迹** `H={(s0,a0),(s1,a1),…}`；把每个动作判成 `aT`（正确、有推进）或 `aF`（失败/冗余循环）。联合训练「状态变化描述」能提升判断精度。在 AgentRewardBench 上比基线 **+7.5%** |
| **Curriculum Generator** | LLM + 持续更新的「软件指南书」记忆 U；`U_{p+1}, I_{p+1} = M_task(U_p, I_p, J_p, C_p)`；用上一阶段的判断 J 和状态变化描述 C 更新指南书，再生成更难的任务 |
| **RL** | 失败动作 → **对抗模仿**（负 log-ratio loss，形式类似 DPO 的负项）；成功动作 → **GRPO**（组内相对优势 `A^(i) = (r^(i) − mean) / std`）；reward = 动作类型匹配 + 距离（click 用 L1、drag 用 IoU、type 用 BLEU） |
| **关键数字** | UI-TARS **11.3% → 34.5%**（+23.2pp）；specialist RL 32.2%；generalist RL 30.6%；**specialist→generalist 34.5% 超过任何单一 specialist** |
| **实验设置** | 5 个 OSWorld 专业软件；全部无人工标注 |
| **局限** | 需要微调 LVLM（训练算力）；需要能执行 GUI 的环境；零依赖插件做不到 |
| **零依赖可行性** | ❌ 训练部分不可；✅ **「逐步评估」概念可借** |
| **能借什么** | **把「这一条准则这次有没有用」判成正/负，而不是等整轮结束再算总分** —— 这正是我们 `appliedGood/appliedBad` 该有的粒度和语义 |

### 1.2 Mem2Evolve（arXiv 2604.10923 / ACL 2026）

| 项 | 内容 |
|---|---|
| **问题** | 现有框架把「经验积累」和「造新资产」分开做：前者被静态工具集限制，后者没有经验指导 |
| **机制** | **Experience Memory**（经验）+ **Asset Memory**（资产：工具/专家 agent）**共同进化**；经验指导造资产，资产带来新经验 |
| **关键数字** | 6 类任务 / 8 个 benchmark：比标准 LLM **+18.53%**；比「只靠经验进化」**+11.80%**；比「只靠造资产进化」**+6.46%** |
| **局限** | 「造资产」需要代码生成 + 执行 + 验证；没有说清楚失败资产怎么回收 |
| **零依赖可行性** | ⚠️ 部分：「经验记忆」可做；「造资产」只能做「造技能卡」，不能造代码 |
| **能借什么** | **经验 → 技能** 的单向管道：用 `usage` 统计筛出反复成功的做法，转成 `kind: procedure` 的技能卡 |

### 1.3 Do Self-Evolving Agents Forget?（arXiv 2605.09315）⭐最重要

| 项 | 内容 |
|---|---|
| **核心发现** | 自我演化是**非单调的**：适应新任务分布会**逐步侵蚀**旧能力 |
| **四条通道** | workflow / skill / model / memory —— **四条都会出现能力侵蚀** |
| **命名** | **capability erosion under self-evolution** |
| **解法** | **CPE（Capability-Preserving Evolution）**：约束破坏性能力漂移的通用稳定原则 |
| **关键数字** | workflow 演化中，CPE 把保留的简单任务性能从 **41.8% → 52.8%**（GPT-5.1 优化），同时复杂任务适应更强 |
| **结论** | 稳定的长期自我进化 agent，不只要「获得新能力」，还要**显式保留旧能力** |
| **局限** | 主要验证在 workflow/skill 层；memory 层的 CPE 机制描述较少 |
| **零依赖可行性** | ✅ **完全可以做**：固定回归集 + 变更前后对比，纯 JSON + 脚本 |
| **能借什么** | **能力保留审计**：每次准则/记忆变更后，跑一组固定的旧任务，通过率下降超过阈值就阻止变更 |

### 1.4 A Survey of Self-Evolving Agents（arXiv 2507.21046）

**框架：What / When / How / Where**

| 维度 | 分类 |
|---|---|
| **What（演化什么）** | Models（权重）/ Memory（记忆）/ Tools（工具）/ Architecture（架构） |
| **When（何时演化）** | **Intra-test-time**（测试时，如 Reflexion）/ **Inter-test-time**（测试间，如 ExpeL） |
| **How（怎么演化）** | Scalar rewards（RL）/ Textual feedback（自然语言反思）/ Single-agent / Multi-agent |
| **Where（在哪演化）** | Coding / Research / General |

**对我们的用处**：定位清楚——我们在 **Memory × Inter-test-time × Textual feedback × Single-agent** 这一格。

### 1.5 A Comprehensive Survey of Self-Evolving AI Agents（arXiv 2508.07407）

**统一反馈环：System Inputs → Agent System → Environment → Optimisers**

| 组件 | 内容 |
|---|---|
| **System Inputs** | 任务、用户反馈、环境信号 |
| **Agent System** | 模型 + 记忆 + 工具 + 架构 |
| **Environment** | 执行环境与结果 |
| **Optimisers** | 谁根据反馈改 Agent：人 / LLM / RL / 规则 |

**对我们的用处**：我们的 Optimiser 是**「规则 + 人」**，不是 RL。这是刻意的——可审计优先于自动化。

### 1.6 Self-Evolving Agents as Dynamic Graph Transformation（arXiv 2608.18104）

**把 agent 的记忆、工具、技能、工作流、关系看成一张随时间变化的图**：

| 演化类型 | 内容 |
|---|---|
| **节点/特征演化** | 新增/修改记忆、工具、技能 |
| **边/拓扑演化** | 建立/删除关系（记忆↔技能、工具↔任务） |
| **子图激活** | 按任务激活一组相关节点 |
| **跨组件协同演化** | 记忆、工具、技能一起变 |

**呼吁**：graph-aware evaluation & governance（图感知的评测与治理）。

**对我们的用处**：我们已经用 `topicIds` + `sourceIds` + `validTo` 表达了大部分边；**不需要图数据库**。

### 1.7 COVE（arXiv 2608.01234）

| 项 | 内容 |
|---|---|
| **问题** | 两条演化通道各有取舍：harness-based（外部记忆/技能，快但浅）vs parameter-based（权重，深但慢） |
| **机制** | task-aware routing（按任务路由到合适通道）+ stage-aware scheduling（按阶段调度）+ knowledge optimization |
| **核心观点** | 自我进化不是「 indiscriminate 累积经验」，而是**把任务和知识类型匹配到合适的学习机制** |
| **对我们的用处** | 明确：**我们的通道是 harness-based**，不该假装能做 parameter-based |

---

## 二、三套 taxonomy 的异同

| 维度 | 2507.21046 | 2508.07407 | 2608.18104 |
|---|---|---|---|
| **组织方式** | What / When / How / Where | 四组件反馈环 | 图的四类变换 |
| **最适合指导** | 「我该演化哪一层、什么时候演化」 | 「谁是我的优化器、反馈从哪来」 | 「记忆/技能之间怎么连」 |
| **粒度** | 中（能力分类） | 中（系统组件） | 细（图操作） |
| **对我们的价值** | ⭐⭐⭐ 定位自己 | ⭐⭐⭐ 设计反馈环 | ⭐⭐ 设计 `sourceIds`/`topicIds` |

---

## 三、L2 记忆学习能借的机制清单

| 机制 | 来源 | 成本 | 落地 |
|---|---|---|---|
| **逐步评估（正/负）** | SEAgent | 半天 | `appliedGood/appliedBad` 已有字段，补自动来源 |
| **能力保留回归** | CPE | 1–2 天 | 固定 50–100 条旧任务；变更前后跑；降 >10% 阻止 |
| **经验 → 技能卡** | Mem2Evolve | 1–2 天 | `usage` 筛出反复成功的，转 `kind: procedure` |
| **任务路由** | COVE | 1 天 | 按任务类型选「查记忆 / 查准则 / 查技能」 |
| **图化关系** | 2608.18104 | 已有 | `sourceIds` + `topicIds` 已够 |
| **双通道意识** | COVE | 0 | 文档里写清「我们只做 harness-based」 |

---

## 四、明确不能借的

| 机制 | 为什么 |
|---|---|
| **GRPO / 对抗模仿 / 微调** | 需要训练算力、标注、可执行环境；零依赖插件做不到 |
| **造资产（代码级）** | 需要代码生成 + 沙箱 + 验证 + 回滚；风险远大于收益 |
| **递归自我改进（RSI）** | 模型训练层的事 |
| **自动生成大规模合成任务** | SEAgent 的 Curriculum 需要可执行环境；我们只能做「缺口 → 人工确认的候选」 |
| **图数据库 / 向量库** | 破坏零依赖和可审计性 |

---

## 五、一句话

> **三篇论文的核心可以浓缩成一句：**
> **SEAgent 说「要逐步评估」；Mem2Evolve 说「经验和技能要一起长」；CPE 说「长新的会掉旧的，必须显式保留」。**
>
> **前两条我们做得到一半（分项计数 + 技能卡）；第三条完全做得到，而且正是我们该主打的差异化。**

---

## 参考

- [SEAgent (arXiv 2508.04700)](https://arxiv.org/abs/2508.04700) / [HTML](https://arxiv.org/html/2508.04700v1)
- [Mem2Evolve (arXiv 2604.10923)](https://arxiv.org/abs/2604.10923)
- [Do Self-Evolving Agents Forget? (arXiv 2605.09315)](https://arxiv.org/abs/2605.09315)
- [A Survey of Self-Evolving Agents (arXiv 2507.21046)](https://arxiv.org/abs/2507.21046)
- [A Comprehensive Survey of Self-Evolving AI Agents (arXiv 2508.07407)](https://arxiv.org/abs/2508.07407)
- [Self-Evolving Agents as Dynamic Graph Transformation (arXiv 2608.18104)](https://arxiv.org/abs/2608.18104)
- [COVE (arXiv 2608.01234)](https://arxiv.org/abs/2608.01234)
