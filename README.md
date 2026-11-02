# dsh-cognition-engine

> 给 DeepSeek Harness 装一层**可追溯的记忆**、**会自我改组的图式**和**三段式反思**。

一个纯 TypeScript、零运行时依赖的 DSH 插件。所有状态都存在内存 + 本地 JSON，不接数据库、不发外部请求（除非你主动打开真模型）。

> 本项目是 **DeepSeek V4.1-Flash（1017）许愿式编程** 的产物：需求由人提出，代码、测试、评测与文档由模型在会话中逐轮生成、验证并修正。

```
认知引擎  记忆 3 · 图式 2 · 待办 1 · 跨会话摘要  ▸
```

点一下这条状态条，展开五个页签：**状态 / 待办 / 记忆 / 图式 / 设置**。

---

## 为什么做

普通 Agent 的记忆是一个检索管道：切块 → 向量化 → 取最近的。它解决不了四件事：

1. **现在为真 vs 曾经为真**——你说"用 Python"，后来改"用 TypeScript"，两句话都在，它不知道该信哪句。
2. **新信息该挂在哪**——第 20 条偏好和第 3 条是同一个话题，还是该新开一簇？
3. **它对这事什么态度**——被连续否定之后，它还是用同样的语气回答。
4. **决定是怎么来的**——只给结论，不给推理过程。

认知引擎用五个模块分别对应这四条，外加一个长程任务台账兜底"跨会话不忘事"。

---

## 特性

- **双时态记忆**：`validFrom/validTo`（世界时间）+ `recordedAt/supersededAt`（事务时间）。取代不删除，旧版本仍可历史召回。
- **图式网络**：新观察能同化就并入，不能就新建图式并连边；否定陈述会触发冲突而不是硬塞。
- **图式扩展召回**：召回时可按图式把同簇的其他记忆一并带出（`expand`）。
- **三段式反思**：THESIS → ANTITHESIS（CONTRADICTION/EVIDENCE）→ SYNTHESIS，严格串行；可对已有草稿直接审（`draft`），可把结论写回记忆（`save`）。
- **长程任务台账**：`tasks.json` 原子落盘，重启恢复，超时任务自动催办。
- **记忆准入**：写入前过四道关——噪声（ok/thanks）、敏感数据（密钥/卡号）、
  指令注入（"忽略之前的指令"）、权威冲突（低权威不能覆盖高权威）。
  设计移植自 [memoripy](https://github.com/caspianmoon/memoripy) 的 `admission.py`。
- **类型化图式边**：边带 `support` / `contradict` 类型，并附一句话说明
  「为什么这两条记忆相连」。结构参照 [memoryweb](https://github.com/corbym/memoryweb) 的叙事边。
- **矛盾可见**：`cognition_state` 返回 `tensions`（图式之间的矛盾边）与
  `memoryConflicts`（同主题互斥的事实对），冲突不再只是节点上的一個布尔值。
- **纠正记忆**：`cognition_remember` 传 `kind: 'correction'` 会自动打标、提升重要度，
  并在跨会话摘要里置顶——「上次错在哪」比「上次说了什么」更值得记住。
- **记忆会老化**：长期没被想起的记忆自动归档——不进 strict 召回，但历史与联想仍可查到。
- **记忆可归并**：同主题下高度相似的条目可一键合并，被合并的标记 `mergedInto` 而不删除，历史仍可查。
- **记忆可手动修正**：内容、主题、录入时间、有效状态都能改；改过的条目标「已手动修正」，不伪造历史。
- **准入规则可开关**：忽略寒暄 / 拦截密钥 / 拦截指令注入 / 低权威不得覆盖高权威，四条独立开关。
- **任务支持顺序与并行**：可设排序号与前一项并行推进；没有硬性截止时间，只有超时提醒。
- **数据可导出导入**：整库记忆导出为 JSON，也能整体导入替换。
- **一键安装**：Windows 与 dsh-go 各有一条命令的安装脚本。
- **持久化**：记忆写入 `cognition-state.json`，重启自动恢复；页面一键清空。
- **反思引擎**：可在「本地模拟」与「真实模型」之间切换；真实模型走宿主 `llm` 服务。
- **记忆读取锁**：给读取记忆正文的接口加访问口令，防止本机其他进程偷看。

---

## 安装

需要 DeepSeek Harness，Node.js ≥ 22，Git。

### 一条命令（Windows）

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/1720198650/dsh-cognition-engine/main/scripts/install.ps1 | iex"
```

自动完成：克隆到 `%USERPROFILE%\dsh-plugins\dsh-cognition-engine` → 装依赖 → 构建 → 注册到 `desktop` profile。

### 一条命令（Android / dsh-go 本机引擎）

```sh
curl -fsSL https://raw.githubusercontent.com/1720198650/dsh-cognition-engine/main/scripts/install-dshgo.sh | sh
```

### 从 npm（包发布后可用）

```sh
dsh plugin --profile desktop add dsh-cognition-engine
```

### 手动安装

```sh
git clone https://github.com/1720198650/dsh-cognition-engine.git
cd dsh-cognition-engine
npm install && npm run build
dsh plugin --profile desktop add .
```

安装后重启一次 DSH，左侧栏会出现 `◈` 图标。

> 首次启动会生成 `cognition-token.txt`。默认不需要口令即可查看面板；
> 只有在设置页手动开启「记忆读取锁」后才需要。

## 七个工具

| 工具 | 作用 |
|---|---|
| `cognition_context` | **新会话先调它**：读取跨会话核心记忆（≤400 字摘要） |
| `cognition_remember` | 写入记忆；`supersedes` 取代旧事实，`source` 标记来源并决定权威等级，`scope` 选 global / workspace / session，`kind: correction` 记纠正 |
| `cognition_recall` | 按 `strict` / `historical` / `belief` 召回；`render` 走 Inline&Spill，`expand` 按图式扩展，`scope` 过滤作用域 |
| `cognition_forget` | 删除记忆：按 id、按来源（如 `test`、`reflection`）、按主题 |
| `cognition_reflect` | 三段式反思；`draft` 审草稿，`save` 把结论存成记忆 |
| `cognition_state` | 记忆/图式/任务统计与跨会话摘要 |
| `manage_long_task` | 长程任务：create / update / list / due / delete |

---

## 配置

`cordis.patch.yml`：

```yaml
- insert:
    - id: cognition-engine
      name: 'dsh-cognition-engine'
      config:
        decayHalfLifeHours: 168        # 记忆衰减半衰期
        assimilateThreshold: 0.55      # 同化阈值
        overlapThreshold: 0.42         # 重叠聚类阈值
        communityThreshold: 0.3        # 社区连边阈值
        maxClusterSize: 8              # 单簇上限
        tasksFile: ./tasks.json
        stateFile: ./cognition-state.json
        heartbeatHours: 6              # 多久没更新算超时
        patrolIntervalHours: 3         # 后台巡视间隔
        recordOnly: true               # 主动发言只记录不发送
        # lockToken: 你的固定口令
        # llmProvider: deepseek
        # llmModel: deepseek-chat
```

---

## 页面

状态条固定在输入框下方，五个页签：

- **状态**：记忆 / 图式 / 待办计数与跨会话摘要
- **待办**：任务描述、状态、线索、超时标记
- **记忆**：正文、来源徽章、当前/已取代、标签
- **图式**：成员数、邻接数、极性
- **设置**：清空记忆、反思引擎（本地模拟 / 真实模型）、记忆读取锁与访问口令

页面上所有数据走 HTTP，**不进入模型上下文，不消耗 token**。

---

## 数据与隐私

| 项 | 说明 |
|---|---|
| 落盘 | `cognition-state.json`（记忆）、`tasks.json`（任务） |
| HTTP | `GET /cognition-engine/state`（仅计数）、`GET /cognition-engine/detail`（含正文）、`POST /cognition-engine/{clear,model,lock}` |
| 记忆读取锁 | 开启后 `detail` 与三个 `POST` 要求 `x-cognition-token`；`state` 始终公开（只有计数） |
| 外部请求 | 默认零外部请求；只有打开真模型时才会调用宿主配置的模型服务 |

> ⚠️ 不设 `lockToken` 且未上锁时，本机任意进程都能读取记忆正文。多人或多程序共用一台机器时请先上锁。

---

## 卸载

插件**运行时注册的东西**（7 个工具、4 条 HTTP 路由、后台巡视定时器、页面状态条）会在卸载时自动撤销。

但有四样东西不会自动消失，需要显式清理：

| 残留 | 说明 |
|---|---|
| `cognition-state.json` | 记忆的落盘 |
| `tasks.json` | 长程任务台账 |
| `AGENTS.md` 第九节 | 会继续指示模型调用已不存在的 `cognition_context` |
| 浏览器 `localStorage['cognition-token']` | 上锁口令 |

清理脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-cleanup.ps1 -Workspace "<工作区目录>"
```

然后移除插件本体：

```text
plugin_manager remove_bundle target=dsh-cognition-engine
```

最后在页面控制台执行 `localStorage.removeItem("cognition-token")`，刷新页面。

> 为什么不在 `dispose` 里自动删数据：`dispose` 在 HMR 热重载和插件重启时也会触发，自动删会把记忆每改一次代码就清空一次。运行时资源自动撤、磁盘数据交给显式脚本，是刻意的分工。

---

## 架构

| 模块 | 职责 | 设计来源 |
|---|---|---|
| `memory.ts` | 双时态存储、三种召回、冲突检测、Inline&Spill | [LongMemory](https://github.com/CaviraOSS/LongMemory) |
| `graph.ts` | 图式网络、同化/顺应、重叠聚类、图式扩展 | [CAM](https://github.com/rui9812/CAM)（NeurIPS 2025） |
| `reflection.ts` | 三段式反思、Worker 队列 | [Hegelion](https://github.com/Hmbown/Hegelion) |
| `proactive.ts` | 默认不做的发言闸门 | [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) |
| `task_manager.ts` | 长程任务台账、原子落盘 | 自研 |
| `persist.ts` | 记忆快照存储 | 自研 |
| `views.ts` | 页面只读视图 | 自研 |
| `tools.ts` | 七个工具的参数表与执行体（状态全部来自依赖注入） | — |
| `util.ts` | 无状态纯函数：参数收敛、schema 自检、异常转文本 | — |
| `index.ts` | 插件装配：建实例、注册工具、HTTP 路由、巡视、生命周期 | — |
| `client.js` | 输入框下方的状态条与面板 | — |

反思闭环参考了 [Generative Agents](https://arxiv.org/abs/2304.03442) 的「记忆 → 反思 → 回写记忆」；图式扩展参考了 [GraphRAG](https://github.com/microsoft/graphrag) 的社区扩展思路。

---

## 开发

```sh
npm install
npm run build      # tsc → lib/
npm test           # 33 项单元测试
npm run eval       # 20 条评测 + token 预算门禁
```

`npm run eval -- --update` 在确认变好之后重写基线。

### 质量门禁

- 单元测试 33 / 33
- 评测用例 20 / 20，判分器自检、打包自检 5 项
- 工具 schema 固定开销 **1086 tokens**（预算 1400）
- 单次调用输出上限 344 tokens（预算 600）

---

## 时间旅行

双时态意味着同一个问题可以问三次，得到三个**都不一样但都正确**的答案：

```
现在：部署区域定在哪？        → strict       → 华东（当前真值）
十月：那时定的是哪？          → historical   → 华南（那时为真）
十月：你当时知道改过吗？      → belief       → 不知道（那时还没记录）
两次都说说：                  → associative  → 华东 + 华南（不过滤时间）
```

旧值不会消失——被取代的记忆保留 id 与 hash，只闭合 `validTo`、标记 `supersededBy`，
所以「上次是怎么说的」永远查得到。

这是别的记忆插件做不到的部分：它们记住**结果**，我们连**变迁过程**一起记住。

---

## 兼容性

**设计原则**：只做特性探测，不做版本判断；任何宿主能力缺失都降级而不是报错。

| 场景 | 行为 |
|---|---|
| 与其他插件工具重名 | 跳过该工具并记警告，其余 6 个照常注册 |
| HTTP 路由被占用 | 跳过该路由，插件继续加载 |
| 宿主没有 `webServer` / `events` / `effect` | 对应功能静默关闭，不抛错 |
| `agent/pre-step` 的 `next` 缺失 | 返回 `undefined`，不阻断模型步骤 |
| 宿主更新导致工具 schema 不被接受 | 该工具注册失败，但不影响其他工具 |

**刻意不做的事**（避免和其他插件打架）：不修改全局 patch、不覆写系统提示、不接管 `tools/post-execute`、不声明 `peerDependencies`（避免 pnpm 的 `ERESOLVE`）。

**已验证环境**：DSH 0.1.x（desktop profile）+ Node 22。每次 `npm run eval` 都会回归「兼容性」三项。

---

## 已知限制

1. **记忆是进程内 + 单文件**，没有并发多实例保护；两个 DSH 同时写会互相覆盖。
2. **反思默认用离线确定性推理器**，不是真思考；打开真模型后才由模型生成。
4. **上锁是共享口令**，不是账号体系；口令泄露即失效。
5. 真模型输出可能很长（一次反思可达数千 token），请自行控制使用频率。

---

## 参考与致谢

本项目的机制设计来自以下开源工作。**只借鉴思想，未复制任何代码**——所有实现均为重新编写。

### 记忆与图式

| 项目 | 借了什么 |
|---|---|
| [LongMemory](https://github.com/CaviraOSS/LongMemory) | 双时态模型：`validFrom/validTo` 与 `recordedAt/supersededAt` 两条时间轴；半开区间判定；闭合区间不改变内容指纹与 id |
| [CAM: A Constructivist View of Agentic Memory](https://github.com/rui9812/CAM)（NeurIPS 2025） | 增量重叠聚类、同化 / 顺应、超图摘要、簇大小上限 |
| [A-MEM: Agentic Memory](https://arxiv.org/abs/2502.12110)（NeurIPS 2025） | 卡片盒式动态链接：新笔记写入时分析历史笔记并建立语义连接。本项目的 `linkedBy` 记录「为什么连上它」（共享词 + 相似度）即源于此 |
| [MemGPT / Letta](https://github.com/letta-ai/letta) | 记忆分层与分页（对照参考） |
| [GraphRAG](https://github.com/microsoft/graphrag) | 社区摘要参与检索；本项目的「图式扩展召回」是其最小实现 |
| [RAPTOR](https://arxiv.org/abs/2401.18059) | 递归聚类 + 逐层摘要的树状检索。本项目改为**抽取式**摘要——父图式取与质心最接近的成员原文，避免每层调用 LLM |
| [HippoRAG: Neurobiologically Inspired Long-Term Memory for LLMs](https://arxiv.org/abs/2405.14831)（NeurIPS 2024） | Personalized PageRank 在知识图上传播相关度。本项目 `associative` 召回用它在图式网络上重排，让「隔一层但相关」的记忆浮上来 |

### 论文引用

实现中直接用到的三篇：

- **HippoRAG** — Gutiérrez et al. *HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models.* NeurIPS 2024. [arXiv:2405.14831](https://arxiv.org/abs/2405.14831)
- **RAPTOR** — Sarthi et al. *RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval.* [arXiv:2401.18059](https://arxiv.org/abs/2401.18059)
- **A-MEM** — Xu et al. *A-MEM: Agentic Memory for LLM Agents.* NeurIPS 2025. [arXiv:2502.12110](https://arxiv.org/abs/2502.12110)

图式网络的建构主义框架另见 CAM（NeurIPS 2025），辩证反思的 Prompt 编排另见 Hegelion，见下方各节。

### 信念修正与图结构

| 项目 | 借了什么 |
|---|---|
| [memoripy](https://github.com/caspianmoon/memoripy)（★693） | **`admission.py` 的准入管线**：噪声过滤、敏感数据隔离、指令注入拦截、权威冲突判定（`_higher_authority_conflict`）；以及「不可变版本 + 完整历史」的模型 |
| [memoryweb](https://github.com/corbym/memoryweb)（★14） | **叙事边** `Edge{from,to,relationship,narrative}`：边不只有权重，还要说明为什么存在 |
| [Graphiti](https://github.com/getzep/graphiti)（★32k） | 时序边的建模方式（事实随时间为真/失效） |
| [Kumiho](https://arxiv.org/abs/2603.17244)（arXiv:2603.17244） | **typed dependency edges** 的理论依据；AGM 信念修正与图原生记忆的对应关系 |

### 反思

| 项目 | 借了什么 |
|---|---|
| [Hegelion](https://github.com/Hmbown/Hegelion) | 三段式 Prompt 编排：THESIS → ANTITHESIS（`CONTRADICTION:` / `EVIDENCE:` 成对）→ SYNTHESIS，以及合成的验收条件 |
| [Self-Refine](https://github.com/madaan/self-refine) | 生成 → 自我反馈 → 重写的迭代范式 |
| [Reflexion](https://github.com/noahshinn/reflexion) | 反思写回记忆、供下次使用的思路 |
| [Self-RAG](http://selfrag.github.io) | 把反思作为过程内控制信号（对照参考） |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | 「记忆 → 反思 → 回写记忆」闭环；近期性 / 重要性 / 相关性三因子检索 |

### 插件机制

| 项目 | 借了什么 |
|---|---|
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | 准入矩阵与「默认不做」；Inline & Spill 的 `chars + read pointer`；Worker 异步隔离 |
| [dsh-context-doctor](https://github.com/Zhenyu98/dsh-context-doctor) | 工具 schema 的 token 成本量化思路（本项目用真分词器自测） |
| [dsh-tool-squeeze](https://github.com/w2829562572-dev/dsh-tool-squeeze) | 工具结果压缩与原文留存的取舍（评估后未采用） |

### 评测方法

| 项目 | 借了什么 |
|---|---|
| [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) | 数据集 + prompt + 指标绑定；先小样本验证判分器 |
| [SWE-bench](https://github.com/princeton-nlp/SWE-bench) | 容器化复现、缓存键必须含输入 |
| [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) | Task / Solver / Scorer 的可替换分层 |
| [promptfoo](https://github.com/promptfoo/promptfoo) | 声明式用例 + 断言 + 基线对比，CI 中运行 |

### 特别说明

- 本项目由 **DeepSeek V4.1-Flash（1017）** 在「许愿式编程」模式下完成：人提需求，模型负责设计、实现、自测、修复与文档。
- 所有参考项目仅用于理解机制；代码、测试与文档均为原创实现，未包含上述项目的源码片段。
- 若你是上述项目的作者并认为某处借鉴过度，请开 issue，我会调整或移除。

---

## License

MIT

---

## English

`dsh-cognition-engine` is a zero-dependency DeepSeek Harness plugin that adds bitemporal memory, a constructivist schema graph, dialectical reflection, and a long-horizon task ledger. Seven tools, one status dock, everything stored locally.
