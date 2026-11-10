# 三家（胡塞尔 / 舍勒 / 拉康）的工程化参考：找到了什么

> 2026-11-10。只收能点开、能核实的。**舍勒那边：一个工程实现都没有**，这是结论，不是没搜到。

---

## 一、胡塞尔（意识现象学）——有真东西，而且不止一个

| 参考 | 出处 | 它做了什么 | 我们能借什么 |
|---|---|---|---|
| **Mapping Husserlian phenomenology onto active inference** | [arXiv:2208.09058](https://arxiv.org/abs/2208.09058)（Albarracin / Pitliya / Ramstead / Yoshimi, 2022） | 把胡塞尔的描述（**重点是内时间意识**）映射到主动推理的生成模型上 | **最贴我们的概念参考**：它证明"滞留-前提"可以写成先验与预测误差，不是比喻 |
| **Projective Consciousness Model（PCM）** | Rudrauf 等：*J Theor Biol* 2017《A mathematical model of embodied consciousness》；[arXiv:2012.12963](https://arxiv.org/abs/2012.12963)（用 PCM 驱动的 agent 出现适应/不适应行为） | 用透视投影 + 主动推理建模"视角"，有 agent 实验 | "视角"→参数化的**视角偏移**；以及"适应与不适应都从同一机制长出来"这个观察 |
| **ITCMA** | [arXiv:2403.20097](https://arxiv.org/abs/2403.20097) | 内时间意识做成时间场，驱动行动，有真机实验 | 时间结构当架构的合法性 |
| **Yoshimi, "The Formalism"** | *Husserlian Phenomenology: A Unifying Interpretation*（Springer 章节） | 给胡塞尔一个形式化读法 | 术语到形式语言的翻译 |
| **胡塞尔在 AI 中的范围综述** | [Springer 10.1007/s44163-026-02602-4](https://link.springer.com/article/10.1007/s44163-026-02602-4) | 32 篇明确以胡塞尔为锚的 AI 出版物 | 说明这不是冷门自嗨 |

**结论**：胡塞尔这条线**有成熟的形式化传统**（Albarracin 那篇是直接可用的），我们只借"时间意识→预测误差"的映射，不借它的意识结论。

## 二、拉康（精神分析）——有一篇论文 + 一个仓库

| 参考 | 出处 | 它做了什么 |
|---|---|---|
| **Enabling self-identification in intelligent agent: insights from computational psychoanalysis** | [arXiv:2403.07664](https://arxiv.org/abs/2403.07664)（Li & Li, 2024） | 把拉康的**想象界/象征界认同**用主动推理写出来；用 CNN/MLP + ChatGPT 监督演示自由能下降；提出 **FreeAgent** 模型，串起拉康"欲望图 II" |
| **LacanAgent** | [GitHub DigitalTwinMind/LacanAgent](https://github.com/DigitalTwinMind/LacanAgent)（7★，Jupyter，2 fork） | 上述论文的自指认计算模型代码 |

**能借的**：
- "认同 = 自由能最小化"这条映射，可以支撑我们"状态永不收敛、只逼近"的设计（拉康的缺失→永不闭合）；
- 它的**失败案例**值得看：把拉康做成可训练模型，最后往往只剩"减少预测误差"，等于把精神分析还原成优化问题——**这正是我们要避开的坑**。

**不能借的**：三界分层、`objet a` 量化、把"阻抗/移情"当解释。理由见宪章流派表。

## 三、舍勒（价值人格）——**零工程实现**

搜遍了：只有舍勒研究（如 *Scheler and Zambrano* 之类哲学论文）、"情感生活分层"的百科条目，**没有任何计算实现、没有代码、没有 agent 架构**。

这不是搜索不全。更可能的原因是：**舍勒本人反对把人格对象化**（人格是行为的统一体，不可被做成对象），所以"工程化舍勒"在方法论上就是自相矛盾的。

**所以我们只能取他一条约束，不能取实现**：

> 价值排序先于认知（ordo amoris）——落到我们这，就是**偏置必须在识别之前生效**；
> 以及那条红线——**不做人格画像、不做评分**。

如果哪天有人说"我做了舍勒式人格引擎"，先问他要定义：他很可能只是做了一套价值观问卷。

## 四、对本项目的直接结论

| 流派 | 有工程实现吗 | 我们取 | 我们扔 |
|---|---|---|---|
| 胡塞尔 | ✅ 有（Albarracin 2208.09058、PCM、ITCMA） | 滞留/前提 → 预测误差；注意的选择性 | 构成、本质还原、"意识"声明 |
| 拉康 | 🟡 勉强有（2403.07664 + LacanAgent） | 永不收敛、防讨好上限、保留症状 | 三界分层、objet a 量化、精神分析式解释 |
| 舍勒 | ❌ 零 | 价值排序先于判断；禁止对象化 | 一切"人格画像/评分/标签" |

**一句话**：胡塞尔能借架构，拉康能借禁令，舍勒只能借一条红线。

## 五、参考清单

1. Albarracin, M., Pitliya, R. J., Ramstead, M. J. D., Yoshimi, J. *Mapping Husserlian phenomenology onto active inference.* arXiv:2208.09058, 2022. <https://arxiv.org/abs/2208.09058>
2. Rudrauf, D. et al. *A mathematical model of embodied consciousness.* J. Theor. Biol., 2017；*The role of consciousness in biological cybernetics…* arXiv:2012.12963. <https://arxiv.org/abs/2012.12963>
3. *ITCMA: A Generative Agent Based on a Computational Consciousness Structure.* arXiv:2403.20097.
4. Li, L. & Li, C. *Enabling self-identification in intelligent agent: insights from computational psychoanalysis.* arXiv:2403.07664, 2024. <https://arxiv.org/abs/2403.07664>
5. `DigitalTwinMind/LacanAgent`（代码）。<https://github.com/DigitalTwinMind/LacanAgent>
6. *A scoping review mapping the role of Husserlian phenomenology in artificial intelligence research.* Springer, 2026. <https://link.springer.com/article/10.1007/s44163-026-02602-4>
