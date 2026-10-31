# dsh-cognition-engine

> 给 DeepSeek Harness 装一层**可追溯的记忆**、**会自我改组的图式**、**有状态的心情**和**三段式反思**。

一个纯 TypeScript、零运行时依赖的 DSH 插件。所有状态都存在内存 + 本地 JSON，不接数据库、不发外部请求（除非你主动打开真模型）。

```
认知引擎  能量 ███████░░░ 70%  好感 █████░░░░░ +0  平静 · 记忆 3 · 图式 2 · 待办 1  ▸
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
- **心情状态机**：能量 / 好感两个连续量 + 带迟滞的状态标签，面板里会解释"为什么是这个值、说明什么"。
- **长程任务台账**：`tasks.json` 原子落盘，重启恢复，超时任务自动催办。
- **持久化**：记忆与心情写入 `cognition-state.json`，重启自动恢复；页面一键清空。
- **真模型开关**：一键把离线推理器切成当前默认模型（走宿主 `llm` 服务）。
- **可上锁**：给明细接口加口令，防止本机其他进程读取记忆正文。

---

## 安装

需要 DeepSeek Harness，Node.js ≥ 22。

```sh
# 从本地目录安装（推荐先用这个）
dsh plugin --profile desktop add /path/to/cognition-engine
```

或让 Agent 直接调 `plugin_manager` 的 `install_bundle` 指向该目录。

安装后重启一次 DSH。页面输入框下方会出现状态条。

> npm 包名当前是 `@local/cognition-engine`，发布前请改成你自己的作用域或 `dsh-cognition-engine`，并同步修改 `cordis.patch.yml` 里的 `name`。

---

## 六个工具

| 工具 | 作用 |
|---|---|
| `cognition_remember` | 写入记忆；`supersedes` 取代旧事实，`source` 标记来源（user / agent / test / imported） |
| `cognition_recall` | 按 `strict` / `historical` / `belief` 召回；`render` 走 Inline&Spill，`expand` 按图式扩展 |
| `cognition_forget` | 删除记忆：按 id、按来源（如 `test`、`reflection`）、按主题 |
| `cognition_reflect` | 三段式反思；`draft` 审草稿，`save` 把结论存成记忆 |
| `cognition_state` | 心情状态条 + 记忆/图式/任务统计，可施加一次心情事件 |
| `manage_long_task` | 长程任务：create / update / list / due / delete |

---

## 配置

`cordis.patch.yml`：

```yaml
- insert:
    - id: cognition-engine
      name: '@local/cognition-engine'
      config:
        decayHalfLifeHours: 168        # 记忆衰减半衰期
        assimilateThreshold: 0.55      # 同化阈值
        overlapThreshold: 0.42         # 重叠聚类阈值
        communityThreshold: 0.3        # 社区连边阈值
        maxClusterSize: 8              # 单簇上限
        tasksFile: D:/path/tasks.json
        stateFile: D:/path/cognition-state.json
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

- **状态**：能量 / 好感 / 标签，每项都有"为什么是这个值"和"这个值说明什么"
- **待办**：任务描述、状态、线索、超时标记
- **记忆**：正文、来源徽章、当前/已取代、标签
- **图式**：成员数、邻接数、极性
- **设置**：清空记忆/心情、真模型开关、上锁与口令

页面上所有数据走 HTTP，**不进入模型上下文，不消耗 token**。

---

## 数据与隐私

| 项 | 说明 |
|---|---|
| 落盘 | `cognition-state.json`（记忆 + 心情）、`tasks.json`（任务） |
| HTTP | `GET /cognition-engine/state`（仅计数）、`GET /cognition-engine/detail`（含正文）、`POST /cognition-engine/{clear,model,lock}` |
| 上锁 | 开启后 `detail` 与三个 `POST` 要求 `x-cognition-token`；`state` 始终公开（只有计数） |
| 外部请求 | 默认零外部请求；只有打开真模型时才会调用宿主配置的模型服务 |

> ⚠️ 不设 `lockToken` 且未上锁时，本机任意进程都能读取记忆正文。多人或多程序共用一台机器时请先上锁。

---

## 架构

| 模块 | 职责 | 设计来源 |
|---|---|---|
| `memory.ts` | 双时态存储、三种召回、冲突检测、Inline&Spill | [LongMemory](https://github.com/CaviraOSS/LongMemory) |
| `graph.ts` | 图式网络、同化/顺应、重叠聚类、图式扩展 | [CAM](https://github.com/rui9812/CAM)（NeurIPS 2025） |
| `mood.ts` | 心情状态机、迟滞标签、自我解释 | 自研 |
| `reflection.ts` | 三段式反思、Worker 队列 | [Hegelion](https://github.com/Hmbown/Hegelion) |
| `proactive.ts` | 默认不做的发言闸门 | [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) |
| `task_manager.ts` | 长程任务台账、原子落盘 | 自研 |
| `persist.ts` | 记忆+心情快照存储 | 自研 |
| `views.ts` | 页面只读视图 | 自研 |
| `index.ts` | 插件装配：工具、路由、巡视 | — |
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

## 已知限制

1. **记忆是进程内 + 单文件**，没有并发多实例保护；两个 DSH 同时写会互相覆盖。
2. **反思默认用离线确定性推理器**，不是真思考；打开真模型后才由模型生成。
3. **心情数值不会自行变化**——`tick()` 从未被调用，值只在事件发生时改变。
4. **上锁是共享口令**，不是账号体系；口令泄露即失效。
5. 真模型输出可能很长（一次反思可达数千 token），请自行控制使用频率。

---

## License

MIT

---

## English

`dsh-cognition-engine` is a zero-dependency DeepSeek Harness plugin that adds bitemporal memory, a constructivist schema graph, a mood state machine, dialectical reflection, and a long-horizon task ledger. Six tools, one status dock, everything stored locally.
