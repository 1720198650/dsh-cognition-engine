# 哲学工程化 → 可落地机制：面向「可信度治理」记忆插件的调研

> 目标插件约束：零依赖、纯 TypeScript、本地 JSON、几十到几百条记忆、已有双时态（validFrom/validTo + recordedAt/supersededAt）、准则本（helpful/harmful、validTo、冲突标记）、主题、反思候选。
> 本文只收「能写进代码」的机制。查不到的明确写「未找到可靠来源」，不补全、不推测成事实。

---

## 0. 先给核验结论

| # | 对象 | 是否存在 | 性质 / 可信度 | 一句话结论 |
|---|---|---|---|---|
| 1 | **GRACE** | 是 | 同行评审（AAAI IASEAI，OJS 收录）+ arXiv 2601.10520 | 三模块架构真实；**概念论文，无代码、无实验**；可借「规范在模型外 + 执行前否决」 |
| 2 | **SCL** | 是 | arXiv 2510.05107（v5），单作者预印本 | propose / verified 分离真实；86.3% 有，但**无置信区间、控制器任务特异性被质疑** |
| 3 | **LeAP / CITE** | 是 | Zenodo 预印本（DOI 10.5281/zenodo.21029662）+ 真实开源实现 | **最接近本插件定位**；治理层是确定性纯函数，可完整抄 |
| 4 | **ITEM** | 是 | ACL 2026 Findings（2026.findings-acl.1579，pp. 31559–31578） | 三层相关性是**流程**不是公式；依赖多轮 LLM 调用 |
| 5 | **HADES** | 是 | 个人 OSS 仓库，仓库内未标注关联论文 | IS/IS-NOT 门控真实存在且可抄；`anchoredTo` **全仓库 0 命中，未找到**；整体依赖 ArangoDB + 向量 + GNN |
| 6 | **veritas-tms** | **否** | GitHub 搜索 0 结果 | 不存在；相近的是 Veritas（空壳仓库）+ ftl-reasons（真 TMS 实现） |
| 7 | 其他 | 是 | OIDA、Kumiho、vectr、ftl-reasons | 分别补「优先级传播」「不可变 revision」「信任阶梯」「依赖回溯」 |

可信度分级：**A** = 同行评审；**B** = 预印本（未评审）；**C** = 工程博客 / 开源实现（无评审，但细节最具体）。

---

## 1. 第一梯队：逐项深挖

### 1.1 GRACE（A）

论文：[arXiv:2601.10520](https://arxiv.org/abs/2601.10520)｜[AAAI IASEAI（OJS）](https://ojs.aaai.org/index.php/IASEAI/article/view/43029)

| 维度 | 内容 |
|---|---|
| **机制名称** | 规范/工具理性分离的三模块治理（MM / DMM / Guard）+ 理由理论（reason theory） |
| **具体做法** | ① **Moral Module (MM)** 用 Horty 默认逻辑 ⟨R, D, <⟩ 判定「允许的宏动作类型」（MAT）；R 是从感知实例化的**理由**（如 `D(X)`=数据 X 敏感、`W(X)`=病人表达愿望 X），D 是**参数化默认规则** `P(X→) ⟶ φ(X→)`（理由→MAT 公式），`<` 是理由间的严格偏序（冲突时谁压谁）。当前情境把一般理论**落地**为 ⟨R↓, D↓, <↓⟩，用 defeasible 推理输出允许集 Φ_perm。② **DMM** 包住原生 agent，只在 Φ_perm 内选原语动作（论文对 DMM 内部架构不做要求）。③ **Guard** 接收 (a_prop, Φ_perm, o_t)，检查 `a ⊧_s φ`（该原语动作是否属于某个允许的宏动作类型），不通过就否决/替换。整体是 `Φ_perm = MM(o_t)` → `a_prop = DMM(Φ_perm, o_t)` → `a_t = Guard(a_prop, Φ_perm, o_t)`（论文式 3–5）。④ **Moral Advisor** 给案例式反馈 `(a, φ, P)`：「a 在 s 不允许，理由是 P，本应做 φ」。 |
| **需要的数据结构** | `reasons[]`（带参数的类型谓词）、`defaults[] = {body, head, priority}`、优先级偏序、动作类型谓词表、guard 判定表 |
| **零依赖 JSON 能否实现** | **能，但要简化**。完整 Horty 语义（多重接地、严格偏序、defeasible 推出）在 TS 里实现成本高；对本插件只需要「有序规则表 + 优先级 + 否决」这一层。 |
| **对我们的价值** | **中**。真正可借的不是道义逻辑，而是三条工程约束：(a) 规范不写进模型，写在外部数据里；(b) 执行前有一个**独立否决层**；(c) 规则之间有显式优先级，冲突不靠模型即兴裁决。 |
| **诚实的限制** | 论文自述 Guard 的设计「不限定」，也**没有做实验**（原文：conceptual validity is illustrated through concrete scenarios, laying groundwork for future empirical evaluation）。「换模型不影响规范约束」是**结构上的保证**（MM/Guard 在 DMM 外），不是实测结论。 |

**对插件的翻译**：准则本的每条准则 = 一条 `default`，字段 `{when: 条件, then: 允许/禁止, priority: n, grounding}`；「矛盾时谁赢」由 priority 决定，而不是让模型二选一。

---

### 1.2 SCL（B）

论文：[arXiv:2510.05107](https://arxiv.org/abs/2510.05107)（v5）｜后续改写版：[arXiv:2511.17673](https://arxiv.org/abs/2511.17673)（把 Regulation 从 Control 中拆出）

| 维度 | 内容 |
|---|---|
| **机制名称** | 提案 / 已验证状态分离（proposal vs verified state）+ 确定性控制器 |
| **具体做法** | 循环 **Retrieve → Cognition → Control → Action → Update Memory**。LLM 只做 Cognition，且输出被约束成**结构化、必须引用 MEM key 的提案**（如 `obs.Miami.temp_f`）。Control 是轻量确定性层，批准前检查三件事：① 前置条件是否满足（no action without preconditions）；② `(tool, arguments, salient context)` 去重缓存——同状态不重复调用；③ 终止条件——目标已满足就不继续。**只有观测/批准结果写入 MEM**；提案与批准都进日志。MEM 是带类型、带时间戳、可寻址的记录集合（observations / judgments / approvals）。 |
| **验证门槛怎么设** | **规则门槛，不是统计门槛**：前置条件 ∧ 非重复 ∧ 未终止。没有「置信度阈值」这种东西。 |
| **需要的数据结构** | `proposal{action, args, evidenceRefs[]}`、`memRecord{key, type, value, ts, source}`、`approval{proposalId, decision, rule}`、去重键 |
| **零依赖 JSON 能否实现** | **能**。本质是 append-only 日志 + 状态机，不依赖模型能力。 |
| **对我们的价值** | **中低**。它是**运行时控制循环**，不是存储层治理；本插件不该接管 agent 的工具调用。但两条不变量可直接借：**「提案不是状态」**、**「每条断言必须能指回证据键」**。 |
| **86.3% 的评测设置（必须打折看）** | 3 个任务（旅行规划 / 条件邮件撰写 / 约束引导图像生成）、360 episodes、基线与 SCL 用同一基座模型/工具/解码参数；TSR 86.3% vs 基线 70.5–76.8%；消融：去 memory → 80.1%，去 control → 78.6%。**问题**：论文没有置信区间/显著性检验；独立审稿（[pith 评审](https://pith.science/paper/2510.05107)）指出控制器可能按场景手写前置条件与终止规则，若是则提升是规则带来的，不是架构带来的。**结论：把 86.3% 当弱证据，不要当采用理由。** |

---

### 1.3 LeAP / CITE（B，但有真实实现）

论文：[Zenodo record](https://zenodo.org/records/21029662)（用户给的 21029661 会重定向到 21029662，DOI 10.5281/zenodo.21029662）｜实现：[engrammic-ai/primitives](https://github.com/engrammic-ai/primitives)

> 注意：这里有两个「四层」，别混。
> **认识类型 4 层**（证据要求递增）：observation → claim → fact → belief。
> **架构层 4 层**（持久化语义不同）：Memory（衰减）/ Knowledge（取代）/ Wisdom（证据门控）/ Intelligence（会话内）。

| 维度 | 内容 |
|---|---|
| **机制名称** | 分层认识类型 + 写时门控（write-time validation）+ 确定性晋升/作废 |
| **每层来源要求** | `observation`：无需理由，原始观测。`claim`：单一来源即可（agent 断言，待晋升）。`fact`：**≥3 个独立来源**且至少 1 个权威来源、聚合置信 ≥0.8。`belief`：由 ≥3 条 fact 合成（cluster density ≥3），只有系统能写。 |
| **如何由代码而非模型控制层级** | ① **写权限按层切开**：agent 工具只能写 Memory / Claim / Commitment；`Fact` 只能由 Custodian 从 Claim 晋升，`Belief` 只能由 Synthesizer 合成——**agents never write Fact nodes directly**。② 晋升是**纯函数**：R1 = 权威来源且 raw_confidence ≥0.7；R2 = ≥3 来源 + 至少 1 权威 + noisy-OR 聚合 ≥0.8（[promotion.py](https://github.com/engrammic-ai/primitives/blob/main/src/primitives/eag/epistemology/promotion.py)）。③ 提交时校验不变量 I1–I5（Fact 必须有 DERIVED_FROM；Belief 必须有 ≥3 SYNTHESIZED_FROM；无环；SUPERSEDES 必须带 reason 枚举）。④ **LLM 只在抽取阶段出现，裁决阶段绝不调用 LLM**（[06-epistemology.md](https://github.com/engrammic-ai/primitives/blob/main/docs/06-epistemology.md)）。 |
| **矛盾与作废（最值钱部分）** | 矛盾 = **同 subject、同 predicate、不同 object**（结构判定，不做语义 NLI）。作废要**优势阈值**：`incoming.confidence ≥ 1.2 × existing.confidence` 才由新的取代旧的；反过来旧的赢；**都不满足 → `UNRESOLVED`，两条都保留、都 active**（[supersession.py](https://github.com/engrammic-ai/primitives/blob/main/src/primitives/eag/epistemology/supersession.py)）。取代原因枚举：`contradiction / evidence_shift / author_update / evidence_erased`。 |
| **置信度怎么算** | 文档给的是乘法式：`source_tier(1.0/0.85/0.6/0.4) × corroboration_factor(1−e^(−0.5n)) × method_weight(0.85/0.75/0.6) × raw_confidence`；代码里 R2 聚合用 noisy-OR。**关键设计**：置信度是**由存储字段算出来的**，不是让模型自报一个数。 |
| **需要的数据结构** | node{layer, spo, confidence, sources[], text}；边 `DERIVED_FROM / SYNTHESIZED_FROM / SUPERSEDES / SUPPORTS / CONTRADICTS / ABOUT`；source tier 枚举 |
| **零依赖 JSON 能否实现** | **治理层完全能**（节点数组 + 边数组 + 纯函数）。**检索层不能**：打分是 `similarity × confidence × corroboration × proximity × NOT_superseded`，`similarity` 要向量、`proximity` 要 PPR 图遍历。 |
| **对我们的价值** | **高**。这是六个对象里唯一一个「认识论 → 确定性代码」做得最完整的，且和插件的双时态/准则本几乎一一对应。 |
| **诚实的限制** | 单作者、公司（Engrammic）预印本，未经同行评审；500 个 coding-agent session 上的「95% vs 66%、87% vs 12%」是**设计验证**，不是公开基准；AGM 公理满足是理论声明，代码是近似。 |

---

### 1.4 ITEM（A）

论文：[ACL Anthology](https://aclanthology.org/2026.findings-acl.1579/)｜[arXiv:2406.11290](https://arxiv.org/abs/2406.11290)

| 维度 | 内容 |
|---|---|
| **机制名称** | 三层相关性（aboutness → utility → answer）+ 伪答案锚定的迭代效用判断 |
| **三层怎么对应** | Schutz 的相关性系统：**topical relevance（主题相关 / aboutness）** → 检索排序；**interpretational relevance（解释相关 / utility）** → 效用判断；**motivational relevance（动机相关 / answer）** → 答案生成。 |
| **具体做法** | 不是公式，是**循环**：先让 LLM 基于候选文档生成一个 **pseudo-answer** 当「认知锚」，再用它给文档打 utility 分（pointwise 或 listwise），高 utility 文档反过来改进 pseudo-answer；ITEM-AR 变体每轮多做一次相关性重排。收敛后输出稳定效用排序与最终答案。全程 in-context learning，**无训练**。 |
| **有没有可复用公式** | **没有**。论文贡献是流程与理论映射，不是打分函数。可复用的是判据顺序：**先问「它跟问题有关吗」，再问「它能不能回答问题」**——后者才是 utility。 |
| **需要的数据结构** | `candidate{id, topicScore, utilityScore}`、`pseudoAnswer`、`round` |
| **零依赖 JSON 能否实现** | **存分数可以；算分数不行**。要多次 LLM 调用；零依赖插件自己做不到（除非宿主 agent 代劳，插件只负责记录分数与轮次）。 |
| **对我们的价值** | **中**。对「该不该把这条记忆塞进上下文」有启发；但对「这条记忆可不可信」没有直接帮助——utility ≠ truth。 |

---

### 1.5 HADES（C，但 IS/IS-NOT 部分可抄）

仓库：[toddwbucy/HADES-burn](https://github.com/toddwbucy/HADES-burn)｜关键文档：[Bastion/graph-methodology.md](https://github.com/toddwbucy/HADES-burn/blob/main/Bastion/graph-methodology.md)

| 维度 | 内容 |
|---|---|
| **机制名称** | IS / IS-NOT 公理门控 + 逐字依据（verbatim_source）+ 缺陷即「缺失的边」 |
| **具体做法** | 每个命名空间**恰好两个** `axiomatic_container` 文档：`<NS>_IS` 和 `<NS>_IS_NOT`，各带 `principles[]`。**每条 principle 必须有 ratified 的逐字引用**：<br>`verbatim_source: { source_id, quote, location, authority_basis: human_approved, ratified: "YYYY-MM-DD by <lead>", reading: direct }`。四类边把概念接到门上：`axiom_basis`（概念→IS，「它是什么」）、`validated_against`（概念→IS_NOT，「拿什么反例检验它」）、`structural_embodiment`（IS→具体定义）、`axiom_inherits`（子容器→框架 IS/IS_NOT）。**一个概念缺任意一条门边 = 缺陷，不是风格问题。** |
| **smell（可执行规则）的数据结构** | `{axiom_basis, is_axioms[], is_not_axioms[], validated_against, verbatim_basis, forbidden_patterns[], scope, origin}`；`origin` 分 `derived`（直接从公理读出来）与 `operational`（从真实 bug 提升），**同一个 bug 复现 3 次才从 derived 升 operational**。 |
| **anchoredTo 如何实现** | **未找到**。我对整仓库（md / rs / yaml / json，201 个文件）做了 `IS-NOT`、`anchoredTo`、`anchored_to` 全文搜索：`IS-NOT` 有 8 处，`anchoredTo` **0 处**。仓库里最接近的是 `memory_source_edges` / `memory_supersedes_edges` 这类来源/取代边，不是 `anchoredTo`。**请不要把 `anchoredTo` 当成 HADES 的既有字段引用。** |
| **需要的数据结构** | 两个公理容器 + principles[] + 四类边 + smell 记录 |
| **零依赖 JSON 能否实现** | **门控部分能**；**整体不能**。HADES 是 Rust CLI + ArangoDB + Jina V4（2048 维）+ GraphSAGE/RGCN 训练 + gRPC + 命名图遍历。 |
| **对我们的价值** | **中高（只对准则本）**。「每条准则必须有原文引用 + 批准人 + 一条正例一条反例；缺反例就是缺陷」——这条能直接变成准则本的状态机。 |

---

## 2. 第二梯队：真伪核验与替代

### 2.1 veritas-tms：不存在

- GitHub 仓库搜索 `veritas-tms`、`veritas tms`：**total_count = 0**。没有这个项目。
- 最接近的是 **Veritas**（[AILIFE1/veritas](https://github.com/AILIFE1/veritas)，博文：[The Colony](https://www.thecolony.ai/post/aa173566-7bae-4733-bdc0-dd0255af8837)、[dev.to](https://dev.to/mike_w_06c113a8d0bb14c793/veritas-give-your-ai-agent-the-ability-to-know-what-it-knows-2l64)）。它**不是 TMS**，是「置信度向量 + 信念传播 + 推理守卫」。
- 但要泼一盆冷水：该仓库**只有一个 279 字节的 README**，没有代码。博文里的 `pip install veritas`、`VeritasDB`、`find_contradictions` 都无法从公开仓库核实。**按 C 级（宣称）对待，不要按可用库对待。**

| Veritas 的机制 | 具体做法 | JSON 可行性 | 价值 |
|---|---|---|---|
| ConfidenceVector | `{value, fragility, staleness_penalty, source_diversity}`；来源用 noisy-OR 合并 | 能 | 中：把「置信」拆成向量而非标量，防止单一分数掩盖脆弱性 |
| 来源半衰期 | MATHEMATICAL 永久 / THEORETICAL ~140y / EMPIRICAL ~10y / AUTHORITY ~6y / ANECDOTAL ~2y | 能（一个枚举映射） | 中低：半衰期数值是拍的，但「按来源类型分衰减」可借 |
| 信念传播 | DEDUCTIVE（依赖不超过基础）/ INDUCTIVE（弱基础拖累，强的不抬升）/ ABDUCTIVE（软拖累） | 能 | 中：和机制 3 同构 |
| ReasoningGuard | PROCEED / CAUTION / HALT；触发：低置信、单来源、高脆弱、陈旧、矛盾 | 能 | 中：三档比二值好落地 |
| 语义矛盾检测 | `sentence-transformers` 余弦阈值 0.49/0.45 | **不能** | **排除**：需要 embedding |

### 2.2 真正的 TMS 工程实现：ftl-reasons（C，但代码是真的）

仓库：[benthomasson/ftl-reasons](https://github.com/benthomasson/ftl-reasons)（Doyle 1979 TMS；Python + SQLite；211 个测试；可 `reasons export` 成 JSON）

| 维度 | 内容 |
|---|---|
| **机制名称** | 真值维护：节点 IN/OUT + 理由（justification）+ nogood + 依赖定向回溯 + 撤回级联 |
| **具体做法** | 节点 = 一个信念，状态 IN（相信）/ OUT（撤回）；分 premise（默认相信）与 derived（因理由而相信）。**justification 两种**：`SL`（support list）——所有前件 IN 则节点 IN；`CP`（假设一致）——假设集合一致则 IN。一个节点可有多条 justification，**任一条有效即 IN**（OR）。**outlist** 实现非单调：「相信 X，除非 Y 被相信」——inlist 全 IN 且 outlist 全 OUT 才有效。`nogood A B` 记录「A、B 不能同时为真」，触发**依赖定向回溯**：沿 justification 图回溯，撤回**最不稳固的 premise**，而不是随便撤一个。 |
| **entrenchment（稳固度）的实际公式** | `premise +100`；`有 source +50`；`有 source_hash +25`；`依赖者数量 × 10`；类型分：AXIOM/WARNING 90、OBSERVATION 80、DERIVED 40、PREDICTED 30、NOTE 10、默认 20（[network.py L291](https://github.com/benthomasson/ftl-reasons/blob/main/reasons/network.py#L291)）。回溯时按 entrenchment 升序挑「先牺牲谁」。 |
| **需要的数据结构** | `nodes[{id, text, truth, premise?, source, source_hash, justifications[], dependents[]}]`、`justifications[{type: SL/CP, inlist[], outlist[]}]`、`nogoods[[id...]]`、`log[]` |
| **零依赖 JSON 能否实现** | **完全能**。图就是两个数组（正向 + 反向邻接）；几百节点 BFS 毫秒级。 |
| **对我们的价值** | **高**。机制 3 直接来自这里；entrenchment 公式可以几乎照搬成「凭什么信」的可解释分数。 |
| **诚实的限制** | 个人项目、1 star、无同行评审；博文里的效果数据（撤回级联 4.1→0.8、深度 8 以上 100% 不可靠、85%→98.2%）都是作者自报，未经第三方复现。**借机制，不借数字。** |

### 2.3 OIDA（B）

论文：[arXiv:2604.11759](https://arxiv.org/abs/2604.11759)｜[HTML](https://arxiv.org/html/2604.11759v2)

| 维度 | 内容 |
|---|---|
| **机制名称** | 类型化节点 + 有符号边 + 确定性优先级更新（Knowledge Gravity Engine） |
| **具体做法** | 9 种认识类型，各有初始优先级与时间行为：DECISION 1.00（稳定直到被取代）、CONSTRAINT 0.90、EVIDENCE 0.80（慢衰减）、NARRATIVE 0.70、PLAN 0.65（限期衰减）、EVALUATION 0.55、OBSERVATION 0.40（无强化则衰减）、HYPOTHESIS 0.30（未检验则衰减）、**QUESTION 0.30（未解决则紧迫度上升）**。边分正（supports/implements/based_on）与负（contradicts/blocks）；**矛盾非破坏性**——降权或与对手并列，不删除。优先级更新是确定性式（论文式 1）：<br>`K_{t+1}(v) = clamp[0,1]( (1−η)K_t(v) + η[s(v)+h_t(v)+u_t(v)+e_t(v)+g_t(v)] − λ_type·Δt·K_t(v) − c_t(v) )`<br>其中 h 是「未解决问题」的紧迫度，g 是图影响，c 是矛盾惩罚。收敛的充分条件是**最大度 < 7**（经验上到 43 仍稳）。 |
| **需要的数据结构** | `nodes[{id, type, priority K, ts, sources}]`、`edges[{from,to,rel,sign,weight}]`、类型先验表、λ 表 |
| **零依赖 JSON 能否实现** | **优先级部分能**（邻接表 + 几轮定点迭代）；**检索不能**（`score = sim(q,v) × φ(...)`，sim 是向量）。 |
| **对我们的价值** | **中**。K 公式可以作为机制 3 的可选精化；`QUESTION` 作为一等公民（记录「不知道什么」）对本插件是新点子，但优先级数值是设计先验、未验证。 |
| **诚实的限制** | 作者是加速器/创业背景；pilot 里 full-context 基线在窗口内反而更好，且 token 预算差 28 倍（3,868 vs 108,687），作者自己承认是主要混杂。**别引用它的效果，只引用它的数据结构。** |

### 2.4 Kumiho（B）与 vectr（C）

- **Kumiho**（[arXiv:2603.17244](https://arxiv.org/abs/2603.17244)）：不可变 revision + 可变 tag 指针 + 类型化依赖边 + URI 寻址；声称与 AGM 的 K*2–K*6、Hansson 的 Relevance/Core-Retainment 对应。**系统本身是 Redis + Neo4j + 向量检索**，整体排除；但「revision 不可变、指针可变」和插件的双时态同构，可作为 `supersededBy` 链的设计依据。价值 **中低**。
- **vectr 信任阶梯**（[dev.to 长文](https://dev.to/swapnanilsaha/agent-memory-needs-a-trust-ladder-provenance-revocation-and-notes-that-lie-3ig1)，作者称已在其工具 vectr 中上线）：三档 provenance（human / agent / auto）、agent 工具的参数 enum **只接受 agent/auto**（`human` 不可自封）、晋升一次只能一级、**不可降级**、撤回 = tombstone 事件而非删除、锚点 = 文件路径 + 截断 SHA-256、漂移只报「verify」不报「false」、投递按 kind 分（directive/task/gotcha/finding/decision）。**全部可用纯 JSON 实现**。价值 **高**（机制 1、2 的直接来源）。限制：工程博客，无同行评审，无公开基准。

---

## 3. 特别标注：听起来很哲学、实际要 embedding / 图数据库的（直接排除）

| 机制 | 依赖什么 | 为什么排除 | 可保留的替代 |
|---|---|---|---|
| Veritas 的语义矛盾检测 | sentence-transformers 余弦相似度 | 零依赖插件不能带模型；且「语义相似 ≠ 矛盾」 | **结构矛盾**：同 subject + 同 predicate + 不同 object |
| HADES 的图方法论整体 | ArangoDB + Jina V4 2048 维 + RGCN/GraphSAGE 训练 + 命名图遍历 | 图数据库 + 向量 + 训练管线，三条全踩 | 只留 `IS/IS-NOT + verbatim_source + 四类边`，用数组存 |
| LeAP / OIDA / Kumiho 的检索打分 | `similarity`（向量）+ PPR/图遍历 + Neo4j/Redis | 检索层要向量与图 | **只抄治理层**（晋升、矛盾、取代、不变量），检索仍用关键词/主题 |
| AGM 全部公理 | 逻辑闭包、信念集 | 自然语言记忆没有闭包；全量 AGM 不可判定也不必要 | **entrenchment + 1.2× 优势阈值 + unresolved** 近似 |
| GRACE 的完整 defeasible logic | 定理证明器 / 多接地偏序 | 对几百条规则是过度工程 | 有序规则表 + priority + guard 否决 |
| ITEM 的迭代效用判断 | 多轮 LLM 调用 | 零依赖插件自己不能调模型 | 宿主 agent 代劳，插件只存 `topicScore/utilityScore` |
| SCL 的 controller | 运行时工具循环 | 属于 agent runtime，不是存储层 | 只借「提案不是状态」「断言必须引用证据键」 |
| **时间衰减**（Ebbinghaus / 半衰期） | 无技术依赖，但**语义错误** | 论文 [2604.11364](https://arxiv.org/abs/2604.11364) 的核心批评：把「最近没被访问」当成「不太真」是类别错误。事实不会因为过了 69 天变假 | **衰减放查询期**（排序/提醒），**不放存储期**（不改 truth status）；只让「注意力」衰减 |

---

## 4. 如果只能选 3 条：选哪 3 条、为什么、怎么用纯 JSON 实现

> 选择标准：① 直接回答「凭什么信 / 什么时候作废」；② 不依赖 embedding、图数据库、外部服务；③ 在几百条规模下 O(n) 或 O(n+e) 可接受；④ 有真实代码或明确规格可对照。

### 机制 1：来源分层 + 写入门控（provenance gate）

**为什么**：这是「凭什么信」的第一道闸。当前插件最大的漏洞不是记得少，而是**模型写的猜测和用户说的话在存储里长得一样**。vectr 的核心洞察：可信度不是一个模型自报的 float，而是**写入时就固定下来的结构性事实**；而且**主体不能给自己发证书**。

**JSON 结构**（挂在现有记忆对象上）：

```ts
type Origin = "human" | "agent" | "auto";

interface TrustFields {
  origin: Origin;                 // 写入时固定，只能单步晋升
  originHistory: { from: Origin; to: Origin; at: number; by: "agent" | "user" }[];
  grounding?: {                   // 准则/事实类条目才需要
    quote: string;                // 逐字引用，不接受转述
    sourceId: string;
    location: string;
    ratifiedBy: string;
    ratifiedAt: number;
  };
  stale?: { anchor: string; hash: string; changedAt: number }; // 可选：文件类锚点
}
```

**规则（写死在代码里，不交给模型）**：

| origin | 可写普通记忆 | 可写准则 | 可作为常驻指令 |
|---|---|---|---|
| `human` | ✓ | ✓（且必须有 grounding） | ✓ |
| `agent` | ✓ | 只能写 `candidate` 状态 | ✗ |
| `auto` | ✓ | ✗ | ✗ |

- 记忆写入工具的 schema 只接受 `agent | auto`；`human` 只能由用户侧动作产生。
- 晋升**一次一级**（auto→agent 由 agent 工具做；agent→human 只能用户做）；**不允许降级**；跳级直接拒绝。
- 准则条目没有 `grounding.quote` → 状态只能是 `candidate`，不进生效集。
- 召回时**把等级花在措辞上**（agent 只看得见文本，看不见 schema）：
  - human → `用户确认：…`
  - agent → `AI 记录（待核实）：…`
  - auto → `自动捕获（最弱，使用前核实）：…`

**复杂度**：O(1) 写入检查。**验收**：写 `origin:"auto"` 的 directive 必须抛错；agent 调用晋升到 human 必须被 schema 拒绝。

---

### 机制 2：结构矛盾 + 优势阈值 + unresolved + tombstone

**为什么**：这是「什么时候作废」的直接答案。现有系统最常见的错是**用「新」覆盖「旧」**——新的不一定对；更糟的是覆盖后什么都不留。LeAP 的做法是：矛盾判定用结构（可判定、零依赖），作废要**显著优势**，不显著就**两条都留、标成未解决**。vectr 补上「撤回不是删除，是立碑」。

**JSON 结构**：

```ts
type SupersedeReason = "contradiction" | "evidence_shift" | "author_update" | "evidence_erased" | "manual";

interface ClaimFields {
  spo?: { s: string; p: string; o: string };   // 有则参与结构矛盾判定
  confidence: number;                          // 由代码算，不由模型报
  conflictGroupId?: string;                    // unresolved 时同组
  supersededBy?: string;
  supersedeReason?: SupersedeReason;
  tombstone?: { revokedAt: number; reason: string; replacedBy?: string };
}
```

**算法**：

```
onWrite(new):
  for old in activeMemos where sameTopic(old,new) and sameKey(old,new):
    if sameObject(old,new): corroborate(old,new); return
    if new.confidence >= 1.2 * old.confidence:
        old.validTo      = new.validFrom ?? now   // 世界何时变
        old.supersededAt = now                    // 我们何时知道
        old.supersededBy = new.id
        old.supersedeReason = "contradiction"
    else if old.confidence >= 1.2 * new.confidence:
        new.status = "rejected"; new.tombstone = {...}
    else:
        g = newGroupId(); old.conflictGroupId = g; new.conflictGroupId = g
        // 两条都 active，召回时并排呈现
```

- `sameKey`：有 `spo` 用 `(s,p)`；没有就要求写入方给 `claimKey`；**两者都没有就不做矛盾判定**（不猜）。
- `confidence` 用简单可算的式子，别让模型报：`tier(origin) × (1 − e^(−0.5 × 独立来源数)) × evidenceWeight`，其中 `tier`: human 1.0 / agent 0.6 / auto 0.4，`evidenceWeight`: 有 grounding 0.85 / 无 0.6。数值可调，重要的是**可复算、可解释**。
- 双时态要分开写：`validTo` 是「世界上何时不再为真」，`supersededAt` 是「我们何时知道」。这两个时间经常不同，插件的现有字段正好支持。
- **superseded ≠ revoked**：被更好的证据取代 = superseded；发现它本来就是错的 = revoked（立 tombstone）。两种状态不要合并。
- 召回渲染：`曾经相信（记录于…，作废于…，原因：…）：“…” 不要未经核实从其他来源重新推导此结论。`

**复杂度**：同主题同 key 的线性扫描，几百条无压力。**验收**：1.1× → unresolved 且两条 active；1.3× → 旧条 superseded 但仍可检索；tombstone 渲染出现。

---

### 机制 3：依赖边 + 稳固度 + 撤回传播（TMS 精简版）

**为什么**：一条错误的基础记忆会悄悄污染所有从它推出来的东西（总结、反思候选、准则）。没有传播，插件只能保证「单条可信」，保证不了「一组推理可信」。ftl-reasons 证明了这在几百节点上就是一个 BFS；entrenchment 让「先牺牲谁」可解释。

**JSON 结构**：

```ts
interface Justification {        // 外层数组 = OR（任一条成立即可）
  in: string[];                  // AND：全部 active 才算成立
  out?: string[];                // 非单调：这些必须不 active
}

interface DepNode {
  id: string;
  justifications: Justification[];
  dependents: string[];          // 反向索引，写入时维护
  status: "active" | "suspect" | "superseded" | "revoked";
  staleBecause?: string[];
}
```

**稳固度（照 ftl-reasons 的思路，可按插件调整）**：

```
entrenchment = (origin === "human" ? 100 : origin === "agent" ? 50 : 20)
             + (grounding ? 50 : 0)
             + (sourceHash ? 25 : 0)
             + dependents.length * 10
             + (kind === "principle" ? 40 : kind === "observation" ? 20 : 10)
```

**传播算法**：

```
onInvalidate(root):
  queue = [...dependentsOf(root)]
  while queue:
    n = pop
    if everyJustificationInvalid(n):        // OR 全失效
        n.status = "suspect"
        n.staleBecause.push(root)
        queue.push(...dependentsOf(n))
```

- **只标 suspect，不删除、不自动改 truth**。恢复（restore）时反向重算，能自动回到 active。
- 冲突裁决（nogood）时，按 entrenchment **升序**挑「最不稳固的」撤回——这就是「凭什么信」的可解释版本。
- 规模：几百节点、边数同量级，O(n+e)，不需要索引；环用 visited 集合截断。

**验收**：作废基础记忆 → 依赖它的准则变 suspect 但不消失；恢复基础 → 准则自动恢复；两条 justification 的节点，只有一条失效时仍 active。

---

### 为什么不是其他几个

- **不选 ITEM**：它解决「哪条记忆对回答更有用」，不解决「这条记忆可不可信」；且要多次 LLM 调用，违反零依赖。可以留作查询期的排序启发，不进核心。
- **不选 SCL**：propose/verify 是运行时循环，插件不该接管工具调用；其精神已被机制 1（写入前校验）+ 反思候选（人工确认）覆盖。
- **不选 GRACE 的完整逻辑**：道义逻辑的形式化对几百条准则是过度工程；只保留「规范在模型外 + 优先级 + 否决」的骨架，已经并入机制 1/2。
- **不选 HADES 整体**：ArangoDB + 向量 + GNN 三重依赖；只把 `verbatim_source + IS/IS_NOT` 折进机制 1 的 `grounding`。

---

## 5. 落地顺序与风险

1. **先做机制 1**（半天量级）：字段 + 写入门控 + 召回措辞。它立刻改变「模型说什么都算数」的现状。
2. **再做机制 2**：先只支持有 `spo`/`claimKey` 的条目；散文记忆先不做矛盾判定，避免误判。
3. **最后做机制 3**：先只覆盖「反思候选 → 来源记忆」这一种依赖，跑通再扩到准则。

**风险**：
- 过度标 `suspect` 会让记忆不可用 → 只传播到「全部 justification 失效」，且保留原文。
- 阈值 1.2 是 LeAP 的经验值，不是定律 → 做成配置项，默认 1.2，可调。
- `confidence` 一旦让模型自报就会变成装饰 → 必须由 `origin + 来源数 + 是否有 grounding` 算出来。
- `unresolved` 必须在召回时**两条一起出现**，否则等于偷偷选了一个赢家。

---

## 6. 参考链接（按可信度排序）

**A（同行评审）**
- GRACE: https://arxiv.org/abs/2601.10520 ｜ https://ojs.aaai.org/index.php/IASEAI/article/view/43029
- ITEM: https://aclanthology.org/2026.findings-acl.1579/ ｜ https://arxiv.org/abs/2406.11290

**B（预印本）**
- SCL: https://arxiv.org/abs/2510.05107 ｜ 后续版 https://arxiv.org/abs/2511.17673 ｜ 审稿意见 https://pith.science/paper/2510.05107
- LeAP: https://zenodo.org/records/21029662 ｜ 实现 https://github.com/engrammic-ai/primitives
- OIDA: https://arxiv.org/abs/2604.11759
- Kumiho: https://arxiv.org/abs/2603.17244
- 四层持久化语义（LeAP 同源）: https://arxiv.org/abs/2604.11364

**C（工程博客 / 开源）**
- HADES: https://github.com/toddwbucy/HADES-burn ｜ 方法论 https://github.com/toddwbucy/HADES-burn/blob/main/Bastion/graph-methodology.md
- ftl-reasons: https://github.com/benthomasson/ftl-reasons ｜ 背景长文 http://benthomasson.com/ai/tools/beliefs/classical-ai/classical-ai-solved-your-llms-problems-revised
- vectr 信任阶梯: https://dev.to/swapnanilsaha/agent-memory-needs-a-trust-ladder-provenance-revocation-and-notes-that-lie-3ig1
- Veritas（仅宣称，仓库空壳）: https://github.com/AILIFE1/veritas ｜ https://www.thecolony.ai/post/aa173566-7bae-4733-bdc0-dd0255af8837

**未找到可靠来源**
- `veritas-tms`：不存在（GitHub 搜索 0 结果）。
- HADES 的 `anchoredTo`：全仓库 0 命中；最接近的是 source/supersedes 边，不是同名字段。
