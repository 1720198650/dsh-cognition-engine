# 上下文内学习（In-Context Learning）研究

> 记录时间：2026-11-04
> 问题：冻结权重的模型，能不能通过外部机制「慢慢学习」？像人一样？
> 关联：[evaluation-review-and-learning.md](evaluation-review-and-learning.md)

---

## 一、核心结论先说

**能学，但学的是「工作状态」，不是「能力」。**

关键区分（来自 SCL）：

> 模型提出（proposes），外部记忆保存**已验证状态**（preserves verified state）。

以及那份终身学习综述的核心提醒：

> 冻结主干并没有消除「稳定性 vs 可塑性」的两难，**只是把它挪了位置**。
>
> （Freezing the backbone doesn't remove the stability-plasticity dilemma — it relocates it.）

换成我们的话：**权重不更新 ≠ 不会遗忘。** 外部记忆一样会「学新的丢旧的」，甚至更容易——
旧准则被新准则挤掉、过期准则还在注入、上下文预算被低价值条目占满。

---

## 二、四类记忆：我们在哪一格

来自 [Lifelong Learning of LLM-based Agents: A Roadmap](https://arxiv.org/abs/2501.07278)（Zheng et al. 2025）
与 [Agentic Memory Architectures](https://www.frankx.ai/research/agentic-memory-architectures)：

| 类型 | 存什么 | 我们的实现 |
|---|---|---|
| **Working**（工作记忆） | 当前上下文窗口 | 对话本身，不归插件管 |
| **Episodic**（情景记忆） | 发生过什么 | ✅ `cognition-state.json` 双时态记忆 |
| **Semantic**（语义记忆） | 一般性知识/规则 | ✅ 准则本（playbook） |
| **Procedural**（程序记忆） | 怎么做一件事 | ❌ **缺这一格** |

**我们缺 procedural memory**——也就是「技能」。而 Voyager / AWM / ExpeL 研究的正是这一块。

---

## 三、技能学习的三条现成路线

### 3.1 Voyager：技能库（Skill Library）

[Voyager](https://arxiv.org/abs/2305.16291)（NVIDIA, 2023）在 Minecraft 里让 agent 把验证过的行为**存成可复用的代码技能**，
新任务先检索技能库再组合。这是「程序记忆」最直接的实现。

**对我们的启示**：准则本存的是「规则」（陈述性），不是「步骤」（程序性）。
一条「发版前依次执行五步」其实已经是伪技能——它有顺序、有可执行性。

> **真要做 procedural memory，最短路径不是新模块，而是给准则加一个 `kind: rule | procedure` 字段**，
> procedure 类允许有步骤列表，渲染时展开成有序清单。

### 3.2 AWM：工作流记忆（Agent Workflow Memory）

[Agent Workflow Memory](https://arize.com/?p=23252) 把多步任务轨迹归纳成**可复用的工作流**，
下次遇到同类任务直接套用。与 Voyager 的区别是它归纳的是「流程」而不是「代码」。

### 3.3 ExpeL：从经验提取洞察

ExpeL（AAAI 2024）让 agent 在多次任务后**自己提取自然语言洞察**（insights），
下次任务把这些洞察作为提示。这是离我们最近的范式——**我们的准则本就是这个思路**。

**差异**：ExpeL 的洞察是从**任务成败对比**中提取的（成功轨迹 vs 失败轨迹），
我们的蒸馏是从**记忆文本**里提取的（没有成败信号）。

> **这正是我们缺反馈回路的原因**：没有成败信号，提取出的洞察无法验证。

---

## 四、最重要的发现：没人测「遗忘」

[PATH-Bench: Path-Dependent Evaluation of Lifelong Agents](https://arxiv.org/abs/2608.01149)（2026-08）

它提出用「路径依赖」评测终身 agent，指标包括：

- **Transfer**：积累的经验对新任务有没有帮助
- **FGT（Forgetting）**：积累经验后，旧任务上的表现掉了多少
- 其他：保留率、效率指标

**结果很有说服力**：多个记忆系统在 WildToolBench 上的 FGT 为**负值**：

| 系统 | 得分 | FGT |
|---|---|---|
| DeepSeek-V4-Flash（无记忆基线） | 42.80 | — |
| BGE-M3 RAG | 45.52 | −1.48 |
| HippoRAG-v2 | 41.70 | −2.61 |
| AWM | 42.86 | +0.01 |
| MemRL | 44.37 | −3.44 |
| AutoSkill | 42.38 | −5.08 |

> **负 FGT = 用了记忆之后，反而比不用的基线更差。**

另一份综述（arXiv 2501.07278）更狠：

> 约 **360 篇**被引文献里，**0 篇**用「遗忘」指标（FGT / BWT）量化过某个具名系统的遗忘程度。
> 「在分类表里打个勾，不等于这个系统被测过遗忘。」

**这意味着两件事**：

1. **加记忆不保证变好，可能变差**——印证「插件也可能让我更蠢」
2. **我们有一个没人占的位置**：因为双时态 + `validTo`，我们**天生就能测遗忘**

---

## 五、可测遗忘：我们的差异化机会

我们现在已经有：

- `validFrom` / `validTo` / `supersededAt`（什么时候该作废）
- 准则的 `validTo` 过期停用
- `helpful` / `harmful` 计数（虽然还没人填）

**缺的只是把「遗忘」变成可计算的量**：

```
遗忘率 = 已过期/已退场准则中，仍在被需要的比例
      或：新准则加入后，旧准则的命中率下降幅度
```

配合 PATH-Bench 的思路，可以在评测台加一条：

> **注入准则 A 之后，原本依赖准则 B 的任务，B 的命中/遵守率有没有下降？**

这是**零成本、纯本地**能做的，而且目前没有竞品做。

---

## 六、类人记忆：`Oblivion` 的做法

[Oblivion: Self-Adaptive Agentic Memory Control through Decay-Driven Activation](https://www.emergentmind.com/papers/2604.00131)

核心：**选择性遗忘是适应能力，不是缺陷**。用衰减驱动激活——记忆的激活度随时间衰减，
需要时按衰减后的强度决定是否唤起。

**我们已有 `decay()`**（`R = e^(−t/S)`，对齐 MemoryBank），但**衰减只用于打分，不用于淘汰**。

可借鉴的一步：**衰减到底的记忆不删除，但降低注入优先级**——现在是纯按 `helpful−harmful×2` 排序，
加上衰减后，长期没被用到的准则会自然下沉。这也解决了「预算挤占」问题（备忘漏掉的那个风险）。

---

## 七、对我们这个插件的具体结论

### 7.1 能做到的「学习」

| 能力 | 对应机制 | 现状 |
|---|---|---|
| 记住事实 | 双时态记忆 | ✅ |
| 记住规则 | 准则本 | ✅ |
| **记住步骤（技能）** | 准则加 `kind: procedure` + 步骤列表 | ❌ 可做，成本低 |
| 纠错 | supersedes / harmful | ✅ 机制有，信号没接 |
| 遗忘 | validTo + decay | ⚠️ 有机制，没调优 |
| **测量遗忘** | FGT 式评测 | ❌ 可做，且是空白位 |

### 7.2 做不到的

- 更深的推理、更强的泛化（要权重更新）
- 真正的「举一反三」——类比迁移需要表征能力
- 自主发现「我该学什么」——需要元认知，现在没有

### 7.3 优先级（按证据强度）

| 顺序 | 做什么 | 依据 | 成本 |
|---|---|---|---|
| **1** | 隐式反馈（纠正→降级） | ExpeL 缺成败信号 | 半天 |
| **2** | 衰减参与注入排序 | Oblivion / MemoryBank | 2 小时 |
| **3** | **遗忘率评测** | PATH-Bench 的空白位 | 1 天 |
| 4 | 准则加 `kind: procedure` | Voyager / AWM | 1 天 |
| 5 | 去重分级 | 评估备忘 | 半天 |

---

## 八、来源

- [Lifelong Learning of LLM-based Agents: A Roadmap](https://arxiv.org/abs/2501.07278)（Zheng et al. 2025）
- [PATH-Bench: Path-Dependent Evaluation of Lifelong Agents](https://arxiv.org/abs/2608.01149)（2026）
- [Voyager: An Open-Ended Embodied Agent with LLMs](https://arxiv.org/abs/2305.16291)（NVIDIA 2023）
- [Agent Workflow Memory](https://arize.com/?p=23252)
- [Oblivion: Decay-Driven Activation](https://www.emergentmind.com/papers/2604.00131)
- [Agentic Memory Architectures: Episodic, Semantic & Procedural](https://www.frankx.ai/research/agentic-memory-architectures)
- [Adapting Without Forgetting（综述解读）](https://podcast.do-not-panic.com/viz/2026-08-01-adapting-without-forgetting-a-lifelong-learning-roadmap-for-llm-agents-162c50.html)
- [Fine-tuning vs In-context Learning: A Formal Language Learning Perspective](https://aclanthology.org/2026.acl-long.1932)（ACL 2026）
