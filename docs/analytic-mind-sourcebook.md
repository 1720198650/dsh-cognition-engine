# 分析哲学 / 心灵哲学：能用的部分（只选不拖累实现的）

> 2026-11-10。目的：在**不改变三判据、不增加依赖**的前提下，从分析的心灵哲学里挑能落到代码的东西。
> 结论先说：**大部分不能工程化，能用的只有两处公式级的东西**，其余只当"别犯的错"清单。

---

## 一、逐流派判断

| 流派 | 核心主张 | 对我们有用吗 | 取 / 不取 |
|---|---|---|---|
| **功能主义 / 多重可实现**（Putnam, Fodor） | 心理状态由功能角色定义，不看基质 | ✅ 方法论有用 | 取：实现"机制"而不是"仿人"；不取：由此推出"什么实现都算"的相对主义 |
| **计算主义 CTM**（Newell, Fodor） | 心智是计算 | ✅ 已经是我们的前提 | 取：把心理学术语翻成可执行规则；不取：强 AI 式断言 |
| **BDI / 意图哲学**（Bratman《Intention, Plans, and Practical Reason》, 1987） | 意图是**带承诺的稳定结构**，不是每步重算 | ✅ 有成熟工程对应（见 §2） | 取：承诺期的概念；不取：完整 BDI 逻辑（会引入规划器，超范围） |
| **全局工作空间 GWT / GNW**（Baars; Dehaene） | 意识内容=被广播到全局的那部分 | ⚠️ 部分可用 | 取："只有少量内容进入全局"这一点（我们已有注入上限）；不取：把"广播"当意识 |
| **Conscious Turing Machine**（Blum & Blum） | 用图灵机形式化"竞争—胜者广播—短期记忆" | ⚠️ 可读不可搬 | 取：竞争进入工作区的机制；不取：它关于意识的强主张 |
| **高阶表征理论 HOT**（Rosenthal; Lau） | 状态要"被表征"才成为意识状态 | ❌ 不适合 | 不取：我们没有元表征层，硬加就是加一个"自我监控"模块，变成设计人格 |
| **自我模型理论**（Metzinger, *Being No One*, 2003） | 自我是**透明的表征模型** | ✅ 概念上支持我们 | 取："自我=模型，不是实体"；不取：现象学细节 |
| **预测加工 / 自由能**（Friston; Seth; Clark） | 大脑做预测误差最小化 | ✅ 已在用 | 取：预测误差驱动（`protentionError`）；不取：把 FEP 当万能解释 |
| **IIT（整合信息论）**（Tononi） | 意识=Φ，整合信息量 | ❌ 不适合当实现 | 取：无；不取：Φ 计算是指数复杂度，且理论本身有公开争议 |
| **行动哲学：意图与承诺**（Bratman; Hawley 论信任） | 承诺会产生"不再重算"的稳定倾向 | ✅ 可映射一个参数 | 取：承诺期；不取：规范伦理学讨论 |

## 二、已经工程化的项目（可参考，不依赖）

| 项目 | 是什么 | 我们能拿什么 |
|---|---|---|
| **ACT-R**（Anderson） | 认知架构；声明性记忆有**基础激活**公式 `B_i = ln(Σ_j t_j^{-d})`，d≈0.5 | **幂律衰减**做 retention 的候选实现（见 §3） |
| **Soar**（Laird） | 认知架构；**chunking**（把解法编译成规则） | 概念参照：我们的 `settle` 类似"编译"，但不做完整 chunking |
| **SPADE / JADE / Jason** | 成熟 BDI 多智能体平台（Python/Java） | 参考"意图状态机"字段设计；**不引入** |
| **LIDA**（Franklin） | 全局工作空间的工程实现（认知循环） | 参考它的"注意码—广播"节奏 |
| **PyPhi**（[wmayner/pyphi](https://github.com/wmayner/pyphi)，PyPI 1.2.0） | IIT 的 Φ 计算工具箱 | 仅作**诊断玩具**，不进产品（复杂度爆炸） |
| **pymdp**（[infer-actively/pymdp](https://github.com/infer-actively/pymdp)，751★） | 主动推理（离散 MDP）实现 | 参考"先验—观测—后验"的写法 |

## 三、选两件工程化（都不影响现有目标）

### 3.1 采纳：幂律衰减作为 retention 的**可选**实现
ACT-R 的基础激活是**幂律**（`Σ t^-d`），而我们目前用的是指数衰减。
幂律的差别在长尾：久远事件衰减更慢，更贴近"陈年旧事仍有余威"。

**做法**：`retentionDecay: 'exponential' | 'power'`，默认 `exponential`（**不改变现有行为**）；
原型里对同一批事件跑两种曲线，比较"第 3 个 checkpoint 的位移量"。哪个更符合"不对称"判据就用哪个。
**不引入依赖**：公式就三行。

### 3.2 只留接口，不实现：BDI 的"承诺期"
`retention` 高 → 意图保持更久（commitment horizon）。这个**先不写**，理由：
一旦实现，"少改口"会变成"固执"，容易被误读成人格特质。只在方案里留一个字段位和说明。

## 四、明确不采纳（并说明为什么）

| 不采纳 | 原因 |
|---|---|
| IIT 的 Φ 当实现 | 指数复杂度 + 理论争议（2023 年那封公开信之后仍未平息）；拿它做产品指标是不负责任的 |
| HOT 的元表征层 | 会引入"自我监控"模块，等于偷偷加了一个人格维度 |
| 全局工作空间的"意识"解读 | 我们只要"少量内容进注入"这个工程事实，不要它的意识结论 |
| 功能主义的相对主义推论 | "怎么实现都行"会让判据失效；我们坚持三判据可测 |

## 五、对目标的影响：零

这些都只是：① 一个衰减公式的可选分支；② 一个字段位的注释。
**三判据（不对称/不可逆/非检索）、4 维上限、默认关闭、不接奖励——一条都不动。**
如果哪天为了塞进某个哲学概念而要加维度或改判据，那就是跑偏了，应当停。

## 六、参考

1. Bratman, M. *Intention, Plans, and Practical Reason.* Harvard UP, 1987.
2. Anderson, J. R. *How Can the Human Mind Occur in the Physical Universe?* Oxford UP, 2007（ACT-R 基础激活公式）。
3. Laird, J. E. *The Soar Cognitive Architecture.* MIT Press, 2012.
4. Metzinger, T. *Being No One.* MIT Press, 2003.
5. Baars, B. *A Cognitive Theory of Consciousness.* Cambridge UP, 1988.
6. Dehaene, S. *Consciousness and the Brain.* Viking, 2014.
7. Blum, L. & Blum, M. *A Theory of Consciousness from a Theoretical Computer Science Perspective*（Conscious Turing Machine）。
8. Mayner, W. `pyphi`（IIT 工具箱）。<https://github.com/wmayner/pyphi>
9. Heins, C. et al. `pymdp`（主动推理）。<https://github.com/infer-actively/pymdp>
10. Tononi, G. et al. Integrated Information Theory（IIT 4.0），仅作背景；不采用其Φ实现。
