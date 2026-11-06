# 2026 Agent 项目精读与选型报告

> 目的：为「零依赖、纯 JSON、本地运行」的中文长期助手插件（`dsh-cognition-engine`）做选型。
> 时间：2026-11-05。范围：常驻/主动型、技能/工作流型、记忆/上下文型、中文社区型共 19 个项目。
> 方法：优先读官方 README / 官方文档 / 规范 / 源码目录；star 数为 2026-11-05 GitHub API 快照，只作热度参考。
> 证据等级：**S** = 论文/规范 + 可复现代码；**A** = 官方文档/规范 + 源码结构可核对；**B** = 官方 README/产品文档，缺公开评测；**C** = 单一第三方报道；**D** = 营销文案/无法验证。

---

## 0. 结论先行

1. **值得借的不是框架，是三种「小机制」**：Super-agent 的 Ticket/record-only/准入矩阵、Agent Skills 的 `SKILL.md` + skill-creator 验收闭环、Memobase/Letta 的结构化记忆块与画像槽。都能用纯 JSON 落地。
2. **编排框架全部不适合引入**：LangGraph、CrewAI、OpenAI Agents SDK、AutoGen、Dify、Langflow、LangChain 解决的是「怎么搭多 Agent / 工作流」，不是「怎么让插件学习」；引入即破坏零依赖。
3. **真正有运行时学习机制的项目只有 8/19**：CrewAI、MaiBot、OpenHanako、Letta、Mem0、Graphiti/Zep、Memobase、A-MEM。其中 L3 技能自造只有 OpenHanako（弱），L4 权重更新 **0 个**。
4. **Super-agent 的 P50/P95 不能当 SLA**：官方实验基于约 300 条合成消息、20 项工作请求、5 次重复，且原文明确「不衡量单个任务的实际执行能力」。P50 12.4 分钟 / P95 15.7 分钟只证明调度协作方向有效。
5. **star 数不可信的项目要单独看**（见第 6 节）：`obra/superpowers` 312,767★、`NousResearch/hermes-agent` 260,758★ 且 53,041 open issues、DeepSeek Super-agent 5 天 19,233★、MaiBot 与 OpenHanako 同为 6,866★，都应先怀疑再核实。

---

## 1. 一张大表

| # | 项目 | 类型 | 核心抽象 | 有没有学习机制 | 许可 | 零依赖可行性 | 借什么 | 不借什么 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | [DeepSeek Super-agent / dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | 常驻/主动 | Router（主会话）+ Worker（每 Ticket 一个 Executor）+ Ticket 状态机 + Trigger/Thread/Subscription + Watchdog（文章层） | **无**；Watchdog 是自愈/监督，不是学习 | MIT | 不可直接（TypeScript / DSH 插件 / SQLite / pnpm 依赖）；机制可纯 JSON 仿 | Ticket 阶段、record-only 默认、准入矩阵、注意力预算、Inline & Spill | 常驻进程、Worker 无审批执行、SQLite 存储、完整 Watchdog | A |
| 2 | [OpenHands](https://github.com/OpenHands/OpenHands) | 常驻/主动 | Agent Canvas（前端）/ Agent Server（执行）/ Automation Server（调度）/ Sandbox（隔离） | **无**；Automations 只是定时/事件编排 | MIT | 不可（Python/Node、Docker、Server 栈） | 触发源目录（GitHub/Slack/Jira/Linear/cron）、每次运行新 sandbox 的隔离思路 | 整套平台与沙箱；不要为个人插件引入 Agent Server | A |
| 3 | [Agent Zero](https://github.com/agent0ai/agent-zero) | 常驻/主动 | 完整 Linux 桌面工作区 + Agent Profile + A2A + Time Travel 快照 | **无自动学习**；Memory 分 main/fragments/solutions/skills，靠人工整理 | MIT（LICENSE 文件确认） | 不可（Docker/Linux、Python、完整桌面） | workspace 快照/回滚思路；「一切可见可改」的透明性 | 完整 Linux 桌面、GUI computer use、A2A 服务 | B |
| 4 | [Agent Skills（Anthropic）](https://agentskills.io/specification) | 技能/工作流 | `SKILL.md` 目录规范：YAML frontmatter（name/description）+ Markdown 正文 + scripts/references/assets | 规范本身**无**；skill-creator 是开发期「评估→改写」闭环（半） | 规范仓库 **Apache-2.0**（[agentskills/agentskills](https://github.com/agentskills/agentskills)）；`anthropics/skills` 仓库无统一 LICENSE（404） | **可**（纯文件格式，解析/生成即可） | 三级渐进披露、frontmatter 字段、skill-creator 的测试/度量/改进方法 | 直接把别人的 skill 内容搬进插件（许可不明）；运行时框架 | A |
| 5 | [LangGraph](https://github.com/langchain-ai/langgraph) | 工作流/编排 | `StateGraph`：共享 state + nodes + edges；checkpointer / durable execution / human-in-the-loop | **无** | MIT | 不可（Python/JS 库 + 运行时） | 状态机/检查点/中断恢复的概念 | 引入 Graph 运行时与 LangChain 生态 | A |
| 6 | [CrewAI](https://github.com/crewAIInc/crewAI) | 工作流/编排 | Agent（role/goal/backstory）+ Task + Crew（sequential/hierarchical）+ Flow | **有（L2 提示级）**：`crew.train()` 记录初始输出/人工反馈/改进输出，蒸馏成 suggestions + quality + final_summary，存入 `.pkl`，后续追加到 prompt | MIT | 不可（Python + 大量依赖；训练产物 .pkl 不可移植） | 人工反馈→固化建议的闭环；短/长/实体记忆的命名 | Crew/Flow 运行时、`.pkl` 训练产物、多 Agent 协作 | A |
| 7 | [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | 工作流/编排 | Agent + Handoff（agents as tools）+ Guardrail + Session + Tracing | **无**（tracing 可接外部 fine-tune，不是内置学习） | MIT | 不可（Python 库） | Handoff/Guardrail/Session 的职责划分 | 整个 SDK；多 Agent handoff 复杂度 | A |
| 8 | [AutoGen](https://github.com/microsoft/autogen) | 工作流/编排 | AgentChat：Agent/Team/GroupChat/Selector Group Chat/Swarm/GraphFlow；Core：Actor 模型 | **无** | 代码 **MIT**（`LICENSE-CODE`），文档 **CC-BY-4.0**（`LICENSE`），不是单一许可 | 不可（Python + Actor 运行时） | 多 Agent 会话模式仅作概念参考 | 整个框架；双许可需按文件核对 | A |
| 9 | [Dify](https://github.com/langgenius/dify) | 工作流/编排 | Workflow / Chatflow / Agent + RAG + 插件市场 | **无** | **修改版 Apache 2.0**：多租户 SaaS 限制、Logo/版权保留，非 OSI 标准许可 | 不可（Docker/Postgres/Redis 等） | 节点分类法（开始/LLM/知识检索/条件/代码/结束）可作文档模板 | 平台本体；许可限制 | B |
| 10 | [Langflow](https://github.com/langflow-ai/langflow) | 工作流/编排 | Visual Flow：component nodes + connections + Playground | **无** | MIT | 不可（Python 服务 + 前端） | 可视化编排的节点粒度仅作参考 | 平台本体；个人插件不需要拖拽 UI | B |
| 11 | [LangChain](https://github.com/langchain-ai/langchain) | 工作流/编排 | `create_agent`：Model + Harness（prompt/tools/middleware）；底层 LangGraph | **无**（LangMem 另属记忆库，不是 LangChain 核心学习） | MIT | 不可（Python/JS，依赖树巨大） | 把「模型 + 工具 + 中间件」分层讲清楚 | 整个依赖体系；不要为了 memory 引入 LangChain | A |
| 12 | [Letta / MemGPT](https://github.com/letta-ai/letta) | 记忆/上下文 | Memory blocks：`label` / `description` / `value` / `limit` / `read_only`；core/archival/recall | **有（L2 记忆）**：agent 可自行编辑 memory block | Apache-2.0 | 不可（服务/平台）；字段可纯 JSON 仿 | block 的 label/description/limit/read_only；persona/human 两块的常驻注入 | Letta 服务端、向量检索、sleep-time agent | S |
| 13 | [Mem0](https://github.com/mem0ai/mem0) | 记忆/上下文 | Memory item + entity scope（user_id/agent_id/app_id/run_id）+ metadata + expiration_date + immutable | **有（L2 记忆）**：V3 单次 ADD-only 提取，记忆累积；旧论文的 UPDATE/DELETE/NOOP 已不是当前 V3 实现 | Apache-2.0 | 不可（平台或向量库）；字段可仿 | `user_id/agent_id/run_id` 作用域、`metadata`、`expiration_date`、`immutable` | 向量库、LLM 抽取管道、平台依赖 | S |
| 14 | [Zep / Graphiti](https://github.com/getzep/graphiti) | 记忆/上下文 | Temporal context graph：Entities（节点）/ Facts & Relationships（边，带有效期）/ Episodes（来源） | **有（L2 记忆）**：事实带 validity window，旧事实 invalidate 不删除；可选 learned ontology | Apache-2.0 | 不可（Neo4j/FalkorDB + LLM + embedding）；字段可仿 | `valid_at` / `invalid_at` 语义、Episode 溯源、「失效不删除」 | 图数据库、LLM 抽取、embedding | S |
| 15 | [Memobase](https://github.com/memodb-io/memobase) | 记忆/上下文 | User Profile slots（basic_info/education/...）+ Event timeline | **有（L2 记忆）**：事件自动更新 profile slots | Apache-2.0 | 不可（FastAPI + Postgres + Redis）；模型可仿 | `profile slot` 的 topic/sub_topics；event 的 summary/tags/profile_delta/created_time | 服务端与数据库；多语言 prompt 依赖 | B |
| 16 | [A-MEM](https://github.com/agiresearch/A-mem) | 记忆/上下文 | Zettelkasten note：contextual description / keywords / tags / links；memory evolution | **有（L2 记忆）**：新笔记触发旧笔记上下文/属性更新，动态建链 | MIT | 不可（Python + embedding + LLM）；字段可仿 | note 的 `keywords/tags/context` + 显式 link 字段；「新记忆可修正旧记忆」 | 向量检索、自动建链的 LLM 成本 | S |
| 17 | [MaiBot](https://github.com/Mai-with-u/MaiBot) | 中文/社区 | MaiSaka 数字生命：人格 JSON + A-Memorix 长期记忆 + expression/jargon learners + turn_trigger 发言闸门 | **有（L2 风格/记忆）**：`expression_learner.py`、`jargon_learner.py`、`jargon_miner.py` 学习群友表达/黑话；A-Memorix 管长期记忆 | GPL-3.0（A-Memorix 为 AGPL-3.0，另有例外说明） | 不可（Python + embedding + 图/向量存储） | 发言时机分层（turn_trigger/gates/idle_backoff/reply_likelihood）；表达学习的数据组织 | 整个机器人栈；GPL/AGPL 代码不要直接搬 | B |
| 18 | [OpenHanako](https://github.com/liliMozi/openhanako) | 中文/社区 | Agent = 文件夹：人格模板 + 记忆 + 定时任务 + Skills；角色卡 zip | **有（L3 技能自造，弱）**：Agent 可从 GitHub 安装社区技能，也可自己写新技能；记忆由「大工具模型」编译 | Apache-2.0 | 不可（Electron + better-sqlite3 + Pi SDK） | Agent=文件夹、人格与记忆分区、角色卡 zip 白名单 | Electron/SQLite 重栈；不透明记忆实现 | B |
| 19 | [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) | 中文/社区 | 关键词搜索 → 读字幕/抽帧 → 写 Markdown 日报 → 可选自动评论 | **无**；是过滤器+摘要器，不是学习者 | MIT | 不可直接（DSH 插件 + Python/Bilibili MCP）；流水线可仿 | 「读原文→判断→写日报」的只读流水线；提示注入红线 | 自动评论/自动社交；Python 运行时 | B |

---

## 2. 重点项目精读

### 2.1 DeepSeek Super-agent：职责边界最值得抄

**Router / Worker / Ticket**

- **Router**：常驻主会话，负责人类交互、维护全局上下文、把任务拆成 Ticket 派发给 Worker；用轻量模型做判断。Worker 不直接回复用户，而是把状态和结果汇报给 Router，由 Router 统一对外沟通。来源：[IT之家/baike.dev 转述官方文章](https://baike.dev/news/18787)。
- **Worker**：每个 Ticket 一个 Executor Session（`worker-<ticket id>`）和独立目录；文档明确「Executor Sessions run commands without approval as the operator's OS user」。见 [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)。
- **Ticket 状态机**：`person/delivery`（Input 投递失败）、`person/answer`（等待回答）、`person/review`（等待审查）、`person/blocked|failed`、`working/queued`、`idle`、`working`。这比普通 todo 多了「等谁、为什么等」。见 [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)。
- **Authorization**：不是简单的「允许/拒绝」，而是按来源、发送者、是否点名、是否为 bot 的**准入矩阵**（`src/admission.ts`：listedUnaddressed / unlistedAddressed / unlistedUnaddressed）；推断型主动工作默认只记录「本来会做什么」（record-only），只有 auto 模式且匹配规则才接受。见 [src/admission.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/admission.ts)、[007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)。
- **Trigger / Thread / Subscription**：输入不是「用户指令」，而是环境事件（群聊消息、邮件/日程提醒、代码审查评论、CI 结果）；先程序规则过滤，再模型判断；Worker 可订阅 Thread，后续事件直接到达 Worker，不必每次过 Router。见 [baike.dev](https://baike.dev/news/18787)。
- **Watchdog**：文章描述为独立 Watchdog Session，形成外部控制回路；不只监控接口报错/状态恢复失败，还会用模型判断 Worker 是否取得实质进展、方向是否偏离目标，发现异常时介入修复。**但**：原型 README 明确「文章中的部分设计是未来方向，未在原型实现」；2026-11-05 的 `main` 源码树中没有 `watchdog` 文件（未找到）。见 [README](https://github.com/deepseek-ai/dsh-superagent-prototype)、[源码树](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/main/src)。**结论：Watchdog 是文章层设计，不是可直接抄的代码。**
- **P50/P95**：官方实验约 300 条消息（其中约 20 条工作请求）、重复 5 次：Super-agent P50 12.4 分钟、P95 15.7 分钟；单 Session + 中性提示 P95 29.5 分钟。原文明确「合成负载和简化环境，主要评估调度与协作能力，不衡量单个任务实际执行能力」。见 [baike.dev](https://baike.dev/news/18787)、[AIBase 摘要](https://news.aibase.cn/news/32016)。**不能把 12.4/15.7 当生产 SLA。**
- **安全模型弱点**：Worker 以操作员 OS 用户无审批运行；文档自己承认命令包装和目录「establish defaults, not a security boundary」，Worker 仍可用绝对路径执行任意程序；管理 API 的文档只描述同源检查与请求限流，未描述身份认证/授权层（[007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) 第 345 行；[003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md) 第 27/80 行）。这正是我们只借「状态机+刹车」、不借「Worker 运行时」的理由。

### 2.2 OpenHands：Automations / Triggers 与运行时

- **配置方式**：在对话里让 OpenHands 创建 automation；Automation Skill 引导填「名称 → 时间表 → 时区 → 任务描述（可选插件）」。见 [Automations Overview](https://docs.openhands.dev/openhands/usage/automations/overview.md)。
- **两种类型**：Prompt-based（自然语言描述任务）与 Prompt with plugins（在 prompt 上附加 OpenHands extensions 的 skill/tool）。见 [Automations Overview](https://docs.openhands.dev/openhands/usage/automations/overview.md)。
- **调度型**：cron 时间表；每次运行新建 fresh sandbox，执行 prompt，保存 conversation，可继续对话；automation 归用户所有，可使用 terminal / file edit / LLM / secrets / MCP；GitHub/GitLab/Bitbucket 登录凭据自动可用。见 [Automations Overview](https://docs.openhands.dev/openhands/usage/automations/overview.md)。
- **事件型**：自定义 webhook；注册时传 `source`、`event_key_expr`（JMESPath 取事件类型）、`signature_header`、`webhook_secret`；再用 JMESPath 过滤（`contains` / `icontains` / `glob` / `==` / `&&` / `||`）。GitHub 在 Enterprise 有内置事件集成；Linear / Stripe / Slack / Twilio 走自定义 webhook。见 [Event-Based Automations](https://docs.openhands.dev/openhands/usage/automations/event-automations.md)。
- **支持的 source（2026-11 文档）**：GitHub（内置事件）、GitLab / Bitbucket / Azure DevOps（仓库集成）、Jira Cloud / Jira Data Center（企业集成）、Slack（集成 + 自定义 webhook）、Linear（自定义 webhook）、cron（定时）。见 [docs index](https://docs.openhands.dev/llms.txt)、[Jira Cloud](https://docs.openhands.dev/enterprise/integrations/jira-cloud.md)、[Slack](https://docs.openhands.dev/enterprise/integrations/slack.md)。
- **运行时架构**：Agent Canvas 是浏览器控制台，**不是** agent runtime；Agent Server 负责 conversation、agent、tool、workspace 操作并流式发事件；Automation Server 存 schedule/event，跟踪 run 并派发 conversation；workspace/sandbox 决定文件、进程、凭据、网络边界。见 [Agent Canvas Architecture](https://docs.openhands.dev/openhands/usage/agent-canvas/architecture.md)、[项目 README](https://github.com/OpenHands/OpenHands)。
- **对我们的意义**：OpenHands 把「触发」与「执行」拆成两个服务，这个边界值得学；但它自己就是平台，个人插件只能借「触发源目录」，不能借运行时。

### 2.3 Agent Zero：computer use / A2A / time travel

- **computer use**：Agent Zero 有完整 Linux 桌面（XFCE）在右侧 Canvas；Agent 可用 Linux Desktop skill 观察屏幕、通过 GUI 操作、验证结果；也可以打开 LibreOffice、文件管理器、终端等。见 [README](https://github.com/agent0ai/agent-zero)、[Desktop Guide](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/desktop.md)。这不是「调一个 browser 工具」，而是「给 agent 一台可接管的 Linux 电脑」。
- **A2A**：基于 FastA2A 的 Agent-to-Agent 协议；开启 A2A Server 后得到带 API Token 的连接 URL（可带 project 上下文），支持分布式工作流、上下文隔离、长时协作、按项目委派。A2A 传「完整对话/推理」，MCP 传「工具调用」。见 [A2A Setup](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/a2a-setup.md)。
- **Time Travel**：对 `/a0/usr` 工作区做快照；可查看变化、比较文件、检查过去状态、按需回滚；官方明确「不是 Git/备份的替代品，而是 agent 活跃改文件时的安全层」。见 [README](https://github.com/agent0ai/agent-zero)。
- **和普通 agent 框架的区别**：普通框架是库/编排层；Agent Zero 是「一台电脑 + 一个 agent 实例」的产品形态。官方强调「几乎不隐藏任何东西」：prompts 在 `prompts/`、tools 在 `tools/`，可检查/替换/扩展；Project 隔离 workspace/instructions/memory/secrets；Agent Profile 改变工作风格。见 [README](https://github.com/agent0ai/agent-zero)。
- **记忆**：Memory 分 `main` / `fragments` / `solutions` / `skills` 四区，支持搜索、编辑、删除、导入知识块；官方明确「长期 AI 记忆不是已解决问题」，需要人工 curation（否则会保留错误假设/过期路径）。见 [Memory Guide](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/memory.md)。**这不是自动学习，是人工维护的记忆库。**

### 2.4 Agent Skills：格式、渐进披露、skill-creator

- **目录结构**：`skill-name/SKILL.md` 必需；可选 `scripts/`（可执行代码）、`references/`（按需文档）、`assets/`（模板/图片/数据）。见 [agentskills.io 规范](https://agentskills.io/specification)。
- **YAML frontmatter 必填字段**：`name`（≤64 字符，小写字母/数字/连字符，不能首尾连字符，不能连续连字符，必须与父目录名一致）；`description`（≤1024 字符，非空，说明「做什么 + 何时用」）。可选：`license`、`compatibility`（≤500 字符）、`metadata`（string→string）、`allowed-tools`（空格分隔，实验性）。见 [agentskills.io 规范](https://agentskills.io/specification)。
- **正文结构**：frontmatter 后的 Markdown 无格式限制；推荐「步骤说明 / 输入输出示例 / 常见边界情况」；正文全部加载，所以建议 `SKILL.md` < 500 行，长内容拆到 references。见 [agentskills.io 规范](https://agentskills.io/specification)。
- **三级渐进披露**：① metadata（name+description，约 100 tokens，启动时全部预加载）；② SKILL.md 正文（激活时加载，建议 <5000 tokens）；③ 资源文件（scripts/references/assets，按需加载，可无限）。Anthropic 官方文章同样描述这三层。见 [Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)、[agentskills.io 规范](https://agentskills.io/specification)。
- **开放标准**：Anthropic 2025-12-18 宣布 Agent Skills 成为开放标准，托管在 [agentskills.io](https://agentskills.io/)；提供 `skills-ref validate ./my-skill` 校验器。见 [Anthropic 文章](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)、[规范 Validation](https://agentskills.io/specification)。
- **skill-creator 怎么测试/度量/改进**（源码 33KB，`skills/skill-creator/SKILL.md`）：
  1. 先写 2-3 个真实用户会说的测试 prompt，保存到 `evals/evals.json`；先不写断言。
  2. 同一轮并行跑「with skill」和「baseline（without skill / 旧版）」，两边都保存输出。
  3. 跑的同时起草可客观验证的 assertions（文件转换、数据抽取、代码生成、固定流程步骤适合；写作风格/艺术类适合人工评审）。
  4. 评分后用 `scripts/aggregate_benchmark` 生成 `benchmark.json/md`：pass rate、耗时、token、mean ± stddev、delta。
  5. **description 优化**：生成 20 条触发评估 query（8-10 条应触发、8-10 条不应触发，负例要「近 miss」而不是明显无关），跑 60% train / 40% held-out test，最多 5 轮，按 test score 选最佳而非 train score。
  6. 可选 blind A/B：把两个版本给独立 agent，不告诉它哪个是哪个，让它判断质量，再分析赢家为什么赢。
  见 [skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)、[Claude 官方博客](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)。
- **许可注意**：规范仓库 [agentskills/agentskills](https://github.com/agentskills/agentskills) 为 Apache-2.0；但 `anthropics/skills` 仓库没有统一 LICENSE（GitHub API `license` 为 null，`/license` 404），各 skill 可能自带条款，不能把 skill 内容直接搬进插件。规范本身可照着实现格式。

### 2.5 LangGraph / CrewAI / OpenAI Agents SDK / AutoGen：全是「编排」，不是「学习」

| 框架 | 核心抽象 | 学习机制 | 对个人插件 |
|---|---|---|---|
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview.md) | 共享 state 的 graph：nodes + edges；checkpointer、durable execution、streaming、human-in-the-loop | 无 | 只借「状态机 + checkpoint」概念；不引入 Python 运行时 |
| [CrewAI](https://docs.crewai.com/v1.15.35/en/concepts/crews) | Agent（role/goal/backstory）+ Task + Crew（sequential/hierarchical）+ Flow | **有**：`crew.train()` 记录 initial_output / human_feedback / improved_output，蒸馏为 `suggestions[] + quality(0-10) + final_summary`，存 `.pkl`，正常运行时追加到 prompt | 只借「人工反馈→固化建议」的闭环；`.pkl` 和运行时不要 |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) | Agent / Handoff（agents as tools）/ Guardrail / Session / Tracing | 无（tracing 可接外部 fine-tune，不是内置） | 只借 handoff 与 guardrail 的职责划分 |
| [AutoGen](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/index.html) | AgentChat：Agent/Team/GroupChat/Selector Group Chat/Swarm/GraphFlow；Core：Actor | 无 | 只作多 Agent 模式参考；代码 MIT（`LICENSE-CODE`）、文档 CC-BY-4.0（`LICENSE`），按文件核对 |

**关键判断**：CrewAI 的 `train` 是四者中唯一「能改变后续行为」的机制，但它是**提示级、人工反馈驱动、存本地 pickle**，不是权重更新，也不是自主进化。其余三个连「学习」入口都没有。

### 2.6 Dify / Langflow / LangChain：工作流平台的参考价值很低

- **Dify**：开源 AI 应用平台，Workflow / Chatflow / Agent + RAG + 插件市场；官方定位是「build AI applications, publish as web apps or APIs」。许可为**修改版 Apache 2.0**：多租户 SaaS 需商业授权，且不能移除 Logo/版权信息（[LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)）。对个人插件的参考价值仅限「节点分类法」。
- **Langflow**：Python 可视化 Flow 编辑器，拖拽 component nodes、Playground 实时测试、可导出 API；适合快速原型，不适合零依赖本地插件（[What is Langflow](https://docs.langflow.org/)）。
- **LangChain**：`create_agent` 把 agent 定义为 Model + Harness（prompt/tools/middleware），底层跑 LangGraph；它解决的是「接模型、接工具、接中间件」，不是「长期记忆治理」（[LangChain Overview](https://docs.langchain.com/oss/python/langchain/overview.md)）。引入 LangChain 会带来巨大依赖树，且 LangMem 等记忆库也不是纯 JSON。

### 2.7 记忆类项目：只回答「数据模型里有没有能直接借的字段/操作」

> 本节按任务要求只谈数据模型，不谈部署；部署/依赖结论见第 1 节「零依赖可行性」列。

| 项目 | 数据模型关键字段/操作 | 我们能直接借什么 | 数据模型边界（不要误用） |
|---|---|---|---|
| [Letta / MemGPT](https://docs.letta.com/v1-sdk/memory/memory-blocks) | block：`label` / `description` / `value` / `limit` / `read_only`；block 始终 prepend 到 prompt；`value` 是整块替换不是 append；last-write-wins | 用 `label` 区分 persona/human/policies；用 `limit` 控制每块上下文预算；用 `read_only` 保护人格/安全块；用 `description` 教模型何时读写 | block 是全量注入，不是检索；不要把 block 当无限容量的记忆库 |
| [Mem0](https://docs.mem0.ai/api-reference/memory/add-memories) | V3：`messages` + `user_id` / `agent_id` / `app_id` / `run_id` + `metadata` + `expiration_date` + `immutable`；**ADD-only**，无 UPDATE/DELETE；异步 `event_id` | `user_id/agent_id/run_id` 三轴作用域；`metadata` 放 category/source；`expiration_date` 做过期隐藏；`immutable` 保护不可改事实 | ADD-only 会累积近似重复；不要把「记忆条数」当「知识质量」 |
| [Zep / Graphiti](https://github.com/getzep/graphiti) | Context graph：Entities（节点，带 evolving summary）/ Facts & Relationships（边，带 validity window）/ Episodes（原始数据，所有事实可溯源）/ Custom types | 「事实有有效期」——我们已有 `validFrom/validTo`；借 `invalid_at` 的「失效不删除」语义；借 Episode 作为 `sourceIds` 的溯源对象 | validity window 是事实时间，不是任务状态；不要把 `invalid_at` 当人工审批 |
| [Memobase](https://docs.memobase.io/features/profile/profile) | Profile slots：默认 `basic_info.name/gender`、`education.school/major`，可 `additional_user_profiles` 扩展 `topic/sub_topics`；Event：summary（可选）、tags（如 `emotion::happy`）、profile_delta（必填）、created_time（必填） | 把「用户画像」拆成固定 slot（基本信息/偏好/工作/健康…），只允许 slot 内更新；每个事件写 `profile_delta`，保留「哪次对话改了什么」的审计 | slot 是白名单，不要让模型自由新增/重命名；profile 不是事实记忆，不承担双时态 |
| [A-MEM](https://arxiv.org/abs/2502.12110) | Note：contextual description / keywords / tags / links；新记忆加入时分析历史记忆并建链；memory evolution 会更新旧笔记的上下文/属性 | 在现有 memory 上增加 `keywords` / `tags` / `context` 三个短字段；用 `links` 表达「相关记忆」；「新记忆可修正旧记忆」但要保留旧版本（我们已有 `supersedes`） | 自动建链是 LLM 成本；不要把「链接多」当「记忆好」，链接需要可审计 |

**一句话**：这五家里，最直接可借的是 **Letta 的 block 字段**（`label/description/value/limit/read_only`）和 **Memobase 的 profile slot + event delta**；Graphiti 的 `valid/invalid` 语义我们已有等价物（`validFrom/validTo`），不需要图数据库；Mem0 的 `immutable/expiration_date` 可补进现有记忆 schema；A-MEM 的 `keywords/tags/context/links` 可作为可选增强字段。

### 2.8 中文/社区型：人格、记忆、主动行为与「学习」

- **MaiBot**（GPL-3.0，6,866★）：
  - 人格/记忆：README 明说 MaiSaka 是「基于大语言模型的数字生命体」，追求「像人」而非效率；A-Memorix 是内置长期记忆与认知增强子系统 v2.0.0，数据 schema v26，支持外部引用、知识包导入导出、图片记忆、时间元数据与追踪操作；核心能力包括双路检索（向量 + 图关系联合召回，支持 search/time/hybrid/episode/aggregate）、写入去重（`external_id` 等）、Episode 重建、人物画像（自动快照 + 手动 override）。见 [A-Memorix README](https://github.com/Mai-with-u/MaiBot/blob/main/src/A_memorix/README.md)。
  - 主动行为：`src/maisaka/turn_trigger/` 下有 `dynamic_gate.py`、`gates.py`、`idle_backoff.py`、`reply_likelihood.py`、`scheduler.py`；还有 `src/maisaka/attention_drift.py`。这套「该不该开口」的闸门比「生成什么」更值得学。
  - 学习机制：`src/learners/expression_learner.py`（42KB）、`jargon_learner.py`（27KB）、`jargon_miner.py`（38KB）、`expression_review_store.py`、`pending_learning_buffer.py`、`weighted_sampling.py`——学习群友的表达/黑话，属于 L2「风格学习」，不是能力学习。见 [learners 目录](https://github.com/Mai-with-u/MaiBot/tree/main/src/learners)。
  - 许可：仓库 GPL-3.0；A-Memorix 单独 AGPL-3.0（含 MaiBot GPL 例外说明），**不能直接搬代码**。
- **OpenHanako**（Apache-2.0，6,866★）：
  - 人格/记忆：Agent = 文件夹；人格模板 + 自定义人格文件；每个 Agent 独立记忆/人格/定时任务；支持角色卡 zip 导入导出（人格、头像、可选记忆、Skills 白名单）。见 [README](https://github.com/liliMozi/openhanako)。
  - 主动行为：定时任务（Cron）+ 心跳巡检书桌文件变化；Hub 独立于聊天会话运行后台任务；多 Agent 可通过频道群聊协作/互相委派。
  - 学习机制：Agent 可从 GitHub 安装社区技能，也可自己编写并学会新技能（L3 技能自造，默认严格审核）；记忆由「大工具模型」编译，README 自己承认「记忆系统有待优化」。技术栈 Electron 42 + React 19 + Pi SDK + better-sqlite3（WAL），不是零依赖。
- **dsh-bili-scroll**（MIT，1,240★）：
  - 流程：按关键词搜近几天视频 → 逐条读字幕原文（不看摘要）→ 没字幕的演示类从 B 站故事板抽帧 → 写 Markdown 日报（每条含「为什么值得」+「它自己的一句话」）→ 开启自动评论时每轮发一条 @ 你；可配置峰谷时段。见 [README](https://github.com/c1overzz/dsh-bili-scroll)。
  - 「学习」：没有。它按你填的关键词和设置页开关过滤，读字幕是推理不是学习；没有权重更新，也没有长期偏好学习。**典型「过滤器 + 摘要器」，不是学习者。**
  - 安全红线：README 自己写「不读取你的隐私；模型看不到你的账号、机器路径、你发过的言」——这正是我们做任何主动型插件时要抄的红线。

---

## 3. 真正有「学习」机制的项目有几个？

### 3.1 先把「学习」分四层

| 层级 | 机制 | 改权重吗 | 本项目能否做 |
|---|---|---|---|
| L1 上下文学习 | prompt 示例 / few-shot | 否 | 能，但不持久 |
| L2 记忆学习 | 外部记忆 + 检索 + 反馈/更新 | 否 | ✅ 主战场（已有双时态、准则本） |
| L3 技能/工具自造 | 写代码、造工具、建技能库 | 否（造的是新资产） | ⚠️ 只做「技能包」，不做「自动造工具」 |
| L4 权重更新 | 微调 / RL / GRPO | 是 | ❌ 零依赖 + 无 GPU，不做 |

### 3.2 逐项判定：8 个有运行时学习机制，11 个没有

| 项目 | 学习判定 | 说明 |
|---|---|---|
| **CrewAI** | ✅ 有（L2 提示级） | `train()` 把人工反馈蒸馏成 `suggestions/quality/final_summary` 存 `.pkl`，后续追加到 prompt；不是权重更新 |
| **MaiBot** | ✅ 有（L2 风格） | expression/jargon learners 学群友表达/黑话；A-Memorix 管长期记忆；不学能力 |
| **OpenHanako** | ✅ 有（L3，弱） | Agent 可安装/编写新 skill；记忆由大工具模型编译；没有权重更新 |
| **Letta** | ✅ 有（L2 记忆） | agent 可编辑 memory block；block 是上下文段，不是能力 |
| **Mem0** | ✅ 有（L2 记忆） | V3 ADD-only 抽取/累积；记忆越存越多，不保证越用越聪明 |
| **Zep / Graphiti** | ✅ 有（L2 记忆） | 事实有效期 + invalidate 不删除 + episode 溯源；是记忆演化，不是能力演化 |
| **Memobase** | ✅ 有（L2 记忆） | 事件自动更新 profile slots；是用户画像维护 |
| **A-MEM** | ✅ 有（L2 记忆） | note 动态建链 + memory evolution；是记忆组织，不是能力学习 |
| **DeepSeek Super-agent** | ❌ 无 | Ticket/授权/Watchdog 都是编排与自愈；没有反馈学习闭环 |
| **OpenHands** | ❌ 无 | Automations 是定时/事件编排；不学习 |
| **Agent Zero** | ❌ 无自动学习 | Memory 四区靠人工整理；Time Travel 是回滚，不是学习 |
| **Agent Skills** | ❌ 规范无 / 半 | 规范只定义「怎么装技能」；skill-creator 是开发期人工评估闭环，不是运行时学习 |
| **LangGraph** | ❌ 无 | 状态图/检查点/中断恢复，都是编排 |
| **OpenAI Agents SDK** | ❌ 无 | Agent/Handoff/Guardrail/Session/Tracing，都是运行时原语 |
| **AutoGen** | ❌ 无 | GroupChat/Swarm/GraphFlow，都是多 Agent 会话模式 |
| **Dify** | ❌ 无 | 工作流平台 |
| **Langflow** | ❌ 无 | 可视化 Flow 编辑器 |
| **LangChain** | ❌ 无 | Model + Harness 抽象；LangMem 是另一条记忆库产品线 |
| **dsh-bili-scroll** | ❌ 无 | 关键词过滤 + 字幕摘要；不学习 |

**结论**：
- 按「运行时能改变后续行为、且不要求人改代码」严格算：**8 个**（CrewAI、MaiBot、OpenHanako、Letta、Mem0、Graphiti、Memobase、A-MEM）。
- 按「能力增长（L3/L4）」算：**只有 OpenHanako 算半个 L3**；CrewAI 只是 L2 提示级；**L4 权重更新 0 个**（SEAgent 等不在本次清单）。
- **编排 ≠ 学习**：LangGraph/CrewAI/OpenAI Agents SDK/AutoGen/Dify/Langflow/LangChain 这 7 个「框架」里，只有 CrewAI 有一个可选的 `train` 特性，其余 6 个没有任何学习机制。
- **自愈 ≠ 学习**：Super-agent 的 Watchdog、Agent Zero 的 Time Travel、OpenHands 的自动重跑，都是「恢复/回滚/重试」，不是「从反馈中更新策略」。
- **记忆 ≠ 能力**：Letta/Mem0/Graphiti/Memobase/A-MEM 都是 L2；记忆能提高一致性，不会让模型本身变强。

---

## 4. 给我们的 3 个可借机制

### 4.1 机制一：Super-agent 的「Ticket 状态机 + record-only + 准入矩阵」

**借什么**：
- 把现有 `tasks.json` 从「待办列表」升级成「工单」：每条任务至少增加 `stage`（`queued / working / waiting_for_person / blocked / failed / done`）、`waitingFor`（等谁/等什么）、`lastReport`（最近一次汇报）、`mandate`（凭什么被授权做：用户点名 / 白名单规则 / 推断候选）、`source`（来自哪个触发源）。这五个字段能解释「为什么这条任务停在这里」。
- 主动候选默认 **record-only**：只写「本来会做什么」到面板/审计，不发消息、不执行；用户确认后才进入 `queued`。这与我们已有的 `proactive.ts` 的 `recordOnly` 姿态一致，只是补上「任务化」。
- 准入矩阵最小版：按「来源 × 是否点名 × 是否白名单」三格判断 `explicit / inferred / ignore`；推断候选不能直接执行，只能进候选队列。
- 注意力预算：每条主动消息必须能回答「用户需要做什么/能得到什么」；回答不了就不发。Super-agent 的哲学原文是「take as little human attention as possible, and give as much value as possible」（[000-philosophy.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)）。

**为什么适合我们**：纯 JSON 就能表达，不需要进程常驻；与现有 `tasks.json` / `proactive.ts` / 审计日志天然衔接。**不借**：Worker 进程、SQLite、无审批执行、Watchdog 模型监督。

### 4.2 机制二：Agent Skills 的「SKILL.md 三级渐进披露 + skill-creator 验收闭环」

**借什么**：
- 准则本增加 `kind: 'procedure'`：一条 procedure = `name` + `description`（何时用）+ `body`（步骤/示例/边界）+ 可选 `references` / `scripts` / `assets`。可导出为标准 `SKILL.md`，与 Agent Skills 生态互通；不导出时仍存 JSON。
- 渲染时按三级预算：每轮只注入所有 procedure 的 `name + description`（约 100 tokens/条）；命中时才注入 body；references 只在需要时读取。这样可以把「准则本」做得比现在更长而不炸上下文。
- 用 skill-creator 的方法给 procedure 做验收：2-3 个真实任务 prompt → with/without 对照 → 客观断言 → 统计 pass rate / 耗时 / token → 修 description 时用 20 条「应触发/不应触发」query，60/40 分割，最多 5 轮。我们的 `eval.ts` 已有规则断言能力，可直接复用，不需要引入任何框架。

**为什么适合我们**：`SKILL.md` 是纯文本规范；导出/导入不需要 npm 包；skill-creator 的评估方法是流程，不是依赖。**不借**：Anthropic 仓库里具体的 skill 内容（许可不明）、运行时 skill 市场、自动安装。

### 4.3 机制三：Memobase 的「profile slot + event delta」+ Letta 的 block 限额

**借什么**：
- 用户画像不要存成一条大记忆，而是固定 slot：`basic_info`（姓名/称呼/语言）、`preferences`（输出风格/禁忌）、`work`（职业/项目/工具链）、`health`（如用户主动提供）、`relationships`（可选）。每个 slot 有 `value`、`limit`、`read_only`（借 Letta 的 block 字段）。
- 每次对话/事件产生 `event`：`summary`（可选）、`tags`（如 `preference::concise`、`project::cognition-engine`）、`profile_delta`（必填：哪个 slot 从什么改成什么）、`created_at`（必填）。只允许通过 `profile_delta` 修改 slot，保留每次改动审计；不允许模型直接重写整块。
- 这样「用户画像」和「事实记忆」分开：画像是稳定偏好，事实是双时态记忆；画像是 slot 白名单，事实是 subject/content。两者都用 JSON，不需要向量库。

**为什么适合我们**：这是把 Memobase 的 `profile slots`/`event` 结构和 Letta 的 `label/description/value/limit/read_only` 拼成一个纯 JSON 模型；可以直接落在 `cognition-persona.json` / `profile.json` + `events.jsonl`。**不借**：Memobase 的 FastAPI/Postgres/Redis、多语言 prompt、自动抽取服务。

---

## 5. 3 个明确避开

### 5.1 避开一：整套多 Agent / 工作流编排框架

**对象**：LangGraph、CrewAI、OpenAI Agents SDK、AutoGen、Dify、Langflow、LangChain。

**理由**：
- 它们解决的是「多个 agent 怎么分工/怎么串工作流」，我们的插件是「单个长期助手 + 记忆/准则/任务」，没有多 agent 协作需求。
- 引入任何一个都意味着 Python/Node 运行时、依赖树、版本升级、调试面；直接违反「零 npm 运行时依赖」。
- CrewAI 的 `train` 虽然有趣，但产物是 `.pkl`，无法在纯 JSON 插件中复用；其余框架连学习入口都没有。
- Dify 的修改版 Apache 2.0 还有多租户/Logo 限制；AutoGen 代码 MIT、文档 CC-BY-4.0，复用时要区分文件类型。

### 5.2 避开二：任何外部记忆服务 / 向量库 / 图数据库

**对象**：Letta 服务端、Mem0 平台、Zep/Graphiti（Neo4j/FalkorDB）、Memobase（FastAPI+Postgres+Redis），以及任何「本地部署 = 零依赖」的说法。

**理由**：
- 「本地运行」不等于「零依赖」：这些项目至少要 Python 服务、数据库、embedding 模型或 API key；Memobase 官方架构就是 FastAPI + Postgres + Redis。
- 我们的 `cognition-state.json` + BM25/规则召回已经够用；引入向量库会把「可审计的 JSON」变成「不可解释的 embedding」。
- 只借它们的**字段**（Letta 的 block、Mem0 的 scope、Graphiti 的 valid/invalid、Memobase 的 slot/event、A-MEM 的 keywords/tags），不借部署。

### 5.3 避开三：无边界自主 / 自进化 / computer use

**对象**：Super-agent 的 Worker 无审批执行、Agent Zero 的完整 Linux 桌面、OpenHands 的 Docker sandbox、OpenHanako 的自动安装 skill、任何「自动改代码 / 自动训练 / 权重更新」。

**理由**：
- 我们没有任何沙箱、VM、审批 UI、回滚基础设施；一旦放开无审批执行，插件就能以用户 OS 权限读写任意文件。Super-agent 自己都承认 Worker 的目录/命令包装「不是安全边界」，其安全模型被标为弱。
- Agent Zero / OpenHands 的 computer use 需要完整 Linux 桌面/Docker 隔离，个人插件无法安全复制；Time Travel 只能当「快照回滚」思路，不能当安全边界。
- 自动安装 skill / 自动改代码是 L3 工具自造，不是 L4 学习；在没有审计和沙箱的情况下，风险远大于收益。我们的路线应是「record-only → 用户确认 → 可回滚」，而不是「自主执行 → 出事再修」。

---

## 6. Star 数可信度提醒

> 以下均为 2026-11-05 GitHub API 快照，只作热度参考；star 数会变，且「star 多 ≠ 机制好 ≠ 适合我们」。

| 项目 | Stars / Forks | 观察 | 判断 |
|---|---:|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | **312,767 / 27,822** | 2025-10 创建，技能/方法论仓库，star 体量与仓库内容（Shell 技能框架）明显不匹配；fork 率约 8.9% | **高度可疑**：即使真实，也说明是营销/病毒式传播，不是技术深度；不作为选型依据 |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | **260,758 / 57,555**，open issues **53,041** | open issues 约为 star 的 20%，远超正常项目；描述「The agent that grows with you」是营销语 | **异常信号**：issue/star 比、fork 率都异常；star 不能证明「会成长」 |
| [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | **19,233 / 2,191** | 2026-10-31 创建，5 天 1.9 万星；官方发布 + 媒体扩散 | **发布驱动的高增速**：可读，但 star 不代表成熟度；原型明确「非正式产品」 |
| [anthropics/skills](https://github.com/anthropics/skills) | **187,617 / 22,134** | 官方仓库 + 生态推动；2025-09 创建 | 官方品牌可信，但 star 不等于每个 skill 质量；仓库无统一 LICENSE |
| [MaiBot](https://github.com/Mai-with-u/MaiBot) | **6,866 / 721** | — | 正常量级；但需看代码质量与 issue 活跃度 |
| [liliMozi/openhanako](https://github.com/liliMozi/openhanako) | **6,866 / 582**，open issues **1,238** | 与 MaiBot **完全相同 6,866**（同一时刻快照）；open issues 是 fork 的 2 倍多 | **可疑巧合 + issue 积压**：至少说明单次 star 快照不能当权威，需看历史曲线与 issue 处理 |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 92,711 / 12,365 | 2024 年创建，长期项目 | 相对可信；仍不能替代架构评估 |
| [Dify](https://github.com/langgenius/dify) | 160,461 / 25,386 | 2023 年创建，平台型产品 | 量级正常，但许可非标准 Apache |
| [Langflow](https://github.com/langflow-ai/langflow) | 156,354 / 10,332 | 2023 年创建 | 量级正常 |
| [LangChain](https://github.com/langchain-ai/langchain) | 149,077 / 25,074 | 2022 年创建 | 量级正常；生态大不等于适合插件 |
| [CrewAI](https://github.com/crewAIInc/crewAI) | 60,532 / 9,060 | 2023 年创建 | 正常 |
| [AutoGen](https://github.com/microsoft/autogen) | 61,711 / 9,371 | 2023 年创建 | 正常；许可需注意 |
| [Mem0](https://github.com/mem0ai/mem0) | 68,463 / 8,128 | 2023 年创建 | 正常；V3 文档与旧论文有差异 |
| [Letta](https://github.com/letta-ai/letta) | 25,358 / 2,668 | — | 正常 |
| [Graphiti](https://github.com/getzep/graphiti) | 32,555 / 3,342 | 2024 年创建 | 正常 |
| [Memobase](https://github.com/memodb-io/memobase) | 2,948 / 238 | 2024 年创建 | 小型但专注 |
| [A-MEM](https://github.com/agiresearch/A-mem) | 1,212 / 125 | NeurIPS 2025 论文配套 | 正常学术项目 |
| [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) | 1,240 / 123（目录页显示 1,213，快照不同步） | 2026-10 创建 | 小而正常 |

**三条使用规则**：
1. **看 star 增速，不看总量**：5 天 1.9 万（Super-agent）和 13 个月 31 万（Superpowers）都说明「有人在看」，不说明「代码好」。
2. **看 issue/star 比**：`hermes-agent` 53k open issues / 260k stars≈20%，`openhanako` 1,238 / 6,866≈18%——异常高，先怀疑 issue 管理或刷量，不要直接当「社区活跃」。
3. **看许可与可复现**：star 高的项目如果 license 不明（anthropics/skills）或许可结构复杂（Dify 修改版 Apache、AutoGen 代码 MIT + 文档 CC-BY-4.0），不能因为 star 多就搬代码。

---

## 7. 选型结论（给插件的一句话版）

> **我们不需要「更会搭 agent 的框架」，需要「更会管记忆/准则/任务的小机制」。**
>
> 最值得抄的三件事：**Super-agent 的工单刹车**、**Agent Skills 的技能格式与验收**、**Memobase/Letta 的结构化画像块**。
>
> 最该避开的三个坑：**多 Agent 编排框架**、**外部记忆服务/向量库**、**无边界自主与自进化**。
>
> 判断标准不是「它有多少 star」，而是「它的机制能不能用几个 JSON 文件 + 现有 `eval.ts` 复现，并且出事能回滚」。

---

## 8. 参考链接（按主题）

**常驻/主动**
- [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)｜[000-philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)｜[003-execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)｜[007-architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)｜[src/admission.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/admission.ts)
- [IT之家/baike.dev：Super-agent 架构与实验数字](https://baike.dev/news/18787)｜[AIBase 摘要](https://news.aibase.cn/news/32016)
- [OpenHands](https://github.com/OpenHands/OpenHands)｜[Automations Overview](https://docs.openhands.dev/openhands/usage/automations/overview.md)｜[Event-Based Automations](https://docs.openhands.dev/openhands/usage/automations/event-automations.md)｜[Agent Canvas Architecture](https://docs.openhands.dev/openhands/usage/agent-canvas/architecture.md)｜[Docs index](https://docs.openhands.dev/llms.txt)
- [Agent Zero](https://github.com/agent0ai/agent-zero)｜[Desktop Guide](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/desktop.md)｜[A2A Setup](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/a2a-setup.md)｜[Memory Guide](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/memory.md)

**技能/工作流**
- [Agent Skills 规范](https://agentskills.io/specification)｜[Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)｜[skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)｜[Claude: Improving skill-creator](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview.md)｜[CrewAI Crews](https://docs.crewai.com/v1.15.35/en/concepts/crews)｜[CrewAI Training](https://docs.crewai.com/en/concepts/training.md)｜[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)｜[AutoGen AgentChat](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/index.html)
- [Dify Docs](https://docs.dify.ai/en/home)｜[Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)｜[Langflow Docs](https://docs.langflow.org/)｜[LangChain Overview](https://docs.langchain.com/oss/python/langchain/overview.md)

**记忆/上下文**
- [Letta Memory Blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)｜[Mem0 Add Memories API](https://docs.mem0.ai/api-reference/memory/add-memories)｜[Graphiti](https://github.com/getzep/graphiti)｜[Memobase Profile](https://docs.memobase.io/features/profile/profile)｜[Memobase Event](https://docs.memobase.io/features/event/event)｜[A-MEM (arXiv 2502.12110)](https://arxiv.org/abs/2502.12110)

**中文/社区**
- [MaiBot](https://github.com/Mai-with-u/MaiBot)｜[A-Memorix README](https://github.com/Mai-with-u/MaiBot/blob/main/src/A_memorix/README.md)｜[learners 目录](https://github.com/Mai-with-u/MaiBot/tree/main/src/learners)｜[turn_trigger 目录](https://github.com/Mai-with-u/MaiBot/tree/main/src/maisaka/turn_trigger)
- [OpenHanako](https://github.com/liliMozi/openhanako)｜[dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)｜[dsh-bili-scroll 插件目录页](https://deepseek-harness-plugin.com/plugins/dsh-bili-scroll)

**Star 快照（GitHub API）**
- [obra/superpowers](https://github.com/obra/superpowers)｜[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)｜[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)｜[anthropics/skills](https://github.com/anthropics/skills)｜[MaiBot](https://github.com/Mai-with-u/MaiBot)｜[OpenHanako](https://github.com/liliMozi/openhanako)

---

> 备注：本报告中的「学习」一律按 L1-L4 四层定义；凡是把「记忆存储」「工具调用」「自愈重试」包装成「自我学习」的宣传，均未计入「有学习机制」。查不到或原型未实现的内容已在各节标注「未找到」或「仅文章层」。
