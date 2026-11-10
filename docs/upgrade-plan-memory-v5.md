# 记忆模块升级方案 v5：分层记忆 + 离线整合（dreaming）+ token 经济

> 2026-11-10。依据两份材料：
> ① Anthropic《The components of agent memory》（2026，官方研究博客）
> ② HarnessMM: Recursive Self-Improvement for Harness Token Efficiency（[arXiv:2610.32813](https://arxiv.org/abs/2610.32813) v2，2026-11）
> 加上对开源记忆系统的横向核对。本文只写**能落到我们代码里**的部分，不做愿景。

---

## 一、Anthropic 那篇到底说了什么

它的核心不是"加一个记忆库"，而是**记忆的四层结构 + 一个离线整合动作**：

```
会话转录（transcripts，可搜索的事件日志）
    ↑ dreaming
记忆笔记（memory notes，模型自己写的要点）
    ↑ dreaming
记忆表示（representations，如 wiki：页面 + 链接，等于一张地图）
    ↑ dreaming
注入上下文（injected context，每个会话开头预加载的那一小块）
```

四条对我们直接有用的结论：

1. **注入层必须小，且要当索引而不是正文。**
   Claude Code 的 auto memory 只加载 `MEMORY.md` 的**前 200 行 / 25 KB**，剩下靠它自己去查。
   官方还明确警告：指令文件越长，遵循度越低（这正好印证我们 P0-1 把准则从 12 条压到 6 条）。
2. **"dreaming"= 用闲置算力回头看**：拿笔记去跟原始转录对账，改错、合并、建新表示、把该上浮的笔记顶到注入层。
   他们给的例子很实在：Claude 在 Pokémon 里把 PokéCenter 记错了边，走过单向台阶掉回去三次，
   最后写"我决定停下来不再绕圈"。dreaming 用它自己的转录核对，改对那条笔记后就走出去了。
3. **wiki（表示层）+ 搜索 一起用才最有效。**
   25 个问题的评估里：只有搜索 53%，只有 wiki 48%（13%→48% 随 dreaming 规模增长），**wiki+搜索 54%→61%，每题省约 2 万 token**。
   但反例同样重要：某个任务里 wiki 长到比原文还大（10 篇文档 115KB → wiki 203KB），**抽象失败，等于没做**。
4. **别写死"什么值得记"。**
   强制"只记录失败"这条规则，让 Opus 5 的记忆增益从基线掉了 **−0.234**（Opus 4.7 −0.150）。
   对强模型，给判断权比给规则更有效。

## 二、HarnessMM 说了什么（以及不能直接照搬什么）

它做的是 **harness token 效率**：工具调用之后不必每次都让模型重新推理——把已解析的决策编码成
可执行决策图（Executable Decision Graph），带守卫条件复用（Guarded Decision Reuse），
条件不满足就把控制权还给模型。

它报的数字：HumanEval 上保持 93% 成功率（90.82%）同时 token 从 66.72k 降到 47.02k（**−29.54%**）；
DeepSeek Harness 上成功率 71.43%→85.71%，token 96.28k→11.62k（**−87.93%**）。

**必须说清楚**：这些是它自己 harness 上的结果，**不能当成我们插件的预期收益**。
而且它的复用是"决策复用"，我们这边没有等价的强制推理链——照搬会变成"缓存过期结论"，风险更大。

**可借的只有一条原则**：*别重复做已经确定的事*。落到我们身上是：
不是复用"回答"，而是复用"**本轮注入的渲染结果**"，并且**按变更集失效**。

---

## 三、开源项目对照（我们该借什么）

| 项目 | 机制 | 借什么 | 不借什么 |
|---|---|---|---|
| **Mem0**（[2504.19413](https://arxiv.org/abs/2504.19413)） | 抽取→相似检索→ADD/UPDATE/DELETE/NOOP | 写入前先给候选（我们已做 `likelyConflicts`） | 全自动改写，判错就污染 |
| **Zep / Graphiti**（[2501.13956](https://arxiv.org/abs/2501.13956)） | 双时态边 + 失效时间 `t_invalid` | 我们已有双时态；补"失效理由"（已做 `supersedeReason`） | 需要图数据库（我们零依赖） |
| **Letta / MemGPT + sleep-time compute**（[2504.13171](https://arxiv.org/abs/2504.13171)） | 空闲时重组上下文 | **dreaming 的合法来源**：闲置期做整合，不占用户等待 | 常驻大上下文 |
| **A-MEM**（[2502.12110](https://arxiv.org/abs/2502.12110)） | Zettelkasten：新记忆自动连旧记忆、并回写旧条目 | 表示层"链接"的思路 → 我们的 wiki 页 | 每次写入都改旧条目（成本高、易漂） |
| **MemOS / MemoryOS / Cognee / LangMem** | 分层记忆 + OS 式调度 / 图记忆 | 分层（热/温/冷）与"按需加载"的分层纪律 | 引入向量库/图库（违背零依赖） |
| **Claude Code auto memory**（官方） | 注入层只放 200 行索引 | **注入层索引化**，正文留在磁盘 | — |

---

## 四、升级方案（按优先级）

### P0-1 注入层索引化（本周）
**做什么**：注入段从"准则正文"改成"准则标题 + id 列表 + 一句总述"，正文靠 `cognition_recall` 取。
**依据**：Anthropic（注入层 200 行/25KB 当索引）+ 我们已实测的多实例退化（ACL 2026, 1470）。
**做法**：`playbook.renderSection` 增加 `indexOnly` 模式；超 `injectMaxInstances` 时输出
`【准则索引】ctxt-00001 发版六步 / ctxt-00004 …（正文用 cognition_recall 取）`。
**验收**：注入字数下降 ≥40%，且 20 条真实记忆的回放测试中，模型仍能按 id 取到正文（用 `/injected` + `recall` 双查）。

### P0-2 离线整合（dreaming）第一次落地
**做什么**：在心跳/巡视的空闲窗口跑一次"对账"：
1. **改错**：拿 `cognition-audit.jsonl` 和事实库对照，找出「摘要里还留着已被取代的旧说法」；
2. **合并**：同主题下语义重复的活事实，生成一条合并建议（进待审，不自动写）；
3. **上浮**：把 `helpful` 高且未被取代的准则标成"候选索引置顶"。
**依据**：Anthropic dreaming 的三件事（对账/建表示/上浮）+ 我们已有的 CPE 与 shadow 机制。
**做法**：新增 `src/dreaming.ts`，纯规则 + 现有相似度，**不调 LLM**（零成本、可测）；输出写进
`cognition-dream.json`（只追加报告），面板给"采纳/忽略"。
**验收**：在真实数据上跑出至少 1 条「摘要残留旧说法」；单测覆盖改错/合并/上浮三类。

### P1-1 表示层：主题 wiki 页
**做什么**：每个主题一页 Markdown（`~/.dsh/cognition-engine/wiki/<topicId>.md`），由 dreaming 增量维护：
页面 = 该主题的活事实摘要 + 指向相关主题的链接 + 「此处存疑」清单。
**依据**：Anthropic 实测 wiki+搜索 61% vs 纯搜索 53%；但**必须设体积上限**（wiki ≤ 原文 1.0×，超了就砍），
否则就是他们遇到的"地图画成帝国那么大"。
**做法**：`src/wiki.ts`；检索顺序改为 wiki → 事实；面板可编辑。
**验收**：wiki 体积上限断言；同一 query 命中 wiki 时返回的 token 数低于直接取事实。

### P1-2 显著性交给判断，不写死规则
**做什么**：`cognition_remember` 的 description 里给出**判断标准**（"会改变未来动作的才值得记"），
而不是硬编码"只记失败/只记成功"。
**依据**：Anthropic 的"只记失败"让 Opus 5 掉 0.234。
**验收**：不加任何强制过滤；只在面板展示"本周写入条数/去重率"，让人看是否在滥记。

### P2-1 注入渲染的变更集缓存（HarnessMM 的合规版）
**做什么**：缓存"上一轮注入的文本 + 生成它时的指纹"（事实版本号、准则版本号、主题分配）。
指纹没变就直接复用渲染结果；变了就重算。
**依据**：HarnessMM 的"别重复推理"；但**只复用渲染，不复用结论**，避免过期决策。
**验收**：指纹不变时 `/injected` 耗时下降；改了任一准则后立刻失效（单测断言）。

### 明确不做
- 不引入向量库/图数据库（零依赖是硬约束）。
- 不做"全自动记忆改写"（Mem0 式），只给候选。
- 不照搬 HarnessMM 的决策复用（我们无等价推理链，风险大于收益）。

---

## 五、参考文献

1. Anthropic. *The components of agent memory.* 2026. <https://www.anthropic.com/research/components-of-agent-memory>
2. Jiang, Y. et al. *HarnessMM: Recursive Self-Improvement for Harness Token Efficiency.* arXiv:2610.32813, 2026. <https://arxiv.org/abs/2610.32813>
3. Chhikara, P. et al. *Mem0.* arXiv:2504.19413, 2025.
4. Rasmussen, P. et al. *Zep: A Temporal Knowledge Graph Architecture for Agent Memory.* arXiv:2501.13956, 2025.
5. *Sleep-time compute.* arXiv:2504.13171（Letta / UC Berkeley）.
6. Xu, W. et al. *A-MEM: Agentic Memory for LLM Agents.* arXiv:2502.12110, NeurIPS 2025.
7. Claude Code 文档 — memory（注入层 200 行 / 25KB 的依据）。<https://code.claude.com/docs/en/memory>

---

## 七、先行工作补充：ARPM（必须对照）

**A Heterogeneous Temporal Memory Governance Framework for Long-Term LLM Persona Consistency**（[arXiv:2605.14802](https://arxiv.org/abs/2605.14802)）
把"长期人格一致性"当**可审计的治理问题**，拆成：静态知识记忆 / 动态对话经验记忆分离；向量 + BM25 + RRF 融合；**双时间坐标重排**；按时间顺序读证据；受控分析协议做证据校验与答案绑定。

它给了三个直接可用的数字：
- 信噪比 1:5 时，CSV 自动判定召回 54.0%，人工复核 100.0%（**自动规则会低估召回**）；
- **关掉对话历史检索**：严格准确率 100% → 66.7%；关掉 BM25 → 80.0%（**纯语义检索不够**）；
- 在 510 万字符噪声 + 周期清空上下文 + 多模型交接下仍保持连续性。

**对我们的三条结论**：
1. 我们 P1 的 wiki 检索**必须保留关键词通道（BM25）**，不能只靠相似度——这是它的消融直接证明的；
2. 我们的"双时态"要用在**重排**上，不仅是存储（它在重排层用双时间坐标）；
3. 评估要报"自动判定 vs 人工复核"两个数，别只报自动的（否则像它的 54% vs 100%）。