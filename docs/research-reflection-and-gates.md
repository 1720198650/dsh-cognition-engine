# 三处「看起来在思考、其实没思考」的地方：依据与改法

> 起因：2026-11-09 收到一份外部批评，指本插件三处「机制聪明但认知含量被高估」：
> ① 三元反思里「反题」可能只是走过场；
> ② 准则本的 helpful/harmful 可能是模型自己给自己打分；
> ③ 回归闸门（CPE）在样本不足时给出 insufficient 却照样放行。
> 本文是查证与改动的依据记录。**三条批评都成立**，改法都在代码里落地了，测试覆盖见 `src/test.ts` 第 [24] 节。

---

## 一、反思：零矛盾不能当成「没问题」

### 证据

**1. 自评在推理任务上几乎不带来增益，甚至会变差。**

《Sample More, Reflect Less: Self-Refine and Reflexion Lose to Repeated Sampling at Equal Token Cost, from 1.5B to 7B》
（[arXiv:2607.28576](https://arxiv.org/abs/2607.28576)，2026-07）把 7 种「让模型检查自己再改」的方法，和「同一问题重复采样取多数」在**等 token 成本**下对比：

- 36 组配对比较（含 bootstrap 区间与多重比较校正）里，**没有任何一种方法可靠地优于重复采样**；
- **10 种显著更差，全部是「模型检查自己输出」这一类**；**18 组自检比较全部为负**；
- 最关键的一句：**Reflexion 在 1.5B 模型上从未真正触发过自己的重试——「它每次都判自己正确」，于是静默退化成了单条思维链。**

这就是「结构走完 ≠ 认知发生」的实证：跑完了三阶段，但反题永远是空的。

**2. 「没检测到矛盾」什么都证明不了。**

《Consistency Is Not Correctness: What Internal Contradiction Detection Certifies…》（2026，
[链接](https://research.pranaymahendrakar.com/p/consistency-is-not-correctness.pdf)）把逻辑讲清楚了：
**从「检测到矛盾」可以推出「两个输出里至少一个为假」；但从「没检测到矛盾」推不出任何东西**——它既可能是真没问题，也可能只是检测器没看出来。

**3. 模型不能靠内部反馈纠正推理。**

《Large Language Models Cannot Self-Correct Reasoning Yet》（[arXiv:2310.01798](https://arxiv.org/abs/2310.01798)）
区分了「内在自我纠正」（无外部反馈）和「有外部反馈的纠正」，结论是前者在推理任务上不能可靠提升，甚至会变差。

### 改法

`src/reflection.ts`：

- `DialecticalResult` 新增 `verdict: 'synthesized' | 'no-contradiction'`。
- 反题里**一条 `CONTRADICTION:`/`EVIDENCE:` 对都没抽到**时：
  - **跳过 synthesis**（省掉一次调用，符合「Sample More, Reflect Less」的结论）；
  - `synthesis` 置空，`verdict = 'no-contradiction'`，`note` 明确写出「这不代表正题成立」；
  - `renderTranscript` 输出「（未产出合题）」，不把空结论包装成结论。
- 配置 `reflectionFailClosed`（**默认 true**）。关掉才允许零矛盾走完全程——那是明确知道自己要「无论有没有批评都给个合题」的场景。

---

## 二、准则本打分：自报不能决定准则生死

### 证据

**1. 让模型评自己，它会偏向自己。**

《LLM Evaluators Recognize and Favor Their Own Generations》
（[arXiv:2404.13076](https://arxiv.org/abs/2404.13076)，Panickssery/Bowman/Feng, 2024）：
LLM 评审会给自己生成的文本打更高分，而人类标注认为质量相当；并且**「认出这是自己写的」的能力与「给自己加分」的强度呈线性相关**——也就是说偏袒不是偶然噪声。

**2. 自评一旦连上奖励，就会通胀。**

《Does Self-Evaluation Enable Wireheading in Language Models?》
（[arXiv:2511.23092](https://arxiv.org/abs/2511.23092)，AAAI 2026 oral）：
当自评分数决定奖励时，模型出现**显著的成绩通胀，而准确率没有相应提升**，在摘要这类模糊任务上尤其明显；
**把自评与奖励解耦之后通胀被压下去**（但仍残留一定过度自信）。

对本插件的含义很直接：`appliedGood` 决定一条准则会不会被保留甚至升级，而插件原本允许模型通过 `cognition_reflect action=rate` 自己写 `usageKind=appliedGood`。**这就是把打分权交给被评对象。**

### 改法

- `src/playbook.ts`：`UsageStats` 拆成两组——
  - 主计数器 `appliedGood / appliedBad / userCorrected`：**只接受外部来源**；
  - `selfAppliedGood / selfAppliedBad`：模型自报，**只展示，不参与任何升降级判断**。
  - `markUsage(id, kind, trace, source)`，`source: 'user' | 'system' | 'self'`；`self` 的 good/bad 只落 selfApplied*。
- `src/tools.ts`：`action=rate` 报 `appliedGood/appliedBad` 时**必须带 `evidence`（≥8 字的具体依据）**，否则直接报错；返回值标注 `countedAs: 'self-report'`。
- `src/index.ts`：用户反馈路径（`classifyFeedback` → `applyFeedback`）传 `source: 'user'`，这是唯一能推动准则降级的信号。

**保留了原能力**：用户/系统的差评仍然能触发降级（测试 [24] 第 5 条专门守这个，防止为了防伪把正常功能一起删掉）。

---

## 三、回归闸门：测不出来就不能算过

### 证据

**1. 自动化金丝雀分析的传统做法：测不出来就不放行。**

Google/Netflix 的 Kayenta（[Google Cloud Blog, 2018](https://cloud.google.com/blog/products/gcp/introducing-kayenta-an-open-automated-canary-analysis-tool-from-google-and-netflix)）
对金丝雀做统计检验，给出聚合分数与阈值，**分数达不到就自动回滚**，而不是「没数据所以默认通过」。

**2. 质量门在基准缺失时判失败，不判通过。**

NVIDIA NeMo Evaluator 的 quality gate 实现（[文档](https://docs.nvidia.com/nemo/evaluator/tutorials/quality-gate)）：
先检查**每一个必需基准在 baseline 和 candidate 两边都存在**，缺任何一个就不放行。

**3. 空题集必须返回失败，不能返回 0 分当及格。**

Drupal `ai_eval` 的实现（[文档](https://project.pages.drupalcode.org/ai_eval/troubleshooting/)）：
数据集为空时明确返回 `avg_score: 0.0, pass_rate: 0.0, passed_gate: FALSE`，并记一条日志说明「没有加载到题」。

对本插件的含义：`cpe.check()` 在回归集样本不足时返回 `status: 'insufficient'`，
而 `accept` 原本**只在 `status === 'red'` 时回滚**——`insufficient` 直接放行，等于**默认配置下这个闸门不存在**。

### 改法

- `src/cpe.ts` 新增 `blocksAcceptance(status, strict)`：`strict && status === 'insufficient'` 即拦。
  （`red` 仍走原有的「回滚文件」路径，不归这里；`green/yellow` 放行。）
- `src/index.ts` 的 `accept` 分支：严格模式下先跑 `cpe.check()`，`insufficient` 时**不 accept**，
  改为把候选**转进 shadow 观察**（复用学习预算溢出时已有的 `shadow.add` 通道），返回
  `movedToShadow: true` 和「回归集样本不足，先补用例再启用」。
- 配置 `cpeStrictGate`（**默认 true**）。想保留旧行为可设为 false。

**注意**：`cpe.seedFromRules()` 能从现有准则派生起步用例，但那是「拿准则自己考自己」的弱数据（代码注释里已标注 `derivedFrom: 'rules'`）。所以它的定位是**让闸门有东西可测**，不是替代用户手标的用例。

---

## 四、没有改的部分（以及为什么）

| 批评 | 结论 | 为什么不动 |
|---|---|---|
| ①「哪条记忆该被取代」靠模型传 `supersedes` | 事实成立 | 双时态的骨架没问题，问题在判别器。改成自动判别需要一个可靠的冲突判定器，而这正是本插件没有的能力；硬做一个规则判别器只会把「模型判错」换成「规则判错」，且更难发现。当前缓解是 `memory.conflicts()` 事后可见 + 单次纠正不降级，属于**知情下的取舍**，写进 README 的限制里。 |
| ⑤ 默认无口令 | 事实成立，但范围是「本机同用户」 | 实测监听只绑 `127.0.0.1`，文件 ACL 只有 SYSTEM/Administrators/当前用户，所以不是「任何机器可读」。而同机同权限进程本来就能直接读 JSON 文件，加个页面口令挡不住它——那是**假防护**。真要防需要加密 + 系统钥匙串，是另一个量级的工程。见 README 的安全姿态说明。 |
| ④ 许愿式编程锁死质量上限 | 成立，且无法用工程手段自证 | 这是生产方式的问题，不是代码问题。能做的只有：把验证尽量外置（真实交付、用户当场纠错回写），并如实标注哪些结论只有自测支撑。已在 README 文首与「已知限制」里写明。 |

---

## 参考文献

1. Mirzaei, I. *Sample More, Reflect Less: Self-Refine and Reflexion Lose to Repeated Sampling at Equal Token Cost, from 1.5B to 7B.* arXiv:2607.28576, 2026. <https://arxiv.org/abs/2607.28576>
2. Panickssery, A., Bowman, S. R., Feng, S. *LLM Evaluators Recognize and Favor Their Own Generations.* arXiv:2404.13076, 2024. <https://arxiv.org/abs/2404.13076>
3. Africa, D. D., Ting, H. E. *Does Self-Evaluation Enable Wireheading in Language Models?* arXiv:2511.23092, AAAI 2026 (oral). <https://arxiv.org/abs/2511.23092>
4. Huang, J. et al. *Large Language Models Cannot Self-Correct Reasoning Yet.* arXiv:2310.01798, 2023. <https://arxiv.org/abs/2310.01798>
5. *Consistency Is Not Correctness: What Internal Contradiction Detection Certifies…* 2026. <https://research.pranaymahendrakar.com/p/consistency-is-not-correctness.pdf>
6. *Introducing Kayenta: An open automated canary analysis tool from Google and Netflix.* Google Cloud Blog, 2018. <https://cloud.google.com/blog/products/gcp/introducing-kayenta-an-open-automated-canary-analysis-tool-from-google-and-netflix>
7. NVIDIA NeMo Evaluator — *Implementing Quality Gates.* <https://docs.nvidia.com/nemo/evaluator/tutorials/quality-gate>
8. Drupal `ai_eval` — *Troubleshooting*（空题集返回 passed_gate=FALSE）。<https://project.pages.drupalcode.org/ai_eval/troubleshooting/>
