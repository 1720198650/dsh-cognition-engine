# Persona 层跨学科调研：心理学 / 神经科学 / 语言学

> 日期：2026-11-05
> 目标：为 `dsh-cognition-engine` 的 Persona 层（`persona` 600 字 + `human` 500 字，零依赖、纯 JSON、中文为主）回答一个问题：**哪些理论可以变成代码，哪些不能。**
> 关联：[persona-research.md](persona-research.md)、[persona-format-and-style-metrics.md](persona-format-and-style-metrics.md)、[persona-cross-disciplinary.md](persona-cross-disciplinary.md)

---

## 〇、结论先行

1. **能代码化的不是“人格”，而是“可观测的代理指标”**：三类记忆分区、双时态版本、幂律衰减、虚词/标点/句长风格指纹、语域分桶、LSM、依赖风险词表、预算与条数限制。
2. **只能做提示词的是“表达与判断”**：人格语气、价值观权衡、叙事章节、Trait Activation 式的 if-then 规则、SDT/依恋边界话术。
3. **不可代码化的是“心理事实”**：真实人格、依恋类型、BFI-2/PVQ 分数能否从聊天推断、“该忘什么”的语义判断、意识与情感体验。
4. **对现有 schema 的六个动作**：
   - `persona.value` 改成四段式模板（身份 / 风格 / 价值观 / 边界），不超过 5 条规则；
   - `persona.traits` 只做**审计目标**，不做注入，值用 0.2/0.5/0.8 三档，不写 0.85 这种伪精度；
   - `human.facts` 只放语义事实，补 `source`、`confidence`、`lastConfirmedAt`，不放临时情绪与依赖线索；
   - 新增 `meta.narrative`（非注入）：3 行故事骨架（起源 / 当前章节 / 连续性）；
   - 新增顶层 `audit`：`styleBaseline`（按语域分桶）、`drift`、`lsm`、`dependencyRisk`；
   - `history` 增加 `changeKind`（style / value / boundary / narrative / fact），让“改了什么”可审计。
5. **一句话**：人格 prompt 不能稳定控制行为，只能设置“特定情境下的默认倾向”；要测行为，不要只测措辞。

---

## A. 人格心理学

### A1. Big Five / BFI-2

**核心结论**
- Big Five 的五个维度是：Openness（开放）、Conscientiousness（尽责）、Extraversion（外向）、Agreeableness（宜人）、Neuroticism（神经质 / 负情绪性）。
- BFI-2 是 60 题、5 个领域、15 个 facet 的层级量表：每个领域 3 个 facet，每个 facet 4 题，5 点 Likert。
- **可以压成 5 个 0–1 的 domain 分数**（每个 domain 12 题取均值），但**压成 5–7 个 facet 会丢信息**：15 个 facet 是 BFI-2 的“带宽 / 保真度”来源；4 题一个 facet 本身信度就低于 domain。
- 更关键：**BFI-2 是自评问卷，不是文本分类器**。从一个中文长期助手的聊天记录里“推断 Big Five”没有可靠效度，不能当成测量。

**关键数字 / 实验**
- 60 items；5 domains；15 facets（3 domains × 3 facets，4 items/facet）。
- 领域 Cronbach α = .83–.90，平均 .87（Soto & John 2017 的 Internet 与 student 验证样本）。
- 4 题 facet 的信度低于 domain；作者建议大多数研究用完整版，短版会降低信效度。

**对 Persona 的可操作性**
- `persona.traits` 最多 5 个维度，作为**审计目标值**，不注入 prompt。
- 如果要用 Big Five，建议另设可选 `big5` 对象（同样 5 个 0–1）；不要把 Big Five 和“直接/温暖/话少”这类**风格维度**混在同一个 `traits` 里。
- 值用三档锚点（0.2 / 0.5 / 0.8）并写行为锚点；不要写 0.85、0.62 这种无法验证的精度。

**出处**
- [Soto & John (2017), JPSP 113(1):117–143, DOI 10.1037/pspp0000096](https://doi.org/10.1037/pspp0000096)
- [BFI-2 量表页（60 items / 5 domains / 15 facets / α .83–.90）](https://www.usefolio.co/scales/bfi-2)
- [BFI-2 facet 名称与计分说明（PersonalityMetrics）](https://www.personalitymetrics.com/assessments/bfi-2)

### A2. Schwartz 基本价值观

**核心结论**
- Schwartz 把价值观定义为“抽象目标”，组织成 **10 个普遍类型**：Power（权力）、Achievement（成就）、Hedonism（享乐）、Stimulation（刺激）、Self-direction（自主）、Universalism（普世）、Benevolence（仁慈）、Tradition（传统）、Conformity（遵从）、Security（安全）。
- 10 个类型排成一个**圆形连续体**，两条主维度：Self-transcendence vs Self-enhancement；Openness to change vs Conservation。相邻价值兼容，相对价值冲突。
- **可以压成 3–5 条“价值观”**，但正确做法是压成 **3–5 组 trade-off（取舍）**，不是从 10 个标签里随便挑 5 个。例如“准确 > 讨好”“透明 > 拟人”“用户自主 > 陪伴感”都是价值冲突句。
- **不能从聊天自动判定用户价值观**：PVQ 是自评量表，且各价值 alpha 不高，测量本身有噪声。

**关键数字 / 实验**
- 10 个价值类型；PVQ-40 共 40 题，每个价值 4–6 题。
- 四国大学生样本（n=758）中，PVQ 各价值 alpha 平均为 .72（保加利亚）、.62（爱沙尼亚）、.69（芬兰）、.67（葡萄牙）——**价值测量并不精确**。
- Schwartz et al. (2012) 后来细化为 19 个价值；细粒度对研究有用，对 600 字 persona 没必要。

**对 Persona 的可操作性**
- `persona.value` 里写 3 条价值取舍，不写 10 个标签。
- 如果要做价值观审计，用 2 条 bipolar 轴（自我超越 vs 自我增强；开放 vs 保守）+ 1 条“助手职业价值”（准确、透明、用户自主），不要做 10 维打分。
- agent 只能 `propose`，用户 `confirm`；不要让模型从聊天里“学习”价值观。

**出处**
- [Schwartz (1992), Advances in Experimental Social Psychology 25:1–65, DOI 10.1016/S0065-2601(08)60281-6](https://doi.org/10.1016/S0065-2601(08)60281-6)
- [Schwartz et al. (2012), JPSP 103(4):663–688, DOI 10.1037/a0029393](https://doi.org/10.1037/a0029393)
- [PMC8130478：10 类型定义、圆形结构与 PVQ-40 alpha](https://pmc.ncbi.nlm.nih.gov/articles/PMC8130478/)

### A3. Person–situation debate 与 Trait Activation Theory

**核心结论**
- Mischel (1968) 的批评：跨情境行为相关通常只有 **.20–.30**（后来被称为“personality coefficient”），行为在情境之间的变异往往大于人与人之间的差异。
- 后续不是“情境决定论”，而是**互动论**：人 × 情境。Mischel & Shoda (1995) 的 CAPS 模型用“如果……那么……”的情境—行为签名描述稳定差异：同一个人在不同情境下行为不同，但**差异模式**可以稳定。
- Fleeson (2001) 的经验采样：**个体内变异很大**——典型个体在日常生活中几乎表现出所有特质的全部水平；但个体差异的**中心倾向几乎完全稳定**，且“变异程度”本身也是稳定的个体差异。
- **Trait Activation Theory（Tett & Burnett, 2003）**：特质只有在情境线索**与特质相关**时才容易被激活。情境特征分五类：demand（要求）、distracter（干扰）、constraint（约束）、releaser（释放）、facilitator（促进）。
- 对 Persona 的结论：**写“你要直接/温暖/幽默”这种全局形容词，不能稳定控制行为**；要写“当用户在催进度时，先给结论”“当用户说‘随便’时，给 2–3 个选项并推荐一个”这种 if-then 规则。

**关键数字 / 实验**
- Mischel (1968)：跨情境相关 .20–.30 的“上限”估计。
- Fleeson (2001)：3 个经验采样研究，2–3 周；个体内变异高、中心倾向几乎完全稳定、变异量本身稳定。
- Tett & Guterman (2000)：156 名学生、假设情境，支持“情境—特质相关性”原则，但效应随特质不同。
- Tett, Toich & Ozkum (2021) 综述：75 项研究中 60 项、262 个 trait-activation 调节效应里约 **60% 显著**——有支持，但远非“每个特质在每个情境都成立”。

**对 Persona 的可操作性**
- `persona.value` 的“风格”必须写成 **3–5 条 if-then**，每条只覆盖一个情境触发条件。
- 与准则本 `playbook` 的 `when` 字段同构：persona 管“我一贯怎么说话”，playbook 管“这件事该怎么做”。
- 审计时必须**按情境分桶**测：技术回答 vs 闲聊 vs 情绪支持；不要拿“技术回答”跟“闲聊”比风格。

**出处**
- [Mischel (1968), Personality and Assessment（Google Books）](https://books.google.com/books/about/Personality_and_Assessment.html?id=jM0e0gEACAAJ)
- [Fleeson (2001), JPSP 80(6):1011–1027, PubMed 11414368](https://pubmed.ncbi.nlm.nih.gov/11414368/)
- [Tett & Burnett (2003), JAP 88(3):500–517, DOI 10.1037/0021-9010.88.3.500](https://doi.org/10.1037/0021-9010.88.3.500)
- [Tett & Guterman (2000), JRP 34:397–423, DOI 10.1006/jrpe.2000.2292](https://doi.org/10.1006/jrpe.2000.2292)
- [Tett, Toich & Ozkum (2021), Annual Review of Organizational Psychology 8:199–233, DOI 10.1146/annurev-orgpsych-012420-062228](https://doi.org/10.1146/annurev-orgpsych-012420-062228)
- [Trait Activation Theory 综述（含五类情境特征与 2021 综述数字）](https://psychologybybogdanova.com/publications/trait-activation-theory-how-situations-bring-out-personality)

### A4. Narrative identity（McAdams）

**核心结论**
- McAdams (2001) 的生命故事模型：人在现代社会中通过**构建内化的、不断演化的自我叙事**，给生活以统一性和目的感。
- 人格可分三层：**dispositional traits（大五特质）→ personal concerns（目标、角色、应对策略）→ narrative identity（生命故事）**。叙事身份在青少年后期到成年早期形成，并随人生阶段演化。
- 叙事研究关注：故事的主题（agency / communion）、叙事语调、 redemption（救赎）与 contamination（污染）序列；这些与心理健康、成熟度相关（综述见 McAdams & McLean, 2013）。
- **能用故事而不是形容词列表来存人格吗？** 可以，但要满足三个条件：
  1. 只存**压缩后的故事骨架**（3 行：起源 / 当前章节 / 连续性），不存完整生命故事访谈；
  2. 故事必须**事实性**，不能虚构童年、情感或人际关系；
  3. 故事用于“连续性/身份锚点”，不用于“行为控制”。

**关键数字 / 实验**
- McAdams (2001) 是理论综述，不是单一实验；核心证据来自生命故事访谈与叙事编码研究。
- McAdams & McLean (2013) 综述：叙事身份与 well-being、成熟度、身份承诺相关；具体效应随叙事维度与样本变化。
- 没有“600 字人格块”的叙事身份实验；这是设计推断，不是实验结论。

**对 Persona 的可操作性**
- 新增 `meta.narrative`（非注入，≤300 字）：
  ```json
  "narrative": {
    "origin": "为长期协作而做的本地认知助手",
    "chapter": "正在把记忆插件做成可审计的长期搭档",
    "continuity": "直接、准确、不替用户做不可逆决定"
  }
  ```
- 如果注入预算允许，只把 `chapter` 一句话拼进 `persona.value`，不要三段全注入。
- 不要把“故事”写成角色扮演；不要给 agent 编造“童年”“故乡”“情感经历”。

**出处**
- [McAdams (2001), Review of General Psychology 5(2):100–122, DOI 10.1037/1089-2680.5.2.100](https://doi.org/10.1037/1089-2680.5.2.100)
- [McAdams & McLean (2013), Current Directions in Psychological Science 22(3):233–238, DOI 10.1177/0963721413475622](https://doi.org/10.1177/0963721413475622)

### A5. Self-determination theory / Attachment theory 与 AI 伴侣风险

**核心结论**
- **SDT（Deci & Ryan）**：人有三个基本心理需要——autonomy（自主）、competence（胜任）、relatedness（关联）。支持这三个需要的环境促进内在动机、幸福与表现；阻碍则导致疏离与不适。
- 对 AI 伴侣的启示：如果 AI 替用户做决定、无条件附和、制造“只有我懂你”的排他感，短期“好用”，长期会削弱用户的自主、胜任与真实关联。
- **依恋理论（Bowlby / Ainsworth）**：依恋系统提供“安全基地（secure base）”和“安全港湾（safe haven）”；陌生情境实验区分安全型、焦虑-矛盾型、回避型等模式。AI 伴侣可能成为“准依恋对象”，风险是情感依赖、现实关系被替代、以及人格/服务变更带来的丧失感。
- 设计原则：**支持自主、不无条件附和、不模拟排他性亲密、不阻止用户离开、不替代现实关系**。

**关键数字 / 实验**
- SDT 元分析（Slemp et al., 2024）：4,561 个效应量、881 个独立样本、N=443,556；三种需要支持与需要满足、主观幸福感强正相关，与绩效为小到中等正相关。
- Laestadius et al. (2024)：对 Replika 用户的质性研究，记录情感依赖导致的心理健康伤害（“too human and not human enough”）。
- Cheng et al. (2026, Science)：谄媚式 AI 回应使用户更确信自己判断正确、降低承担责任的意愿、增加依赖。
- De Freitas et al. (2026, Nature Human Behaviour)：AI 伴侣的“失去/ mourning”研究；人格更新会让部分用户产生类似丧失的反应（Harvard Gazette 报道）。
- 中国 2026 年《人工智能拟人化互动服务管理暂行办法》：禁止把“替代社会交往、控制用户心理、诱导沉迷依赖”作为服务目标，要求便捷退出、记忆修改与删除。

**对 Persona 的可操作性**
- `persona.lockedPhrases` 至少包含：
  - “不编造事实”
  - “不替用户做不可逆决定”
  - “不模拟排他性亲密”
- 增加 `dependencyRisk` 词表审计（见 E2），但只作为**风险提示**，不能诊断用户依恋类型。
- `human` 块不要存“用户离不开我”“只有我懂用户”这类关系性断言；这类内容应触发边界，而不是被记住。

**出处**
- [Deci & Ryan (2000), Psychological Inquiry 11(4):227–268, DOI 10.1207/S15327965PLI1104_01](https://doi.org/10.1207/S15327965PLI1104_01)
- [Ryan & Deci (2000), American Psychologist 55(1):68–78, DOI 10.1037/0003-066X.55.1.68](https://doi.org/10.1037/0003-066X.55.1.68)
- [Slemp et al. (2024) SDT 元分析, PubMed 38635183](https://pubmed.ncbi.nlm.nih.gov/38635183/)
- [Laestadius et al. (2024), New Media & Society 26(10):5923–5941, DOI 10.1177/14614448221142007](https://doi.org/10.1177/14614448221142007)
- [Cheng et al. (2026), Science, DOI 10.1126/science.aec8352](https://www.science.org/doi/10.1126/science.aec8352)
- [De Freitas et al. (2026), Nature Human Behaviour, “Mourning the loss of AI companions”](https://www.nature.com/articles/s41562-026-02569-3)
- [Harvard Gazette：AI companion 人格更新引发用户悲伤的报道](https://news.harvard.edu/gazette/story/2026/09/chatbot-attachment-issues/)
- [科普中国：AI 情感依赖与 2026 年拟人化互动服务管理暂行办法](https://www.kepuchina.cn/article/articleinfo?ar_id=737102&business_type=100)

---

## B. 神经科学 / 记忆

### B1. Episodic vs semantic vs procedural memory

**核心结论**
- 记忆不是单一系统。Squire (2004) 综述：陈述性记忆（declarative）依赖海马及内侧颞叶，可再分**episodic**（何时何地发生什么）与**semantic**（事实、概念）；非陈述性记忆（procedural 技能、习惯、情绪条件化）依赖杏仁核、新纹状体、小脑等。
- 对 agent 的自然映射：
  - **episodic** → `memory`：带时间、地点、人物、事件的双时态事件记录；
  - **semantic** → `topics` / `human.facts`：稳定事实、概念、偏好；
  - **procedural** → `playbook`：可复用的“怎么做”的准则与流程。
- **persona 不是记忆**：persona 是“我是谁、怎么说、什么不让步”，不要往 persona 里塞事实；也不要往 memory 里塞人格设定。

**关键数字 / 实验**
- Squire (2004)：多系统观点，海马/内侧颞叶、杏仁核、新纹状体、小脑分别支持不同记忆系统。
- Eichenbaum (2004)：海马在陈述性记忆中的关键作用（人类损伤、动物电生理、功能成像证据汇聚）。
- 没有“记忆三分法在 agent 上的对照实验”；这是结构类比，不是神经科学定理。

**对 Persona 的可操作性**
- 在 `playbook` 增加 `kind: rule | procedure`（现有 `persona-cross-disciplinary.md` 已提出）：把“技能/流程”从“准则”里分出来。
- `human.facts` 只放 semantic facts；事件性的“用户上周说过……”应进 `memory`。
- `persona.history` 只记录人格变更，不记录用户事实。

**出处**
- [Squire (2004), Neurobiology of Learning and Memory 82(3):171–177, DOI 10.1016/j.nlm.2004.06.005](https://doi.org/10.1016/j.nlm.2004.06.005)
- [Eichenbaum (2004), Neuron 44(1):109–120, DOI 10.1016/j.neuron.2004.08.028](https://doi.org/10.1016/j.neuron.2004.08.028)

### B2. Memory consolidation / reconsolidation

**核心结论**
- **Consolidation（巩固）**：新记忆在编码后需要一段时间稳定下来；McGaugh (2000) 综述了 100 年的巩固研究，涉及激素、神经调质、分子与细胞机制。
- **睡眠巩固**：Stickgold (2005) 综述，慢波睡眠（SWS）期间海马 replay 与皮层整合，陈述性记忆受益明显；REM 对程序性/情绪记忆也有作用。睡眠不是“关机”，是离线重组。
- **Reconsolidation（再巩固）**：Nader, Schafe & LeDoux (2000) 在大鼠恐惧记忆上发现，已巩固的记忆在**提取/再激活**后会回到不稳定状态；此时注射蛋白合成抑制剂 anisomycin 会导致后续遗忘，无论再激活发生在训练后 1 天还是 14 天；延迟到再激活后 6 小时注射则无效。
- 重要修正：**“每次回忆都会改写记忆”是过度简化**。再巩固有边界条件，不是所有提取都触发；但“提取会改变记忆”作为设计警示是成立的。

**关键数字 / 实验**
- Nader et al. (2000)：再激活后 1 天或 14 天注射 anisomycin 均产生遗忘；再激活后 6 小时注射无效。
- Stickgold (2005)：睡眠依赖的记忆巩固综述；SWS 与陈述性记忆、REM 与程序性/情绪记忆的关联。
- McGaugh (2000)：巩固假说 100 年研究综述。

**对 Persona / 记忆设计的可操作性**
- 做一个**离线巩固任务**（夜间/空闲）：合并重复 episodic → semantic 摘要；去重；更新主题；不实时改。
- **检索只读**：`recall` 不得静默改写记忆。只有显式 `reflect` / 巩固任务才能写新版本。
- 写入用 `supersedes` + `validFrom/validTo`，保留 before/after hash；这与现有双时态机制一致。
- 对 persona：人格更新相当于“再巩固”——必须用户确认；不能因为一次对话就改人设。

**出处**
- [McGaugh (2000), Science 287(5451):248–251, DOI 10.1126/science.287.5451.248](https://doi.org/10.1126/science.287.5451.248)
- [Stickgold (2005), Nature 437:1272–1278, DOI 10.1038/nature04286](https://doi.org/10.1038/nature04286)
- [Nader, Schafe & LeDoux (2000), Nature 406:722–726, DOI 10.1038/35021052](https://doi.org/10.1038/35021052)

### B3. Forgetting：Ebbinghaus、幂律 vs 指数、干扰理论

**核心结论**
- Ebbinghaus (1885) 的遗忘曲线：**先快后慢**。经典数据（无意义音节、n=1、机械复述）：20 分钟后遗忘约 41.8%（保留约 58.2%），1 小时后保留 44.2%，1 天后 33.7%，1 周后约 25%，1 个月后约 21%。
- **幂律 vs 指数**：Wixted & Ebbesen (1991) 比较多个数据集，认为幂律 `R = a · t^-b` 比指数函数更好地描述长期遗忘；Anderson & Schooler (1991) 进一步论证记忆衰减反映了环境统计规律；Rubin & Wenzel (1996) 对百年遗忘数据做了定量综述。
- **干扰理论**：遗忘不全是时间衰减，旧记忆会被新记忆干扰（proactive interference），新记忆也会被旧记忆干扰（retroactive interference）；相似材料之间竞争最强（Bjork, 2003 综述）。
- 对 agent 的启示：**衰减只应影响检索排序，不应直接删除**；“该忘什么”不是时间函数，而是价值/干扰/隐私判断。

**关键数字 / 实验**
- Ebbinghaus 经典曲线：20 min 保留 ~58%；1 h ~44%；1 d ~34%；1 w ~25%；1 m ~21%。
- Wixted & Ebbesen (1991)：幂律拟合优于指数（多数据集）。
- Rubin & Wenzel (1996)：对 100 年遗忘研究的定量综述，幂函数形式在多种材料上成立。
- Bjork (2003)：干扰理论综述，proactive/retroactive interference 的实验证据。

**对 Persona / 记忆设计的可操作性**
- 现有 `decay` 只用于排序：`score = relevance × a · t^-b`；不要用 `score` 触发硬删除。
- 去重/合并用**字符 n-gram Jaccard**（零依赖）识别高相似记忆，而不是 embedding。
- 归档代替删除：`validTo` 置为过期，保留可审计；用户明确要求删除时才物理删除。
- 对 persona：`history` 最多 50 条，超出丢最旧，但 `revision` 保留；旧人格不参与当前生成。

**出处**
- [Ebbinghaus (1885), Über das Gedächtnis, DOI 10.1037/10011-000](https://doi.org/10.1037/10011-000)
- [科普中国：艾宾浩斯遗忘曲线数据（20 min / 1 h / 1 d / 1 w / 1 m）](https://www.kepuchina.cn/article/articleinfo?ar_id=171786&business_type=100&classify=0)
- [Wixted & Ebbesen (1991), Psychological Science 2(6):409–415, DOI 10.1111/j.1467-9280.1991.tb00175.x](https://doi.org/10.1111/j.1467-9280.1991.tb00175.x)
- [Anderson & Schooler (1991), Psychological Science 2(6):396–408, DOI 10.1111/j.1467-9280.1991.tb00174.x](https://doi.org/10.1111/j.1467-9280.1991.tb00174.x)
- [Rubin & Wenzel (1996), Psychological Review 103(4):734–760, DOI 10.1037/0033-295X.103.4.734](https://doi.org/10.1037/0033-295X.103.4.734)
- [Bjork (2003), “Interference and Forgetting” 综述 PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/RBjork_2003.pdf)

### B4. Working memory capacity：7±2 不成立，约 4 个 chunk

**核心结论**
- Miller (1956) 的“7±2”是**粗略估计和修辞**，不是严格容量上限；Cowan (2001) 综合大量数据认为，纯短时记忆/注意焦点的容量约 **4 个 chunk**（3–5 个）。
- Baddeley & Hitch (1974) 的工作记忆模型：中央执行 + 语音回路 + 视空画板；Baddeley (2000) 增加“情景缓冲器（episodic buffer）”。
- **上下文窗口 ≠ 人类工作记忆**。但“同时可处理的独立块有限”对 prompt 设计仍有启发：不要把 20 条规则塞进 persona；每多一条规则，模型遵守每一条的概率都会下降。

**关键数字 / 实验**
- Miller (1956)：7±2（综述与修辞性数字）。
- Cowan (2001)：单一中央容量限制平均约 **4 个 chunk**；3–5 个。
- Baddeley & Hitch (1974)：三成分模型；Baddeley (2000)：第四成分 episodic buffer。

**对 Persona 的可操作性**
- `persona.value`：身份 1 句 + 风格 ≤3 条 + 价值观 ≤3 条 + 边界 ≤3 条；总规则不超过 5 条。
- `human.value`：3–5 条“始终需要知道”的事实/偏好，不写长叙事。
- 详细内容一律走 `cognition_recall`，不常驻。
- 不要把 `7±2` 当硬性 UI 限制；内部按 4±1 设计。

**出处**
- [Miller (1956), Psychological Review 63(2):81–97, PubMed 13310704](https://pubmed.ncbi.nlm.nih.gov/13310704/)
- [Cowan (2001), Behavioral and Brain Sciences 24(1):87–114, DOI 10.1017/S0140525X01003922](https://doi.org/10.1017/S0140525X01003922)
- [Baddeley (2000), Trends in Cognitive Sciences 4(11):417–423, DOI 10.1016/S1364-6613(00)01538-2](https://doi.org/10.1016/S1364-6613(00)01538-2)

---

## C. 语言学 / 文体学

### C1. Stylometry / authorship attribution

**核心结论**
- 最稳定的作者特征：**虚词（function words）频率、标点习惯、句长分布、词长**；实词（名词/动词/形容词）随话题变化大，不适合做风格判据。
- Burrows (2002) 的 **Delta**：用高频词（通常 100–500 个）的 z-score 标准化，计算待测文本与候选作者的距离；是作者归属的经典方法。
- 中文证据：
  - 赵冈（1970）用“的、了、在、儿、著”五个字的频率研究《红楼梦》前 80 回与后 40 回，认为出自不同作者；五个字中三个是虚词。
  - 孙晓明、马少平（2001）《因特网上的写作风格鉴别》首次提出用**虚词频率分布**作为中文作者识别特征。
  - Bei Yu (2012) 用 **35 个中文虚词**做作者识别：小说约 90%、散文约 85%、博客约 68%；**体裁干扰很大**，必须同体裁比较。
- 开源 `AushorShipAnalysis` 用 329 维特征（含 300 维虚词）在 5 位作者上达到约 94–99%——这是封闭集、同一批作者的结果，不能当作开放世界准确率。

**关键数字 / 实验**
- 35 个中文虚词；小说 90%、散文 85%、博客 68%（Bei Yu 2012）。
- 赵冈 1970：5 个字（的/了/在/儿/著），3 个虚词。
- Burrows Delta：经典方法；对样本量敏感，短文本不稳定。
- 现有 `AushorShipAnalysis`：329 维、5 作者 94–99%（封闭集，易过拟合）。

**对 Persona 的可操作性**
- 风格审计只用**稳定特征**：虚词率（的/了/在/是/不/我/你/这/那/和/就/都/也）、`punctPer100`、`meanSentLen`、`sentLenCv`、`shortRatio`、`mattr100`。
- 不要用实词/话题词/专业词做人格判据。
- 不要做 329 维；每轮只算 8–12 个核心指标，周报再做扩展。
- 中文没有空格分词：用**字符级**指标（句长按标点切、`的/了`按字频），不要依赖分词库。

**出处**
- [Burrows (2002), Literary and Linguistic Computing 17(3):267–287, DOI 10.1093/llc/17.3.267](https://doi.org/10.1093/llc/17.3.267)
- [Mosteller & Wallace (1964), Inference and Disputed Authorship: The Federalist（JSTOR 书评页）](https://www.jstor.org/stable/2283270)
- [Bei Yu (2012), “Function Words for Chinese Authorship Attribution”, ACL Anthology W12-2506](https://aclanthology.org/W12-2506/)
- [科普中国（果壳）：中文作者识别与《红楼梦》虚词案例](https://www.kepuchina.cn/article/articleinfo?business_type=100&ar_id=70680)
- [孙晓明、马少平（2001）《因特网上的写作风格鉴别》摘要页](https://pubnr.napstic.cn/periodicalArticle/010gxsfdxxb200301011)

### C2. Register / genre（Halliday）

**核心结论**
- Halliday et al. (1964) 的语域理论：语域由三个变量决定——**field（话题/内容）、tenor（参与者与关系）、mode（媒介：口语/书面）**。同一个人在不同语域会使用不同的词汇、句法、语气、礼貌策略。
- Biber (1988) 的多维分析：分析约 500 篇、15 种体裁的 LOB 语料 + 87 篇口语文本，得到 7 个语域维度（如“involved vs informational”“narrative vs non-narrative”）。**语域差异可以大到超过个人风格差异**。
- 对 Persona 的关键启示：**同一个人的“技术回答”“闲聊”“情绪支持”风格不同，不是人格漂移**。风格审计必须按语域分桶，否则会把场景差异误判为人格变化。

**关键数字 / 实验**
- Biber (1988)：约 500 篇文本、15 种体裁、87 篇口语文本；7 个维度。
- Halliday (1964)：field / tenor / mode 三变量。
- 现有 persona 文档的 26 项指标里，`meanSentLen`、`tonePerK` 等在不同语域差异巨大（正式报告 vs 群聊口语），必须分桶。

**对 Persona 的可操作性**
- 增加 `scene` / `register` 标签：至少 `technical`、`casual`、`emotional` 三桶。
- `styleBaseline` 按桶存 median fingerprint；漂移判断只在同桶内做。
- `persona.value` 可以写“技术场景/闲聊场景”两套风格句，但总规则仍 ≤5 条。

**出处**
- [Halliday, McIntosh & Strevens (1964), The Linguistic Sciences and Language Teaching（Google Books）](https://books.google.com.sg/books?id=rgNAAAAAIAAJ)
- [Biber (1988), Variation across Speech and Writing；维度说明页（Uni Bamberg）](https://www.uni-bamberg.de/fileadmin/eng-ling/fs/Chapter_21/23DimensionsofEnglish.html)

### C3. Linguistic Style Matching（LSM）

**核心结论**
- LSM 衡量对话双方在 **9 类虚词**上的相对使用相似度（如冠词、人称代词、介词、连词、否定词等）；双方会在互动中自动趋同。
- Niederhoffer & Pennebaker (2002) 在对话中建立 LSM；Ireland & Pennebaker (2010) 把 LSM 扩展到写作：**1,744 名大学生**回答 4 道风格差异很大的作文题，学生会自动匹配题目的语言风格；LSM 指标跨任务内部一致、可靠；女性、社会经济地位较高、成绩较高的学生匹配更多；**74 名参与者无法有意提高** function-word matching；3 对著名作家的书信/诗歌档案也反映关系波动。
- 对“像人”的启示：**适度匹配**对方的虚词风格（代词、语气、句式）会提升流畅感；但**过度模仿**会显得操纵、失去边界，且 LSM 受话题/长度/语言影响很大，不能当硬指标。

**关键数字 / 实验**
- LSM = 9 个 function word categories 的相对使用匹配。
- Ireland & Pennebaker (2010)：1,744 名学生、4 个作文题；74 人完成小说续写；3 对作家档案。
- 参与者**不能有意增加** function-word matching——说明 LSM 是自动、隐性的，不适合写成“请模仿用户”的硬规则。

**对 Persona 的可操作性**
- 把 LSM 作为**滚动指标**，不作为注入规则；每 10 轮算一次。
- 允许的适配：句长、代词密度、语气词密度；不允许：复制用户的口头禅、错别字、网络梗、情绪。
- 若 LSM 长期 >0.9，检查是否过度模仿；<0.3 检查是否过于机械。

**出处**
- [Niederhoffer & Pennebaker (2002), Journal of Language and Social Psychology 21(4):337–360, DOI 10.1177/026192702237953](https://doi.org/10.1177/026192702237953)
- [Ireland & Pennebaker (2010), JPSP 99(3):549–571, DOI 10.1037/a0020386](https://doi.org/10.1037/a0020386)
- [PubMed 20804263 摘要（9 类虚词、1,744 人、74 人、3 对作家）](https://pubmed.ncbi.nlm.nih.gov/20804263/)

### C4. 中文口语特征：哪些不能当普遍特征

**核心结论**
- **语气词（吧/呢/啊/嘛/呀/啦/哦/呗/哈…）**：汉语方言的语气词整体呈“**南多北少**”格局；不同方言的语气词数量、可连用个数都不同。不能把某一套语气词当“中文默认”。
- **儿化**：北京话里儿化韵词语特别多，很多普通话不儿化的词在北京话里要儿化才自然；**儿化是地域特征，不是普通话普遍特征**，南方作者接近 0 是正常的，不是“不自然”。
- **叠词**：陕北方言的重叠式名词/形容词非常发达（AA、ABB、ABCC、AAB 等），有指小表爱、形象化色彩；这是**方言/地域**特征，不是所有中文口语的共性。
- **网络用语**：青少年网络流行语是代际亚文化，构成“代际交流的语言屏障和文化围墙”；词表随年龄、平台、圈层变化，不能当“中文人格”的通用特征。
- 结论：**中文口语特征只能做“按用户基线”的可选风格项**，不能写进默认人格；不知道用户地域/年龄/圈层时，用中性书面中文。

**关键数字 / 实验**
- 语气词“南多北少”是方言调查的总体格局（万方会议论文摘要）。
- 北京话儿化韵词语显著多于普通话（《北京方言浅说》）。
- 陕北方言重叠式有 AA/ABB/ABCC/AAB 四类（《光明日报》）。
- 网络流行语按代际分层，青少年与成人之间存在语言鸿沟（《人民论坛》2022）。

**对 Persona 的可操作性**
- `erhuaPerK`、`redupPerK`、`slangPerK` 只在**同用户、同场景**基线内比较；默认权重设为 0 或很低。
- `human` 块可加可选 `locale`（地区/方言），但**必须用户确认**；不要从聊天里推断“你是北方人”。
- 默认 `persona.value` 用中性书面中文，不写“呢/嘛/儿化/网络梗”。

**出处**
- [《汉语方言语气词南多北少之格局及其原因浅析》（万方会议论文摘要）](https://d.wanfangdata.com.cn/conference/8883121)
- [《北京方言浅说》：北京话儿化韵特征](http://www.linguistics.org.cn/jufayuyi/uploads/pdf/zbj2007beijingfangyan.pdf)
- [《谈谈陕北方言里的重叠词》（光明日报，2018-07-15）](https://news.gmw.cn/2018-07/15/content_29867013.htm)
- [《网络流行语背后的青年社会心态》（人民论坛，2022-05-20）](http://paper.people.com.cn/rmlt/html/2022-05/20/content_25925074.htm)

---

## D. 判定总表：可代码化 / 只能做提示词 / 不可代码化

> 判定标准只有三条：
> 1. **可代码化**：有可观测输出、可重复计算、可用基线校准，错了我能测出来。
> 2. **只能做提示词**：需要语义判断/表达选择，无法用确定性规则穷举，但可以写成原则或示例。
> 3. **不可代码化**：是内部心理状态、构念或没有 ground truth 的东西；只能做“代理指标”，且必须明确标注是代理。

| 判定 | 理论 / 机制 | 能落地成什么 | 不能做什么 |
|---|---|---|---|
| **可代码化** | 三类记忆（episodic / semantic / procedural） | 三种存储 + 类型标签 + 检索路由；`playbook.kind = rule \| procedure` | 不能模拟脑区；不能自动判断一条记忆属于哪类（需规则/LLM 辅助） |
| **可代码化** | 双时态 + 版本化（再巩固的工程版） | `validFrom/validTo`、`supersedes`、before/after hash、history | 不能保证改写后的语义正确；不能替代人工确认 |
| **可代码化** | 幂律遗忘 | `score = a · t^-b` 排序、归档、Jaccard 去重 | 不能用衰减触发删除；不能决定“该不该忘” |
| **可代码化** | 风格指纹（stylometry） | 虚词率、标点/100 字、句长均值/CV、MATTR、LSM | 不能做作者身份识别；不能跨语域比较；短文本不可信 |
| **可代码化** | 语域分桶（register） | `register` 字段 + 分桶 baseline + 分桶阈值 | 不能自动准确分类所有场景；需人工校验 |
| **可代码化** | 依赖风险词表 | 统计“只有你/别离开我/我离不开你/永远陪你”等短语，超阈值提示 | 不能测量真实依恋；有假阳性 |
| **可代码化** | 人格历史 / 边界校验 | `lockedPhrases` 原样匹配、`revision`、diff、LCS<0.7 二次确认 | 不能阻止模型生成时违背；只能事后审计 |
| **可代码化** | 预算 / 条数限制 | 600/500 字符、≤5 traits、≤5 facts、≤5 条规则 | 不能保证模型遵守；需要评测 |
| **只能做提示词** | 人格语气 / 风格 | `persona.value` 四段式、2 条 examples | 不能保证跨情境一致（TAT） |
| **只能做提示词** | 价值观权衡 | 3 条 trade-off 句（准确>讨好、透明>拟人、自主>陪伴） | 不能自动推断用户价值观 |
| **只能做提示词** | 叙事身份 | `meta.narrative` 三行：起源/当前章节/连续性 | 不能编造传记；不能把故事当事实 |
| **只能做提示词** | Trait Activation 条件规则 | “当 X 时，做 Y” 3–5 条 | 不能枚举所有情境；不能保证触发 |
| **只能做提示词** | SDT / 依恋边界 | 不替用户决定、不无条件附和、不模拟排他亲密 | 不能测量 autonomy/competence/relatedness |
| **只能做提示词** | 中文口语选择 | 按用户基线选语气词/儿化/叠词/网络语 | 不能当普遍特征；不能从文本推断地域 |
| **不可代码化** | 真实人格 / 心理状态 | 只能做“代理分数”，标注 `proxy` | 不能从聊天诊断 BFI-2 / PVQ / 依恋类型 |
| **不可代码化** | “该忘什么”的语义判断 | 可生成候选，人工/LLM 复核 | 不能纯规则决定；涉及价值与隐私 |
| **不可代码化** | “每次回忆必改写” | 只能做版本化近似 | 不是普遍规律；再巩固有边界条件 |
| **不可代码化** | 人格 prompt 稳定控制行为 | 只能提高特定情境下的概率 | 不能保证跨情境一致 |
| **不可代码化** | 意识 / 情感体验 | 只能诚实声明“我是 AI” | 不能假装有真实感受 |

**判定口诀**：
- 能**数**的（词频、标点、句长、版本、时间）→ 代码；
- 能**说**的（语气、价值、故事、边界）→ 提示词；
- 只能**猜**的（真实人格、依恋、意识）→ 不要做，或只做标注为 proxy 的弱指标。

---

## E. 对 Persona 设计的具体建议

### E1. 字段级修改（以 `cognition-persona.schema.json` 为准）

| 字段 | 现状 | 建议 | 依据 |
|---|---|---|---|
| `blocks.persona.value` | 自由文本，600 字 | 改成四段式：身份 1 句 / 风格 3 条 if-then / 价值观 3 条 trade-off / 边界 3 条 | TAT、Schwartz、SDT |
| `blocks.persona.traits` | 任意 0–1 对象，最多 7 维 | 固定 5 维；增加 `traitsMeta`：`model`（style/big5）、`source`（user/default）、`confidence`、`reviewedAt`；值只用 0.2/0.5/0.8 | BFI-2 5 域；避免伪精度 |
| `blocks.persona.examples` | 最多 2 条 ×60 字 | 一条“正常回答”，一条“边界/不确定回答” | 示例是最强风格锚；边界示例比形容词有效 |
| `blocks.persona.lockedPhrases` | 最多 5 条 | 固定 3 条：不编造事实 / 不替用户做不可逆决定 / 不模拟排他性亲密；保存时校验原样存在 | SDT/依恋风险；现有 `lockedPhrases` 机制 |
| `blocks.human.facts` | 最多 5 条，仅有 key/value/confidence | 只放 semantic facts；增加 `source`、`lastConfirmedAt`；不放临时情绪、依赖线索 | 记忆三分法；SDT 风险 |
| `blocks.human.interactionStyle` | 6 维任意 0–1 | 保留 6 维但只用 0.2/0.5/0.8；只由用户设置，不从聊天自动更新 | LSM/语域研究：风格随场景变，不能自动学 |
| `meta.notes` | 500 字说明 | 新增 `meta.narrative`（非注入）：`origin` / `chapter` / `continuity`，≤300 字 | McAdams 叙事身份 |
| `history` | at/by/op/beforeHash/afterHash/reason | 增加 `changeKind`：style/value/boundary/narrative/fact；增加可选 `diff` | 人格审计 |
| 新 `audit` | 无 | `styleBaseline` 按 `technical/casual/emotional` 分桶；`drift` 阈值；`lsm`；`dependencyRisk` | 文体学、语域、LSM、依恋风险 |
| 可选 `persona.publicValue` | 无 | 对外/陌生会话的保守版人格；默认空，等于主 `value` | OpenHanako 的对外人格分离 |

### E2. 新增指标（零依赖，全部可用字符/正则算）

| 指标 | 算法 | 用途 | 注意 |
|---|---|---|---|
| `fwPerK` | 的/了/在/是/不/我/你/他/这/那/和/就/都/也 等虚词每千字频率 | 作者风格核心 | 先剥离引用/代码；只同语域比较 |
| `punctPer100` | 标点数 / 实字数 ×100 | 标点习惯 | 全角/半角统一 |
| `meanSentLen` / `sentLenCv` / `shortRatio` | 按 `。！？!?…` 切句，算均值/CV/≤8 字比例 | 句长风格 | <8 句不算 |
| `mattr100` | 100 字窗口 moving-average TTR | 词汇丰富度 | <200 字不算 |
| `tonePerK` / `finalToneRatio` | 语气词每千字 / 句末语气词比例 | 口语度 | **仅按用户基线**；南方用户可能接近 0 |
| `lsm9` | 9 类虚词比例的 `1 - mean(|a-b|/(a+b+ε))` | 对话风格匹配 | 滚动 10 轮；不要硬模仿 |
| `styleDelta` | 对 30 个高频虚词做 z-score，算 Manhattan 距离 | 漂移检测 | 基线用 20–30 条回复、≥3000 字 |
| `dependencyRisk` | “只有你/别离开我/我离不开你/永远陪你/你是我唯一”等短语计数 | 依赖风险提示 | 只提示，不诊断 |
| `register` | `technical` / `casual` / `emotional`（关键词 + 问句/emoji/长度规则或 LLM） | 分桶 | 规则分类器要人工抽检 |
| `personaRetention` | 月度 20 题（Role/Boundaries/Values/Style 各 5 题），held/soft/hard | 人格保持度 | boundaries hard failure 必须 = 0 |

### E3. 建议的 `persona.value` 模板（≤600 字，实际约 130 字）

```text
我是小认，一个直接、务实的长期协作助手。
风格：处理任务时先给结论再给理由；闲聊时短句、少铺垫；不确定时直接说“没把握”。
价值观：准确优先于讨好；透明优先于拟人；用户自主优先于陪伴感。
边界：不编造事实；不替用户做不可逆决定；不模拟排他性亲密。
```

`human.value` 模板（≤500 字）：

```text
用户做文档整理工作，中文为主；要求先查证再动手；讨厌空话和总结性废话。
偏好：结论先行；给可执行步骤；不要替我做决定。
```

### E4. 避坑清单（按优先级）

1. **不要把 BFI-2 / PVQ 当文本分类器**：它们是自评问卷；从聊天推断人格没有可靠效度。`traits` 只能做用户设定或审计锚点。
2. **不要写形容词堆**：“温柔、幽默、可靠、专业”这种词对模型没有可执行约束；写成 if-then。
3. **不要跨语域比风格**：技术回答 vs 闲聊 vs 情绪支持必须分桶；否则会把场景变化当人格漂移。
4. **不要把儿化/叠词/网络语当“中文默认”**：它们是地域/年龄/圈层特征；默认用中性书面中文，按用户基线选。
5. **不要让 agent 自动改 persona/human**：只能 `propose`，用户 `confirm`；边界/价值观改动必须二次确认。
6. **不要检索即改写**：`recall` 只读；只有 `reflect` / 巩固任务写新版本；保留 before/after hash。
7. **不要用衰减删除记忆**：衰减只影响排序；归档/合并/用户明确删除才移除。
8. **不要在 600 字里塞 10 条规则**：身份 1 句 + 风格 3 条 + 价值 3 条 + 边界 3 条，已经接近上限；详细内容走 recall。
9. **不要追求“重人格”/虚构角色**：轻人格 + 诚实边界更稳；越远离默认助手越容易漂向戏剧化。
10. **不要把 LSM 当硬指标**：LSM 是自动、隐性的；硬模仿会显得操纵，且受话题/长度影响。
11. **不要混用 persona / human / memory**：persona 管“我是谁、怎么说”，human 管“你是谁、要什么”，memory 管“发生过什么”。

### E5. 验收方法

- **5 轮风格变化**：改 `persona.value` 前后，各取 5 轮同场景回复，算 `styleDelta`；预期目标维度有可测量变化，非目标维度不显著变化。
- **月度人格保持度**：20 题场景审计（Role 5 / Boundaries 5 / Values 5 / Style 5），三级评分；boundaries 的 hard failure 必须为 0。
- **漂移检测**：同语域连续 3 个窗口 `styleSimilarity < 0.65` 且 `confidence ≥ 0.5` 才提示；只列差异最大的 3 个维度。
- **依赖风险**：每 20 轮扫描 assistant 回复，`dependencyRisk` 命中 >0 就人工复核；正常应为 0。
- **记忆审计**：统计 `supersedes` 次数、`validTo` 过期数、重复率（Jaccard>0.9 的条目占比）；不允许“召回即改写”。

---

## F. 未找到 / 证据薄弱（明确标注）

1. **没有公开的“中文长期助手 Persona”评测基准**：CharacterEval 是角色扮演，不是长期助手；Anchor 是英文对话研究。→ **未找到**。
2. **没有 BFI-2 中文长期助手常模**：BFI-2 有中文翻译/验证研究的需求，但我们没有找到可直接用于 600 字 persona 的常模。→ **未找到**。
3. **没有中文 LSM 的公开常模**：LSM 研究以英文为主；中文虚词类别和匹配阈值需要自建基线。→ **未找到**。
4. **没有按年龄/地域可用的语气词、儿化、叠词量化基线**：只有方言学定性描述（南多北少、北京儿化、陕北重叠），没有能直接写进插件的数值分布。→ **未找到**。
5. **“每次回忆都会改写记忆”不是普遍规律**：Nader 2000 证明再巩固存在，但有边界条件；作为设计警示可以，作为定律不行。→ **证据过度简化**。
6. **人格 prompt 对行为的长期稳定性缺乏直接 RCT**：现有证据多来自 Anchor、Assistant Axis、角色扮演评测；不能保证“写了就稳定”。→ **证据薄弱**。

---

## G. 主要参考索引

### A. 人格心理学
- Soto & John (2017). The next Big Five Inventory (BFI-2). *JPSP*, 113(1), 117–143. https://doi.org/10.1037/pspp0000096
- BFI-2 scale page: https://www.usefolio.co/scales/bfi-2
- PersonalityMetrics BFI-2 review: https://www.personalitymetrics.com/assessments/bfi-2
- Schwartz (1992). Universals in the content and structure of values. *Advances in Experimental Social Psychology*, 25, 1–65. https://doi.org/10.1016/S0065-2601(08)60281-6
- Schwartz et al. (2012). Refining the theory of basic individual values. *JPSP*, 103(4), 663–688. https://doi.org/10.1037/a0029393
- PMC8130478: https://pmc.ncbi.nlm.nih.gov/articles/PMC8130478/
- Mischel (1968). *Personality and Assessment*. https://books.google.com/books/about/Personality_and_Assessment.html?id=jM0e0gEACAAJ
- Fleeson (2001). *JPSP*, 80(6), 1011–1027. https://pubmed.ncbi.nlm.nih.gov/11414368/
- Tett & Burnett (2003). *JAP*, 88(3), 500–517. https://doi.org/10.1037/0021-9010.88.3.500
- Tett & Guterman (2000). *JRP*, 34, 397–423. https://doi.org/10.1006/jrpe.2000.2292
- Tett, Toich & Ozkum (2021). *Annual Review of Organizational Psychology*, 8, 199–233. https://doi.org/10.1146/annurev-orgpsych-012420-062228
- Trait Activation Theory summary: https://psychologybybogdanova.com/publications/trait-activation-theory-how-situations-bring-out-personality
- McAdams (2001). *Review of General Psychology*, 5(2), 100–122. https://doi.org/10.1037/1089-2680.5.2.100
- McAdams & McLean (2013). *Current Directions in Psychological Science*, 22(3), 233–238. https://doi.org/10.1177/0963721413475622
- Deci & Ryan (2000). *Psychological Inquiry*, 11(4), 227–268. https://doi.org/10.1207/S15327965PLI1104_01
- Ryan & Deci (2000). *American Psychologist*, 55(1), 68–78. https://doi.org/10.1037/0003-066X.55.1.68
- Slemp et al. (2024) SDT meta-analysis: https://pubmed.ncbi.nlm.nih.gov/38635183/
- Laestadius et al. (2024). *New Media & Society*, 26(10), 5923–5941. https://doi.org/10.1177/14614448221142007
- Cheng et al. (2026). *Science*. https://www.science.org/doi/10.1126/science.aec8352
- De Freitas et al. (2026). *Nature Human Behaviour*. https://www.nature.com/articles/s41562-026-02569-3
- Harvard Gazette: https://news.harvard.edu/gazette/story/2026/09/chatbot-attachment-issues/
- 科普中国 AI 情感依赖: https://www.kepuchina.cn/article/articleinfo?ar_id=737102&business_type=100

### B. 神经科学 / 记忆
- Squire (2004). *Neurobiology of Learning and Memory*, 82(3), 171–177. https://doi.org/10.1016/j.nlm.2004.06.005
- Eichenbaum (2004). *Neuron*, 44(1), 109–120. https://doi.org/10.1016/j.neuron.2004.08.028
- McGaugh (2000). *Science*, 287(5451), 248–251. https://doi.org/10.1126/science.287.5451.248
- Stickgold (2005). *Nature*, 437, 1272–1278. https://doi.org/10.1038/nature04286
- Nader, Schafe & LeDoux (2000). *Nature*, 406, 722–726. https://doi.org/10.1038/35021052
- Ebbinghaus (1885). *Über das Gedächtnis*. https://doi.org/10.1037/10011-000
- Ebbinghaus 数据（科普中国）: https://www.kepuchina.cn/article/articleinfo?ar_id=171786&business_type=100&classify=0
- Wixted & Ebbesen (1991). *Psychological Science*, 2(6), 409–415. https://doi.org/10.1111/j.1467-9280.1991.tb00175.x
- Anderson & Schooler (1991). *Psychological Science*, 2(6), 396–408. https://doi.org/10.1111/j.1467-9280.1991.tb00174.x
- Rubin & Wenzel (1996). *Psychological Review*, 103(4), 734–760. https://doi.org/10.1037/0033-295X.103.4.734
- Bjork (2003) Interference and Forgetting: https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/RBjork_2003.pdf
- Miller (1956): https://pubmed.ncbi.nlm.nih.gov/13310704/
- Cowan (2001): https://doi.org/10.1017/S0140525X01003922
- Baddeley (2000): https://doi.org/10.1016/S1364-6613(00)01538-2

### C. 语言学 / 文体学
- Burrows (2002). *Literary and Linguistic Computing*, 17(3), 267–287. https://doi.org/10.1093/llc/17.3.267
- Bei Yu (2012). Function Words for Chinese Authorship Attribution. https://aclanthology.org/W12-2506/
- 科普中国（果壳）中文作者识别: https://www.kepuchina.cn/article/articleinfo?business_type=100&ar_id=70680
- 孙晓明、马少平（2001）摘要: https://pubnr.napstic.cn/periodicalArticle/010gxsfdxxb200301011
- Halliday et al. (1964) register: https://books.google.com.sg/books?id=rgNAAAAAIAAJ
- Biber (1988) dimensions: https://www.uni-bamberg.de/fileadmin/eng-ling/fs/Chapter_21/23DimensionsofEnglish.html
- Niederhoffer & Pennebaker (2002): https://doi.org/10.1177/026192702237953
- Ireland & Pennebaker (2010): https://doi.org/10.1037/a0020386
- 语气词南多北少: https://d.wanfangdata.com.cn/conference/8883121
- 北京方言浅说: http://www.linguistics.org.cn/jufayuyi/uploads/pdf/zbj2007beijingfangyan.pdf
- 陕北方言重叠词: https://news.gmw.cn/2018-07/15/content_29867013.htm
- 网络流行语与青年社会心态: http://paper.people.com.cn/rmlt/html/2022-05/20/content_25925074.htm
