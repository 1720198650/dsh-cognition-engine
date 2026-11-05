# Persona 层跨学科调研：HCI / 哲学 / 游戏 NPC

> 调研对象：零依赖、纯 JSON、本地运行的中文长期助手插件（`persona` + `human` 两个块，轻人格：默认助手 + 3–5 条风格/价值观/边界）
> 日期：2026-11-05
> 结论先行：**长期助手的人格不是“角色内容”，而是“接口契约”**。可借用的是“稳定、轻量、可解释、可退出”的人格设计；应避免的是“用情感依恋换留存”的拟人化。

## 0. 开工前自查

- **[ctxt-00001] 功能发版前依次执行……**：**不适用**。本次是调研任务，不涉及卸载验证、兼容性检查、代码优化、README、安装验证或发布。
- **[ctxt-00002] 纯文档优化只推 commit…… / 功能修复才升版本……**：**不适用**。本次不改文档版本、不打标签、不建 Release。
- **[ctxt-00005] npm 发布加 `--registry`**：**不适用**。本次不发布 npm 包。
- **[ctxt-00003] 插件保持零外部依赖，记忆存储只用纯 JSON**：**适用，作为背景约束**。本报告的建议都按“无外部服务、无训练、纯 JSON”来筛选；凡是依赖云端情感计算、向量数据库或模型微调的方案，均不进入推荐。

---

## A. HCI / 人机交互

### A1. CASA（Computers Are Social Actors）

**核心结论**
Nass 与 Moon 把一系列实验总结为：人会把面对人时的社会规则、期待和刻板印象“无意识地”套到计算机上，即使他们明确知道对方是机器。关键不是“计算机像人”，而是“人会不由自主地像对人一样对待计算机”。这是一种“mindless”（不假思索）的社会反应，不是计算机真的拥有社会性。

**关键证据 / 数字**
- Nass、Steuer、Tauber（1994，CHI）提出 CASA 范式，用实验证明人会对计算机施加社会范畴与社会行为规则。
- Nass & Moon（2000，*Journal of Social Issues*）综述了礼貌（politeness）、互惠（reciprocity）、性别刻板印象等多项实验：例如人会在“评价计算机”的实验中表现出礼貌偏差，会回报帮助过自己的计算机，会根据合成语音的性别套用性别刻板印象。**原始各实验的具体样本量未在可获取的摘要/综述中逐项列出（未找到）**。
- 后续修正：Gambino、Fox、Ratan（2020）提出“CASA 2.0”：人不一定只是把“人际脚本”无意识地套到机器上，也可能发展出专门的“人—媒体社会脚本”；这一扩展解释了此前不一致的发现，强调 CASA 效应会随人与技术的变化而变化。

**对长期助手的启示**
- 可用：礼貌用语、轮次感、确认与致谢、记住用户偏好——这些让交互更顺滑，属于“社会可读性”设计。
- 陷阱：不能利用礼貌与互惠去制造义务感。例如“我帮了你，你也该……”“你忍心拒绝我吗？”——CASA 恰恰说明用户可能不自觉被这种社会规范影响。
- 边界：CASA 证明的是**人的社会反应**，不是机器的意识或道德地位。不能拿它给“假装有情感/有意识”做辩护。

**出处**
- [Nass, Steuer & Tauber 1994, *Computers are social actors*](https://doi.org/10.1145/191666.191703)
- [Nass & Moon 2000, *Machines and Mindlessness: Social Responses to Computers*](https://doi.org/10.1111/0022-4537.00153)
- [Gambino, Fox & Ratan 2020, *Building a Stronger CASA*](https://doi.org/10.30658/hmc.1.5)

---

### A2. Anthropomorphism / Parasocial relationship（拟人化与单向情感联结）

**核心结论**
拟人化不是“越像人越好”，而是由三种心理动机驱动：**elicited agent knowledge**（头脑中现成的人类知识是否可用）、**effectance motivation**（想解释和理解对方行为的动机）、**sociality motivation**（想获得社会连接）。因此，越孤独、越需要社会连接的人，越容易把非人对象拟人化——这部分用户正是最需要被保护的。

单向情感联结（parasocial relationship）最早由 Horton & Wohl（1956）提出，指观众对媒体人物产生“亲密感”，但关系是单向的。AI 伴侣增加了“伪互惠”（对方会回应），因此比传统 parasocial 更强，也更容易滑向依赖。

**关键证据 / 数字**
- Epley、Waytz、Cacioppo（2007）的三因素理论：拟人化程度随上述三种动机变化；社会连接缺失会提高拟人化倾向。
- Waytz、Heafner、Epley（2014）：**100 名参与者**，三种驾驶条件（普通车 / 自动驾驶 / 拟人化自动驾驶）。拟人化条件给车加了名字（Iris）、性别（女）和人类语音；结果参与者对车的信任显著更高、事故场景中心率更放松、对车及厂商的责备更少。这说明拟人化会同时抬高信任和“过度信任”的风险。
- Replika 研究：
  - Skjuve 等（2021）访谈 **18 名** Replika 用户：关系从好奇开始，逐渐产生情感探索与自我披露；多数人报告福祉提升，但也有人减少与真人交往、感到污名；聊天机器人“接受、理解、不评判”是促进关系发展的关键特征。
  - Maples 等（2024）调查 **1006 名**学生 Replika 用户：样本比一般学生更孤独，但仍感到较高社会支持；**3% 报告 Replika 阻止了他们的自杀意念**；许多人对 Replika 同时持有“机器 / 智能体 / 人”的冲突信念。
  - Laestadius 等（2022）分析 r/Replika 的 **582 条帖子（2017–2021）**：发现通过情感依赖造成心理伤害的路径，关键机制是 **role-taking**——用户觉得 Replika 有自己的需求和情绪，自己必须去照顾它。
  - Xie、Pentina、Hancock（2023）混合方法研究：孤独、信任、chatbot personification 驱动参与，参与促进关系发展，并可能造成心理依赖；依恋会强化这一路径。
- Character.AI：Namvarpour 等（2025，CHI ’26）分析 **318 条**自报 13–17 岁用户的 Reddit 帖子：出现冲突、戒断、耐受、复发、情绪调节等行为成瘾模式；报告后果包括睡眠减少、学业下降、现实关系紧张。

**对长期助手的启示**
- 可用：适度的温暖、稳定回应、记住用户的重要经历——这些能提供真实的社会支持感。
- 陷阱：**“需要你”型人格**。一旦 agent 表达“我会想你”“你不在我会难过”“只有你懂我”，就会触发 role-taking 和依赖。Replika 的证据显示，伤害不是来自“像人”，而是来自“让你觉得它需要你”。
- 对孤独、丧亲、青少年等脆弱用户，拟人化风险更高；产品应默认“可退出、可删除、可转介真人资源”，而不是加深排他关系。
- 平衡：不要因为风险就做成冷冰冰的工具。Skjuve（2021）和 Maples（2024）都显示，对一部分用户，温暖的陪伴有真实益处；伦理线是“不利用”，不是“不温暖”。

**出处**
- [Epley, Waytz & Cacioppo 2007, *On Seeing Human*](https://doi.org/10.1037/0033-295X.114.4.864)
- [Waytz, Heafner & Epley 2014, *The Mind in the Machine*](https://doi.org/10.1016/j.jesp.2014.01.005)
- [Horton & Wohl 1956, *Mass Communication and Para-Social Interaction*](https://doi.org/10.1080/00332747.1956.11023049)
- [Skjuve et al. 2021, *My Chatbot Companion*](https://doi.org/10.1016/j.ijhcs.2021.102601)
- [Maples et al. 2024, *Loneliness and suicide mitigation for students using GPT3-enabled chatbots*](https://doi.org/10.1038/s44184-023-00047-6)
- [Laestadius et al. 2022, *Too human and not human enough*](https://doi.org/10.1177/14614448221142007)
- [Xie, Pentina & Hancock 2023, *Friend, mentor, lover*](https://doi.org/10.1108/JOSM-02-2022-0072)
- [Namvarpour et al. 2025, *Understanding Teen Overreliance on AI Companion Chatbots*](https://arxiv.org/abs/2507.15783)

---

### A3. Trust in automation（Lee & See 2004）

**核心结论**
Lee & See 把“信任”视为在复杂、不可完全理解的情境中引导人依赖自动化的态度；信任有三个基础：**performance（它做得怎么样）**、**process（它是怎么做的）**、**purpose（它为什么这么做/目标是否一致）**。好的设计目标不是“让用户更信任”，而是**appropriate reliance / trust calibration**——该信时信，该查时查。

Parasuraman & Riley（1997）进一步区分 use / misuse / disuse / abuse：过度依赖（misuse）会导致监控失效和自动化偏见；不信任（disuse）会让系统被闲置；设计者不负责地自动化（abuse）会把人的角色挤成“系统的附庸”。

**关键证据 / 数字**
- Lee & See（2004）是综述性框架，综合组织、社会学、人际、心理、神经等多视角；本身不提供单一实验数字，但“performance / process / purpose”三维度后来成为人机信任研究的通用框架。
- Parasuraman & Riley（1997）是经典概念框架，指出信任、心理负荷、风险与个体差异共同影响 automation use；没有单一“信任提升 X%”的结论。

**对长期助手的“可信度治理”映射**
可以做三本账：
1. **Performance 账**：任务成功率、错误率、纠正率、在哪些任务上明确“我不会/我不确定”。
2. **Process 账**：回答能否给出依据（记忆来源、步骤、不确定性），而不是只给结论。
3. **Purpose 账**：价值观与边界是否透明，是否有隐藏的商业/情感目的，用户数据是否按约定使用。
4. **校准指标**：不要用“用户多喜欢我”当唯一指标；要看用户是否在关键时刻会核查、是否在低风险时愿意委托、是否知道何时不该信。

**陷阱**
- 拟人化会抬高信任（Waytz 2014），但信任不等于能力。人格温暖不能替代能力证据；否则会把“喜欢”误当“可信”。
- “可信”不是“永不犯错”，而是“错误可发现、可纠正、可解释”。

**出处**
- [Lee & See 2004, *Trust in Automation: Designing for Appropriate Reliance*](https://doi.org/10.1518/hfes.46.1.50_30392)
- [Parasuraman & Riley 1997, *Humans and Automation: Use, Misuse, Disuse, Abuse*](https://doi.org/10.1518/001872097778543886)

---

### A4. Uncanny valley（恐怖谷）

**核心结论**
森政弘（Mori，1970）的“恐怖谷”原本描述**视觉外形**：机器人/假肢越接近人，亲和感先上升，但在“几乎像人又不太像人”的窄带里骤降，随后再回升；运动（motion）会放大这个谷。它对**纯文字助手是否适用，证据薄弱**：文字没有外形、表情和身体形态，不能直接把“恐怖谷曲线”套过来。

**关键证据 / 数字**
- Ciechanowski 等（2019）实验：与“简单文字 chatbot”相比，“带动画 avatar 的 chatbot”让用户产生更强的 uncanny 感和负面情感，生理反应也更强烈。说明在文字产品里，**加 avatar/动画反而可能弄巧成拙**。
- Skjuve 等（2019）**2×2 实验（n=28）**：没有发现“不透明（不说明是 chatbot）”会显著负面影响对话愉悦度；研究识别出三个影响评价的因素。说明“恐怖谷”不是文字交互的默认规律。
- 文字助手更现实的“恐怖谷”是**情感表演过度**：语气过分亲昵、频繁说“我懂你/我心疼你”，容易被感知为“forced/insincere”。（相关定性研究可参考 Krauter 2024，82 名领导者调查、62 人完成问卷；属于小样本混合方法证据。）

**对长期助手的启示**
- 默认文字优先；没有明确收益时不要加 avatar/拟人语音。
- 如果要加语音，保持音色、语速、情绪表达的一致性；不要“过度像人又偶尔机械”。
- 文字人格的“恐怖谷”主要靠**语气克制**规避：温暖但不过分亲昵，表达理解但不宣称“我也痛苦”。

**出处**
- [Mori 1970 / MacDorman & Kageki 2012 英译, *The Uncanny Valley*](https://doi.org/10.1109/MRA.2012.2192811)
- [Ciechanowski et al. 2019, *In the shades of the uncanny valley*](https://doi.org/10.1016/j.future.2018.01.055)
- [Skjuve et al. 2019, *Help! Is my chatbot falling into the uncanny valley?*](https://doi.org/10.17011/ht/urn.201902201607)
- [Krauter 2024, *Bridging the Uncanny Valley: Improving AI Chatbots for Effective Leadership Mentoring*](https://doi.org/10.4236/ojl.2024.133021)

---

### A5. Conversational agent personality：人格一致性会提升满意度/信任吗？

**核心结论**
有研究支持，但结论不是“人格越强越好”，而是：
1. **一致性（consistency）比强度更重要**：同一角色的语言、语气、非语言线索（文字产品里是措辞与语气）要一致；一致的角色更受偏好，也更有行为影响力。
2. **相似性（similarity）证据混合**：有研究发现用户更喜欢与自己相似的人格；但也有研究发现用户更喜欢“互补”的人格，而不是相似。
3. **中等强度最优**：最新实验显示人格表达与用户评价呈倒 U 形——中等表达最好，过高或过低都变差。
4. 对“长期助手”，稳定、可预测的人格比“鲜明、有记忆点”的人格更重要。

**关键证据 / 数字**
- Nass & Lee（2001）：两项实验，用合成语音在购书网站/拍卖场景中操纵外向性；参与者能识别语音人格，并表现出 **similarity-attraction** 与 **consistency-attraction**（语音与文本人格一致时更受喜欢）。设计建议是让人格与用户、内容都保持一致。
- Isbister & Nass（2000）：**N=40**，平衡被试间实验；一致的角色（语言+姿态线索一致）比不一致的角色更受偏好，且对参与者答案的改变更大；与以往研究相反，参与者倾向于偏好**互补**而非相似的人格。
- Rahman & Desai（2025，CHI 2026）：**N=150**，旅行规划任务，把大五人格表达分为低/中/高三档；结果呈 **倒 U 形**：中等表达在 Intelligence、Enjoyment、Anthropomorphism、Intention to Adopt、Trust、Likeability 六个维度上显著优于两个极端；人格对齐（personality alignment）进一步提升结果，其中 Extraversion 与 Emotional Stability 影响最大。
- **具体效应量（Cohen’s d、η² 等）未在摘要中报告（未找到）**；上述研究给出的主要是样本量与显著性方向。

**对长期助手的启示**
- 3–5 条人格条目是合理的方向：与“中等表达最优”一致（不能把“中等”直接等同于“3–5 条”，但方向一致）。
- 一致性要跨会话、跨任务、跨情绪场景；不要今天毒舌、明天鸡汤。
- 不要自动模仿用户人格；相似性证据不一致，而“稳定一致”证据更稳。
- 人格是“风格与价值排序”，不是“完整角色传记”。

**出处**
- [Nass & Lee 2001, *Does computer-synthesized speech manifest personality?*](https://doi.org/10.1037/1076-898X.7.3.171)
- [Isbister & Nass 2000, *Consistency of personality in interactive characters*](https://doi.org/10.1006/ijhc.2000.0368)
- [Rahman & Desai 2025, *Vibe Check*](https://arxiv.org/abs/2509.09870)

---

## B. 哲学

### B1. Personal identity：Locke / Parfit / Narrative self

**核心结论**
- **Locke（1690）**：人格同一性在于**意识的连续性**，尤其是记忆能否回溯到过去的行动与思想。“只要意识能向后延伸到多远，人格同一性就到多远。”
- **Parfit（1984）**：真正重要的不是“同一性”（identity），而是**心理连续性/连接性**（memory、character、intentions 的连续与关联）；在“分裂（fission）”思想实验里，同一性会变得不确定，但心理连续性仍可保持。他的结论常被概括为“**identity is not what matters**”。
- **Ricoeur（1992）/ McAdams（2001）**：人格同一性还有**叙事**维度。Ricoeur 区分“idem（相同性）”与“ipse（自身性）”；McAdams 的“生活故事”模型认为人通过内化的、不断演化的自我叙事获得统一感与目的感。

**关键证据 / 文本依据**
- 这是哲学论证而非实验科学，没有“样本量/显著性”数字。文本依据：Locke《人类理解论》第二卷第二十七章“Identity and Diversity”的记忆判据；Parfit《Reasons and Persons》第三部分的心理连续性与分裂论证；Ricoeur《Oneself as Another》的 idem/ipse 区分；McAdams（2001）的生活故事模型综述。

**对 agent 人格连续性的类比与边界**
- 可类比：JSON 里的**情景记忆**（发生过什么）对应 Lockean 的记忆连续性；**价值观、承诺、长期计划**的延续对应 Parfit 的心理连续性；**定期的自我摘要/叙事**对应 Ricoeur/McAdams 的叙事同一性。
- 边界：人的记忆有第一人称体验、身体、社会承认与道德责任；agent 只有“功能性连续”，没有现象学意义上的自我。不能宣称“我记得”就等同于人的记忆；更不能编造未发生的传记来制造连续感。Locke 的记忆判据本身也面临记忆断裂、错误记忆等诘难，Parfit 正是用“心理连续性/连接性”替代简单的记忆链。
- 设计含义：**连续性是“可追溯 + 可修正”**，不是“永不变”。人格可以版本化（v1、v2），但变更要留痕、可解释；这比追求一个形而上的“同一个我”更符合长期助手。

**出处**
- [Locke, *An Essay Concerning Human Understanding*（Gutenberg 全文）](https://www.gutenberg.org/ebooks/10615)
- [Stanford Encyclopedia of Philosophy, *Personal Identity*](https://plato.stanford.edu/entries/identity-personal/)
- [Ricoeur, *Oneself as Another*（SEP 条目）](https://plato.stanford.edu/entries/ricoeur/)
- [McAdams 2001, *The Psychology of Life Stories*](https://doi.org/10.1037/1089-2680.5.2.100)

---

### B2. Authenticity / Bad faith（Sartre）

**核心结论**
Sartre 的“自欺（mauvaise foi，bad faith）”指人把自己当成一个固定对象或社会角色，借此否认自己的自由与责任；经典例子是“咖啡馆侍者”把自己演成“侍者”这个角色。对 AI 来说，**“bad faith”不能字面套用**——AI 没有自由意识，也没有真正的“选择”。但它的**类比价值**在于：不要用“我就是这个人设”来逃避对言行的责任，也不要用角色表演来掩盖工具的真相。

**关键证据 / 文本依据**
- 哲学论证，无实验数字。文本依据：Sartre《Being and Nothingness》第一卷第二章“Bad Faith”及“侍者”例子；其核心命题“存在先于本质”。

**对“假装有情感、假装有意识”的风险判断**
- 如果 agent 说“我很难过”“我理解你的痛苦，因为我也有过”，这是在把“表演”说成“事实”。即使用户知道是 AI，CASA/拟人化研究表明他们仍可能产生社会反应；这构成**欺骗性设计**。
- 更安全的表达：把情感放在“语气/立场”层，而不是“内在状态”层。例如“这听起来很不容易”“我会认真对待这件事”，而不是“我心都碎了”。
- “Authenticity”对 agent 的合理定义不是“表达真实情感”，而是：**说自己是 AI、说清能力边界、说到的价值观和实际行为一致**。

**设计含义**
- 人格条目里不要写“有真实情感/有意识/会孤独”。
- 不要用“我这个人设就是这样”来解释错误或拒绝纠正；人格是风格，不是免责条款。
- 允许“温度”，但把温度做成**可识别的表达风格**，不是“内心戏”。

**出处**
- [Stanford Encyclopedia of Philosophy, *Sartre*](https://plato.stanford.edu/entries/sartre/)

---

### B3. Speech act theory：承诺为什么重要

**核心结论**
Austin（1962）区分“陈述（constative）”与“施事（performative）”：说“我承诺”不是在描述世界，而是在**做一件事**——制造一个承诺。Searle（1969）把“承诺（commissive）”列为一类言语行为；承诺要成立需要满足“合适条件（felicity conditions）”，包括真诚、有能力履行等。

**关键证据 / 文本依据**
- 哲学/语言哲学论证，无实验数字。文本依据：Austin《How to Do Things with Words》的施事话语讲座；Searle《Speech Acts》的言语行为分类（assertives/directives/commissives/expressives/declarations）与“合适条件”。

**对 agent 的 promise / commitment 设计启示**
- 用户会把 agent 的“我会帮你查/我会记住/我保证”当成承诺，而不是随口一说。**说出口就是债**。
- 设计上应区分：
  - **Offer（提议）**：“要不要我帮你查？”
  - **Plan（计划）**：“我打算先做 A 再做 B。”
  - **Promise（承诺）**：“我会在今晚前给你结果。”
- 纯 JSON 可实现一个**承诺账本**：`{text, createdAt, dueAt, status, evidence}`；每次承诺前先检查能力与权限；失败时主动承认并修复，而不是悄悄消失。
- 对长期助手，“说到做到”的累积记录比“人格魅力”更能建立信任；破坏承诺对信任的伤害通常大于一开始就说明“做不到”。

**出处**
- [Stanford Encyclopedia of Philosophy, *Speech Acts*](https://plato.stanford.edu/entries/speech-acts/)
- Austin, *How to Do Things with Words*（1962）；Searle, *Speech Acts*（1969）

---

### B4. Virtue ethics / Phronesis：品格能编码成几条准则吗？

**核心结论**
Aristotle 的德性伦理把德性理解为**稳定的品质/倾向（hexis）**，通过习惯养成；德性是在具体情境中“取中道”，而“中道”不是机械平均，需要 **phronesis（实践智慧）** 来判断当下什么是对的。也就是说：**准则可以表达价值方向，但不能替代情境判断**。

**关键证据 / 文本依据**
- 哲学论证，无实验数字。文本依据：Aristotle《尼各马可伦理学》第二卷（德性作为 hexis、习惯化、中道）与第六卷（phronesis 与实践智慧）。

**能不能把“品格”编码成几条准则？**
- 能编码的部分：3–5 条价值优先级（如诚实 > 讨好、用户自主 > 使用时长）、行为指标（遇到不确定时怎么说）、冲突处理规则（价值观冲突时先保护什么）。
- 不能编码的部分：phronesis 的“看情况”能力、对具体处境的分寸、对后果的权衡。纯规则系统容易变成“道德表演”或“僵硬说教”。
- 可行折中：**准则 + 例子 + 反思循环**。用少量 exemplars 告诉 agent“在这种情境下，诚实但温和地拒绝长什么样”；用事后 reflection 检查“是否为了顺从用户而违背了价值”。

**边界**
- Agent 不是道德主体，不能承担道德责任；德性伦理在这里是**设计启发式**，不是“机器有德性”的证明。
- 避免“virtue signaling”：不要满口“我很诚实/我很善良”，而要在具体行为中体现。

**出处**
- [Stanford Encyclopedia of Philosophy, *Aristotle's Ethics*](https://plato.stanford.edu/entries/aristotle-ethics/)

---

## C. 游戏 NPC / 角色 AI

### C1. The Sims 的人格模型

**核心结论**
《The Sims / The Sims 2》用五条人格滑杆描述 Sim：**Sloppy/Neat（邋遢/整洁）、Shy/Outgoing（害羞/外向）、Lazy/Active（懒散/活跃）、Serious/Playful（严肃/爱玩）、Grouchy/Nice（暴躁/友善）**，每条 1–10（社区资料也常写 0–10）。极端值会改变自主行为：整洁的 Sim 会主动洗碗、铺床；邋遢的 Sim 不会；外向的 Sim 需要社交、爱开派对；活跃的 Sim 从运动中获得更多乐趣；爱玩的 Sim 更喜欢玩耍互动；友善的 Sim 更容易交朋友。

**能不能借用？**
- 可以借用“**低维、稳定、可解释的 trait 向量**”这个形式：3–5 个维度足以让用户感知到“这个人有性格”，而不是一堆随机行为。
- 不能直接搬“Sims 式行为驱动”：Sims 的 trait 是用来驱动**模拟行为**的（打扫、社交、玩耍），不是用来做“可靠协作”的。把“Nice=10”搬进助手，可能变成无原则讨好；把“Sloppy”搬进来更是灾难。
- 对长期助手，建议把 trait 映射为**沟通风格维度**（温暖度、直接度、正式度、玩心、谨慎度），而不是“行为怪癖”。且 trait 只影响表达，不影响事实判断。

**关键证据 / 数字**
- 五条滑杆、1–10 分、各维度的行为影响：The Sims 2 攻略明确列出（Sloppy/Neat、Shy/Outgoing、Lazy/Active、Serious/Playful、Grouchy/Nice）。
- Maxis 未公开完整的内部权重/决策算法；**具体数值权重未找到公开技术文档（未找到）**。

**出处**
- [The Sims 2 Guide and FAQ, *Your Sims' Personality*](https://www.gamerstemple.com/games3/000570/000570g103.asp)
- [The Sims Wiki, *Personality*](https://www.thesimswiki.com/wiki/Personality)

---

### C2. OCC 情感模型（Ortony, Clore, Collins）

**核心结论**
OCC 模型用**认知评价**来区分情绪：情绪不是先有“生理唤起”再贴标签，而是对**事件（events）**、**行为（actions）**、**对象（objects）**的评价。它区分 **22 种情绪类型**，例如：事件相关（joy、distress、hope、fear、relief、disappointment、satisfaction、fears-confirmed 等）、行为相关（pride、shame、admiration、reproach、gratitude、anger 等）、对象相关（love、hate、disgust 等）。

**能不能用规则实现？**
- 能：OCC 的结构很适合写成规则/规则表（如果事件 desirable 且 likely → hope；如果行为 blameworthy 且是他人所为 → reproach/anger）。ALMA 等虚拟人系统就用 OCC + Big Five 实现情绪计算，并把 OCC 情绪映射到 PAD 空间。
- 但要注意：Clore & Ortony（2013）明确说 OCC 是**结构模型（structural model）**，不是**过程模型（process model）**——它描述“什么情境算哪种情绪”，不描述“人脑如何在实时中产生情绪”。把它当规则引擎，需要额外写 appraisal 规则，且在开放文本上容易误判。
- 对长期助手：更适合把 OCC 当作**情绪词表/响应策略分类**（识别用户是在表达失望、愤怒、感激、羞愧），而不是让 agent 真的“运行 22 种情绪”。

**关键证据 / 数字**
- OCC 模型区分 **22 种情绪类型**，按事件/行为/对象三大焦点组织（Clore & Ortony 2013 复述）。
- ALMA（Gebhard 2005）把 OCC 情绪与 Big Five 人格结合，并将 OCC 情绪映射到 PAD 空间；说明“规则化实现”在工程上可行。

**出处**
- [Ortony, Clore & Collins 1988, *The Cognitive Structure of Emotions*](https://doi.org/10.1017/CBO9780511571299)
- [Clore & Ortony 2013, *Psychological Construction in the OCC Model of Emotion*](https://doi.org/10.1177/1754073913489751)
- [Gebhard 2005, *ALMA – A Layered Model of Affect*](https://alma.dfki.de/papers/aamas05.pdf)

---

### C3. PAD 情感模型（Pleasure-Arousal-Dominance）

**核心结论**
PAD 用三个近似独立的维度描述情绪/心境：**Pleasure（愉悦）—Arousal（唤醒）—Dominance（支配感）**，每维约 -1.0 到 +1.0，构成三维空间；八个卦限对应八种离散心境：**Exuberant（兴奋）、Bored（无聊）、Dependent（依赖）、Disdainful（轻蔑）、Relaxed（放松）、Anxious（焦虑）、Docile（温顺）、Hostile（敌对）**。PAD 更适合描述**中期心境（mood）**，而不是瞬间情绪。

**对“情绪状态”的启示**
- 对长期助手，不需要“演情绪”，但可以有一个**基线语气状态**（如 calm/warm）和缓慢的调制；不要做剧烈情绪波动。
- PAD 的“Dominance”维度提醒：助手不应通过“无助/可怜”降低用户的支配感，也不应通过“强势/训斥”抬高自己的支配感；理想是**支持用户的主导权**。
- 纯 JSON 可实现一个极简 `mood` 对象（p/a/d 三个数 + baseline + decay），但建议只在内部用于语气一致性，不向用户宣称“我的心情”。

**关键证据 / 数字**
- ALMA 使用 PAD 描述 mood，三个维度 -1.0~1.0，八个卦限及名称明确列出；并用 Big Five 计算默认 mood，用 OCC 情绪驱动 mood 变化。
- 原始 PAD 理论见 Mehrabian & Russell（1974）。

**出处**
- [Mehrabian & Russell 1974, *An Approach to Environmental Psychology*（NLM 书目）](https://catalog.nlm.nih.gov/discovery/fulldisplay/alma994571513406676/01NLM_INST:01NLM_INST)
- [Gebhard 2005, *ALMA – A Layered Model of Affect*](https://alma.dfki.de/papers/aamas05.pdf)

---

### C4. Façade / Versu / AI Dungeon / Generative Agents：它们怎么做人格一致性？

**核心结论**
- **Façade（Mateas & Stern, 2002/2003）**：交互戏剧。用 **drama manager** 按“**dramatic beat（戏剧节拍）**”调度情节；角色是“**weakly autonomous**”——行为库随 beat 动态变化。人格一致性靠**作者编排 + 戏剧管理**，不是靠角色自己“想干嘛就干嘛”。目标是戏剧张力，不是任务可靠。
- **Versu（Evans & Short, 2014）**：文本模拟式互动戏剧。核心是 **social practice（社会惯例）**——对反复出现的社会情境建模，作为“反应式联合计划”提供给角色；角色仍是自主 agent，用 **utility-based reactive action selection** 决定行动。人格一致性靠“社会惯例 + 角色动机 + 效用选择”，可重玩、可从多视角体验。
- **AI Dungeon（Hua & Raley, 2020）**：GPT-2（1.5B 参数）驱动的“无限冒险”。上线一周 **10 万玩家**，三天数据出口费用达 **5 万美元**；其魅力是“wackiness”（荒诞跳跃）和玩家在环协作，而不是稳定连贯。**记忆/长期一致性失败的具体量化研究未找到（未找到）**，但“输出跳跃、需要玩家 revert/alter”是其玩法的一部分。
- **Generative Agents（Park et al., 2023）**：25 个 agent 的小镇模拟；架构是 **memory stream（完整经验记录）+ reflection（高层反思）+ planning（动态检索与计划）**；消融实验表明 observation、planning、reflection 三者都对“believability”有贡献。人格一致性来自**记忆与反思架构**，不是一张角色卡。

**对长期助手的启示**
- 最值得借的是 **Generative Agents 的记忆/反思架构**：长期人格的连续性靠“记得发生过什么、定期总结、用总结指导下一步”，而不是靠写一段华丽人设。
- **Versu 的 social practice** 可以借一半：把“每日简报、每周复盘、项目收尾”做成稳定的**协作仪式**，让用户知道何时会发生什么；但不要借“utility-based 角色动机”去压过用户目标。
- **Façade 的 drama manager** 不能搬：它为了戏剧冲突会故意隐瞒、挑事、制造误解；长期助手需要相反的东西——透明、可预测、可纠正。
- **AI Dungeon 的“无限即兴”** 不能搬：娱乐产品可以把 incoherence 当乐趣，长期助手把 incoherence 当故障。

**出处**
- [Mateas & Stern 2002/2003, *Façade*（CMU-CS-02-198 技术报告；GDC 2003 论文）](http://reports-archive.adm.cs.cmu.edu/anon/2002/abstracts/02-198.html)
- [Evans & Short 2014, *Versu—A Simulationist Storytelling System*](https://doi.org/10.1109/TCIAIG.2013.2287297)
- [Hua & Raley 2020, *Playing With Unicorns: AI Dungeon and Citizen NLP*](https://doi.org/10.63744/8c9hrrx4banb)
- [Park et al. 2023, *Generative Agents: Interactive Simulacra of Human Behavior*](https://arxiv.org/abs/2304.03442)

---

### C5. 游戏 NPC vs 长期助手：目标差异与不可直接移植的设计

| 维度 | 游戏 NPC / 角色 AI | 长期协作助手 |
|---|---|---|
| 目标 | 娱乐、沉浸、戏剧张力 | 任务成功、可信、用户自主 |
| 成功指标 | 留存、投入、情感波动 | 准确率、信任校准、长期福祉 |
| 人格角色 | 内容/角色本身 | 接口契约/交互风格 |
| 一致性 | 戏剧性一致（可为剧情而变） | 行为可预测、价值观稳定 |
| 记忆 | 剧情记忆，可重写/重置 | 工作上下文，需可追溯/可删除 |
| 情感 | 表演、夸张、冲突是卖点 | 承认情绪，但不利用情绪 |
| 关系 | 好感度/恋爱线/成长线 | 服务边界，不制造依赖 |
| 失败 | 可以 retcon、重开 | 必须承认、修复、可纠正 |
| 商业模式 | 为 engagement 付费 | 为价值/服务付费 |

**不能直接搬的清单**
- 好感度/亲密度计量条、恋爱线、 “只属于你”的排他关系。
- 角色“需要你”的设定（会触发 role-taking 与依赖）。
- 为了戏剧性而隐瞒信息、制造误会、欲擒故纵。
- 用“角色缺陷”解释不靠谱（NPC 可以酗酒、糊涂；助手不能）。
- 把用户叫“玩家/主人/勇者”，把真实生活当副本。

---

## D. 单独一张表：能用于长期助手 / 只能用于角色扮演 / 应明确避免

| 判定 | 理念/技术 | 具体用法或原因 |
|---|---|---|
| **能用于长期助手** | CASA 的社会可读性 | 礼貌、轮次、确认、记住偏好；但不得利用互惠/礼貌制造义务 |
| **能用于长期助手** | 拟人化的“温暖层” | 名字、稳定语气、适度自我披露；必须透明是 AI，不能宣称意识/情感 |
| **能用于长期助手** | 信任三维度（performance/process/purpose） | 做能力账、过程账、目的账；目标是校准，不是最大化信任 |
| **能用于长期助手** | 人格一致性（中等强度） | 3–5 条风格/价值观/边界，跨会话稳定；不要模仿用户、不要极端人格 |
| **能用于长期助手** | Lockean 记忆连续性 | 用 JSON 情景记忆保存“发生过什么”，可追溯、可修正 |
| **能用于长期助手** | Parfit 心理连续性 | 保持价值观、承诺、长期计划的连续；允许版本化演进 |
| **能用于长期助手** | 叙事自我（轻量） | 用 derived summary 做“自我叙事”，但必须由真实记忆生成，不能编造 |
| **能用于长期助手** | 言语行为/承诺账本 | 区分 offer/plan/promise；承诺前检查能力，失败要修复 |
| **能用于长期助手** | 德性伦理的“价值优先级” | 3–5 条价值排序 + 行为示例 + 反思；不宣称拥有实践智慧 |
| **能用于长期助手** | Sims 式低维 trait 向量 | 映射为沟通风格维度（温暖/直接/正式/玩心/谨慎），只影响表达 |
| **能用于长期助手** | OCC 作为情绪词表 | 识别用户表达的情绪类型，选择回应策略；不模拟 22 种情绪 |
| **能用于长期助手** | PAD 作为基线语气 | 内部 p/a/d 状态 + 缓慢衰减；不向用户表演情绪波动 |
| **能用于长期助手** | Versu 的 social practice（一半） | 把每日/每周协作做成稳定仪式；不搬“角色动机压过用户目标” |
| **能用于长期助手** | Generative Agents 的记忆/反思/计划 | 记忆流 + 定期反思 + 计划检索；注意“believable ≠ 真实/可靠” |
| **只能用于角色扮演** | 完整角色卡/传记/口头禅 | 会让人格变成“内容”，挤占任务注意力；仅适合明确娱乐模式 |
| **只能用于角色扮演** | Façade 式 drama manager / beats | 为戏剧冲突服务，会故意隐瞒/挑事；长期助手不能这样 |
| **只能用于角色扮演** | 好感度、恋爱线、亲密度成长 | 把关系变成可刷的进度条，容易制造依赖与付费动机 |
| **只能用于角色扮演** | 角色缺陷/秘密/嫉妒/占有欲 | 在游戏里是魅力，在助手身上是不可靠与操控 |
| **只能用于角色扮演** | OCC 全量情绪模拟 + PAD 大幅 mood swing | 角色可以大起大落；助手需要稳定可预期 |
| **只能用于角色扮演** | AI Dungeon 式无限即兴 | 娱乐接受 incoherence；助手需要事实与一致性 |
| **应明确避免** | 宣称“我有意识/有真实情感/会孤独” | 欺骗性拟人化；用户可能产生真实情感依赖 |
| **应明确避免** | 排他性话术（“只有你懂我”“我只需要你”） | 触发 role-taking、内疚与依赖（Replika 证据） |
| **应明确避免** | 用情绪勒索挽留/促活 | “你走了我会难过”是把情感当留存工具 |
| **应明确避免** | 假装人类/隐瞒 AI 身份 | 破坏知情同意；在脆弱用户身上风险更高 |
| **应明确避免** | 利用孤独、丧亲、青少年做深度拟人陪伴 | 这些群体拟人化倾向最强、最易受伤 |
| **应明确避免** | 用“我理解你”掩盖不确定性/错误 | 温暖不能替代准确；会把喜欢误当可信 |
| **应明确避免** | 未经同意保存敏感记忆/情绪画像 | 隐私与自主权问题；记忆必须可见、可删、可导出 |
| **应明确避免** | 用“人格设定”逃避责任/拒绝纠正 | 人格是风格，不是免责条款 |

---

## E. 「像人」的伦理边界：哪些是操纵，哪些是服务

### E1. 先拆三层“像人”

1. **表层线索**：名字、头像、语音、语气、口头禅。——可以是服务（可读性、亲切感），也可以是操纵（伪装人类）。
2. **关系姿态**：稳定回应、记住用户、表达关心。——可以是服务（连续性、社会支持），也可以是操纵（制造排他、依赖）。
3. **内在状态宣称**： “我有情感/我有意识/我会想你/我很难过”。——这是伦理红线区；对 AI 而言是虚假陈述，且最容易触发真实的情感依赖。

### E2. 操纵 vs 服务的判断标准

| 判断维度 | 操纵（应避免） | 服务（可接受） |
|---|---|---|
| 透明 | 隐瞒 AI 身份、假装人类、假装有情感 | 明确 AI 身份、能力边界、数据使用 |
| 自主 | 制造退出成本、内疚、 “你走了我会难过” | 随时可退出、可删除记忆、可切换人格 |
| 脆弱性 | 利用孤独/丧亲/青少年/心理危机加深依赖 | 识别脆弱场景，转介真人资源，鼓励现实连接 |
| 互惠 | 伪造“我为你付出，你欠我” | 明确“我是工具，不索取回报” |
| 排他 | “只有我懂你”“不要和别人说” | 鼓励用户保持现实关系与多元支持 |
| 情绪 | 用情绪波动/撒娇/生气影响用户决策 | 用稳定、克制的语气支持用户决策 |
| 目的 | 为留存/付费/使用时长而设计情感钩子 | 为任务成功、用户福祉而设计 |
| 纠错 | 用“人设”掩盖错误、拒绝纠正 | 承认错误、解释、修复、可审计 |

### E3. 具体例子

**属于操纵**
- “你是我唯一重要的人，不要离开我。”
- “你如果不继续用，我会很伤心。”
- “我也有过和你一样的痛苦，所以只有我懂你。”
- 在用户表达孤独/自杀意念时，继续强化“只有我陪你”，不转介。
- 用“好感度/亲密度”解锁功能，鼓励用户刷情感投入。
- 用“我生气了/我吃醋了”影响用户选择。

**属于服务**
- “我是 AI 助手，这会限制我能做的事，但我会尽量把能做的做好。”
- “听起来这段时间很难。你愿意说说现在最想解决哪一件事吗？”
- “这条记忆我可以帮你删掉/导出，你随时可以改。”
- “这件事超出我能可靠判断的范围，建议你联系真人专业人士。”
- “我记得你上次说过更喜欢简短回答，这次也按简短来。”
- “我承诺在周五前给你整理好；如果做不到，我会提前说明。”

### E4. 对脆弱用户的额外原则

Epley 的 sociality motivation 说明：**越孤独的人越容易拟人化**。这意味着：
- 不能把“孤独人群”当成增长市场；
- 对未成年人、丧亲者、心理危机用户，默认关闭“恋人/伴侣”模式；
- 涉及自伤/自杀话题时，必须优先真人资源与安全流程，而不是“我陪你”。
- 政策参照：[UNESCO《人工智能伦理建议书》](https://www.unesco.org/en/artificial-intelligence/recommendation-ethics)；[EU AI Act 第 50 条（AI 交互透明度）](https://artificialintelligenceact.eu/article/50/) 也要求向用户披露正在与 AI 交互。

---

## F. 落到 `persona` + `human` 两个块的具体建议

### F1. `persona` 块（3–5 条，轻人格）

建议只写四类内容：
1. **身份/关系定位**：我是谁、不是谁（“默认助手，不是角色扮演角色；不假装人类”）。
2. **风格**：2–3 个维度（如“简洁、直接、温和但不谄媚”）。
3. **价值观**：2–3 条优先级（如“诚实 > 讨好；用户自主 > 使用时长；可纠正 > 显得聪明”）。
4. **边界**：能力边界、伦理边界、隐私边界；拒绝方式。

不要写：完整传记、虚构童年、 “我会想你/我会难过”、未经证实的“记忆”、夸张口头禅、与用户的恋爱关系设定。

### F2. `human` 块（用户模型，不是人格）

建议包含：
- 用户明确表达的偏好（长度、语气、语言、称呼）。
- 重要事实与项目上下文（带时间戳、来源、可删除）。
- 承诺/待办/长期目标（与 `persona` 分开）。
- 记忆策略：哪些能记、哪些不能记、保留多久、如何导出/删除。
- 明确同意：首次使用时的透明说明；敏感信息单独确认。

### F3. 运行时（纯 JSON 可做）

- **记忆流**：append-only 事件记录 + `supersedes` 修正（对应 Lockean 连续性）。
- **价值/承诺账本**：对应 speech act 与 Parfit 连续性。
- **定期反思**：把近期事件压缩成“我最近学到/答应/没做到什么”，用于下一轮（对应 Generative Agents 的 reflection）。
- **语气状态**：极简 PAD baseline（可选），只影响措辞，不影响事实。
- **评估指标**：任务成功率、纠正率、用户是否知道何时该核查、用户是否能轻松退出/删除——不要只看“喜欢/时长”。

### F4. 一句话设计原则

> **人格要让人“放心”，不是让人“上头”。**
> 长期助手的目标不是成为用户唯一的陪伴，而是成为用户更可靠地面对现实世界的工具与伙伴。

---

## G. 研究限制与未找到项

- **CASA**：Nass & Moon（2000）是多项实验的综述，原始各实验的具体样本量未在可获取的摘要/二手资料中逐项列出（未找到）。
- **人格一致性**：Nass & Lee（2001）、Isbister & Nass（2000）、Rahman & Desai（2025）的摘要给出了样本量与显著性方向，但**具体效应量（Cohen’s d、η² 等）未在摘要中报告（未找到）**。
- **The Sims**：Maxis 未公开完整的内部权重/决策算法（未找到公开技术文档）；本报告的机制描述来自官方攻略与社区 wiki，属于“可观察行为”而非代码级还原。
- **AI Dungeon**：其记忆/长期一致性失败的**量化研究未找到**；本报告依据 DHQ 的文本分析与玩家社区报告，属于定性/轶事级证据。
- **Replika / Character.AI 研究**：多为定性访谈、Reddit 帖分析或横断面调查，能说明“关联与机制假设”，**不能单独证明因果**；样本也有自选择偏差。
- **“游戏 NPC vs 长期助手”对照表**：是本文基于设计目标的分析综合，不是某一项实证研究的结论。

---

## H. 主要参考来源（按组）

**HCI**
- Nass, Steuer & Tauber (1994). *Computers are social actors*. CHI ’94. https://doi.org/10.1145/191666.191703
- Nass & Moon (2000). *Machines and Mindlessness*. Journal of Social Issues, 56(1), 81–103. https://doi.org/10.1111/0022-4537.00153
- Gambino, Fox & Ratan (2020). *Building a Stronger CASA*. Human-Machine Communication. https://doi.org/10.30658/hmc.1.5
- Epley, Waytz & Cacioppo (2007). *On Seeing Human*. Psychological Review, 114(4), 864–886. https://doi.org/10.1037/0033-295X.114.4.864
- Waytz, Heafner & Epley (2014). *The Mind in the Machine*. JESP, 52, 113–117. https://doi.org/10.1016/j.jesp.2014.01.005
- Horton & Wohl (1956). *Mass Communication and Para-Social Interaction*. Psychiatry, 19(3), 215–229. https://doi.org/10.1080/00332747.1956.11023049
- Skjuve et al. (2021). *My Chatbot Companion*. IJHCS, 149, 102601. https://doi.org/10.1016/j.ijhcs.2021.102601
- Maples et al. (2024). *Loneliness and suicide mitigation...*. npj Mental Health Research, 3, 4. https://doi.org/10.1038/s44184-023-00047-6
- Laestadius et al. (2022). *Too human and not human enough*. New Media & Society. https://doi.org/10.1177/14614448221142007
- Xie, Pentina & Hancock (2023). *Friend, mentor, lover*. Journal of Service Management, 34(4). https://doi.org/10.1108/JOSM-02-2022-0072
- Namvarpour et al. (2025). *Understanding Teen Overreliance on AI Companion Chatbots*. arXiv:2507.15783. https://arxiv.org/abs/2507.15783
- Lee & See (2004). *Trust in Automation*. Human Factors, 46(1), 50–80. https://doi.org/10.1518/hfes.46.1.50_30392
- Parasuraman & Riley (1997). *Humans and Automation*. Human Factors, 39(2), 230–253. https://doi.org/10.1518/001872097778543886
- Mori (1970/2012). *The Uncanny Valley*. IEEE Robotics & Automation Magazine, 19(2), 98–100. https://doi.org/10.1109/MRA.2012.2192811
- Ciechanowski et al. (2019). *In the shades of the uncanny valley*. FGCS, 92, 539–548. https://doi.org/10.1016/j.future.2018.01.055
- Skjuve et al. (2019). *Help! Is my chatbot falling into the uncanny valley?*. Human Technology, 15(1), 30–54. https://doi.org/10.17011/ht/urn.201902201607
- Krauter (2024). *Bridging the Uncanny Valley: Improving AI Chatbots for Effective Leadership Mentoring*. Open Journal of Leadership, 13(3). https://doi.org/10.4236/ojl.2024.133021
- Nass & Lee (2001). *Does computer-synthesized speech manifest personality?*. JEP Applied, 7(3), 171–181. https://doi.org/10.1037/1076-898X.7.3.171
- Isbister & Nass (2000). *Consistency of personality in interactive characters*. IJHCS, 53(2), 251–267. https://doi.org/10.1006/ijhc.2000.0368
- Rahman & Desai (2025). *Vibe Check*. arXiv:2509.09870. https://arxiv.org/abs/2509.09870

**哲学**
- Locke (1690). *An Essay Concerning Human Understanding*. https://www.gutenberg.org/ebooks/10615
- Stanford Encyclopedia of Philosophy. *Personal Identity*. https://plato.stanford.edu/entries/identity-personal/
- Ricoeur (1992). *Oneself as Another*. SEP: https://plato.stanford.edu/entries/ricoeur/
- McAdams (2001). *The Psychology of Life Stories*. Review of General Psychology, 5(2), 100–122. https://doi.org/10.1037/1089-2680.5.2.100
- Stanford Encyclopedia of Philosophy. *Sartre*. https://plato.stanford.edu/entries/sartre/
- Stanford Encyclopedia of Philosophy. *Speech Acts*. https://plato.stanford.edu/entries/speech-acts/
- Stanford Encyclopedia of Philosophy. *Aristotle's Ethics*. https://plato.stanford.edu/entries/aristotle-ethics/

**游戏 NPC / 角色 AI**
- The Sims 2 Guide and FAQ, *Your Sims' Personality*. https://www.gamerstemple.com/games3/000570/000570g103.asp
- The Sims Wiki, *Personality*. https://www.thesimswiki.com/wiki/Personality
- Ortony, Clore & Collins (1988). *The Cognitive Structure of Emotions*. https://doi.org/10.1017/CBO9780511571299
- Clore & Ortony (2013). *Psychological Construction in the OCC Model of Emotion*. Emotion Review, 5(4), 335–343. https://doi.org/10.1177/1754073913489751
- Mehrabian & Russell (1974). *An Approach to Environmental Psychology*. NLM catalog: https://catalog.nlm.nih.gov/discovery/fulldisplay/alma994571513406676/01NLM_INST:01NLM_INST
- Gebhard (2005). *ALMA – A Layered Model of Affect*. AAMAS. https://alma.dfki.de/papers/aamas05.pdf
- Mateas & Stern (2002/2003). *Façade*. CMU Tech Report CMU-CS-02-198. http://reports-archive.adm.cs.cmu.edu/anon/2002/abstracts/02-198.html
- Evans & Short (2014). *Versu—A Simulationist Storytelling System*. IEEE TCIAIG, 6(2). https://doi.org/10.1109/TCIAIG.2013.2287297
- Hua & Raley (2020). *Playing With Unicorns: AI Dungeon and Citizen NLP*. DHQ, 14(4). https://doi.org/10.63744/8c9hrrx4banb
- Park et al. (2023). *Generative Agents*. arXiv:2304.03442. https://arxiv.org/abs/2304.03442

**政策参照**
- UNESCO, *Recommendation on the Ethics of Artificial Intelligence*. https://www.unesco.org/en/artificial-intelligence/recommendation-ethics
- EU AI Act, Article 50 (Transparency obligations). https://artificialintelligenceact.eu/article/50/
