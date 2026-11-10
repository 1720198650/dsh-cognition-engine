# 现象学人格/意识 论文与著作清单（只收我们要用的）

> 2026-11-10。用途：给 [plan-sediment-layer-v1.md](plan-sediment-layer-v1.md) 提供哲学地基，
> 并做**概念 → 计算结构**的翻译。每一条都标注「我们取什么 / 不取什么」，不做文献综述式罗列。
>
> 甄别纪律：经典著作只写出版社/年份（可查）；能给出链接的才给链接。
> 上一份材料里查不到出处的（Sawyer / ARPM / Melissa / Project Sue）**一条都不收**。

---

## 一、收进来的 10 条

| # | 文献 | 我们取什么 | 不取什么 |
|---|---|---|---|
| 1 | **Husserl,《内时间意识现象学讲稿》**（1893–1917 讲稿，1928 年编成书；中译/英译多版） | **滞留（Retention）不是回忆**：刚过去的东西仍以衰减方式"在场"，构成当前的晕圈。→ 对应"参数仍在，但不被查询" | 不取先验现象学的还原方法（无法工程化） |
| 2 | 同上 | **前提（Protention）**：意识总带着对下一步的预期。→ 给我们的模块加"预测误差"事件 | 不取"意向对象"的形而上学 |
| 3 | 同上 | **被动综合（passive synthesis）**：没有主动注意也会发生的联结与巩固。→ `settle` 巩固规则 | 不取"发生现象学"的完整体系 |
| 4 | **Merleau-Ponty,《知觉现象学》**（1945；英译 1962） | **习性/身体图式**：重复使动作门槛降低、变得"顺手"。→ 重复无冲突 → caution 缓慢下降 | 不取身体本体论（我们没有身体） |
| 5 | **Zahavi,《Subjectivity and Selfhood》**（MIT Press, 2005；另见其 1999 年"最小自我"论文） | **最小自我 = 体验的连续性/第一人称给予性**，不需要叙事。→ 我们的"状态连续"就是最小自我，**不需要写人格文案** | 不取现象学自我理论的争论细节 |
| 6 | **Gallagher, "A pattern theory of self"**（*Frontiers in Human Neuroscience*, 2013） | **自我是多要素的动态模式**，没有单一核心。→ 支持"少维度 + 权重随情境变"，反对固定人格量表 | 不取他列的全部要素（我们只 4 维） |
| 7 | **Heidegger,《存在与时间》**（1927） | **在世存在 / 处境性**：意义总在具体处境里发生。→ 偏置**只对最近活跃的主题生效**，不全局 | 不取"本真性"等规范主张 |
| 8 | **Dreyfus,《Being-in-the-World》**（MIT Press, 1991） | **技能性应对**：熟练后不经推理直接反应。→ 高 retention 时**减少 deliberation**（注入更短） | 不取他对早期 AI 的整体批评 |
| 9 | **Seth, "Interoceptive inference, emotion, and the embodied self"**（*TiCS*, 2013，[链接](https://www.cell.com/trends/cognitive-sciences/fulltext/S1364-6613(13)00211-8)） | 自我是**调节过程的预测模型**，不是一份表征清单。→ 定性支撑"输出参数而不是描述" | 不取内感受的具体生理机制 |
| 10 | **Varela, "Neurophenomenology: A Methodological Remedy for the Hard Problem"**（*J. of Consciousness Studies*, 1996） | **第一人称报告与第三人称测量必须互相约束**。→ 验证协议里"行为测量 + 人工读轨迹"双轨 | 不取"意识难题可被解决"的强主张 |

补充（工程/交叉，非哲学）：**Roy, Petitot, Pachoud & Varela (eds.),《Naturalizing Phenomenology》**（Stanford UP, 1999，[链接](https://www.sup.org/books/theory-and-philosophy/naturalizing-phenomenology)）——现象学与认知科学"联姻"的方法论集合；我们只用它的态度（可形式化、可被经验约束），不用它的具体模型。

## 二、明确不收（避免滑向"角色扮演"）

- **Ricoeur 的叙事身份（narrative identity）**：一旦引入，就会要求"讲一个关于自己的故事"——那就回到人格文案了。我们只要最小自我。
- **任何"人格五因素/大五"量表**：那是测量工具，不是发生机制。
- **Sawyer《Temporal Skew》/ ARPM / Melissa / Project Sue**：查无记录，不引。

## 三、概念 → 计算结构的翻译（这张表就是工程化的核心）

| 现象学结构 | 不能这样实现（错） | 我们这样实现（对） |
|---|---|---|
| 滞留 | 把旧记忆检索出来注入 | 不读正文；只让 `retention` 参数抬高"覆盖阈值"，使新证据更难说服 |
| 前提 | 加一句"你要预测下一步" | 每次交互前用当前状态算一个**期望张力**；实际张力与期望的差 → `protentionError` 事件（小幅） |
| 被动综合 | 每隔 N 轮跑一次 LLM 总结 | 无冲突的重复共现 → `settle` 事件，按 `0.995/轮` 缓慢衰减 retention（有地板，且只能追加） |
| 习性 | 记录"用户喜欢这样" | 同一主题连续无冲突 → `caution` 缓慢下降（更敢直接给结论） |
| 最小自我 | 生成"我是谁"的描述 | 断言"状态向量连续"即可；连续性用相邻 checkpoint 的余弦相似度 ≥ 0.9 度量 |
| 在世存在 | 全局人格参数 | 偏置只作用于最近 K 轮出现过的主题；其余主题用中性参数 |
| 技能性应对 | 一律给长回答 | 高 retention + 高熟练 → 注入更短、更少确认 |
| 内感受/具身自我 | 存"情绪状态"标签 | 参数只调"注意/抑制/门槛"，不落任何情绪词 |

## 四、对原创方案的修订（v1 → v1.1）

在 [plan-sediment-layer-v1.md](plan-sediment-layer-v1.md) 的基础上改四条：

1. **加事件类型 `protentionError`**：让偏置层具备"预期"能力，而不是纯反应式。
   规则：`expectedTension` 由最近 10 次同主题事件的均值给出；`|actual − expected| > 0.2` 时记一次，delta 幅度为普通 tension 的 **1/3**（防噪声主导）。
2. **加 `settle` 巩固**：同主题连续 ≥ 8 轮无 tension → 记一次 settle，`retention *= 0.995`（地板 0.2），**通过追加事件实现，不改历史**。
3. **加作用域限制**：偏置只对"最近 K=20 轮出现过的 subject"生效（在世存在的工程版），其余主题用中性值。防止一次争吵影响所有话题。
4. **明确排除叙事自我**：不生成任何"关于自己的叙述"；`attachment` 只影响排序权重。

**新增一条验收**（防止把"新奇"当"张力"）：

```
新事实与旧事实相似但**不矛盾**（flip=0）→ 允许产生 protentionError，但 retention 必须不变。
若 retention 变了 → 说明我们把"惊讶"错当"被推翻"，判失败。
```

## 五、这套东西能证明什么、不能证明什么

- **能证明**：路径依赖（同输入顺序不同 → 终态不同）、不可逆（哈希链断点检出）、非检索（检索消融后差异仍在）。
- **不能证明**：任何关于意识/主体性的主张。我们只做"可测的滞后轨迹"，这也是 Varela 那条方法论约束的诚实版本——第一人称报告可以给线索，但结论必须落在可测量上。

## 六、参考文献

1. Husserl, E. *Vorlesungen zur Phänomenologie des inneren Zeitbewusstseins*（1928 编）；英译 *On the Phenomenology of the Consciousness of Internal Time*。
2. Merleau-Ponty, M. *Phénoménologie de la perception*, 1945；英译 1962。
3. Zahavi, D. *Subjectivity and Selfhood: Investigating the First-Person Perspective.* MIT Press, 2005。
4. Gallagher, S. "A pattern theory of self." *Frontiers in Human Neuroscience* 7:443, 2013。
5. Heidegger, M. *Sein und Zeit*, 1927。
6. Dreyfus, H. *Being-in-the-World.* MIT Press, 1991。
7. Seth, A. K. "Interoceptive inference, emotion, and the embodied self." *TiCS* 17(11), 2013. <https://www.cell.com/trends/cognitive-sciences/fulltext/S1364-6613(13)00211-8>
8. Varela, F. "Neurophenomenology: A Methodological Remedy for the Hard Problem." *JCS* 3(4), 1996。
9. Roy, Petitot, Pachoud & Varela (eds.). *Naturalizing Phenomenology.* Stanford UP, 1999. <https://www.sup.org/books/theory-and-philosophy/naturalizing-phenomenology>
10. Merleau-Ponty 的习性/具身解读（二手，可作入门）：*Frontiers in Human Neuroscience*, 2014. <https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2014.00542/full>
