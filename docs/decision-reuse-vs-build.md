# 决策：还要不要原创？（2026-11-10）

> 用户问：「我们还需要原创吗？重新搜一下…看看有没有符合我要求的内容先。」
> 答案先说：**机制层面不需要再原创了——已经有人把每一块都做了，而且有代码。**
> 我们只剩下「一处薄增量」。下面是证据和结论。

---

## 一、按你的三条判据打分（已核实，附出处）

| 候选 | 不对称（过去偏重未来） | 不可逆（只追加） | 非检索（不靠查询生效） | 形态 |
|---|---|---|---|---|
| **Pae**（arXiv:2602.02902） | ✅ 方向依赖滞后 | ✅ 慢变量不被后果优化 | ✅ 调节快策略，不读记忆 | 论文（无代码） |
| **ARPM**（arXiv:2605.14802 + [代码 MIT](https://github.com/Spirtxiaoqi7/ARPM)） | ⚠️ 双时间重排，非偏置 | ⚠️ 可审计，但允许治理改写 | ❌ 本质是检索治理 | 论文 + 可跑代码（10★，Python） |
| **agent-soul**（[GitHub MIT](https://github.com/Rau1CS/agent-soul)） | ⚠️ 未强调不对称 | ✅ 事件溯源式记忆 + self-model 逐次修订 | ⚠️ 靠 hydrate 注入（仍是查询） | 可跑（TS+SQLite，1★，实验项目，147 安全测试） |
| **Evo-chat**（[GitHub](https://github.com/EMMA019/Evo-chat)，HN 帖） | ✅ **显式 hysteresis：要 2 倍分数差才翻转** | ⚠️ 状态可存，无哈希链 | ✅ 状态参与生成，非查询 | 可跑 demo（Python/Flask+Gemini） |
| **AutoPersonas / AutoPersona**（arXiv:2607.08252 + [代码](https://github.com/Ailta666508/AutoPersona)） | ⚠️ 多时间尺度 | ⚠️ 状态可更新 | ⚠️ 靠状态注入 | 论文 + 代码 |
| **Melissa**（[Zenodo](https://zenodo.org/records/18333446)） | ❌ 主张"遗产层传递经验"，不可测 | ❌ 无机制 | ❌ 提示词层 | 自发布白皮书 |
| **Project Sue**（[Zenodo](https://zenodo.org/records/22022948)） | ❌ 无 | ❌ 无 | ❌ 无 | 自发布预印本 |
| **dsh-yogacara / dsh_laap** | ⚠️ | ✅ yogacara 只追加 | ⚠️ 写回提示 | 可跑插件 |

**没有一项同时满足三条**——但**每一块都有人做过**：
- 不对称 → Pae（形式化）、Evo-chat（工程实现，明确写了 2 倍阈值）
- 只追加 → agent-soul（事件式记忆）、yogacara（种子链）
- 非检索 → Pae、Evo-chat（状态参与生成而非查询）

## 二、结论

**不需要为了"原创"去重造机制。** 我们的方案 v2 里那三条"可能原创"，现在看只剩一条站得住：

| 原以为原创 | 实际 |
|---|---|
| 慢变量偏置 | Pae + Evo-chat 已有 |
| 只追加因果链 | agent-soul / yogacara 已有 |
| **哈希链保证不可逆** | **还没见到别人做**（都靠"约定不改"，没有结构性校验） |
| **检索消融作为验收** | **还没见到别人做**（没人用"关掉检索差异是否仍在"来验人格模块） |

所以真实增量 = **「不可逆要能被机器验证」+「非检索要能被消融证明」**。这不是新机制，是把**验收标准**做实。
诚实说：这是方法学增量，不是机制创新。**如果只想要功能，可以直接抄现成的，连这两点也可以不做。**

## 三、建议路线（按成本从低到高）

### 路线 A：直接复用，不原创（1–2 天）
- 装 `agent-soul`（MIT）看它的 sleep cycle / self-model 结构；
- 装 `Evo-chat` 看 hysteresis 的阈值实现；
- 我们的插件只做**适配层**：把它们的"状态"读进来当偏置参数。
- **优点**：最快见效。**缺点**：agent-soul 是 TS+SQLite（~20 表），与"零依赖纯 JSON"直接冲突；Evo-chat 是 demo 级。

### 路线 B：复用设计 + 只做一处增量（推荐，M0 缩到 1 天）
- 设计照 Pae（慢变量）+ Evo-chat（2 倍阈值滞后）；
- 实现保持零依赖：4 维 + `cognition-sediment.jsonl`；
- **只多做一件事：哈希链**，让"不可逆"可被机器检出；
- 验收加**检索消融**一条。
- 这样既不用重造机制，又能拿出别人没有的东西。

### 路线 C：只做验收工具，不做模块（0.5 天）
- 写一个 `scripts/verify-nonretrieval.mjs`：给任何"人格/记忆"实现做检索消融测试。
- 适用范围最广（也给 agent-soul、Evo-chat 用），但用户拿不到新功能。

## 四、先要你定的一件事

**你要的是"有这个东西"，还是"有别人没有的东西"？**

- 要东西 → 走 A，1–2 天，直接装现成的，我们只做接线。
- 要差异 → 走 B，1 天原型 + 2 周影子期，增量是"可验证的不可逆 + 消融验收"。
- 只是想把事做扎实 → 走 C，半天，产出一个能验任何实现的测试器。

我倾向 **B**：成本低、不重造轮子、还剩一个能讲清楚的差异点。

## 五、顺便纠正两条我之前的说法

1. 我说过"Melissa/Project Sue 查无"——错，它们存在（Zenodo），但**是自发布，无同行评审，效果数字不可信**。
2. 我说过"Pae 只给了形式化没有工程"——准确说法是 **Pae 是论文无代码，但 Evo-chat 已经把 hysteresis 做成了可运行 demo**（虽然简单）。

## 六、参考

Pae (arXiv:2602.02902)；ARPM (arXiv:2605.14802 / GitHub Spirtxiaoqi7/ARPM, MIT)；
agent-soul (GitHub Rau1CS/agent-soul, MIT)；Evo-chat (GitHub EMMA019/Evo-chat, HN 46037117)；
AutoPersonas (arXiv:2607.08252 / GitHub Ailta666508/AutoPersona)；
Sawyer《Temporal Skew》(PhilPapers)；dsh-yogacara；dsh_laap。
