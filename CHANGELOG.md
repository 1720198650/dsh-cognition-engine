# 更新报告

## v0.3.2（2026-11-02）— 补齐论文引用

纯文档更新，无代码改动。

- README 新增「论文引用」一节，列出直接实现的三篇工作：HippoRAG（PPR 重排）、RAPTOR（抽取式层次摘要）、A-MEM（`linkedBy` 连接理由）。
- 修正 A-MEM 与 RAPTOR 的定位：此前标为「对照参考」，实际已在 v0.2.1 落地实现。
- 补上遗漏的 HippoRAG 引用。

## v0.3.1（2026-11-02）— 代码结构整理

纯重构，**不改任何行为**，工具 schema 一行未变。

### 结构

- 新增 `src/tools.ts`：七个工具的定义与执行体搬进工厂函数 `createTools(deps)`，
  状态全部通过 `ToolDeps` 注入（`reflection` / `persistReflection` / `tasksReady` / `config`）。
- 新增 `src/util.ts`：无状态纯函数（参数收敛、schema 自检、异常转文本）。
- `index.ts` **802 → 506 行**，只负责建实例、注册、路由、巡视与清理。

### 修复

- 卸载脚本移除 `AGENTS.md` 章节后，不再残留孤立的 `---` 分隔线。

### 验证

```
死代码扫描  无未使用变量/参数
单元测试   34 / 34
评测      19 / 19 + 打包 5 / 5 + 兼容性 5 / 5
schema    1076 / 1400（未变）
卸载流程   真实 remove_bundle → 工具消失 → install_bundle → 完全恢复，数据保留
```

## v0.3.0（2026-11-02）— 自动召回 + 记忆生命周期

### 新增

- **系统提示自动注入**（P0）：跨会话核心记忆挂进 `systemPrompt.section`，每次装配实时计算，**没有记忆时返回空串、不占 token**。不再依赖 `AGENTS.md` 里那句提醒。
- **记忆老化与归档**（P1）：长期未访问且从未被强化的记忆自动归档。归档只影响 `strict` 召回，`historical` / `associative` 仍可查，**不删任何数据**；由后台巡视触发（`idleDays: 180`、`maxActivation: 1`）。
- **时间旅行文档**（P2）：README 新增一节，用「现在 / 十月 / 两次都说说」演示四种口径的差别。
- **`cognition_state` 展示归档数**：`memory.archived`。

### 兼容性

新增第 5 项自检：**系统提示段注册失败时不拖垮插件**（例如与其他插件段名冲突）。五项全绿。

### 变更

- 从工作区 `AGENTS.md` 移除了第九节「认知引擎」——功能已由系统提示接管，避免双重开销。

### 验证

```
单元测试   34 / 34（新增归档、自动归档两项）
评测      19 / 19 + 打包 5 / 5 + 兼容性 5 / 5
schema    1076 / 1400（不变）
```

## v0.2.1（2026-11-01）— 图检索升级

吸收了 HippoRAG、RAPTOR、A-MEM 三项学术工作的可落地部分，全部零 LLM 调用、零 token 成本。

### 新增

- **Personalized PageRank 重排**（HippoRAG，[arXiv:2405.14831](https://arxiv.org/abs/2405.14831)）
  `associative` 模式现在把命中图式当种子，在加权图上做 20 轮幂迭代传播，
  让「隔一层但相关」的记忆也能浮上来，而不是只按文本相似度排序。
- **抽取式层次摘要**（RAPTOR 的零成本替代，[arXiv:2401.18059](https://arxiv.org/abs/2401.18059)）
  多级图式的父节点现在带 `summary`：取与质心最接近的成员原文，
  不再只是 `label / label` 的拼接。
- **连接理由**（A-MEM 的动态链接，[arXiv:2502.12110](https://arxiv.org/abs/2502.12110)）
  顺应时记录 `linkedBy: { schemaId, score, terms }`——这条新事实为什么连上那个图式、
  共享了哪几个词，都能回答。

### 验证

```
单元测试   31 / 31（新增 PPR 传播、连接理由两项）
评测      19 / 19 + 打包 5 / 5 + 兼容性 4 / 4
schema    1076 / 1400（不变，全部是内部计算）
```

## v0.2.0（2026-11-01）— 移除心情状态机

**破坏性变更**：删除 `mood.ts`（能量 / 好感 / 六种状态标签 / 迟滞阈值）。

**为什么删**：三根支柱——LongMemory 的双时态记忆、CAM 的建构主义图式、Hegelion 的辩证反思——里没有它。它也不驱动任何模型行为，只是在页面上画了一根进度条。留着会让人误以为它有用。

**连带移除**：

- 记忆的 `sentiment` 字段（它唯一的消费者就是心情）
- `recallWithMeta()` 的 `sentimentSum` / `isNostalgic`
- `cognition_state` 的 `event` / `intensity` 参数
- `agent/pre-step` 监听器（它的全部工作就是心情结算）
- 配置项 `initialEnergy` / `initialFavorability` / `energyDrainPerMinute`
- 页面状态条上的能量 / 好感，以及「心情」页签
- 清空路由的 `scope=mood`

**保留**：图式的 `isConflict` / `cognitiveDissonance`——它有独立语义，将来可以用于提示「这条记忆与已有图式冲突」。

| 项 | 变化 |
|---|---|
| 工具 schema | 1159 → **1076**（-83） |
| 代码 | 约 -700 行 |
| 单元测试 | 33 → 29 |
| 评测 | 20 → 19 |

**存档兼容**：旧 `cognition-state.json` 里多出来的 `mood` / `sentiment` 字段会被忽略，记忆本身不受影响。

## v0.1.1（2026-11-01）

本次更新把记忆、图式、情绪三者打通，补上跨会话能力，并做了一轮兼容性与体积优化。

### 新增

- **情绪感知记忆**：事实可带 `sentiment`（-1..1）；取代旧事实时触发 `CONFLICT`，怀旧召回触发 `NOSTALGIA`，批量情绪触发 `SENTIMENT_BATCH`。
- **联想召回 `associative`**：不做时间过滤，被取代的、未来的都参与排序，并自动带图式关联。至此四种口径齐了：`strict` / `historical` / `belief` / `associative`。
- **跨会话核心记忆**：新增工具 `cognition_context`，返回 ≤400 字的核心摘要；配合工作区 `AGENTS.md` 一行指令，新会话开头即可"想起上次定的事"。
- **记忆作用域**：`global` / `workspace` / `session` 三级；`session` 写入自动绑定当前会话。
- **多级图式层次**：对齐 CAM 的 `run_hierarchy`，社区 → 父图式 → 更高层，直到收敛；图式扩展召回会爬到最高层祖先再展开。
- **卸载清理脚本** `scripts/uninstall-cleanup.ps1`：删数据文件并从 `AGENTS.md` 摘掉相关章节。

### 优化

- **反思引擎**：改用 Hegelion 的 JSON 输出契约（`response_style='json'`），矛盾提取从正则扫文本改为读结构；解析失败自动回退文本格式。新增结果缓存（同 query 不重复调模型）与单段 90 秒超时。
- **Token**：工具 schema 1237 → **1159**（-78）；`cognition_state` 输出去掉 `communities` 数组，每次调用再省约 60 tokens。
- **图式层次重建**：加脏检查，没有新建图式时跳过 O(n²) 的父层连边。
- **命名**：面板「真模型」改为「反思引擎」（本地模拟 / 真实模型），「上锁」改为「记忆读取锁」，并补充说明文字。

### 修复

- **落盘文件损坏导致插件无法加载**：现在会把坏文件改名为 `*.corrupt-<时间戳>` 留档，然后按空库启动。
- **写盘失败变成未捕获 Promise 拒绝**，在某些 Node 配置下会终止宿主进程：`flush()` / `remove()` 均已加 `catch`。

### 兼容性

原则是**只做特性探测，不做版本判断**；任何宿主能力缺失都降级而不是报错。

| 场景 | 行为 |
|---|---|
| 与其他插件工具重名 | 跳过该工具，其余照常注册 |
| HTTP 路由被占用 | 跳过该路由，插件继续加载 |
| 缺少 `webServer` / `events` / `effect` | 对应功能静默关闭 |
| `agent/pre-step` 的 `next` 缺失 | 返回 `undefined`，不阻断步骤 |
| 落盘文件损坏 | 备份后空库启动 |

评测内置 4 项兼容性回归，每次 `npm run eval` 都会跑。

### 移除

- `agent/created` 里基于 `agent.inject()` 的自动注入。实测会让子代理创建失败（有对照组验证），已彻底移除，改由 `cognition_context` 工具提供。

### 数据

- 落盘格式向后兼容：旧存档缺少 `sentiment` / `scope` / `lastTickTime` 时按默认值恢复。
- `cognition-state.json`、`tasks.json` 路径不变。

### 验证

```
编译      ✓
单元测试   33 / 33
评测      20 / 20 + 打包 5 / 5 + 兼容性 4 / 4
schema    1159 / 1400 tokens
输出最大   344 / 600 tokens
```

## v0.1.0（2026-10-31）

首个公开版本：双时态记忆、建构主义图式网络、心情状态机、三段式辩证反思、长程任务台账、页面状态条。
