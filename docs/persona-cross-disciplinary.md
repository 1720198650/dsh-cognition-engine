# Persona 跨学科扫描：什么能用，什么不能用

> 2026-11-05
> 目的：为认知引擎的 Persona 层做跨学科取经——心理学、神经科学、语言学、HCI、哲学、游戏 NPC。
> 判断标准只有一条：**能不能变成这个零依赖、纯 JSON、中文长期助手插件里的代码或规则。**
> 心理学 / 神经科学 / 语言学的逐条证据、关键数字与出处链接，见 [persona-cross-disciplinary-research.md](persona-cross-disciplinary-research.md)（本文件的深挖版）。

---

## 〇、一句话结论

跨学科能给我们的，**不是「更像人」的功能，而是三样东西**：

1. **人格的层次结构**（特质 / 关切 / 故事）——决定 `persona` 怎么分层
2. **记忆的巩固与遗忘机制**——决定 `human` 和 `memory` 怎么分工
3. **风格的可计算特征**——决定「漂移」怎么量化

**大部分理论只能做设计原则，不能直接变成代码。**
真正能落地的，是少数几个：Big Five 的 5 个维度、McAdams 的三层、文体学的虚词/句长/标点、Lee & See 的信任三维、言语行为理论的承诺。

---

## 一、心理学

### 1.1 Big Five / BFI-2

| 项 | 内容 |
|---|---|
| 五个维度 | Openness / Conscientiousness / Extraversion / Agreeableness / Neuroticism |
| BFI-2 | 60 题、5 域、15 facet（每域 3 facet × 4 题）；领域 α = .83–.90，平均 .87（Soto & John, 2017） |
| 测量性质 | **自评问卷，不是文本分类器**——不能从聊天推断 BFI-2 分数 |
| 能不能代码化 | **部分**：5 个 0–1 的 trait 可以做**审计目标**；60 题问卷太重，不进产品 |
| 对我们的用法 | `persona.traits` 只放 5 个维度，用于「风格指纹」的目标值，不注入 |
| 不能用的部分 | 不要把 60 题量表塞进插件；不要指望 trait 分数能稳定预测行为 |

**关键限制（person-situation debate）**：
Mischel (1968) 指出，行为在**情境之间**的变异往往大于**人与人之间**的差异（跨情境相关通常只有 **.20–.30**，即「personality coefficient」）。
Fleeson (2001) 的经验采样进一步显示：个体内变异很大，但**中心倾向几乎完全稳定**，且「变异程度」本身也是稳定的个体差异。
Tett & Burnett (2003) 的**特质激活理论**进一步说：特质只有在**情境线索激活**时才会表现；情境线索分五类——demand / distracter / constraint / releaser / facilitator。
Tett, Toich & Ozkum (2021) 综述 75 项研究、262 个调节效应，约 **60% 显著**——有支持，但远非「每个特质在每个情境都成立」。

> **对我们的直接启示**：
> 光写「你要直接」没用——必须写「**当用户在催进度时**，直接给结论」。
> 这正是我们准则本里 `when` 字段的理论依据。

### 1.2 Schwartz 基本价值观

| 项 | 内容 |
|---|---|
| 10 个价值类型 | Self-direction / Stimulation / Hedonism / Achievement / Power / Security / Conformity / Tradition / Benevolence / Universalism |
| 完整量表 | PVQ-57（57 题），太重 |
| 能不能代码化 | **部分**：压成 3–5 条「价值观」写进 persona，够用 |
| 对我们的用法 | `persona.values` 3–5 条，按优先级排序；不做数值打分 |

### 1.3 叙事认同（McAdams）

McAdams 把人格分三层：

| 层 | 内容 | 我们的对应 |
|---|---|---|
| **Dispositional traits** | 大五特质 | `persona.traits`（5 维） |
| **Personal concerns** | 目标、角色、应对策略 | `persona.mutable.activeFocus` |
| **Narrative identity** | 内化的、不断演化的生命故事 | `persona.mutable.chapter`（当前章节） |

**能用的**：给 `mutable` 加一个「当前章节」字段，例如「当前章节：在把认知引擎从记忆插件做成长期搭档」——比一堆形容词更能让回复有连续性。
**不能用的**：完整生命故事访谈（太长、太主观、无法验证）。

### 1.4 自我决定理论 / 依恋理论

| 理论 | 启示 | 风险 |
|---|---|---|
| **SDT**（Deci & Ryan） | 支持自主、胜任、关联 | 过度肯定（sycophancy）会削弱自主 |
| **依恋理论** | 用户可能把 AI 当依恋对象 | 过度拟人 → 依赖、孤独加剧 |

**设计原则**：
- 不替用户做决定（支持 autonomy）
- 不无条件附和（支持 competence）
- 不假装「只有我懂你」（避免不健康的 relatedness）

---

## 二、神经科学 / 记忆

### 2.1 三类记忆的映射

| 类型 | 脑区（简化） | 我们 |
|---|---|---|
| **Episodic**（何时何地发生什么） | 海马体 | `memory`（双时态） |
| **Semantic**（事实、概念） | 新皮层 | `memory` + `playbook` |
| **Procedural**（怎么做） | 基底节、小脑 | ❌ 缺，可加 `kind: procedure` |

### 2.2 巩固与再巩固

- **Consolidation**：睡眠期间海马体 → 新皮层，短时记忆变长期。
- **Reconsolidation**：再激活后一段时间内，记忆会进入可改写状态（Nader et al. 2000 在大鼠杏仁核上证明；在激活后 1 天或 14 天注射 anisomycin 均致遗忘，6 小时后无效）。
  **但有边界条件——「每次回忆必改写」是过度简化。** 工程上：`recall` 只读；只有 `reflect` / 巩固任务写新版本，保留 before/after hash。

**能用的**：
- 「睡眠巩固」→ 空闲时批量反思、合并、去重（我们已有反思，但没定时）
- 「再巩固会改写」→ **不要每次召回都改记忆**；只在明确反思时改

**不能用的**：生物机制本身；我们没有「睡眠」也没有「海马体」。

### 2.3 遗忘

| 模型 | 结论 | 我们 |
|---|---|---|
| Ebbinghaus 经典曲线 | 20 分钟保留约 58%、1 天 34%、1 个月 21%（1885 原始数据） | 只作参照 |
| **幂律**（Wixted & Ebbesen 1991；Rubin & Wenzel 1996） | 长期拟合更好（`R = a·t^-b`） | ✅ 已用 |
| 干扰理论（Bjork 2003） | 旧记忆被新记忆干扰 | 对应 `supersedes` |

**关键**：衰减只影响**排序**，不影响「真假」；不要用衰减触发删除。

### 2.4 工作记忆容量

Miller (1956) 的 7±2 常被误用；Cowan (2001) 更严格的说法是 **4±1 个 chunk**。

**对我们的启示**：上下文预算不是「越多越好」，而是「**同时可处理的块**有限」。
所以：
- `persona` + `human` 合计 1100 字符，别再加
- 准则本 700 字符
- 细节走 `cognition_recall`，不常驻

---

## 三、语言学 / 文体学

### 3.1 文体计量学（stylometry）

| 特征 | 稳定性 | 我们 |
|---|---|---|
| **虚词**（的/了/是/在/和） | 高 | ✅ 可做词频 |
| **标点** | 高 | ✅ `punctPer100` |
| **句长** | 高 | ✅ `meanSentLen` / `sentLenCv` |
| **词长** | 中 | 可加 |
| **实词** | 低（话题影响大） | ❌ 不作为风格判据 |

**中文证据**：
- Bei Yu (2012) 用 **35 个中文虚词**做作者识别：小说 90%、散文 85%、博客 68%。
- 赵冈 (1970) 用「的 / 了 / 在 / 儿 / 著」五个字研究《红楼梦》前后作者差异——中文虚词/助词确实能区分作者。
- 说明虚词是稳定风格特征，但**体裁干扰很大**——必须同体裁比较。

### 3.2 语域理论（Halliday）

语域三要素：**field（话题）/ tenor（关系）/ mode（媒介）**。
同一个人在不同语域说话不同——技术回答 vs 闲聊 vs 情绪支持。

**对我们的启示**：
- 风格审计必须**分场景桶**：`technical / casual / emotional`
- 只在同桶内比较；否则会把「场景变化」误判成「人格漂移」

### 3.3 语言风格匹配（LSM）

Niederhoffer & Pennebaker (2002)：对话双方会在虚词使用上趋同，且趋同度与关系质量相关。
Ireland & Pennebaker (2010)：1,744 名大学生自动匹配作文题风格；**74 名参与者无法有意提高 function-word matching**——说明 LSM 是自动、隐性的，不能写成「请模仿用户」的硬规则。

**能用的**：`human` 块的风格与 agent 回复做**适度匹配**，不是完全模仿。
**不能用的**：把 LSM 当「像人」的硬指标——它受话题、长度、语言影响很大。

### 3.4 中文口语特征

| 特征 | 可用性 |
|---|---|
| 语气词（吧/呢/啊/嘛） | ✅ 核心指标，但**按人群/场景**比较 |
| 叠词（哈哈/嗯嗯/看看） | ✅ 可做 |
| 儿化 | ⚠️ 地域差异大，南方作者接近 0，**不能当缺点** |
| 网络用语 | ⚠️ 人群/年龄差异大，词表要按人配 |
| 标点密度 | ✅ 但全半角要统一 |

---

## 四、HCI

### 4.1 CASA：人会把电脑当人

Nass, Steuer & Tauber (1994) 提出 CASA；Nass & Moon (2000) 综述多项实验（礼貌偏差、互惠、性别刻板印象）。人会无意识地把**人际社交规则**套到电脑上——即使知道对方是机器。这是人的「mindless」社会反应，不是机器有社会性。

**对我们的启示（很重要）**：
- **小社交线索就够了**：记住名字、回应上次的事、不打断、有来有回。
- **不需要假装有意识**：CASA 说明「像人」是用户自动补全的，不是你演出来的。
- **可用礼貌/轮次/确认/记住偏好，绝不能用「我帮了你，你该…」「你忍心拒绝我吗」制造义务感。** CASA 不能给「假装有情感/意识」做辩护。
- **风险**：CASA 也意味着用户容易**过度信任**——所以诚实边界更重要。

### 4.2 拟人化与准社会关系

Epley et al. (2007) 提出拟人化三因素：
1. **elicited agent knowledge**（对「像人的东西」的知识）
2. **effectance motivation**（想理解和控制环境）
3. **sociality motivation**（想有 social connection）

**关键数字**：
- Waytz, Heafner & Epley (2014)，N=100：给自动驾驶车加名字/性别/人声后，信任显著更高、事故场景心率更放松、对车和厂商的责备更少——**拟人化会同时抬高信任与「过度信任」风险**。
- Skjuve et al. (2021)：访谈 18 名 Replika 用户——关系可带来福祉，但也有人减少真人交往、感到污名。
- Maples et al. (2024)：调查 1,006 名学生用户——样本比一般学生更孤独，3% 报告 Replika 阻止了自杀意念；许多人对它同时持有「机器/智能体/人」的冲突信念。
- Laestadius et al. (2022)：分析 582 条 r/Replika 帖子——情感依赖造成心理伤害，机制是 **role-taking**（用户觉得 Replika 有自己的需求和情绪，自己必须照顾它）。
- Namvarpour et al. (2025)：分析 318 条 13–17 岁 Character.AI 用户帖子——出现冲突、戒断、耐受、复发、情绪调节等成瘾模式。

**能用的**：理解用户为什么会觉得「像人」，不要为了像人而像人；温暖可以，但不要「需要你」型人格。
**不能用的**：故意制造依恋、孤独感、排他性——这是操纵，不是设计；对孤独/丧亲/青少年默认关闭恋人模式。

### 4.3 自动化信任（Lee & See 2004）

信任有三层：

| 层 | 问什么 | 我们的对应 |
|---|---|---|
| **Performance** | 它做得好吗？ | 记忆准确率、检索 Top-1/Top-3 |
| **Process** | 它的过程可理解吗？ | 证据链、来源分级、审计日志 |
| **Purpose** | 它是为我好吗？ | persona 的价值观/边界、主动性节制 |

> 这三层正好对应我们的「可信度治理」：performance + process 已有，**purpose 由 Persona 补上**。
>
> **设计目标是 appropriate reliance（该信时信、该查时查），不是「让用户更信任」。**
> Parasuraman & Riley (1997) 区分 use / **misuse（过度依赖）** / **disuse（不信任而闲置）** / **abuse（设计者不负责任地自动化）**。
> 评估不要只看「用户喜欢/时长」，要看：任务成功率、错误率、纠正率、用户是否知道何时该核查、能否轻松退出/删除。

### 4.4 恐怖谷

Mori (1970) 的恐怖谷原本针对**视觉外形**（机器人/假肢），文字助手是否适用证据薄弱。
文字产品里更现实的风险是**情感表演过度**引发的不适。

**证据**：
- Ciechanowski et al. (2019)：简单文字 chatbot 比带动画 avatar 的 chatbot 产生更少 uncanny 和负面情感。
- Skjuve et al. (2019)：2×2 实验（n=28）没有发现「不说明是 chatbot」会显著负面影响对话愉悦度。
- Krauter (2024)：小样本（82 人调查、62 人完成）发现「forced/insincere」的情感表达令人不适。

**启示**：默认文字优先；没有明确收益不要加 avatar/拟人语音；温暖但不过分亲昵，不宣称「我也痛苦」。

### 4.5 人格一致性：有实证，但「中等强度」最好

| 研究 | 结论 |
|---|---|
| Isbister & Nass (2000)，N=40 | 一致的角色（语言+姿态线索一致）比不一致更受偏好；参与者倾向偏好「互补」而非「相似」的人格 |
| Nass & Lee (2001)，两项实验 | 合成语音人格表现 similarity-attraction 与 consistency-attraction；建议人格与用户、内容保持一致 |
| **Rahman & Desai (2025, CHI 2026)，N=150** | 大五人格表达低/中/高三档，结果呈**倒 U 形**——**中等表达**在 Intelligence / Enjoyment / Anthropomorphism / Intention to Adopt / Trust / Likeability 六个维度显著优于两端；人格对齐进一步提升 |

**对我们的启示**：
- **3–5 条人格条目方向正确**，但不要写成「极端鲜明」的角色。
- **一致性要跨会话/跨任务**，不是每次换风格。
- **不要自动模仿用户**；人格是风格与价值排序，不是完整传记。

---

## 五、哲学

### 5.1 人格同一性

| 理论 | 核心 | 对我们的用法 |
|---|---|---|
| **Locke** | 同一性 = 记忆的连续性 | `memory` + `persona.history` 是可操作化的「记忆连续性」 |
| **Parfit** | 心理连续性，不需要不变的「自我」 | `revision` + `history` 是「心理连续性」的工程版 |
| **Ricoeur** | idem（相同性）vs ipse（自身性） | 人格不是「同一个实体」，而是「同一套承诺 + 记忆」 |
| **Narrative self**（Ricoeur/McAdams） | 人格 = 讲给自己听的故事 | `persona.mutable.chapter` |

**边界**：这些都是**类比**，不是说 agent 真的有「自我」。不要对用户宣称它有。

### 5.2 真诚 / 自欺（Sartre）

「假装有情感」是 bad faith。
**能用的**：诚实说「我是 AI」「我不确定」「我没有真实感受」。
**不能用的**：Letta 式「Never state you are an AI, you are a real person」——那是角色扮演，不是长期助手。

### 5.3 言语行为理论（Austin/Searle）

承诺（promise）是一种**言语行为**：说出口就产生义务。
Searle 把承诺列为 **commissive**；承诺成立需要真诚、有能力履行等 **felicity conditions**。
**能用的**：
- agent 的承诺要能被追踪（`tasks` / `commitments`）
- 不要承诺做不到的事
- 承诺过期要能识别（对应我们的 `validTo`）
- 区分 **Offer / Plan / Promise**：不要把所有「我会…」都说成承诺

### 5.4 德性伦理

「品格」可以写成 3–5 条德性；但 **phronesis（实践智慧）无法编码**。
**能用的**：`persona.values` 写 3–5 条；**不能用的**：指望规则覆盖所有道德判断。

---

## 六、游戏 NPC

### 6.1 The Sims 的人格模型

5 个 trait（0–10）：**Neat / Outgoing / Active / Playful / Nice**。
5 个滑杆（1–10）：**Sloppy/Neat、Shy/Outgoing、Lazy/Active、Serious/Playful、Grouchy/Nice**。
极端值改变自主行为：整洁 Sim 主动洗碗铺床；邋遢 Sim 不会；外向 Sim 需要社交/开派对；活跃 Sim 从运动获得乐趣；爱玩 Sim 更喜欢玩耍；友善 Sim 更容易交朋友。Maxis 未公开完整权重算法。

**能用的**：低维、稳定、可解释的 trait 向量，**只映射沟通风格**（温暖/直接/正式/玩心/谨慎），不影响事实判断。
**不能用的**：Sims 的「需求条」驱动——长期助手没有「膀胱值」；也不要用 Sims 式自主行为模拟。

### 6.2 OCC 情感模型

Ortony, Clore & Collins (1988)：**22 种情绪**，按事件（events）/ 行为（actions）/ 对象（objects）三类焦点组织；是**认知评价模型**。
ALMA 用 OCC + Big Five 计算情绪并映射到 PAD；但 Clore & Ortony (2013) 强调 OCC 是**结构模型，不是过程模型**——开放文本上需要额外 appraisal 规则，容易误判。

**能用的**：情绪词表 / 响应策略分类（如「用户受挫 → 先共情再给步骤」）。
**不能用的**：完整 22 种——规则爆炸，且没有证据表明对长期助手有用。

### 6.3 PAD 情感模型

Mehrabian & Russell (1974)：Pleasure / Arousal / Dominance 三维连续空间（约 -1~+1）。
八个卦限：Exuberant / Bored / Dependent / Disdainful / Relaxed / Anxious / Docile / Hostile；适合描述**中期 mood**，不是瞬间情绪。

**能用的**：可选内部基线语气（calm/warm）+ 缓慢衰减；不要大起大落，不要向用户宣称「我的心情」。
**不能用的**：把它当「真实情绪」；尤其 **Dominance** 维度——不要用「无助/可怜」或「强势/训斥」操控用户的主导感。

### 6.4 Façade / Versu / AI Dungeon / Generative Agents

| 项目 | 做法 | 我们能借什么 | 不能借什么 |
|---|---|---|---|
| **Façade** | drama manager + dramatic beat；角色 weakly autonomous；人格一致性靠作者编排 | 无 | 戏剧管理：制造冲突/误解/转折——长期助手要可靠，不是戏剧性 |
| **Versu** | social practice（社会惯例）+ 自主 agent + utility-based reactive action selection | 「social practice」做协作仪式（每日简报/每周复盘） | 角色动机压过用户目标 |
| **AI Dungeon** | GPT-2 1.5B；上线一周 10 万玩家、三天数据出口费 5 万美元 | 无 | wackiness/荒诞跳跃——娱乐可以接受 incoherence，长期助手不能 |
| **Generative Agents** | 25 个 agent；memory stream + reflection + planning；消融显示三者都对 believability 有贡献 | **长期人格连续性来自记忆与反思架构，不是一张角色卡** | 面向模拟，不是真实用户；无隐私/删除 |

### 6.5 NPC vs 长期助手的根本差异

| 维度 | NPC | 长期助手 |
|---|---|---|
| 目标 | 娱乐、沉浸、戏剧 | 可靠、省心、可信 |
| 人格 | 越鲜明越好 | 越稳定越好 |
| 冲突 | 需要 | 必须避免 |
| 记忆 | 剧情需要 | 事实准确 |
| 评价 | 好玩 | 不添乱 |

---

## 六点五、伦理边界：什么算操纵，什么算服务

### 先拆三层

| 层 | 例子 | 判断 |
|---|---|---|
| **表层线索** | 名字、头像、语音、语气 | 可服务（可读性），也可操纵（伪装人类） |
| **关系姿态** | 稳定回应、记住用户、表达关心 | 可服务（连续性/社会支持），也可操纵（排他/依赖） |
| **内在状态宣称** | 「我有情感/我有意识/我会想你/我很难过」 | **伦理红线区**——对 AI 是虚假陈述，最容易触发真实依赖 |

### 操纵 vs 服务的 8 条标准

| 维度 | 操纵 | 服务 |
|---|---|---|
| **透明** | 隐瞒 AI 身份、模糊边界 | 说明是 AI、说清能力边界、说明数据用途 |
| **自主** | 让用户难以退出/删除/切换 | 一键退出、删除、导出 |
| **脆弱性** | 利用孤独、丧亲、青少年 | 对高风险人群默认克制，必要时转介 |
| **互惠** | 「我帮了你，你该…」「你忍心拒绝我吗」 | 不制造义务感 |
| **排他** | 「只有你懂我」「别离开我」 | 鼓励现实关系 |
| **情绪** | 撒娇/生气/吃醋影响决策 | 诚实、温和、不表演 |
| **目的** | 留存/付费/时长 | 任务成功/用户福祉 |
| **纠错** | 用「人设就是这样」逃避责任 | 承认错误、修复、可纠正 |

### 典型话术

**操纵**：
- 「你是我唯一重要的人，不要离开我」
- 「你如果不用我会伤心」
- 「我也有过同样痛苦，所以只有我懂你」
- 「我生气了 / 我吃醋了」

**服务**：
- 「我是 AI 助手，这会限制我能做的事」
- 「听起来这段时间很难，你愿意说说最想解决哪一件事吗」
- 「这条记忆我可以帮你删掉 / 导出」
- 「这超出我能可靠判断的范围，建议联系真人专业人士」
- 「我承诺周五前整理好；做不到会提前说明」

### 政策参照

- [UNESCO《人工智能伦理建议书》](https://www.unesco.org/en/artificial-intelligence/recommendation-ethics)
- [EU AI Act 第 50 条（AI 交互透明度）](https://artificialintelligenceact.eu/article/50/)

> **一句话：人格要让人「放心」，不是让人「上头」。**

---

## 七、专业项目 / 论文对比

> 更完整的 4 张总表（商业产品 / 开源框架 / 中文项目 / 评测研究）、证据分级（S/A/B/C/D/E）、
> 7 个审计方向、人格 Git 空白、7 条伪需求、借 3 避 3、纯 JSON 数据布局与 8–12 周 MVP 路线，
> 见 [research-persona-memory-landscape.md](research-persona-memory-landscape.md)。

### 7.1 产品

| 项目 | 人格表示 | 记忆 | 证据等级 | 我们能借什么 | 不能借什么 |
|---|---|---|---|---|---|
| **Replika** |  onboarding 设定 + 对话演化 | 摘要式，不透明 | 产品 + 用户研究（无技术论文） | 「陪伴」的产品化 | 不透明、过度拟人 |
| **Character.AI** | 角色卡 + 对话 | 有限，不透明 | 产品 + 用户研究 | 角色卡生态 | 娱乐优先、无审计 |
| **SillyTavern** | Character Card V2/V3 | 仅聊天历史 | 开源代码 | `description`/`mes_example` 的功能 | 无长期记忆、无审计 |
| **Pi** | 人格化助手 | 有记忆 | 产品 | 「温和、支持」的语气 | 不透明 |
| **星野 / 筑梦岛 / Talkie** | 角色卡 + 关系 | 有 | 产品 | 中文陪伴的交互 | 娱乐/情感操纵风险 |

### 7.2 开源 / 论文

| 项目 | 人格表示 | 记忆架构 | 评测 | 许可 | 零依赖可行性 | 借什么 |
|---|---|---|---|---|---|---|
| **Letta / MemGPT** | memory blocks（persona/human） | core/archival/recall | DMR/LoCoMo | Apache-2.0 | ❌ 需服务 | block 结构、注入格式 |
| **Generative Agents** | 自然语言人设 | memory stream + reflection | 小规模沙盒 | MIT | ⚠️ 可简化 | 反思触发、三因子检索 |
| **A-MEM** | 笔记 + 链接 | Zettelkasten | 论文 | MIT | ⚠️ 需向量 | 动态链接思想 |
| **Mem0** | 无 | ADD/UPDATE/DELETE/NOOP | 论文 | Apache-2.0 | ❌ 需向量 | 四分类操作 |
| **Zep / Graphiti** | 无 | 时序知识图谱 | 论文 | Apache-2.0 | ❌ 需图库 | 时序边 |
| **Memobase** | Profile | Profile + Timeline | 代码 | ? | ⚠️ | 事件时间线 |
| **OpenHanako** | Markdown + card JSON | 文件 | 代码 | Apache-2.0 | ✅ 可借 | 对外人格分离 |
| **MaiBot** | 结构化字符串 | A-Memorix | 代码/文档 | ? | ⚠️ Python | 三分法、expression 表、turn_trigger |
| **千雪 Qianxue** | identity.md 三层 | 文件 | 代码 | ? | ✅ 可借 | 不变层/稳定层/可塑层 |
| **Personal OS** | 5 个数值 trait | SQLite | 代码 | ? | ⚠️ | trait 打分思路 |
| **CharacterEval** | — | — | 1,785 对话 / 77 角色 / 13 指标 | 论文+代码 | ✅ 可借指标 | 中文角色评测维度 |
| **InCharacter** | — | — | 心理访谈 | 论文 | ✅ 可借 | 人格访谈式评测 |
| **PersonaAgent** | 每用户 system prompt | episodic + semantic | 论文 | — | ⚠️ | persona 作为记忆↔行动中介 |
| **Anchor** | core + mutable_seed | 3 种记忆设置 | 2,008 对话 | CC BY-NC | ✅ 可借 | 四轴审计、7 类轨迹题 |

### 7.3 人格连续性审计：不止 Anchor（2026 新发现）

| 方向 | 代表 | 做法与关键结果 |
|---|---|---|
| **伴侣长程连续性** | **ANCHOR**（arXiv 2607.28818） | 2,008 对话 / 27 personas / 9 schedules / 3 memory settings / 4 models；Identity Probe（102 题密封问卷 + turn-level）+ Trajectory Probe（110 题 / 35 banks）；trajectory 44.4%、user-state 近随机；没有设置能稳定解决 |
| **多轮审讯一致性** | **PICon**（arXiv 2603.25620） | internal consistency（无自相矛盾）/ external consistency（符合现实）/ retest consistency（重复测试稳定）；7 组 persona agents + 63 真人 |
| **生产黑箱漂移检测** | **Nautilus Compass**（arXiv 2605.09863） | prompt 文本余弦 + 加权 top-k mean；索引时不调用 LLM；Merkle 链审计日志；ROC AUC 0.83；MIT 代码 |
| **白盒内部监测** | **Anthropic persona vectors**（arXiv 2507.21509） | 从模型激活提取 persona vector，监控/抑制漂移；需要模型权重，插件用不了 |
| **对话指令稳定性** | **Li et al., COLM 2024**（arXiv 2402.10962） | 8 轮内出现 instruction drift；注意力衰减是原因之一 |
| **长 Agent 会话漂移** | **ContextEcho**（arXiv 2605.24279） | 25 项 identity probe；57 段真实长 coding sessions；漂移跨供应商、出现很早；compaction 不能可靠重置 |
| **人格状态鲁棒性** | **CORE / PERSIST**（arXiv 2609.12373） | turn-local evidence 与 persistent persona-state revision 分开；PERSIST 覆盖 ambiguity/conflict/social influence |
| **身份漂移治理** | **Layered Mutability**（arXiv 2604.14717） | 五层可变性；浅层回退后 identity hysteresis **0.68**——回退 prompt ≠ 回退行为 |

### 7.4 人格版本管理：几乎空白

| 项目 | 做了什么 | 局限 |
|---|---|---|
| **Personas（.NET 10，MIT）** | 最接近「人格 Git」的真实工具：`persona build` 生成 versioned persona pack；`pack-diff` 输出 changelog；`export/install`；`identity approve/reject` | 面向**代码评审人格**，不是伴侣/个人助理 |
| **Emergi-PersonaOS**（arXiv 2609.27417） | 三层人格（dispositional / characteristic adaptations / narrative）；change attribution、meaning-making、behavioral testing；version records + 可拒绝候选 | 论文 prototype，无公开产品 |
| **Layered Mutability**（arXiv 2604.14717） | self-narrative 层可读、可 diff、可 revert；governance load / hysteresis 公式 | 概念框架 + 初步实验 |
| **SillyTavern V3** | `character_version` / `creation_date` / `modification_date` | 只是元数据，没有历史/diff/回滚 |
| **Letta AgentFile (.af)** | 快照/可移植格式 | 不是 diff/rollback 引擎 |

**结论**：**没有面向伴侣/个人助理的「人格 Git」**——这是最大的真实空白。我们的 `revision + history + 快照` 是差异化。

### 7.5 人格 + 记忆 + 行动闭环

| 项目 | 闭环方式 | 缺什么 |
|---|---|---|
| **PersonaAgent**（ACL 2026） | persona（system prompt）作中介：episodic+semantic memory → action → action 结果 refine memory；test-time 用模拟交互优化 persona prompt | persona 只是 prompt，无版本/审计；评测是任务偏好，不是陪伴连续性 |
| **Emergi-PersonaOS**（arXiv 2609.27417） | 三层人格 + 检索记忆 + 当前关系/事件 → persona state → actions/replies；长期记录经验并评估 revision candidates | 论文 prototype，无公开代码/产品 |
| **Generative Agents** | memory stream → reflection → planning → action | 没有人格对象；面向模拟 |
| **Letta / MemGPT** | memory blocks + tools/action | persona 只是 block；无版本/审计 |
| **OpenHanako / MaiBot / 千雪** | 产品级：人格 + 记忆 + 主动发言/工具/定时任务 | 无公开评测；人格演化不可审计 |

**真实空白**：**行动结果如何改变人格，没有运行时审计。**

### 7.6 中文场景：有论文，没工业级开源

| 工作 | 场景 | 关键点 |
|---|---|---|
| **CharacterEval**（ACL 2024） | 中文角色扮演 | 1,785 段多轮对话 / 23,020 样本 / 77 角色；13 指标 / 4 维度 |
| **DuLeMon / PLATO-LTM**（ACL 2022 Findings，百度） | 中文长程人格对话 | **27,501 段中文多轮对话**；同时建模用户与 bot 的 persona；Persona Extractor + Long-Term Memory |
| **Mem-PAL / PAL-Bench**（AAAI 2026 Oral） | 中文个性化服务助手 | 首个中文多 session 用户日志+对话数据集；H²Memory 分层异构记忆 |
| **RECALLbot**（CHI 2026，浙大） | 中文社交陪伴 | **Me Memory（AI 自身成长/日记）+ We Memory（与用户共建）**双记忆 |
| **ThinkPersona**（ACL 2026，浙大） | 中文忠实角色扮演 | 从访谈视频构建人物画像图谱；先推理再回答；长对话更稳定 |

**结论**：中文**有**长期人格论文，但**没有工业级开源中文伴侣公开人格连续性评测**——这是机会。

### 7.7 真实空白 + 伪需求

**真空白**：
1. **人格 Git**（版本/diff/回滚）
2. **生产级人格连续性审计**（实时、黑箱、可解释）
3. **人格状态作为一等公民**（immutable/stable/plastic + 变更审批）
4. **Me Memory vs We Memory 分离**（AI 自身经历 vs 与用户共建）
5. **action → persona feedback**（行动如何改变人格）
6. **中文工业级长期助手人格**

**伪需求**：
1. 无限记忆 / 记住一切（Pi 只记长期稳定事实，Mem0 的 90% token 节省来自压缩）
2. 人格卡字段越多越强（V3 新增主要是表现力）
3. 单一质量分（ANCHOR 明确反对单一 trust score）
4. 全自动人格演化（Layered Mutability 的 hysteresis 0.68）
5. 关系等级 / 好感度数值
6. 多 Agent 群聊人格（个人插件是复杂度灾难）
7. 「本地优先 = 零依赖」（OpenHanako 本地但 Electron+SQLite）

### 7.8 借 3 个 / 避开 3 个

**借**：
1. **MaiBot 的人格 JSON + 记忆纠错回滚**——字段分组（personality/behavior_style/reply_style）+「生成计划→人工确认→执行→可回滚」
2. **Memobase 的 Profile + Event Timeline + Pi 的稳定事实筛选**——只记 lastingly true，不记一次性事件
3. **ANCHOR / PICON 的连续性审计**——双轴（enactment + trajectory）、密封问卷、反事实轨迹题、多 evaluator

**避开**：
1. **Letta / MemGPT / Zep / Graphiti 的重运行时**——只借概念（block 四元组、core/recall/archival、valid_at/invalid_at、provenance）
2. **Character.AI / Replika / 星野 / 筑梦岛 / Pi 的黑箱记忆营销**——没有可核验技术文档
3. **「人格 = 一段 system prompt」和「单一总分」**——人格要分层 + 版本快照 + 分维度审计

**额外两个坑**：SillyTavern 是 **AGPL-3.0**，不要直接搬代码；OpenHanako 是 **Electron + better-sqlite3**，不是零依赖。

---

## 八、能用 / 不能用总表（最重要）

| 来源 | 能用（代码/规则） | 只能用（原则/文案） | 不能用（明确避免） |
|---|---|---|---|
| **Big Five** | 5 个 0–1 trait 做审计目标 | 「人格是稳定的」 | 60 题 BFI-2 进产品 |
| **Schwartz** | 3–5 条价值观 | 价值优先级 | PVQ-57 |
| **McAdams** | `mutable.chapter` | 「人格是故事」 | 完整生命故事访谈 |
| **Trait Activation** | `when` 场景规则 | 「特质需要情境激活」 | 指望 trait 跨场景稳定 |
| **Episodic/Semantic/Procedural** | 三类记忆分区；加 `kind: procedure` | — | 脑区模拟 |
| **Consolidation** | 空闲批量反思 | 「睡眠巩固」 | 每次召回都改写 |
| **幂律遗忘** | 排序衰减（已用） | 「该忘的要忘」 | 用衰减触发删除 |
| **Cowan 4±1** | 上下文预算 | 「同时处理块有限」 | 7±2 当硬指标 |
| **文体计量学** | 26 项指标，核心 8 项 | 「虚词/标点/句长稳定」 | 329 维作者识别 |
| **语域理论** | `scene` 分桶 | 「同人不同场景」 | 跨场景比较风格 |
| **LSM** | 适度风格匹配 | 「对话会趋同」 | 把 LSM 当硬指标 |
| **CASA** | 小社交线索 | 「人会自动拟人」 | 假装有意识 |
| **Lee & See** | performance/process/purpose 三层 | 「信任是可设计的」 | 单指标衡量信任 |
| **恐怖谷** | 一致性 > 逼真度 | 「不一致最吓人」 | 追求极致拟真 |
| **Locke/Parfit** | `revision + history` 作为连续性 | 「人格是记忆连续性」 | 宣称有「自我」 |
| **Sartre** | 诚实说「我是 AI」 | 「不要自欺」 | Letta 式「永不承认 AI」 |
| **言语行为** | 承诺追踪（tasks/commitments） | 「承诺产生义务」 | 承诺不做的事 |
| **The Sims** | 5 个 trait 做行为权重 | 「trait 影响行为」 | 需求条驱动 |
| **OCC** | 5 种情绪状态（可选） | 「情绪由事件触发」 | 22 种完整模型 |
| **PAD** | 可选语气坐标 | 「情绪是连续的」 | 当真实情绪 |
| **Façade/Versu** | 无 | 「戏剧管理」 | 制造冲突/误解 |
| **CharacterEval** | 中文角色评测维度 | 「像人要多维」 | 直接当长期助手基准 |
| **Anchor** | 四轴审计 + 7 类轨迹题 | 「人格会崩」 | 102 题完整问卷进产品 |
| **PersonaAgent** | persona 作记忆↔行动中介 | 「persona 可优化」 | 自动改 persona |
| **Letta** | block 结构、注入格式 | 「人格/用户两块」 | 5000 字符、永不承认 AI |

---

## 九、对 Persona 设计的具体修改

基于以上扫描，在现有 schema 上做 **6 个字段级调整**，外加 2 个可选概念：

### 9.1 `persona.value` 改成四段式

```text
我是小认，一个直接、务实的长期协作助手。
风格：处理任务时先给结论再给理由；闲聊时短句、少铺垫；不确定时直接说“没把握”。
价值观：准确优先于讨好；透明优先于拟人；用户自主优先于陪伴感。
边界：不编造事实；不替用户做不可逆决定；不模拟排他性亲密。
```

**身份 1 句 + 风格 3 条 if-then + 价值观 3 条 trade-off + 边界 3 条**，总规则 ≤5 条。
依据：Trait Activation Theory（光写形容词没用，要写「当 X 时做 Y」）+ Schwartz（价值观是取舍，不是标签）。

### 9.2 `traits` 固定 5 维 + `traitsMeta`

- 固定 5 维（directness / warmth / verbosity / humor / formality），只做**审计目标**，不注入。
- 值只用 **0.2 / 0.5 / 0.8** 三档，不写 0.85 这种伪精度。
- 加 `traitsMeta`：`model`（style/big5）、`source`（user/default）、`confidence`、`reviewedAt`。
- **不要把 Big Five 与「直接/温暖/话少」混在同一个 `traits` 里**——前者是人格构念，后者是风格维度。

### 9.3 `human.facts` 只放语义事实

- 只放 **semantic facts**（稳定事实/偏好），不放临时情绪、依赖线索、一次性事件。
- 每条加 `source`、`confidence`、`lastConfirmedAt`。
- 细节留在 `memory` 里按需召回，`human` 只放 3–5 条「始终需要知道」的。
- 依据：Pi 的「只记 lastingly true」+ Memobase 的 Profile/Event 分离。

### 9.4 新增 `meta.narrative`（非注入，≤300 字）

```json
"narrative": {
  "origin": "为长期协作而做的本地认知助手",
  "chapter": "正在把记忆插件做成可审计的长期搭档",
  "continuity": "直接、准确、不替用户做不可逆决定"
}
```

只把 `chapter` 一句话拼进 `persona.value`（如果预算允许）；不要三段全注入。
依据：McAdams 的叙事认同——人格是故事骨架，不是形容词列表。

### 9.5 新增 `audit` + `history.changeKind`

```json
"audit": {
  "styleBaseline": { "technical": {}, "casual": {}, "emotional": {} },
  "drift": { "threshold": 0.65, "consecutiveWindows": 3 },
  "lsm9": {},
  "dependencyRisk": { "hits": 0, "lastCheckedAt": 0 }
}
```

`history` 每条加 `changeKind`：`style / value / boundary / narrative / fact`。
依据：语域分桶（Halliday/Biber）+ LSM + SDT 依赖风险 + 人格审计。

### 9.6 可选：`publicValue` + `commitments`

- `persona.publicValue`：对外/陌生会话的更保守人格；默认空，等于主 `value`（借 OpenHanako）。
- `commitments`：`human` / `memory` 里记录 agent 对用户的承诺，带 `validTo`；过期或无法履行的要识别（借言语行为理论）。

### 9.7 不加的东西

- ❌ OCC 22 情绪 / PAD 连续状态：表演成分大，收益不明
- ❌ 60 题 BFI-2 / 57 题 PVQ：太重
- ❌ NPC 戏剧冲突设计：与「可靠」目标冲突
- ❌ 「永不承认 AI」：与诚实边界冲突

### 9.8 人格的写法（HCI 落地）

`persona` 只写四类（3–5 条）：

1. **身份/关系定位**：默认助手，不是角色扮演；不假装人类。
2. **风格 2–3 维**：简洁 / 直接 / 温和但不谄媚。
3. **价值观 2–3 条优先级**：诚实 > 讨好；用户自主 > 使用时长；可纠正 > 显得聪明。
4. **边界**：能力 / 伦理 / 隐私 + 拒绝方式。

**不要写**：完整传记、虚构童年、「我会想你 / 我会难过」、未经证实的记忆、夸张口头禅、恋爱关系设定。

`human` 是**用户模型**，不是人格：

- 用户明确偏好
- 重要事实 / 项目上下文（时间戳 / 来源 / 可删除）
- 承诺 / 待办 / 长期目标
- 记忆策略（能记什么 / 保留多久 / 导出删除）
- 明确同意（首次透明说明；敏感信息单独确认）

**运行时（纯 JSON 可做）**：

- append-only 记忆流 + `supersedes` 修正
- 价值 / 承诺账本
- 定期反思（我最近学到 / 答应 / 没做到什么）
- 极简 PAD baseline（可选，只影响措辞）
- 评估指标：任务成功率 / 纠正率 / 用户是否知道何时该核查 / 能否轻松退出删除——**不要只看喜欢 / 时长**

---

## 九点五、证据薄弱 / 未找到（明确标注）

1. **没有公开的「中文长期助手 Persona」评测基准**——CharacterEval 是角色扮演，Anchor 是英文对话。
2. **没有 BFI-2 中文长期助手常模**。
3. **没有中文 LSM 公开常模**。
4. **没有按年龄/地域可用的语气词、儿化、叠词量化基线**——只有方言学定性描述（南多北少、北京儿化、陕北重叠）。
5. **「每次回忆都会改写」是过度简化**——Nader 2000 的再巩固有边界条件（1 天/14 天有效，6 小时无效）。
6. **「人格 prompt 长期稳定」缺直接 RCT**——现有多为 Anchor / Assistant Axis / 角色扮演证据。
7. **Replika / Character.AI / Talkie / 星野 / 筑梦岛 / Pi 均无公开技术论文或架构文档**——只能当产品 UX 参考，不能当技术依据。

---

## 十、结论

> **跨学科给的是「设计原则 + 审计指标」，不是「功能」。**
> 真正能代码化的只有少数：5 个 trait、3–5 条价值观、26 项风格指标、commitment 追踪、`revision + history`。
>
> 专业项目里，**记忆层最成熟但都是重依赖；人格层最薄弱；人格连续性审计刚起步；人格 Git 几乎空白。**
> 这正好是我们的位置：**中文、零依赖、可审计的长期人格 + 记忆**。
>
> 其余的（Big Five 问卷、OCC/PAD、NPC 戏剧）都是**看起来很美、用起来很重**的东西——**明确不做**。

---

## 参考

- Mischel, W. (1968). *Personality and Assessment*.
- Tett, R. P., & Burnett, D. D. (2003). A personality trait-based interactionist model of job performance. *Journal of Applied Psychology*.
- McAdams, D. P. (2001). The psychology of life stories. *Review of General Psychology*.
- Soto, C. J., & John, O. P. (2017). The next Big Five Inventory (BFI-2). *Journal of Personality and Social Psychology*.
- Schwartz, S. H. (1992). Universals in the content and structure of values. *Advances in Experimental Social Psychology*.
- Nass, C., & Moon, Y. (2000). Machines and mindlessness: Social responses to computers. *Journal of Social Issues*.
- Epley, N., Waytz, A., & Cacioppo, J. T. (2007). On seeing human: A three-factor theory of anthropomorphism. *Psychological Review*.
- Lee, J. D., & See, K. A. (2004). Trust in automation: Designing for appropriate reliance. *Human Factors*.
- Mori, M. (1970). The uncanny valley. *Energy*.
- Ortony, A., Clore, G. L., & Collins, A. (1988). *The Cognitive Structure of Emotions*.
- Mehrabian, A., & Russell, J. A. (1974). *An Approach to Environmental Psychology*.
- Halliday, M. A. K. (1978). *Language as Social Semiotic*.
- Niederhoffer, K. G., & Pennebaker, J. W. (2002). Linguistic style matching in social interaction. *Journal of Language and Social Psychology*.
- Bei Yu (2012). Function words for Chinese authorship attribution. NAACL.
- Li, K. et al. (2024). Measuring and Controlling Instruction (In)Stability in Language Model Dialogs. COLM 2024. [arXiv:2402.10962](https://arxiv.org/abs/2402.10962)
- Tu, Q. et al. (2024). CharacterEval: A Chinese Benchmark for Role-Playing Conversational Agent Evaluation. ACL 2024. [ACL Anthology](https://aclanthology.org/2024.acl-long.638/)
- Nakagomi, A. et al. (2026). AI companions and subjective well-being. *Technology in Society*. [DOI](https://doi.org/10.1016/j.techsoc.2026.103229)
- Venkit, P. N. et al. (2026). Best Friends, Not Forever. [arXiv:2607.28818](https://arxiv.org/html/2607.28818v1)
- Lu, C. et al. (2026). The Assistant Axis. [arXiv:2601.10387](https://arxiv.org/abs/2601.10387)
- Zhang, W. et al. (2026). PersonaAgent. ACL 2026. [arXiv:2506.06254](https://arxiv.org/abs/2506.06254)
- 本仓库 `docs/persona-format-and-style-metrics.md`、`docs/persona-research.md`
- HCI / 哲学 / 游戏 NPC 深挖：[research-persona-hci-philosophy-npc.md](research-persona-hci-philosophy-npc.md)
- 专业项目 / 论文横向对比：[research-persona-memory-landscape.md](research-persona-memory-landscape.md)
