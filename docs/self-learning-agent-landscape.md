# 自我学习 Agent：跨学科扫描与 2026 项目/论文

> 2026-11-05
> 问题：自我学习到底指什么？2026 年哪些项目和论文真的在做？哪些能用、哪些不能用？我们处在哪一层？
> 关联：[research-frozen-weight-learning.md](research-frozen-weight-learning.md)、[research-humanlike-agents-and-autonomy.md](research-humanlike-agents-and-autonomy.md)、[vision-and-roadmap.md](vision-and-roadmap.md)

---

## 〇、一句话结论

**「自我学习」不是一个东西，是四层：**

| 层 | 机制 | 改权重 | 代表 | 我们 |
|---|---|---|---|---|
| **L1 上下文学习** | prompt 示例 | 否 | few-shot / ICL | 能，但不持久 |
| **L2 记忆学习** | 外部记忆 + 检索 + 反馈 | 否 | ExpeL / ReasoningBank / ACE / Mem0 | ✅ 已做 |
| **L3 技能/工具自造** | 写代码、造工具、建技能库 | 否（造的是新资产） | Voyager / Agent Skills / Mem2Evolve | ⚠️ 可做「技能」部分 |
| **L4 权重更新** | 微调 / RL / GRPO | **是** | SEAgent / Agentic RL | ❌ 不做 |

> **2026 年最热的是 L3 和 L4；但真正能落进「零依赖本地插件」的，仍然只有 L2，加一点 L3 的「技能包」。**

---

## 一、三个必须知道的 2026 综述

### 1.1 *A Survey of Self-Evolving Agents*（arXiv 2507.21046）

组织框架：**What / When / How / Where to evolve**

| 维度 | 内容 |
|---|---|
| **What** | 演化什么：models / memory / tools / architecture |
| **When** | 什么时候演化：intra-test-time（测试时）/ inter-test-time（测试间） |
| **How** | 怎么演化：scalar rewards / textual feedback / single-agent / multi-agent |
| **Where** | 在哪些场景演化：coding / research / general |

**关键判断**：LLM 本身是静态的，无法改内部参数；自我演化是「用外部机制弥补静态性」。

### 1.2 *A Comprehensive Survey of Self-Evolving AI Agents*（arXiv 2508.07407）

统一反馈环：**System Inputs → Agent System → Environment → Optimisers**

| 组件 | 作用 |
|---|---|
| **System Inputs** | 任务、用户反馈、环境信号 |
| **Agent System** | 模型 + 记忆 + 工具 + 架构 |
| **Environment** | 执行环境与结果 |
| **Optimisers** | 谁根据反馈改 Agent（人 / LLM / RL / 规则） |

**关键判断**：自我演化的核心不是「模型变强」，是**优化器如何利用反馈改 Agent 的某个组件**。

### 1.3 *Self-Evolving Agents as Dynamic Graph Transformation*（arXiv 2608.18104）

把 agent 的记忆、工具、技能、工作流、关系看成**一张随时间变化的图**：

| 演化类型 | 内容 |
|---|---|
| **节点/特征演化** | 新增/修改记忆、工具、技能 |
| **边/拓扑演化** | 建立/删除关系（记忆↔技能、工具↔任务） |
| **子图激活** | 按任务激活一组相关节点 |
| **跨组件协同演化** | 记忆、工具、技能一起变 |

并呼吁 **graph-aware evaluation & governance**（图感知的评测与治理）。

**对我们的启示**：我们已经有「记忆 + 主题 + 准则 + 缺口」的图结构雏形；**不需要图数据库**，用 `topicIds` + `sourceIds` 就能表达大部分边。

---

## 二、2026 年最热的项目（按类型）

> 星标数来自第三方排行榜抓取（2026-11-05），**数值明显偏高，仅作热度参考**；证据等级见括号。

### 2.0 热度榜 Top 10（AI_Agents 分类）

| # | 项目 | 星标 | 一句话 |
|---|---|---|---|
| 1 | **rea** | 432k | 用 agent 逆向工程一切（从 App 行为到原生二进制） |
| 2 | **superpowers** | 312k | Agentic skills 框架 + 开发方法论 |
| 3 | **hermes-agent** | 260k | "The agent that grows with you" |
| 4 | **firecrawl** | 198k | 给 agent 提供网页数据 |
| 5 | **AutoGPT** | 187k | 第一代自主 agent |
| 6 | **ponytail** | 184k | "让 AI 像最懒的资深开发"——少写代码 |
| 7 | **agency-agents** | 166k | 一整套「AI  agency」角色包 |
| 8 | **dify** | 160k | Agentic workflow + RAG 平台 |
| 9 | **langflow** | 156k | 可视化 agent/workflow |
| 10 | **langchain** | 149k | Agent engineering platform |

**判断**：热度榜前 10 里，**真正做「学习」的只有 hermes-agent（自称）和 superpowers（技能框架）**；其余是编排、数据、开发方法论。**热度 ≠ 学习能力。**

### 2.1 常驻 / 主动型 Agent

| 项目 | 是什么 | 关键机制 | 证据 |
|---|---|---|---|
| **DeepSeek Super-agent** | Router + Worker 常驻 agent | Ticket / 授权 / 主动观察 / Watchdog 自愈；P50 12.4 分钟、P95 15.7 分钟（单 Session 29.5） | A（官方文章 + 开源原型） |
| **OpenHands**（92.7k★） | 开源 agentic SDLC 平台 | GitHub/Slack/Jira/Linear/定时触发；PR review、nightly security | B（源码 + 产品） |
| **Agent Zero** | 自主 agent 框架 | computer use、A2A、状态回滚（time travel） | B（源码） |
| **AutoGPT**（187k★） | 第一代自主 agent | 任务分解 + 自主循环 | B（源码，工程不成熟） |
| **Hermes-agent**（260k★） | "The agent that grows with you" | 长期成长/记忆（官方描述） | C（README） |
| **Superpowers**（312k★） | Agentic skills framework | 技能框架 + 开发方法论 | C（README） |

### 2.2 技能 / 工作流型

| 项目 | 是什么 | 关键机制 | 证据 |
|---|---|---|---|
| **Agent Skills（Anthropic）** | 开放标准（agentskills.io） | `SKILL.md`：YAML frontmatter（name/description）预加载 → 正文按需加载 → 资源文件三级渐进披露；文件夹 = 指令 + 脚本 + 资源 | A（官方标准 + 文档） |
| **dsh-bili-scroll**（1.2k★） | 每天替你刷 B 站 | 读字幕判断 + 写日报 + 自动评论；personaPrompt | B（源码） |
| **MaiBot**（6.9k★） | QQ 群聊数字生命 | 人格 JSON + expression_learner + turn_trigger | B（源码） |
| **OpenHanako**（6.9k★） | 个人 agent | Markdown + card JSON + 人格/任务 | B（源码） |

### 2.3 记忆 / 上下文型

| 项目 | 是什么 | 关键机制 | 证据 |
|---|---|---|---|
| **Letta / MemGPT** | 有状态 agent 平台 | memory blocks + core/archival/recall + sleep-time | S（论文 + 代码） |
| **Mem0** | 记忆层 | ADD/UPDATE/DELETE/NOOP；token −73%、延迟 −92% | S（论文 + 代码） |
| **Zep / Graphiti** | 时序知识图谱 | 双时间轴、事实有效期 | S（论文 + 代码） |
| **Memobase** | Profile + Event Timeline | 用户画像 + 事件时间线 | B（源码） |
| **A-MEM** | Zettelkasten 记忆 | 笔记 + 动态链接 | S（论文 + 代码） |

### 2.4 框架

LangGraph、CrewAI、OpenAI Agents SDK、AutoGen、Dify、Langflow、LangChain、Browser-use、pi、Firecrawl。

**判断**：这些是「怎么搭 agent」的框架，不是「怎么让 agent 学习」的机制。对我们的参考价值低于前几类。

---

## 三、2026 年最值得读的论文

### 3.1 SEAgent（ICML 2026）——真·L4 自我进化

- **问题**：computer-use agent 依赖人工标注，遇到新软件就废。
- **机制**：
  - **World State Model**：逐步评估轨迹（这一步有没有用）
  - **Curriculum Generator**：自动生成由易到难的任务
  - **GRPO**：对成功轨迹做强化学习，对失败动作做对抗模仿
  - **Specialist → Generalist**：多个专家 agent 的经验整合成一个通用 agent
- **结果**：在 5 个 OSWorld 专业软件上，UI-TARS 从 **11.3% → 34.5%**（+23.2pp）；specialist RL 32.2%、generalist RL 30.6%。
- **World State Model 细节**：Qwen2.5-VL 微调，输入完整轨迹，输出每步 `aT`（正确）或 `aF`（失败/冗余）；在 AgentRewardBench 上比基线精度 **+7.5%**。
- **Curriculum Generator 细节**：LLM + 持续更新的「软件指南书」记忆 U；U 由状态变化描述 C 和轨迹判断 J 更新，再生成更难的下一阶段任务。
- **RL 细节**：失败动作用对抗模仿（负 log-ratio），成功动作用 GRPO；reward = 动作类型匹配 + 距离（click L1 / drag IoU / type BLEU）。
- **我们能借**：**「逐步世界状态评估」** → 映射到我们的 `appliedGood/appliedBad`；**训练部分用不了**。

### 3.2 Mem2Evolve（ACL 2026）——经验与资产共同进化

- **问题**：现有框架把「经验积累」和「造新工具/新 agent」分开做——前者被静态工具集限制，后者没有经验指导。
- **机制**：**Experience Memory + Asset Memory** 共同进化；经验指导造资产，资产带来新经验。
- **结果**：6 类任务 / 8 个 benchmark：
  - 比标准 LLM **+18.53%**
  - 比「只靠经验进化」**+11.80%**
  - 比「只靠造资产进化」**+6.46%**
- **我们能借**：**经验记忆 → 指导造技能** 的思路；但「造资产」在我们这里就是「写一条 procedure 准则 / 一个脚本」，不是造 agent。

### 3.3 *Do Self-Evolving Agents Forget?*（arXiv 2605.09315）——**最重要的警告**

- **核心发现**：自我演化是**非单调的**——适应新任务分布会**逐步侵蚀**旧能力，在 workflow / skill / model / memory 四条演化通道上都会出现。
- **命名**：**capability erosion under self-evolution**（自我演化下的能力侵蚀）。
- **解法**：**CPE（Capability-Preserving Evolution）**——约束破坏性的能力漂移。
- **数字**：workflow 演化中，CPE 把保留的简单任务性能从 **41.8% → 52.8%**（GPT-5.1 优化），同时复杂任务适应更强。
- **对我们的启示**：**每加一个学习机制，都要跑一遍「旧能力回归」**。这正是我们「证据链 + 审计 + 回归测试」该做的事。

### 3.4 其他值得扫一眼的

| 论文 | 一句话 |
|---|---|
| **AgencyBench**（ACL 2026） | 6 能力 / 32 场景 / 138 任务；平均 90 次工具调用、100 万 token、数小时；闭源 48.4% vs 开源 32.1% |
| **Agentic RL Survey**（2509.02547） | POMDP 框架；能力分为 planning / tool use / memory / reasoning / self-improvement / perception |
| **Learning What to Remember and What to Internalize**（2608.01234，COVE） | 两条演化通道：**harness-based**（外部记忆/技能，快）vs **parameter-based**（权重，深）；COVE 用 task-aware routing + stage-aware scheduling + knowledge optimization 协调两者 |
| **Darwin-Claw**（2610.23574） | 环境自适应经验巩固，递归自我演化 |
| **MemEvolve**（2512.18746） | 记忆系统的元演化 |
| **Co-Evolution in Agentic Systems**（2608.10299） | 超越人类设计的自导向演化 |
| **OPD-Evolver**（2606.17628） | On-policy 蒸馏训练 agent evolver |

### 3.5 Anthropic《When AI builds itself》——L4 的现实边界

- Anthropic 内部 **80%+ 合并代码由 Claude 写**（2026-05），2025-02 前还是个位数。
- 工程师人均季度代码量是 2021–2025 的 **8 倍**。
- METR 任务时长：2024-03 约 4 分钟 → 2025 Sonnet 3.7 约 1.5 小时 → 2026 Opus 4.6 约 12 小时 → Mythos 约 16 小时；**每约 4 个月翻倍**。
- 自动化 AI 研究实验：2 名人类研究员一周的差距约 23%；agent 用 800 累计小时、约 1.8 万美元算力追到 **97%**。
- **但**：人类选问题、定评分标准；结果未迁移到生产规模。

> **这是 L4 的「模型训练层」自我改进，不是插件能做的。**
> 但它说明：**L4 的门槛是算力 + 训练管线，不是 prompt。**

---

## 四、跨学科视角：自我学习还能怎么理解

| 学科 | 核心概念 | 能用的 | 不能用的 |
|---|---|---|---|
| **控制论** | 闭环反馈、设定点、误差修正、稳定性 vs 可塑性 | 「反馈 → 误差 → 修正」的循环设计 | 把 agent 当线性系统做 PID |
| **神经科学** | 巩固 / 再巩固、突触稳态（SHY）、灾难性遗忘 | 空闲批量巩固；旧能力回归测试 | 脑区模拟 |
| **心理学** | 刻意练习（Ericsson）、形成性反馈、间隔重复 | 「针对性练习 + 即时反馈」 | 「一万小时定律」式的粗糙类比 |
| **教育学** | 掌握学习（mastery learning）、课程生成 | 缺口驱动课程（gap → 由易到难） | 完整教学法 |
| **经济学** | 探索/利用（exploration/exploitation）、边际收益递减 | 学习预算：新技能 vs 旧技能 | 效用函数拟合 |
| **进化生物学** | 变异-选择-保留、适应度地形、中性漂移 | 「候选 → 验证 → 保留」的三步 | 「agent 会自己进化出智能」的隐喻 |
| **安全/对齐** | Goodhart's law、reward hacking、能力侵蚀 | 每次学习后跑回归；指标不能单一 | 用单一分数衡量「变好」 |

**一句话**：跨学科给的是**「学习循环 + 保留机制」的设计原则**，不是新算法。

---

## 五、能用 / 不能用（针对我们）

### 5.1 能用

| 机制 | 来源 | 我们的落地 | 成本 |
|---|---|---|---|
| **经验提炼** | ExpeL / ACE | 准则本 + `helpful/harmful` + 蒸馏候选 | ✅ 已有 |
| **缺口驱动课程** | SEAgent 的 Curriculum / 我们的 gaps | gap → 由易到难产候选 | ✅ 已有（P6） |
| **逐步评估** | SEAgent 的 World State Model | `appliedGood/appliedBad` 分项计数 | ✅ 已有 |
| **能力保留审计** | CPE（2605.09315） | 每次学习后跑「旧准则回归」 | 1–2 天 |
| **技能包** | Agent Skills 的 `SKILL.md` | 准则加 `kind: procedure`，可导出 `SKILL.md` | 1–2 天 |
| **经验→资产** | Mem2Evolve | 「经验记忆 → 产 procedure 候选」 | 已有雏形 |
| **版本化记忆** | MemGPT / 双时态 | `revision + history + supersedes` | ✅ 已有 |
| **反馈回路** | Agentic RL 的 reward 思想（不用 RL） | 用户纠正 → `appliedBad` | 半天（关键缺口） |

### 5.2 不能用

| 机制 | 为什么不能用 |
|---|---|
| **GRPO / RL 训练** | 需要训练基础设施、GPU、数据；零依赖插件做不到 |
| **递归自我改进（RSI）** | 模型训练层的事，不是插件 |
| **自动造 agent / 造工具** | 需要代码执行 + 沙箱 + 审批；风险高 |
| **无界自我训练** | 能力侵蚀（CPE 论文）；会越学越窄 |
| **多 Agent 协同进化** | 复杂度爆炸；个人插件不需要 |
| **把「工具自造」说成「自我学习」** | 聊天记录里的陷阱；要诚实区分 L3/L4 |

### 5.3 半能用

| 机制 | 怎么用 | 风险 |
|---|---|---|
| **自动生成课程** | 用 gap + 现有记忆生成候选任务，人确认 | LLM 生成的课程可能偏 |
| **自动提取经验** | 蒸馏候选进 pending，人确认 | 自我强化偏差 |
| **技能库** | 只存「验证过的 procedure」，不存代码 | 需要验证机制 |
| **遗忘/衰减** | 只影响排序，不删 | 不能当「真值」 |

---

## 六、我们的位置：一张图

```
L4 权重更新   ← SEAgent / Agentic RL / Anthropic RSI    ❌ 不做
L3 技能/工具  ← Voyager / Agent Skills / Mem2Evolve     ⚠️ 做「技能包」，不做「造工具」
L2 记忆学习   ← ExpeL / ACE / Mem0 / 我们                ✅ 主战场
L1 上下文     ← few-shot / prompt                        ✅ 已用
```

**我们的差异化不是「更会学」，是「学得可审计」：**

- 别人：记忆越堆越多 → 能力侵蚀（PATH-Bench 负 FGT / CPE 41.8%→52.8%）
- 我们：证据链 / 来源分级 / 冲突裁决 / 分项计数 / 回归审计 → **学习不会让旧能力变差**

---

## 七、如果要把「学习」再推进一步：四个动作

### 动作 1：接上真实反馈回路（半天，最高优先级）

现在 `appliedGood/appliedBad` 没有自动来源。做法：

```
记录每轮注入了哪些准则
  → 下一轮用户明确纠正 → 上一轮注入的准则 appliedBad +1
  → 用户确认正确 → appliedGood +1
  → 连续 2 次纠正 → disputed
```

**这是「自我学习」从 0 到 1 的开关。**

### 动作 2：准则加 `kind: procedure`（1 天）

把「规则」和「步骤」分开：

```json
{
  "kind": "procedure",
  "when": "发布版本时",
  "steps": ["卸载验证", "兼容性检查", "代码优化", "README 覆盖", "安装验证"]
}
```

可导出为 `SKILL.md`（Agent Skills 格式），与生态互通。

### 动作 3：能力保留审计（1–2 天）

借 CPE 的思想：每次准则/记忆变更后，跑一组**固定的旧任务回归**：

```
50 条「以前能做对」的任务
  → 变更后重跑
  → 通过率下降 >10% → 阻止变更 / 标记
```

**这是「学习不会变傻」的保险。**

### 动作 4：缺口驱动课程（已有，补验收）

`gaps` → 生成由易到难的候选任务 → 人确认 → 学习 → 关闭 gap。
现在有 gap 表，但还没有「课程生成」；可以先做「gap 优先级排序 + 每周回顾」。

---

## 八、2026 热门项目/论文速查表

| 类型 | 项目/论文 | 一句话 | 证据 |
|---|---|---|---|
| 常驻 Agent | DeepSeek Super-agent | Router+Worker+Ticket，P95 15.7 分钟 | A |
| 常驻 Agent | OpenHands | 开源 SDLC，GitHub/Slack/定时触发 | B |
| 常驻 Agent | Agent Zero | computer use + A2A + 状态回滚 | B |
| 技能标准 | Agent Skills | `SKILL.md` 三级渐进披露；开放标准 | A |
| 自我进化 | **SEAgent**（ICML 2026） | World State + Curriculum + GRPO；真 L4 | A |
| 自我进化 | **Mem2Evolve**（ACL 2026） | 经验+资产共同进化；+18.53% | A |
| 自我进化 | **Do Self-Evolving Agents Forget?** | 能力侵蚀；CPE 41.8%→52.8% | A |
| 自我进化 | AgencyBench（ACL 2026） | 6 能力/32 场景/138 任务；闭源 48.4% vs 开源 32.1% | A |
| 综述 | 2507.21046 | What/When/How/Where to evolve | A |
| 综述 | 2508.07407 | System Inputs → Agent → Environment → Optimisers | A |
| 综述 | 2608.18104 | 自我进化 = 动态图变换 | A |
| 综述 | 2509.02547 | Agentic RL = POMDP；6 大能力 | A |
| 记忆 | Letta / MemGPT | memory blocks + core/archival/recall | S |
| 记忆 | Mem0 | ADD/UPDATE/DELETE/NOOP；−73% token | S |
| 记忆 | Zep / Graphiti | 双时间轴知识图谱 | S |
| 记忆 | A-MEM | Zettelkasten + 动态链接 | S |
| 框架 | LangGraph / CrewAI / AutoGen / Dify | 搭 agent 的框架，不是学习机制 | B |

---

## 九、结论

> **2026 年最热的是 L4（训练）和 L3（造技能），但这两层都不是零依赖插件能做的。**
>
> 我们能做、且真正有价值的是：
> **L2 记忆学习 + 一点 L3 技能包 + 严格的能力保留审计。**
>
> 一句话：
> **别人追求「越学越强」，我们追求「越学越稳」。**
> 在自我进化普遍会「能力侵蚀」的 2026 年，**稳本身就是差异化。**

---

## 参考

- [A Survey of Self-Evolving Agents (arXiv 2507.21046)](https://arxiv.org/abs/2507.21046)
- [A Comprehensive Survey of Self-Evolving AI Agents (arXiv 2508.07407)](https://arxiv.org/abs/2508.07407)
- [Self-Evolving Agents as Dynamic Graph Transformation (arXiv 2608.18104)](https://arxiv.org/abs/2608.18104)
- [The Landscape of Agentic Reinforcement Learning for LLMs (arXiv 2509.02547)](https://arxiv.org/abs/2509.02547)
- [SEAgent (ICML 2026)](https://icml.cc/virtual/2026/poster/65711)
- [Mem2Evolve (arXiv 2604.10923)](https://arxiv.org/abs/2604.10923)
- [Do Self-Evolving Agents Forget? (arXiv 2605.09315)](https://arxiv.org/abs/2605.09315)
- [AgencyBench (arXiv 2601.11044)](https://arxiv.org/abs/2601.11044)
- [Agent Skills (Anthropic)](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [When AI builds itself (Anthropic)](https://www.anthropic.com/institute/recursive-self-improvement)
- [DeepSeek Super-agent](https://ai-bot.cn/super-agent)
- [OpenHands](https://www.openhands.dev/)
- [Agent Zero](https://agent-zero.ai)
- 本仓库 `docs/research-frozen-weight-learning.md`、`docs/research-humanlike-agents-and-autonomy.md`
