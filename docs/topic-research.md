# 主题（Schema）模块调研：该不该留、要不要特化

调研时间：2026-11-03
调研方法：内部代码审计 + 论文检索（独立复现优先）+ 业界实践对照

---

## 一、内部审计：这个模块目前在做什么

### 1.1 能力清单（graph.ts，703 行）

| 能力 | 方法 | 实际被用到吗 |
|---|---|---|
| 同化 / 顺应 | `assimilate` / `accommodate` | 仅测试与导入 |
| 带类型的边（support / contradict） | `connect` / `neighbors` / `tensions` | 仅测试 |
| 社区检测 | `communities` | **从未调用** |
| 抽取式摘要 | `summarize` | 仅 UI 展示 |
| 层级构建 | `buildHierarchy` / `hierarchy` | 仅 UI 展示 |
| Personalized PageRank | `personalizedPageRank` | 联想召回（需有主题） |
| 代表成员 | `representatives` | **从未调用** |

### 1.2 致命事实：**从未产出过任何数据**

```
当前真实状态：记忆 9 条，主题 0 个
```

原因有三条，每一条都足以致命：

1. **主写入路径不接入**
   `cognition_remember`（agent 工具）**从不调用 `graph.ingest`**。
   只有「UI 新建记忆」「导入」「反思 synthesis」三条冷路径会喂图。

2. **不持久化**
   `graph` 没有序列化逻辑，每次重启归零，且启动时不从记忆重建。

3. **自动聚类在纯字面相似度下不可用**
   零依赖、无向量库，只能用字头二元组余弦。这种相似度做聚类，
   边界完全不可控（我们的准则本去重实测过：只差几个字 = 0.759，同义改写 = 0.694）。

### 1.3 于是连带空转的

`expand`（顺藤摸瓜）、PPR 联想重排、社区摘要、层级——**全部依赖主题存在**，
主题为 0 时这些全是死代码。

---

## 二、借鉴来源复盘：**我们借错了任务域**

| 来源 | 它的任务 | 我们借的 | 问题 |
|---|---|---|---|
| **CAM**（NeurIPS 2025, arXiv:2510.05520） | **长文档阅读理解**（long-form QA / 摘要 / 断言验证） | 增量重叠聚类、同化/顺应 | 长文档需要**压缩大量文本**；个人记忆只需**精确取少量事实**，目标相反 |
| A-MEM（arXiv:2502.12110） | 卡片盒式动态链接 | `linkedBy` 说明 | 消融基线本身有问题（见 §3.1） |
| GraphRAG | 大语料全局问答 | 社区摘要 | 见 §3.2，社区检索在细节型 QA 上更差 |
| RAPTOR | 递归聚类 + 逐层摘要 | 树状检索 | 同上 |
| HippoRAG | 知识图 PPR | 联想召回 | 作者自认在基础事实记忆上不如标准 RAG |

**CAM 原摘要原文**：
> "Current LLMs are confronted with overwhelming information volume when comprehending **long-form documents**...
> an incremental overlapping clustering algorithm for structured memory development"

它的输入是**一篇长文档**，输出是能回答全局问题的结构化记忆。
而我们的输入是**跨会话的零散约定**，总长才几千 token——**根本不需要压缩**。

---

## 三、论文证据（独立复现优先）

### 3.1 结构化收益比宣传的小得多

| 证据 | 数字 | 来源 |
|---|---|---|
| **Mem0 自己的消融** | 图记忆只比「向量 + 更新语义」高 **约 2%** | arXiv:2504.19413 |
| **Zep 自己的对比** | DMR 94.8% vs MemGPT 93.4%——但**全量上下文基线就有 94.4%** | arXiv:2501.13956 |
| **A-MEM 消融** | 去掉链接+演化后 Multi-hop 45.85→24.55；但"无结构"基线单跳仅 9.65，**低于同论文朴素基线 25.02**，消融不干净 | arXiv:2502.12110 |
| **HippoRAG 2** | 联想记忆 +7%，作者自认基础事实记忆低于标准 RAG | arXiv:2502.14802 |

### 3.2 独立第三方复现：**结构化反而是净损失**

**SubtleMemory**（arXiv:2606.05761，EMNLP 2026 Findings，1522 题）：

| 方案 | 准确率 |
|---|---|
| 理想条件（原始对话直灌） | **85.4%** |
| 最好的独立记忆系统 A-Mem | 70.0% |
| Mem0 | 69.0% |
| EverMemOS | 68.1% |
| MemOS | 56.8% |
| Memobase | 32.1% |

> **在它测的规模上，「把原文直接给模型」比任何结构化记忆系统都准 15 个点。**

**RAG vs GraphRAG**（arXiv:2502.11371，第三方统一协议）：

| 数据集 | 纯向量 | 最好图方法 |
|---|---|---|
| Natural Questions (F1) | **64.78** | GraphRAG Local 63.01 / Global 54.48 |
| HotpotQA | 60.04 | HippoRAG2 63.01 |
| MultiHop-RAG | 67.02 | 70.27 |

> 结论是**互补而非一致赢家**；而且社区全局检索**伤害细节型 QA**。

**GraphRAG-Bench**（arXiv:2506.02404，9 种图方法）：

```
无检索      70.68
BM25        71.66
TF-IDF      71.71
GraphRAG    72.50
HippoRAG    72.64
RAPTOR      73.58
```

> 从 BM25 到最好的图方法只差 **1.9 个点**，但 GraphRAG 构造成本 **7993 万 tokens**、检索 44.87 秒/查询。

### 3.3 没有任何论文研究「我们这种规模」

- 无任何论文在 **10² 条记忆**规模做「聚类 vs 平铺」对照
- Zep 无「去掉社区层 vs 纯向量」的消融
- 所有正收益都在 **10⁴–10⁶ token / 多会话**尺度

### 3.4 基准本身也在打架

- Mem0 给 Zep 65.99 / 自己 66.88；Zep 反指 Mem0 配置跑错
- Zep 自我更正 LoCoMo 头条数字 **84% → 58.44%**
- Mem0 重跑 A-Mem 得分 39.79 / 18.85 / 54.05 / 49.91

**这个领域的公开数字可信度很低，不能拿来指导架构决策。**

---

## 四、业界实践：生产级产品**根本不做主题层**

来自对 ChatGPT / Claude / Claude Code / Codex / Gemini CLI 的逆向调研
（[LLM 记忆系统调研 2025](https://lin-guanguo.github.io/llm-memory-research/blog.1.chinese/)）：

| 产品 | 记忆方案 |
|---|---|
| ChatGPT | **33 条事实摘要，始终注入**（≈ 我们的准则本） |
| Claude | 按需检索工具调用（≈ 我们的 cognition_recall） |
| Claude Code | JSONL + 纯文本摘要，**无 RAG、无知识图谱** |
| Codex | JSONL + JWT 压缩 |
| Gemini CLI | 服务端，每次压缩生成新会话文件 |

> 原文：*"没有复杂的 RAG 管道，没有知识图谱，就是朴素的滑动窗口 + 摘要压缩。
> 这与学术论文中讨论的各种高级方案形成鲜明对比。"*

**我们现在的设计（准则本常驻 + 按需召回）恰恰和生产实践一致。主题层是唯一"学术超标"的部分。**

---

## 五、对我们这种规模意味着什么

### 5.1 规模算一下就清楚

```
300 条记忆 × 50–100 tokens ≈ 15,000 – 30,000 tokens
```

**现代模型的上下文窗口完全装得下。** 这个规模下：
- 最优解是「**不压缩、全量进上下文**」
- 聚类/社区/层级是**为压缩服务**的，而这里不需要压缩
- 压缩反而引入损失（SubtleMemory：85.4% → 70.0%）

### 5.2 我们已有的两层已经覆盖了主题的全部价值

| 主题层声称的价值 | 我们已有的替代 |
|---|---|
| 结构化组织 | 记忆的 `subject` 字段（显式，比自动聚类准） |
| 矛盾检测 | `memory.conflicts()`（同 subject 区间重叠） |
| 注入压缩 | 准则本（600 字符，蒸馏过） |
| 检索扩展 | 同一 `subject` 下直接取 |
| 摘要 | `buildCoreDigest` + 准则本 |

**结论：主题层在我们这里没有一项独特价值。**

---

## 六、三个方案

### 方案 A：删掉

- 删除 `graph.ts`（703 行）+ 主题页签 + 相关测试/评测
- 代码量 −9%，认知负担显著下降
- 风险：`expand` 联想召回、PPR 一起消失（但它们本来是空转的）

### 方案 B：降级为「按主题浏览」（推荐）

- **保留「主题」这个用户概念，但去掉自动聚类**
- 主题 = 记忆的 `subject` 字段（已有），UI 按 subject 分组展示
- 新增：跨 subject 的矛盾检测（相似度 + 否定词，复用准则本那套，实测 0.38 阈值）
- 删除：`assimilate` / `accommodate` / `communities` / `buildHierarchy` / PPR / 边类型
- 收益：从 703 行降到 ~150 行，且**每一条都有明确用途**

### 方案 C：接线保留现状

- 把 `cognition_remember` 接上 `graph.ingest`，加持久化
- **不推荐**：接上之后也只是让一个无证据支持的模块开始产生数据，
  而且字面相似度聚类的质量会立刻暴露

---

## 七、真正该投入的方向（有证据支持的）

按投入产出排序：

1. **元数据**：时间 / 主体 / 类型 / 来源 —— 我们的双时态已经在做，继续加深
2. **显式失效语义**：`supersedes` + validTo —— 已做
3. **保留原文**：`recall` 返回原文而不是摘要 —— 已做（SubtleMemory 证实这是关键）
4. **更新语义**：ADD / UPDATE / DELETE / NOOP —— Mem0 的真收益在这里（图只 +2%）
5. **关键词 + 时间衰减 + 主体过滤** —— 我们已有，BM25 级效果已接近最好图方法

---

## 八、来源

### 论文

- CAM: Constructivist Agentic Memory — [arXiv:2510.05520](https://arxiv.org/abs/2510.05520)（NeurIPS 2025）
- A-MEM — [arXiv:2502.12110](https://arxiv.org/abs/2502.12110)
- Mem0 — [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)
- Zep / Graphiti — [arXiv:2501.13956](https://arxiv.org/abs/2501.13956)
- HippoRAG 2 — [arXiv:2502.14802](https://arxiv.org/abs/2502.14802)
- SubtleMemory — arXiv:2606.05761（EMNLP 2026 Findings）
- RAG vs GraphRAG 统一评测 — [arXiv:2502.11371](https://arxiv.org/abs/2502.11371)
- GraphRAG-Bench — [arXiv:2506.02404](https://arxiv.org/abs/2506.02404)
- 长上下文 vs 记忆系统成本 — arXiv:2603.04814

### 行业调研

- [LLM 记忆系统调研：2025 年技术全景与落地真相](https://lin-guanguo.github.io/llm-memory-research/blog.1.chinese/)
  （含 ChatGPT / Claude / Claude Code / Codex / Gemini CLI 逆向）

### 存疑来源（已标注，未采信）

- tsight.io 的 GraphRAG 批评文章标注为「AI 生成情报（gemma-4-26b）」，其「成本 50–100 倍」数字**未经核实**
- dev.to 的 Graph Memory vs Vector Memory 由 ODEI 创始人撰写，属**厂商推广内容**，无方法论细节，未采信
