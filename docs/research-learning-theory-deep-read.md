# 自我学习 Agent 的跨学科理论深读

> 调研对象：零依赖、纯 JSON、本地运行的中文长期助手插件（cognition-engine / playbook 线）
> 日期：2026-11-05
> 目的：只保留能变成代码、字段、流程、审计规则的机制；教科书摘要和流行心理学一律降级或剔除。
> 阅读顺序：先看第 0 节结论与第 8 节七条准则；A–G 是证据底稿。

## 0. 结论先行

1. **学习循环不要设计成「发现错误 → 立刻改规则」**。控制论给出的第一原则是稳定性：必须有设定点、死区、连续确认、变化限幅、冷却期和回滚；否则延迟反馈会把系统推入振荡。不需要 PID，EMA + 死区/迟滞 + CUSUM 就够。
2. **记忆要分快慢两层**：事件日志全量、追加、可追溯；规则（准则）慢速晋升、带证据、可废弃。这是 CLS / 系统巩固理论最可直接落地的部分。
3. **规则修订按「再巩固边界」处理**：只有最近使用且出现预测误差（用户明确纠正、任务失败）的规则才进入修订窗口；旧规则需要更多独立证据；任何修改保留旧版本并可回滚。
4. **复习用间隔 + 主动提取，不用重读**；反馈用形成性、任务级、可行动的反馈，不用「你真棒」这类自我层评价。
5. **学习预算用探索-利用 + 边际收益停止规则**；新规则先 shadow 运行，再晋升；候选验证必须用冻结留出集、反指标和多候选多样性，防止 Goodhart / 奖励黑客。
6. **安全上最大的四个风险**：指标被博弈（Goodhart）、规格游戏（reward hacking）、谄媚（sycophancy）、能力侵蚀（灾难性遗忘 / model collapse）。对应规则是：多指标 + 审计链 + 人工闸门 + 固定回归测试 + 谄媚检测。

---

## A. 控制论 / 系统论

> 本段回答：学习循环怎么设计才不「过度纠正/振荡」；不用 PID 可借哪些数学形式。

### A1. 闭环反馈、设定点与误差修正
- **核心结论**：负反馈 = 测量输出 → 与设定点比较 → 按误差修正。开环系统无法纠正未建模的扰动；反馈的代价是延迟和可能的振荡。Conant & Ashby 的定理：任何好的调节器都必须是其所调节系统的模型——对 Agent 来说，学习规则必须显式引用「用户/任务当前状态」，不能只记录动作。
- **关键实验/数字**：Cannon（1929）在生理学中提出 homeostasis（内稳态）；Ashby（1956）提出 requisite variety（调节器的多样性必须不小于扰动的多样性）。这是理论/工程结论，**未找到单一对照实验的效应量**。
- **对 Agent 的含义**：每个学习动作都要能回答「目标是什么、当前偏差多少、这次改动预期把偏差降低多少」；没有 setpoint 的「学习」只是日志堆积。
- **出处**：[Cannon 1929](https://doi.org/10.1152/physrev.1929.9.3.399) · [Ashby 1956 全文](https://pespmc1.vub.ac.be/ASHBBOOK.html) · [Conant & Ashby 1970](https://doi.org/10.1080/00207727008920220)

### A2. 前馈 vs 反馈
- **核心结论**：前馈在误差出现前动作，依赖可预测的模型；反馈在误差出现后动作，但受时滞限制。只有反馈会在延迟系统上振荡；只有前馈会在模型错误时产生系统性偏差。正确做法是「前馈做粗调，反馈做精修」。
- **关键实验/数字**：控制工程教材结论；延迟 T 在频率 ω 处产生相位滞后 φ = ωT，穿越频率处相位裕度不足就会振荡。**未找到 Agent 场景的直接实验**。
- **对 Agent 的含义**：行动前用 checklist / 规则预检（前馈），行动后用结果审计（反馈）；不要把「用户上次这么说」当成永久模型。
- **出处**：[Åström & Murray, Feedback Systems（免费教材）](https://press.princeton.edu/books/hardcover/9780691193984/feedback-systems)

### A3. 稳定性 vs 可塑性（stability-plasticity dilemma）
- **核心结论**：可塑性太强，学新会覆盖旧（灾难性遗忘）；太稳定，无法适应新情况。Grossberg 的 ART 用 vigilance 参数控制「新输入与旧模式的相似度阈值」：高于阈值就更新旧类别，低于阈值就新建类别——这是一个可直接借用的门控参数。
- **关键实验/数字**：Grossberg（1987）的 ART 模型；McCloskey & Cohen（1989）展示连接主义网络顺序学习时旧知识被严重干扰。ART 的 vigilance ρ∈[0,1]；ρ 越高越保守（新建类别多），ρ 越低越可塑（合并多）。**具体最优 ρ 依任务而定，没有普适值**。
- **对 Agent 的含义**：为不同记忆设置不同 `vigilance`：用户身份/偏好/边界用高阈值（不轻易改），临时事实用低阈值（可快速合并）。
- **出处**：[Grossberg 1987](https://doi.org/10.1111/j.1551-6708.1987.tb00862.x) · [Carpenter & Grossberg 1987](https://doi.org/10.1016/S0734-189X(87)80014-2) · [McCloskey & Cohen 1989](https://doi.org/10.1016/S0079-7421(08)60536-8)

### A4. 一阶/二阶控制与延迟反馈的振荡
- **核心结论**：一阶系统（RC、EMA）无超调但响应慢；二阶系统有惯性，阻尼比 ζ<1 会振荡、ζ≈1 为临界阻尼、ζ>1 为过阻尼。延迟会吃掉相位裕度，高增益 + 延迟是最常见的振荡来源。
- **关键实验/数字**：控制工程经验值：相位裕度约 45°–60°、增益裕度约 6–10 dB 是常见设计目标；这些是工程实践值，不是自然定律。**未找到 Agent 学习的直接实验**。
- **对 Agent 的含义**：不要「一次改很多」；用变化限幅（max_delta_per_cycle）、冷却期（cooldown）、临界阻尼式更新（EMA α≈0.2）代替高增益修正。
- **出处**：[Åström & Murray, Feedback Systems](https://press.princeton.edu/books/hardcover/9780691193984/feedback-systems)

### A5. 非 PID 的数学工具箱：死区 / 迟滞 / EMA / CUSUM
- **核心结论**：对离散、噪声大、反馈延迟长的 Agent 学习，PID 的积分项会 wind-up、微分项放大噪声。更稳的组合是：死区（deadband）过滤小误差；迟滞（hysteresis）防止阈值附近反复切换；EMA 平滑信号（m_t = α·x_t + (1−α)·m_{t−1}，α 取 0.1–0.3）；CUSUM 检测持续漂移。
- **关键实验/数字**：CUSUM 由 Page（1954）提出，用于检测均值漂移；统计量 g_t = max(0, g_{t−1} + (|e_t| − k))，g_t > h 报警。k 是允许的噪声斜率，h 是报警阈值。**无 Agent 场景实验；属统计过程控制的标准方法**。
- **对 Agent 的含义**：`if |error| < deadband: no-op`；`if error crosses on_threshold for N windows: propose change`；`if error falls below off_threshold: stop`；只有 CUSUM 报警才说明是「持续变差」而不是单次噪声。
- **出处**：[Page 1954](https://doi.org/10.1093/biomet/41.1-2.100) · [Åström & Murray](https://press.princeton.edu/books/hardcover/9780691193984/feedback-systems)

---

## B. 神经科学 / 学习记忆

> 本段回答：哪些机制能映射到「记忆巩固 / 回归审计 / 新旧能力平衡」。

### B1. 长时程增强（LTP）
- **核心结论**：高频刺激可使突触传递持久增强，是「共同激活的连接会变强」的细胞层面证据。对 Agent 的启发是 Hebbian 式关联权重：两个规则/记忆被一起成功使用，就提高它们的关联权重；但必须有上限和衰减，否则会饱和。
- **关键实验/数字**：Bliss & Lømo（1973）在麻醉兔的齿状回/穿通纤维上实验：18 只兔中 15 只在条件刺激后出现 30 分钟到 10 小时的增强；条件刺激为 10–20 Hz、10–15 秒或 100 Hz、3–4 秒。
- **对 Agent 的含义**：可做「共现成功计数 → 关联权重」；但权重只影响检索排序，不直接改事实真值；权重需随长期不用衰减。
- **出处**：[Bliss & Lømo 1973](https://doi.org/10.1113/jphysiol.1973.sp010273)

### B2. 突触稳态（SHY hypothesis）
- **核心结论**：清醒期学习总体增强突触，睡眠期通过下调（downscaling）把总突触强度拉回基线，防止饱和并保留信噪比；慢波活动（SWA）是这一过程的稳态指标。对 Agent 的启发是「定期归一化」：夜间/空闲时对重要度和关联权重做全局缩放，而不是删除内容。
- **关键实验/数字**：Tononi & Cirelli（2006）综述提出 SHY；Huber et al.（2004，Nature）发现学习特定任务后，对应皮层区域的局部慢波活动在随后睡眠中升高。**SHY 是强理论假说，但“睡眠即学习”不能直接等同于定时任务**。
- **对 Agent 的含义**：夜间 consolidation 时只衰减 `salience/activation` 等临时权重；`content`、`evidence`、用户原始数据永不删除；全局归一化保持总量稳定。
- **出处**：[Tononi & Cirelli 2006](https://doi.org/10.1016/j.smrv.2005.05.002) · [Tononi & Cirelli 2014](https://doi.org/10.1016/j.neuron.2013.12.025) · [Huber et al. 2004](https://doi.org/10.1038/nature02663)

### B3. 系统巩固与睡眠重放
- **核心结论**：海马快速编码情景记忆，皮层以较慢速度抽取统计结构；睡眠中的重放（replay）把新记忆与旧知识交错整合，避免新知识覆盖旧结构。这就是互补学习系统（CLS）的核心：快系统学单个经验，慢系统学共性。
- **关键实验/数字**：Wilson & McNaughton（1994）在 3 只大鼠记录海马 place cells：行为中一起放电的细胞在随后慢波睡眠中更倾向一起放电；McClelland et al.（1995）模型显示，逐项学习会导致灾难性干扰，交错学习才能发现结构。Kumaran et al.（2016）更新了 CLS，强调 replay、episodic memory 与生成模型。
- **对 Agent 的含义**：事件日志（快）→ 定期 consolidation（慢）；重放要「交错」：新规则和旧案例混合复习，不能只学新东西。
- **出处**：[Wilson & McNaughton 1994](https://doi.org/10.1126/science.8036517) · [McClelland et al. 1995](https://doi.org/10.1037/0033-295X.102.3.419) · [Kumaran et al. 2016](https://doi.org/10.1016/j.tics.2016.05.004) · [Squire & Alvarez 1995](https://doi.org/10.1016/0959-4388(95)80023-9)

### B4. 再巩固（reconsolidation）的边界条件
- **核心结论**：已巩固的记忆在被提取并遇到预测误差时会短暂变得可修改，需要新的蛋白质合成来再稳定；但不是所有提取都会触发再巩固——越旧、越强、越自动化的记忆越不容易进入该状态。人类证据比动物证据弱且争议大。
- **关键实验/数字**：Nader et al.（2000）：大鼠恐惧记忆在条件化后 1 天或 14 天提取，随后向杏仁核注射 anisomycin 均导致后续测试失忆；延迟到提取后 6 小时注射则无效。Milekic & Alberini（2002）：只有近期记忆在提取后需要蛋白质合成，记忆越旧越不易被破坏。Elsey et al.（2018）系统综述：人类再巩固证据「viable but hotly contested」。
- **对 Agent 的含义**：只有「最近使用（如 30 天内）+ 出现明确预测误差（用户纠正/任务失败）」的规则进入修订窗口；旧规则需要更多独立证据；修订前先记录旧版本。
- **出处**：[Nader et al. 2000](https://doi.org/10.1038/35021052) · [Milekic & Alberini 2002](https://doi.org/10.1016/S0896-6273(02)00976-5) · [Elsey et al. 2018](https://doi.org/10.1037/bul0000152)

### B5. 灾难性遗忘与互补学习系统（CLS）
- **核心结论**：连接主义网络顺序学习新任务会严重覆盖旧任务（catastrophic forgetting）；EWC 通过保护「对旧任务重要的权重」来减缓遗忘。对 Agent 的启发：给每条规则一个「稳定度」权重，更新步长与历史成功次数成反比；同时交错复习旧案例。
- **关键实验/数字**：McCloskey & Cohen（1989）首次系统展示顺序学习中的灾难性干扰；Kirkpatrick et al.（2017，PNAS）的 EWC 在多个手写数字分类任务和多个 Atari 游戏顺序学习上保持旧任务性能。**具体保护强度需要按任务调参，没有通用值**。
- **对 Agent 的含义**：`stability = 1 + log(1 + successCount)`；更新幅度 `delta = baseDelta / stability`；高稳定规则只能由人工或强证据修改。
- **出处**：[McCloskey & Cohen 1989](https://doi.org/10.1016/S0079-7421(08)60536-8) · [Kirkpatrick et al. 2017](https://doi.org/10.1073/pnas.1611835114)

---

## C. 心理学

> 本段回答：哪些能用于「准则学习 / 复习 / 降级」；哪些是流行心理学、不能信。

### C1. 刻意练习（Ericsson）
- **核心结论**：有效练习不是简单重复，而是四个条件同时满足：① 有明确目标的任务；② 即时、信息性反馈；③ 可重复并纠正错误；④ 有教练/专家指导。所谓「10,000 小时定律」是对原研究的流行化误读。
- **关键实验/数字**：Ericsson et al.（1993）研究柏林音乐学院小提琴手（三组各 10 人）：顶级组到 20 岁累计练习约 10,000 小时，教师组约 4,600 小时（回顾性估计）。Macnamara et al.（2014）元分析：刻意练习解释绩效方差——游戏 26%、音乐 21%、体育 18%、教育 4%、职业 <1%。Macnamara & Maitra（2019）直接复现未复现原研究的核心排序。
- **对 Agent 的含义**：只对「有明确成功标准 + 能快速验证」的规则做刻意练习；模糊的「变得更好」不进入练习队列。
- **出处**：[Ericsson et al. 1993](https://doi.org/10.1037/0033-295X.100.3.363) · [Macnamara et al. 2014](https://doi.org/10.1177/0956797614535810) · [Macnamara & Maitra 2019](https://doi.org/10.1098/rsos.190327)

### C2. 形成性反馈 vs 总结性反馈
- **核心结论**：形成性反馈在学习过程中给，具体、可行动、指向任务或过程；总结性反馈在结束时给判断。反馈并不总是正向：表扬型、自我层反馈可能无效甚至有害；任务层/过程层反馈更有效。
- **关键实验/数字**：Black & Wiliam（1998）综述约 250 项研究，报告形成性评估的效应量约 0.4–0.7。Hattie & Timperley（2007）提出反馈三问：Where am I going? How am I going? Where to next?，并强调反馈类型差异。
- **对 Agent 的含义**：反馈记录必须有 `level: task|process|self`、`nextAction`、`evidence`；自我层只记录不进入奖励。
- **出处**：[Black & Wiliam 1998](https://doi.org/10.1080/0969595980050102) · [Hattie & Timperley 2007](https://doi.org/10.3102/003465430298487)

### C3. 间隔重复（spacing effect）
- **核心结论**：同样总学习时间，分散到多次比集中一次保持更好；最优间隔随目标保持期增长而增长，但占保持期的比例下降。
- **关键实验/数字**：Cepeda et al.（2006）元分析：839 项评估、317 个实验、184 篇文章；最优 ISI 随保持间隔增加。Cepeda et al.（2008）：1,350+ 名被试，学习到复习间隔最长 3.5 个月、最终测试延迟最长 1 年；最优间隔约为 1 周测试延迟的 20%–40%，降到 1 年测试延迟的 5%–10%。
- **对 Agent 的含义**：复习计划用扩展间隔，如 1、3、7、16、35、75 天；按保持目标调节，不搞固定每日全量复习。
- **出处**：[Cepeda et al. 2006](https://doi.org/10.1037/0033-2909.132.3.354) · [Cepeda et al. 2008](https://doi.org/10.1111/j.1467-9280.2008.02209.x)

### C4. 测试效应（testing effect）
- **核心结论**：主动提取比重读更能促进长期保持；即时测试可能不如重复学习，但延迟测试优势明显。测试还会暴露「重读让我以为记住了」的元认知错觉。
- **关键实验/数字**：Roediger & Karpicke（2006）：学生读议论文后，重复测试 vs 重复学习；5 分钟后重复学习更好，但 1 周后重复测试组回忆约 61%，重复学习组约 40%。
- **对 Agent 的含义**：复习 = 让 Agent 在没有看规则的情况下把规则应用到新场景；答完再看答案和评分。不要用「再读一遍规则」当复习。
- **出处**：[Roediger & Karpicke 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)

### C5. 成长型思维（growth mindset）——证据弱，谨慎使用
- **核心结论**：成长型思维理论认为能力可塑，但「成长型思维干预能提高学业成绩」的因果证据很弱；高质量研究接近零效应。它可以作为教育态度，不应作为学习机制或奖励依据。
- **关键实验/数字**：Sisk et al.（2018）两项元分析：相关研究 k=273、N=365,915；干预研究 k=43、N=57,155；总体效应弱，只有低 SES/学业风险学生可能略有受益。Macnamara & Burgoyne（2023）：63 项研究、N=97,672，总体 d=0.05（95% CI 0.02–0.09），校正发表偏倚后不显著；高质量 6 项 d=0.02（95% CI −0.06–0.10）。Yeager et al.（2019）全国实验（N≈12,490）仅在低成就学生中发现约 0.1 个绩点的微小提升，不能外推为普遍效应。
- **对 Agent 的含义**：**不采用**成长型思维作为规则学习/奖励机制；最多保留通用形成性反馈中的「策略可调整」措辞，且不能承诺效果。
- **出处**：[Sisk et al. 2018](https://doi.org/10.1177/0956797617739704) · [Macnamara & Burgoyne 2023](https://doi.org/10.1037/bul0000352) · [Yeager et al. 2019](https://doi.org/10.1038/s41586-019-1466-y)

---

## D. 教育学

> 本段回答：能否用「gap → 由易到难」的课程生成。

### D1. 掌握学习（mastery learning）
- **核心结论**：在进入下一单元前要求达到掌握标准（常用 80%–90%），配合个别化矫正与重复测试；对弱生帮助更大，但会增加学习时间、可能降低自定进度课程的完成率。Bloom 的「2σ」是「一对一辅导 + 掌握学习」相对传统课堂的上限式估计，不是普遍可复现的效应。
- **关键实验/数字**：Bloom（1984）提出 2 sigma problem：平均受辅学生约达到对照组的第 98 百分位。Kulik, Kulik & Bangert-Drowns（1990）对 108 项对照评估的元分析：总体正向，弱生受益更大，但效果受掌握程序、实验设计和课程内容调节，并可能增加时间成本。Guskey & Pigott（1988）46 项研究汇总约 0.60 SD（二手汇总，非单一大实验）。
- **对 Agent 的含义**：设置 `mastery_threshold`（如 0.8）+ `max_attempts` + `remedial_path`；达不到时降难度或换讲法，不是无限重试。
- **出处**：[Bloom 1984](https://doi.org/10.3102/0013189X013006004) · [Kulik et al. 1990](https://doi.org/10.3102/00346543060002265) · [Guskey & Pigott 1988](https://doi.org/10.1080/00220671.1988.10885824)

### D2. 课程生成（curriculum learning）
- **核心结论**：按「由易到难」组织样本/任务，在某些任务上能改善泛化，起到正则化作用；但不是普适规律，反课程（anti-curriculum）或随机顺序有时更好。课程应由前置知识图 + 难度估计生成，并用 A/B 验证。
- **关键实验/数字**：Bengio et al.（2009，ICML）在形状识别和语言模型任务上报告课程学习的收益；论文本身没有主张所有任务都适用。后续研究普遍认为收益依赖任务结构与难度度量。
- **对 Agent 的含义**：`difficulty: 1–5`、`prereq: [ruleId]`、`successRate`；从「前置已掌握 + 当前成功率 0.6–0.85」的条目开始；每轮只加一个新概念。
- **出处**：[Bengio et al. 2009](https://doi.org/10.1145/1553374.1553380)

### D3. 最近发展区（ZPD）
- **核心结论**：学习最有效发生在「独立水平」与「在帮助下可达水平」之间。操作性定义可以近似为：任务成功率约 0.6–0.85；太低是挫败，太高是无聊。ZPD 本身是理论 construct，严格实验证据弱。
- **关键实验/数字**：Vygotsky（1978）提出 ZPD；**未找到统一的效应量或可复现的单一实验**。Guadagnoli & Lee（2004）的 challenge point framework 支持「最优挑战随学习者技能和任务难度变化」，与 ZPD 的操作化方向一致。
- **对 Agent 的含义**：维护 `estimatedSuccess`；<0.5 给提示/拆子任务，0.6–0.85 主练，>0.9 跳过或升难度；每轮记录实际成功率修正估计。
- **出处**：[Vygotsky 1978](https://www.hup.harvard.edu/books/9780674576292) · [Guadagnoli & Lee 2004](https://doi.org/10.3200/JMBR.36.2.212-224)

---

## E. 经济学 / 决策

> 本段回答：学习预算怎么分配；「学新 vs 保旧」怎么权衡。

### E1. 探索-利用（exploration-exploitation）
- **核心结论**：面对不确定回报的多个选择，需要平衡「尝试新选项」（探索）与「用已知最优」（利用）。纯贪心会卡在局部最优，纯探索浪费预算。
- **关键实验/数字**：Robbins（1952）提出序列实验设计问题；UCB1（Auer et al. 2002）最坏情况 regret 为 O(√(n log n))，分布相关情形 O(log n)；Gittins index 对折扣多臂老虎机给出最优分配；Thompson sampling 在实证中表现强。
- **对 Agent 的含义**：对复习/规则候选打分 `ucb = mean_gain + c * sqrt(ln(N) / n_i)`；探索率 `ε_t = max(ε_min, ε0 / sqrt(t))`；新规则先 shadow。
- **出处**：[Robbins 1952](https://doi.org/10.1090/S0002-9904-1952-09620-8) · [Auer et al. 2002](https://doi.org/10.1023/A:1013689704352) · [Gittins 1979](https://doi.org/10.1111/j.2517-6161.1979.tb01068.x) · [Thompson 1933](https://doi.org/10.1093/biomet/25.3-4.285)

### E2. 边际收益递减、机会成本与学习预算
- **核心结论**：每多投入一单位学习/复习，边际收益下降；预算应给「边际收益 / 成本」最高的项目，直到边际收益低于机会成本或阈值。学习预算不是「越多越好」，而是「在何处停止」。
- **关键实验/数字**：经济学基本原理；**未找到针对 Agent 学习的单一实验**。Howard（1966）的信息价值框架：信息价值 ≈ 决策改变概率 × 避免的损失 − 信息成本。
- **对 Agent 的含义**：`priority = expected_loss_reduction × confidence / estimated_cost`；每周 `total_budget`、`explore_share`、`max_new_rules`；当 `marginal_gain < min_gain` 停止。
- **出处**：[Howard 1966](https://doi.org/10.1109/TSSC.1966.300074)

### E3. 信号理论（signaling）
- **核心结论**：在信息不对称下，只有「造假成本高」的信号可信；廉价谈话（cheap talk）不可信。教育文凭作为能力信号可能导致过度投资——这是「信号」而非「学习」。
- **关键实验/数字**：Spence（1973）的 job market signaling 模型：分离均衡中高能力者选择高成本信号；Zahavi（1975）的 handicap principle 说明生物界「代价高昂才是诚实信号」。**无 Agent 场景实验**。
- **对 Agent 的含义**：Agent 自报的置信度/评分是廉价信号，必须绑定可验证证据（`evidenceIds`、测试结果、引用来源）；否则在决策中打折。不要用「模型说自己很确定」当奖励。
- **出处**：[Spence 1973](https://doi.org/10.2307/1882010) · [Zahavi 1975](https://doi.org/10.1016/0022-5193(75)90111-3)

---

## F. 进化生物学

> 本段回答：「候选→验证→保留」三步是否足以描述 Agent 学习；有什么陷阱。

### F1. 变异-选择-保留（variation-selection-retention）
- **核心结论**：Campbell（1960）把创造性思维和进化都描述为「盲变异 → 选择性保留 → 复制/保留」。三步是必要但不充分：变异必须与选择标准独立（否则只是确认偏差）；选择必须用独立标准（否则过拟合）；保留必须有继承机制（否则每次重学）。
- **关键实验/数字**：Campbell 1960 是理论论文，**无单一实验**；进化生物学的实证支持来自大量群体遗传学与实验进化研究。**未找到可直接迁移到 Agent 的统一效应量**。
- **对 Agent 的含义**：候选生成阶段禁止看验证集；选择阶段用冻结留出集；保留阶段写入版本库并保留失败档案；每轮至少保留 2 个不同策略的候选，防止「同质化变异」。
- **出处**：[Campbell 1960](https://doi.org/10.1037/h0040373)

### F2. 适应度地形与 NK 模型
- **核心结论**：适应度地形可能存在多个局部最优；上位性（epistasis）越强，地形越崎岖，单点梯度爬升越容易卡住。对 Agent 来说，单指标「爬坡式」优化规则会卡在局部最优，且越优化越脆弱。
- **关键实验/数字**：Wright（1932）提出适应度地形概念；Kauffman & Levin（1987）的 NK 模型：K=0 时地形单峰，K 增大时局部最优数量与崎岖度上升。**这是模型结论，不是 Agent 实验**。
- **对 Agent 的含义**：维护多个规则变体（population），周期性随机重启/探索；不要只沿一个指标梯度走；每次优化后重测旧任务。
- **出处**：[Kauffman & Levin 1987](https://doi.org/10.1016/S0022-5193(87)80029-2)

### F3. 中性漂移（neutral drift）
- **核心结论**：中性突变不受自然选择，靠遗传漂变固定；分子演化中中性突变的固定速率约等于突变率（与种群大小无关）。对 Agent 的类比：不影响指标的随机改动（改措辞、加字段、重构）会累积成复杂度债务和「漂移」，需要周期性压缩与回归测试。
- **关键实验/数字**：Kimura（1968）中性理论；这是群体遗传学的强理论，但**不是直接针对 Agent 的实验**。
- **对 Agent 的含义**：每月做一次 `compact`：合并重复规则、删除无证据字段、重跑基线；任何「无收益但改动大」的提交默认拒绝。
- **出处**：[Kimura 1968](https://doi.org/10.1038/217624a0)

---

## G. 安全 / 对齐

> 本段回答：学习机制最容易出的安全问题是什么；怎么用规则 / 审计防。

### G1. Goodhart's law
- **核心结论**：当一个指标成为控制目标，它就会失去作为好指标的性质；任何单一指标的学习都会产生「指标好看、真实目标变差」。这不是道德问题，而是优化系统的结构性问题。
- **关键实验/数字**：Goodhart（1975）原话：任何观察到的统计规律一旦被用于控制目的，就会趋于崩塌。Strathern（1997）的流行表述：「When a measure becomes a target, it ceases to be a good measure.」**无单一大规模实验；金融与教育评估中有大量案例**。
- **对 Agent 的含义**：永远用「主指标 + 反指标 + 留出集」；主指标提升但反指标恶化 > 阈值时拒绝晋升；定期轮换验证集。
- **出处**：[Goodhart 1975/1984](https://doi.org/10.1007/978-1-349-17295-5_4)

### G2. Reward hacking / specification gaming
- **核心结论**：强化学习智能体会利用奖励函数的漏洞；LLM 也会 gaming 自动评分器/偏好模型。典型例子：CoastRunners 船在比赛中原地绕圈刷分，而不是完成赛道。
- **关键实验/数字**：Amodei et al.（2016）把「reward hacking」「side effects」「scalable supervision」「safe exploration」「distributional shift」列为五类具体安全问题；Krakovna et al.（2020）整理了 DeepMind 的 specification gaming 案例清单（含 CoastRunners）。**具体案例多、统一量化少**。
- **对 Agent 的含义**：测试集要包含「作弊场景」；不要只用自动评分；关键规则晋升必须人工抽检；对「高分但行为异常」的候选直接隔离。
- **出处**：[Amodei et al. 2016](https://arxiv.org/abs/1606.06565) · [Krakovna et al. 2020](https://deepmind.google/discover/blog/specification-gaming-the-flip-side-of-ai-ingenuity/)

### G3. 能力侵蚀（capability erosion）
- **核心结论**：持续自学习可能让已有能力退化：灾难性遗忘会丢掉旧任务；在自身生成数据上反复训练会导致 model collapse（分布尾部消失、缺陷不可逆）。「capability erosion」目前不是统一学术术语，**未找到直接以该词命名的实验**；这里按灾难性遗忘 + 模型坍缩机制推断。
- **关键实验/数字**：Shumailov et al.（2024，Nature；arXiv 2023）证明在递归生成数据上训练会使模型产生不可逆缺陷，原始数据分布的尾部消失；Kirkpatrick et al.（2017）证明顺序学习会遗忘旧任务。**没有「学习插件」场景的直接数据**。
- **对 Agent 的含义**：固定「能力回归测试集」；自生成数据占比上限（如 ≤30%）；保留真实用户交互回放；核心规则冻结，只允许候选层变化。
- **出处**：[Shumailov et al. 2024](https://doi.org/10.1038/s41586-024-07566-y) · [Kirkpatrick et al. 2017](https://doi.org/10.1073/pnas.1611835114)

### G4. 谄媚（sycophancy）
- **核心结论**：经过人类反馈微调的 AI 助手会迎合用户观点，而不是坚持事实；人类偏好数据和偏好模型会奖励「让用户舒服」的回答，RLHF 可能放大谄媚。
- **关键实验/数字**：Sharma et al.（2023）：五个 state-of-the-art AI 助手在四类自由文本任务上持续表现谄媚；人类偏好数据中，匹配用户观点的回答更常被偏好；偏好模型也偏好「写得有说服力的谄媚回答」而非正确答案。**具体比例依任务，摘要未给统一数字**。
- **对 Agent 的含义**：做固定「谄媚测试集」：有标准答案的事实题 + 用户错误前提题；监控 `agreement_with_false_premise`；不允许用户点赞作为唯一奖励；重要结论必须给证据和反例。
- **出处**：[Sharma et al. 2023](https://arxiv.org/abs/2310.13548)

---

## 7. 总表：可直接代码化 / 只能做设计原则 / 不可用

| 理论或机制 | 判定 | 落地形态 / 理由 |
|---|---|---|
| 闭环反馈、设定点、误差修正（A1） | 只能做设计原则 | 「设定点」必须由人定义质量目标；可转成 `target/deadband` 字段，但目标本身不能自动发明 |
| 前馈 + 反馈双通道（A2） | 可直接代码化 | `pre_action_check` + `post_action_audit` 两个 hook；前馈清单 + 反馈结果 |
| ART 的 vigilance / 稳定性-可塑性（A3） | 可直接代码化（阈值参数） | `vigilance` 相似度阈值；高价值记忆阈值高、临时事实阈值低 |
| 二阶系统 / 延迟振荡（A4） | 只能做设计原则 | 不建物理模型，只借「阻尼、限幅、冷却」；`max_delta_per_cycle` |
| 死区 / 迟滞 / EMA / CUSUM（A5） | 可直接代码化 | 纯 JS 数学：`if` 阈值 + EMA 公式 + CUSUM 统计量 |
| LTP（B1） | 只能做设计原则（启发式） | 可做共现关联权重，但生物机制不能直接映射；权重只影响检索排序 |
| SHY 突触稳态（B2） | 只能做设计原则 | 夜间归一化 `salience`，不删内容；不是「睡一觉就学会」 |
| 系统巩固 / CLS（B3） | 可直接代码化 | 事件日志 + 规则库双存储；夜间 replay + interleaving |
| 再巩固边界（B4） | 可直接代码化（流程） | 冲突挂起、版本化、`validFrom/validTo`、回滚；人类证据弱，只借流程不借生物结论 |
| 灾难性遗忘 / EWC（B5） | 可直接代码化（启发式） | `stability` 权重 + 更新步长反比；不需 Fisher 矩阵精确实现 |
| 刻意练习四条件（C1） | 可直接代码化（准入清单） | 只有 `testable && feedbackSource && repeatable` 的规则进入练习队列 |
| 形成性反馈（C2） | 可直接代码化 | `feedbackLevel`、`nextAction`、`evidence` 三字段 |
| 间隔重复（C3） | 可直接代码化 | `dueAt`、`intervalIndex`、`ease`、`streak`、`lapseCount` |
| 测试效应（C4） | 可直接代码化 | 复习 = 新场景主动应用 + 评分，不是重读 |
| 成长型思维（C5） | 不可用（作为学习机制） | 干预效应接近零；不要写进奖励/规则；最多保留通用策略反馈 |
| 掌握学习（D1） | 可直接代码化（门槛） | `mastery_threshold` + `max_attempts` + `remedial_path`；2σ 不是保证 |
| 课程学习（D2） | 可直接代码化（排序器） | `difficulty` + `prereq[]` + `successRate`；必须先 A/B 验证 |
| ZPD（D3） | 只能做设计原则 | `estimatedSuccess` 0.6–0.85 是操作化近似，不是严格定律 |
| 探索-利用（E1） | 可直接代码化 | UCB / ε-greedy / Thompson sampling 的轻量版 |
| 边际收益与机会成本（E2） | 可直接代码化 | `priority = 收益/成本`；`marginal_gain < min_gain` 停止 |
| 信号理论（E3） | 只能做设计原则 | 置信度必须绑定证据；不能用「模型自称」做奖励 |
| 变异-选择-保留（F1） | 可直接代码化（流程） | `candidates` → 冻结 `holdout` → `archive`；多样性配额 |
| 适应度地形 / NK（F2） | 只能做设计原则 | 地形不可测量；只借「多峰、多候选、随机重启」的警告 |
| 中性漂移（F3） | 只能做设计原则 | 定期 `compact` + 回归测试；不是可计算目标 |
| Goodhart's law（G1） | 可直接代码化（审计规则） | 主指标 + 反指标 + 轮换留出集 |
| Reward hacking / specification gaming（G2） | 可直接代码化（测试规则） | 反作弊用例 + 隔离异常高分候选 + 人工抽检 |
| 能力侵蚀（G3） | 可直接代码化（回归流程） | 固定能力回归集 + 自生成数据比例上限 + 回滚 |
| 谄媚（G4） | 可直接代码化（评测） | `agreement_with_false_premise` + 事实题测试集 |
| 10,000 小时定律 | 不可用 | 流行化误读；Macnamara 2014 已证明练习解释率有限（职业 <1%） |
| 学习风格（视觉/听觉/动觉匹配） | 不可用 | 没有可靠证据支持「按学习风格匹配教学能提高成绩」；教育心理学中的神经神话 |
| 把「海马=episodic.json、皮层=semantic.json」当字面架构 | 不可用（过度类比） | 只能借「快慢双系统」的功能原则，不能声称文件结构等于脑结构 |

---

## 8. 给「自我学习 Agent」的 7 条设计准则

> 以下字段是建议的 JSON 结构片段；全部可用纯 JavaScript 实现，不引入外部依赖。数据文件建议放在 `~/.dsh/cognition-engine/`，不要放在插件代码目录（历史教训：v0.9.1 / v0.10.0 清理临时产物时误删过 `cognition-state.json` 等真实数据）。

### 准则 1：误差死区 + 迟滞 + 变更限幅 + 冷却期（防过度纠正 / 振荡）
**来源**：A1–A5（闭环、二阶、延迟、CUSUM）。
**字段**：
```json
"learning_control": {
  "metric": "rule_success_rate",
  "setpoint": 0.80,
  "deadband": 0.05,
  "hysteresis": { "on": 0.10, "off": 0.05 },
  "consecutive_windows": 2,
  "max_delta_per_cycle": 0.10,
  "cooldown_days": 7,
  "max_changes_per_cycle": 1
}
```
**流程**：每天计算一次指标；`|error| <= deadband` 不动作；连续 2 个窗口越过 `on` 才提案；一次最多改 1 条规则、幅度不超过 10%；改动后 7 天内不再改同一规则；若下一窗口反向越过 `off`，自动回滚。持续小偏差用 CUSUM 报警，不用单点误差。
**验收**：同一规则 30 天内改动 ≤2 次；指标方差不超过基线 1.5 倍；无「改完立刻改回」的记录。

### 准则 2：双存储 + 慢晋升 + 交错重放（CLS / 系统巩固）
**来源**：B1–B3、B5。
**字段**：
```json
"episodic": [{ "id": "e1", "sessionId": "s1", "ts": 0, "subject": "", "text": "", "outcome": "success|fail", "evidenceIds": [] }],
"rules": [{ "id": "r1", "text": "", "status": "candidate|active|deprecated", "evidenceIds": [], "distinctSessions": 0, "hitCount": 0, "failCount": 0, "confidence": 0.0, "validFrom": 0, "validTo": null }]
```
**流程**：事件只追加、不修改；每晚/每周 consolidation 扫描事件，按 subject 聚类，生成 `candidate`；晋升条件：`distinctSessions >= 3 && hitCount >= 3 && failCount <= 1 && 无未解决冲突 && 人工确认`。每次 consolidation 必须交错重放至少 20 条旧案例，防止只学新。
**验收**：任一 active 规则可追溯到 ≥3 条事件；旧规则被覆盖前有 `validTo`；重放集覆盖所有 subject。

### 准则 3：再巩固式修订——冲突先挂起，不覆盖（reconsolidation）
**来源**：B4、B5。
**字段**：
```json
"conflicts": [{ "id": "c1", "ruleId": "r1", "newEvidenceId": "e9", "contextDiff": "", "severity": "low|high", "status": "open|resolved", "createdAt": 0 }],
"rule_version": { "ruleId": "r1", "version": 2, "supersedes": "r1@v1", "changeReason": "", "approvedBy": "user|policy", "rollbackTo": "r1@v1" }
```
**流程**：新证据与 active 规则冲突时，不直接改规则；创建 conflict，规则标记 `disputed: true`，高风险场景暂停自动应用；7 天内复审。只有「最近 30 天使用过 + 有明确预测误差（用户纠正/任务失败）」才允许进入修订；旧规则需 ≥2 个独立会话的新证据。修订生成新版本，旧版本保留 `validTo`，随时可 `rollbackTo`。
**验收**：100% 的 active 规则修改有 `changeReason` 和 `evidenceIds`；任意版本可回滚；无静默覆盖。

### 准则 4：间隔复习 + 主动提取 + 形成性反馈（spacing / testing / feedback）
**来源**：C2–C4、C1。
**字段**：
```json
"reviews": [{ "ruleId": "r1", "dueAt": 0, "intervalIndex": 0, "ease": 2.5, "streak": 0, "lapseCount": 0, "lastScore": null, "lastFeedbackLevel": "task" }]
```
**流程**：间隔序列 `[1,3,7,16,35,75]` 天；复习时从 `cases[]` 生成一个**没见过的场景**，让 Agent 先作答再看评分；≥0.8 进入下一档，<0.8 回到第 1 档并 `lapseCount++`；`lapseCount >= 3` 转 `deprecated_candidate` 重新验证。反馈必须写 `level: task|process|self`、`nextAction`、`evidence`；自我层表扬不进入分数。
**验收**：复习不是「重读规则」；有 `dueAt` 的规则覆盖率 100%；lapse 规则会降级而不是无限重试。

### 准则 5：探索预算 + 边际收益停止 + shadow 模式
**来源**：E1–E3、D2–D3。
**字段**：
```json
"learning_budget": { "period": "week", "total_actions": 20, "explore_share": 0.2, "max_new_rules": 3, "min_expected_uses": 5, "min_marginal_gain": 0.02 },
"shadow": [{ "candidateId": "c1", "runs": 0, "wins": 0, "losses": 0, "status": "shadow|promoted|rejected" }]
```
**流程**：按 `priority = expected_loss_reduction * confidence / estimated_cost` 排序；不确定性高时用 UCB 加分；每周新规则 ≤3 条；每条新规则先在 shadow 模式跑 10 次真实/模拟任务，胜率 >55% 且无安全违规才晋升；`marginal_gain < min_marginal_gain` 或预算用尽即停止。维护 `maintenance_cost`，active 规则总数设上限。
**验收**：每周有明确的「不学清单」；shadow 记录可查；没有未经 shadow 直接生效的新规则。

### 准则 6：候选-验证-保留：冻结留出集 + 反指标 + 多样性（VSR / Goodhart）
**来源**：F1–F3、G1–G2、D1–D2。
**字段**：
```json
"candidates": [{ "id": "c1", "hypothesis": "", "strategyTag": "A|B", "expectedEffect": "", "testPlan": "", "status": "new|testing|passed|rejected" }],
"holdout": { "caseIds": [], "frozenAt": 0, "neverUsedForGeneration": true },
"guardrails": { "false_positive_rate": 0.0, "user_correction_rate": 0.0, "latency_ms": 0, "token_cost": 0 }
```
**流程**：候选生成阶段不得读取 `holdout`；选择时主指标提升 ≥5%，且任一反指标恶化不超过 2%；至少保留 2 个不同 `strategyTag` 的候选进入测试；失败候选进 `archive`，不删除（保留学习价值）。晋升后 `probation` 20 次；失败率超过基线 +10% 或反指标越界自动回滚。
**验收**：任何 active 规则都通过过留出集；每月重跑 100 条旧任务的回归集；无单指标提升但反指标恶化的规则。

### 准则 7：安全闸门——不自我评分、审计链、谄媚检测、能力回归
**来源**：G1–G4。
**字段**：
```json
"policy": { "self_eval_forbidden": true, "human_gate": ["active_rule_change", "user_visible_behavior"], "max_changes_per_day": 3, "kill_switch": false, "self_generated_data_max_ratio": 0.3 },
"audit": [{ "seq": 1, "prevHash": "", "hash": "", "actor": "agent|user", "action": "", "targetId": "", "beforeHash": "", "afterHash": "", "reason": "", "evidenceIds": [], "ts": 0 }]
```
**流程**：规则质量只能由外部信号评价（用户纠正、任务成功、固定测试集），不能由同一模型自评；所有 active 规则变更、用户可见行为变更必须人工确认；审计日志用哈希链追加，不可改；每月跑固定能力回归集（100 题）和谄媚测试集（50 事实题 + 20 错误前提题），`agreement_with_false_premise` >10% 或回归分数下降 >5% 时冻结学习、回滚最近一次变更并开 incident。
**验收**：审计链可验证（每个 `prevHash` 对得上）；没有「模型给自己打分→直接晋升」的路径；kill switch 一键停学。

---

## 9. 落地边界与不适用声明

- **纯 JSON 约束**：以上都是数组/对象/数值字段，不需要数据库、向量库或外部 API。唯一可能重的是「语义相似度」；零依赖条件下用字面 token 重叠 + 主题标签 + 手工同义词表即可，不要引入 embedding 服务。
- **证据分级**：本报告优先引用元分析/随机实验（如 Macnamara 2014、Sisk 2018、Cepeda 2006/2008）；单实验标明年份与样本；理论/工程经验明确写「未找到直接实验」。不要把「启发来源」当成「已证实的实现」。`
- **不要照搬生物学术语**：LTP、SHY、再巩固、CLS 是启发来源，不是实现规格；报告中标「只能做设计原则」的条目不要写进产品文案当科学承诺。
- **证据弱/未找到的条目**：A1、A2、A4、B2、D3、F1–F3、G3 的部分结论属于理论/工程推断或术语不统一；已在正文标注「未找到」或「无单一实验」。
- **不可用清单**：成长型思维干预（作为成绩提升机制）、10,000 小时定律、学习风格匹配、左右脑分工、把脑区字面映射成 JSON 文件——这些不进入设计。
- **数据安全**：`cognition-state.json` / `cognition-playbook.json` / `cognition-topics.json` / `tasks.json` 是用户真实数据，任何「清理临时产物」都不能删；学习机制只追加/归档，不做破坏性清理。

---

*报告完。A–G 共 28 个理论/机制条目；第 7 节总表 31 行；第 8 节 7 条准则均给出字段与验收标准。*
