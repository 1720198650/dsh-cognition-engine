# AI 人格 / 长期记忆 / 伴侣 Agent 横向对比
**——为零依赖本地插件选型**

调研日期：2026-11-05  
调研方法：优先读一手 README / 官方文档 / 论文摘要与正文；GitHub 仓库核对源码与许可证；对官网只有宣传页的产品单独标低证据等级。  
说明：本报告里的「未找到」指在公开可检索范围内没有找到，不等于绝对不存在；被墙/登录墙挡住的内容不臆测。

---

## 0. 结论先行

1. **记忆层是这一垂直领域最成熟的部分**：MemGPT/Letta、Mem0、Zep/Graphiti、Memobase 都已经把「抽取—合并—检索—遗忘」做成体系；但它们的共同点是**重依赖**（SQLite/Postgres/Neo4j/向量库/LLM 抽取），不适合直接塞进零依赖插件。
2. **人格层明显落后于记忆层**：绝大多数产品把「人格」等同于一段 system prompt / 角色卡；只有千雪、MaiBot、Emergi-PersonaOS 等少数项目把人格拆成结构化、可演化的对象。
3. **「人格连续性审计」2026 年才刚起步**：ANCHOR、PICON、Nautilus Compass、ContextEcho、Anthropic persona vectors 等都还是论文/离线工具，没有面向陪伴产品的生产级审计。
4. **「人格版本管理 / diff / 回滚」几乎是空白**：最接近的是 .NET 工具 **Personas**（代码评审人格的 `pack-diff`）和论文 **Emergi-PersonaOS**（版本记录）；没有「人格 Git」产品。
5. **中文场景有论文、没工业级开源**：CharacterEval、DuLeMon/PLATO-LTM、Mem-PAL/PAL-Bench、RECALLbot、ThinkPersona 都是真论文；星野/筑梦岛只有宣传页，没有技术披露。

**一句话选型**：借 **MaiBot 的人格 JSON + 记忆纠错回滚**、**Memobase 的 Profile + Event Timeline**、**ANCHOR/PICON 的连续性审计**；避开 **Letta/Zep 式重运行时**、**黑箱记忆营销**、**「人格=system prompt」**。

---

## 1. 证据分级（全文统一）

| 等级 | 定义 | 含义 |
|---|---|---|
| **S** | 论文 + 可运行代码/数据，且评测可复现 | 最硬 |
| **A** | 有论文/正式技术报告，代码或系统未完全公开 | 技术可信，工程不可直接复用 |
| **B** | 有源码或可安装包，可读实现，但无公开评测 | 工程可参考，效果未知 |
| **C** | 只有 README/文档，没有可运行实现或评测 | 只能当设计意图 |
| **D** | 只有官方宣传页/博客/帮助中心 | 营销证据 |
| **E** | 只有第三方测评/转述 | 最弱 |

> 重要提醒：**开源 ≠ 有评测**；**有论文 ≠ 有产品**；**有官网 ≠ 有技术**。下表每行都带证据等级。

---

## 2. 总表

### 2.1 商业 / 产品

| 项目 | 类型 | 人格表示 | 记忆架构 | 评测方式 | 开源/许可 | 零依赖可行性 | 我们能借什么 | 我们不能借什么 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| **Replika** | 商业 AI 伴侣 App | 用户可改 name/avatar/backstory；Traits（Sassy 等）付费购买、影响语气；Interests 是知识包。无公开 prompt/模型结构。 | 官方称分层：可见 **Memory tab**（可手动增删）+ 更深系统从整体对话模式推断；自动记忆、点赞强化；官方称在「你的体验内本地工作」，不保留永久对话记录。无技术细节。 | 无官方技术评测；有第三方 HCI 用户研究（Skjuve et al., IJHCS 2021） | 闭源，订阅制 | ❌ 不可 | 可见记忆 tab + 手动增删 + 反馈强化；traits 当轻量人格旋钮 | 黑箱记忆、付费 trait、情感依赖型设计 | **D**（官方帮助中心；第三方用户研究另计） |
| **Character.AI** | 商业角色聊天平台 | 角色定义（name/greeting/description/definition）+ **Lorebook**；用户 **Persona** 在 profile 设置；无公开卡片标准。 | 官方博客（2026-05-21）称上线 **Story Memory / Facts / Memory Usage**；另一篇「Helping Characters Remember What Matters Most」；无算法/存储细节。 | 无同行评审的 persona/memory 论文；有训练工程博客（Inside Kaiju、Squinch） | 闭源 | ❌ 不可 | 用户 Persona 与角色 Persona 分离；Story Memory/Facts/Memory Usage 的产品分层命名 | 平台锁定；把官方博客当技术白皮书 | **D**（官方博客/帮助文档；训练工程博客另计） |
| **SillyTavern** | 本地 LLM 前端（开源） | Character Card V1→V2→V3。V2 字段：name/description/personality/scenario/first_mes/mes_example/system_prompt/post_history_instructions/alternate_greetings/character_book/creator_notes/tags/creator/character_version/extensions。V3 加 assets/nickname/creator_notes_multilingual/source/group_only_greetings/creation_date/modification_date + lorebook `@@` decorators + CHARX。 | 前端本身无原生长期记忆：context window + World Info/Lorebook + Summarize 扩展 + Data Bank RAG；没有独立记忆数据库。 | 无官方 benchmark；社区实践 | AGPL-3.0 | ⚠️ 中：Node 20+ 可本地跑，但依赖多；**卡片 JSON/PNG 格式本身零依赖** | 卡片 schema、extensions 透传、character_version/时间戳、Lorebook 触发式注入 | 用 prompt 拼接代替记忆管理；AGPL 代码；复杂前端 | **B**（规范+源码，无评测） |
| **Talkie / 星野**（MiniMax） | 商业 AI 角色陪伴 App（Talkie 海外、星野国内同产品线） | 星野官方「三层深度定制系统」：上传照片生成头像、逐字设定性格人设、五种音色混音；角色由官方/用户创建。 | 星野官方「星念记忆体系」：对话自动生成剧情卡片，可收藏/设为背景/社区分享；是**可回看的故事卡片**，不是可查询的结构化长期记忆。Talkie 第三方称 long-term memory，官方技术细节未找到。 | 无公开论文/技术评测 | 闭源 | ❌ 不可 | 人格=外貌+文字人设+声音三件套；把记忆包装成可收藏的剧情卡片（用户可见、可运营） | 把「记忆卡片」当长期记忆库；纯营销话术 | **D**（官网）；Talkie 第三方说明 **E** |
| **筑梦岛** | 商业 AI 虚拟互动平台 | 用户创建「梦中人」：外貌、性格、身世、聊天风格、喜怒哀乐；「小剧场」可加背景小传、平行世界、补充设定。 | 官网「云端梦境」：随时保存与重现美好梦境、回味点滴记忆；更像聊天存档/内容回看，不是记忆架构。第三方 FAQ 称多聊会自动强化记忆关联（弱证据）。 | 无 | 闭源 | ❌ 不可 | 人格小传/小剧场作为设定层；把关系记忆包装成「梦境」的 UX | 不透明记忆；内容运营型产品逻辑 | **D/E** |
| **Pi (Inflection)** | 商业个人 AI 助手/伴侣 | 官方定位 kind & supportive companion（有报道称主打 EQ/personal intelligence）；具体人格设定未公开。 | 官方帮助（2026-09-01）：**Pi now remembers across chats**。记忆范围：姓名/城市/家人（经许可）、饮食偏好/过敏、爱好、工作/学习、沟通偏好、目标/习惯；明确不记临时计划/一次性事件；Settings > Account > Manage Memories 可增删改；点踩不自动删除。无架构细节。 | 无公开论文/技术评测 | 闭源 | ❌ 不可 | 「只记长期稳定事实，不记临时事件」的筛选原则；记忆分类；用户可编辑/清除 | 黑箱；无法验证「permission」实现 | **D**（官方帮助中心） |

### 2.2 开源 / 研究：记忆与 Agent 框架

| 项目 | 类型 | 人格表示 | 记忆架构 | 评测方式 | 开源/许可 | 零依赖可行性 | 我们能借什么 | 我们不能借什么 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| **Letta / MemGPT** | 开源有状态 Agent 框架（MemGPT 论文系统） | persona 是 **core memory block**：label / description / value / character limit；可被 agent 自编辑；另有 human block；sleep-time agent 也可改块。人格不是独立对象，只是记忆块。 | 三层：**core memory**（常驻上下文的可编辑块）、**recall memory**（完整对话历史，可搜索）、**archival memory**（外部向量/图数据库，显式知识）；message buffer + eviction/summarization；sleep-time compute 离线整理。 | MemGPT 论文：文档分析 + 多会话对话；DMR benchmark；Letta 有 evals 框架 | Apache-2.0（Letta 仓库） | ❌ 低：server/DB/向量库 | block 的 label/description/value/limit 四元组；core/recall/archival 分层；sleep-time 整理 | 完整服务端/DB 依赖；把人格降成一个 block；LLM 自编辑缺少审计 | **S**（论文+代码+文档） |
| **Generative Agents**（Park 2023） | 研究论文 + 开源模拟代码 | 每个 agent 有 identity/backstory（自然语言），不是结构化人格对象。 | **memory stream**：完整自然语言经历记录；检索按 **recency / importance / relevance** 加权；**reflection** 定期生成高层洞察；**planning** 分层（日计划→小时→行动）；消融证明 observation/planning/reflection 各自重要。 | 人类评估 believability + 消融；25 agents 小镇涌现行为（情人节派对） | 代码公开，许可证见仓库 | ⚠️ 中低：Python 研究代码；思路可纯 JSON 复刻 | memory stream 三因子检索；reflection 生成「总结」而非只存原文；计划与记忆分离 | 面向模拟而非真实用户；无隐私/删除/权限；成本高 | **S**（论文+代码） |
| **A-MEM**（NeurIPS 2025） | 研究记忆系统 | 无独立人格模型；通用 agent memory。 | **Zettelkasten 式笔记**：每条记忆生成 contextual description + keywords + tags；动态链接相关历史记忆；**memory evolution** 会更新旧记忆的上下文/属性；形成图式知识网络。 | 六个基础模型、对比 SOTA 记忆基线；NeurIPS 2025 | 代码公开（仓库见论文） | ⚠️ 中低：LLM+向量；笔记 JSON+双链可纯文件实现 | 记忆条目=结构化笔记（摘要/关键词/标签/链接）；新记忆触发旧记忆演化 | 依赖 LLM 抽取；链接维护成本；没有用户可见的删除/审计 | **S**（论文+代码） |
| **Mem0** | 开源/商业记忆层 | 无；只做 user/agent/session memory。 | 两阶段：**extraction**（从对话提取候选记忆）+ **consolidation**（对已有记忆执行 **ADD / UPDATE / DELETE / NOOP**）；可选 graph memory 捕捉关系。 | LOCOMO：比 OpenAI memory **26%** relative LLM-as-Judge 提升；p95 latency **-91%**；token cost **-90%+**；graph memory 约 **+2%** | Apache-2.0（Open Source） | ❌ 低：SDK + vector store + LLM | ADD/UPDATE/DELETE/NOOP 四操作；抽取—合并流水线；token/latency 指标口径 | 依赖 LLM/向量库；只记用户事实、不覆盖人格连续性；商业平台锁定 | **S**（论文+代码；厂商自评） |
| **Zep / Graphiti** | 商业记忆层 + 开源时序知识图谱引擎 | 无独立人格模型；persona 可作为实体/关系建模。 | Graphiti：episode（原始对话/事件）→ entity/edge；边带 **created_at / expired_at / valid_at / invalid_at** 双时间轴；incremental 更新；provenance。Zep 提供 DMR/LongMemEval 评测。 | Zep 论文：DMR **94.8% vs MemGPT 93.4%**；LongMemEval accuracy **+18.5%**、latency **-90%** | Graphiti Apache-2.0；Zep 商业服务 | ❌ 低：Neo4j/FalkorDB 等图数据库 | 事实有效期 valid_at/invalid_at；provenance/来源追踪；episode→实体→关系抽取 | 图数据库依赖；抽取成本；schema 复杂 | **S/A**（论文+Graphiti 源码） |
| **Memobase** | 开源用户画像记忆系统 | 无独立人格；**Profile**（basic_info/demographics/education/interest/psychological/work 等可配置字段）+ **Event Timeline**。 | 结构化用户 Profile + 事件时间线；buffer 批量处理（约 1024 tokens 或 1 小时 flush）；context API 直接打包进 prompt；在线延迟声称 <100ms；0.0.40 起单次 flush 固定 3 次 LLM 调用；LOCOMO 自报 SOTA。 | LOCOMO（官方自报）+ 900 轮真实聊天 profile 示例；无独立论文 | Apache-2.0 | ❌ 低：FastAPI + Postgres + Redis；**数据模型可纯 JSON 复刻** | Profile + Event Timeline 双视图；批量 buffer 降成本；context 打包 API；可配置 profile schema | 服务端依赖；以用户画像为中心，不覆盖 AI 自身人格/关系演化；SOTA 自报 | **B**（源码+README+自报 benchmark） |

### 2.3 中文人格 / 陪伴项目

| 项目 | 类型 | 人格表示 | 记忆架构 | 评测方式 | 开源/许可 | 零依赖可行性 | 我们能借什么 | 我们不能借什么 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| **OpenHanako / HanaAgent** | 开源桌面 AI 个人 Agent（Electron + React + Pi SDK） | 人格模板 + 自定义人格文件；每个 Agent 独立文件夹（人格/记忆/定时任务）；支持导入/导出角色卡 zip：人格、头像、可选记忆、Skills 白名单。 | 自研记忆系统 + 主流记忆方案；近期记忆强；用 **better-sqlite3（WAL）** 存储；「大工具模型」负责记忆编译；具体分层未公开文档化。 | 无公开评测；约 6.9k stars / 1.2k open issues | Apache-2.0；TypeScript | ❌ 低：Electron + SQLite + Node | 「Agent=文件夹」的人格/记忆打包；角色卡 zip 白名单携带记忆；多 Agent 隔离 | Electron/SQLite 重栈；记忆实现不透明；issue 积压 | **B**（源码+README） |
| **MaiBot / 麦麦 MaiSaka** | 开源 QQ/Discord 群聊数字生命 Agent（Python） | **人格库**（多 persona 保存/切换、热重载）；人格 JSON `maibot.personality` v1：`personality`、`behavior_style`、`reply_style`、`group_chat_prompt`、`private_chat_prompts`、`multiple_reply_style`、`multiple_probability`；另有心理学人格画像。 | **A-Memorix**：SQLite 主存（paragraphs/relations/episodes/profiles/fact ledger/queues）+ FAISS 向量 + 关系图快照；episode 生成、person profile、记忆演化（衰减/遗忘）、模糊修正（生成计划→确认→执行→**可回滚**）、记忆抹除回收站/历史回滚、`.amembundle` 记忆包导入导出、图片记忆。 | 无公开学术评测；工程文档非常细（A-Memorix 配置 5000+ 字） | GPL-3.0 | ❌ 很低：Python + SQLite + FAISS + embedding/LLM | 人格 JSON 字段设计（行为风格/群聊/私聊分开）；记忆纠错「计划→确认→执行→回滚」；记忆流/审计时间线；人物画像与事实账本分离；记忆包导出 | GPL-3.0（闭源/宽松许可插件需避开）；重依赖；群聊场景假设 | **B**（源码+详细文档） |
| **千雪 Qianxue** | 开源跨平台 AI 陪伴 Agent（Python，QQ/Discord/Web） | **三层人格**：不变层（底线）/稳定层（性格底色）/可塑层（说话风格、话题偏好、情感倾向，每次对话微调）；**四维节律**：心情、精力、注意力、信心随时间变化并影响回复。 | 短期记忆（感知层：谁在说话/聊什么/她的情绪）→ **双轨长期记忆**（体验层=经历与感受；信息层=事实/生日/宠物名；独立演化，回忆时合并为统一简报）→ **梦境处理**（巩固层：重组记忆、发现关联、模糊不重要细节）；跨群共享短期记忆；跨平台身份合并；心跳主动思考。 | 无公开评测；约 3 stars，MIT | MIT | ❌ 低：多 Python 服务（Memory/backend/heartbeat）+ 可选 STT/TTS | 三层人格；体验层 vs 信息层双轨记忆；「梦境」离线巩固；情绪/精力节律；跨平台身份合并 | 多进程服务架构；Python 依赖；无评测 | **B**（源码+README） |
| **Personal OS**（同名两项目需区分） | 开源本地个人 AI 助理 | ① `waynevianzhang-bit/personal-os`：personality engine 学习你的决策风格；② `Iuanin666/personal-reasoning-os`：profile evolution、evidence-aware。均无详细结构公开。 | ① 长期记忆 + RAG 知识库 + ChromaDB；② Markdown-based personal memory + evidence-aware retrieval + personal analysis + profile evolution。 | 无 | ① MIT；② 未核 | ① ❌ 低（FastAPI/React/ChromaDB）；② ⚠️ 高（纯 Markdown 有零依赖潜力） | ② 用 Markdown 作为记忆载体、证据可追溯；① 人格引擎学习决策风格的概念 | 项目太小/未验证；ChromaDB 依赖；不要把两个同名项目混为一谈 | **B/C**（README/描述） |

### 2.4 人格评测与研究

| 项目 | 类型 | 人格表示 | 记忆架构 | 评测方式 | 开源/许可 | 零依赖可行性 | 我们能借什么 | 我们不能借什么 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| **CharacterEval** | 中文角色扮演评测 benchmark（ACL 2024） | 77 个中文小说/剧本角色；角色 profile 来自百度百科 + 对话 | 无（评测对话，不建模长期记忆） | 1,785 段多轮对话 / 23,020 样本 / 77 角色；13 项指标 / 4 个维度；含 reward model | 代码+数据公开（MIT） | 仅评测 | 中文角色一致性指标；角色 profile 来源 | 没有长期记忆维度 | **S**（论文+代码） |
| **InCharacter** | 人格保真度评测（ACL 2024） | 32 个角色；14 种心理量表；用「心理访谈」测人格 | 无 | 心理访谈而非自我报告；SOTA RPAs 与人类感知人格对齐最高 **80.7%** | 论文+代码（仓库见论文） | 仅评测 | 用心理量表/访谈测人格，不只问「你是谁」 | 静态人格，不测记忆/时间演化 | **S/A** |
| **CharacterBench** | 中英双语角色定制 benchmark（AAAI 2025） | 3,956 个角色 / 25 个类别；11 个维度 / 6 个方面（sparse vs dense） | 无 | 22,859 条人工标注样本；专用 **CharacterJudge**；比 GPT-4 judge 更稳定/便宜 | 代码+数据公开 | 仅评测 | 稀疏/稠密维度分类；专用 judge 模型；角色类别覆盖 | 不测长期记忆/关系 | **S**（论文+代码） |
| **PersonaAgent** | 个性化 LLM Agent 框架（ACL 2026 Findings；arXiv 2506.06254） | **persona = 每个用户独特的 system prompt**；作为 memory 与 action 的中介 | personalized memory module：**episodic + semantic** memory；action 结果反过来 refine memory；test-time 用最近 n 轮模拟优化 persona prompt（textual loss） | 与其他个性化 baseline 对比；test-time 用户偏好对齐；声称显著优于 baseline | 论文（代码发布情况待核） | ⚠️ 中：框架轻，但依赖 LLM/工具 | persona 作为记忆与行动的中介；episodic/semantic 双记忆；动作结果回写；test-time persona prompt 优化 | persona 只是 prompt，无版本/审计；评测侧重任务偏好，不是长期陪伴连续性 | **A**（论文） |
| **ANCHOR**（Best Friends, Not Forever，arXiv 2607.28818） | 长程人格连续性审计 benchmark | **27 personas**；Identity Probe = 102 项密封问卷 + turn-level judgments；Trajectory Probe = 110 道校准反事实题 / 35 conversation banks | 3 种生成记忆设置 × 9 种交互 schedule；**2,008 conversations**；4 个模型 | 测 **persona collapse + behavioral drift**：trajectory accuracy 仅 **44.4%**；user-state recall 接近四选一随机；没有 context/memory 设置能稳定解决；问卷保持率随模型/人格 facet 变化，且与 turn-level 行为不一致，对 evaluator 选择敏感 | 论文；未找到公开代码 | ✅ 高（离线审计方法） | 把连续性拆成 **persona enactment + trajectory recall** 两个独立指标；密封问卷 + turn-level 判断 + 反事实轨迹题；多 evaluator 交叉 | 合成审计，不是生产监控；不能直接当产品指标 | **A**（论文；代码未找到） |

---

## 3. 五个追加问题

### 3.1 谁在做「人格连续性审计」？除了 Anchor 还有谁？

不是只有 Anchor。2026 年已经形成一个很小但明确的研究簇，可分为四类：

| 方向 | 代表工作 | 做法与关键结果 | 证据 |
|---|---|---|---|
| **伴侣长程连续性** | **ANCHOR**（Best Friends, Not Forever，arXiv 2607.28818） | 2,008 段对话、27 personas、9 schedules、3 memory settings、4 models；Identity Probe（102 项密封问卷 + turn-level）+ Trajectory Probe（110 道反事实题 / 35 banks）；trajectory accuracy 44.4%，user-state recall 近随机；结论：没有模型/记忆设置能可靠保持连续性。 | **A**（论文） |
| **多轮审讯一致性** | **PICon**（arXiv 2603.25620，KAIST） | 逻辑链式多轮提问；三个维度：internal consistency（无自相矛盾）、external consistency（符合现实事实）、retest consistency（重复测试稳定性）；7 组 persona agents + 63 名真人；连此前「高一致」的系统也不达人类基线。有 demo/code 页面。 | **A**（论文+Demo） |
| **生产黑箱漂移检测** | **Nautilus Compass**（arXiv 2605.09863） | prompt-text 层余弦相似度（BGE-m3）+ 加权 top-k mean；索引时不调用 LLM；Merkle 链审计日志；ROC AUC 0.83；LongMemEval-S 56.6%；MIT 代码，Claude Code 插件/MCP/CLI。自称是少数不在索引时调 LLM 的公开记忆层。 | **A/B**（论文+MIT 源码，厂商自评） |
| **白盒内部监测** | **Anthropic persona vectors**（arXiv 2507.21509） | 从模型激活中提取「persona vector」，监控/抑制/预防人格漂移；在 Qwen 2.5-7B、Llama-3.1-8B 上验证；适合模型开发者，不适合闭源 API 插件。 | **A**（论文+官方博客） |
| **对话指令稳定性** | **Measuring and Controlling Persona Drift in Language Model Dialogs**（Li et al., COLM 2024，arXiv 2402.10962） | 测量并控制对话中的 persona drift / instruction instability；较早的系统性工作。 | **A**（论文） |
| **长 Agent 会话漂移** | **ContextEcho**（arXiv 2605.24279） | 25 项 identity probe；snapshot-then-probe；57 段真实长 coding sessions（Claude Code/Codex CLI）；发现漂移跨供应商、出现很早，compaction 不能可靠重置或放大；单次 anchor 可恢复，但 placebo 对照显示可能是通用语气重置。 | **A**（论文，开源 benchmark） |
| **人格状态鲁棒性** | **CORE / PERSIST**（arXiv 2609.12373，EMNLP 2026 Findings） | 把 turn-local evidence 与 persistent persona-state revision 分开；PERSIST 基准覆盖 ambiguity/conflict/social influence；在 ALOE、PersonaChat、PERSIST 上提升对齐与鲁棒性。 | **A**（论文） |
| **身份漂移治理** | **Layered Mutability**（arXiv 2604.14717） | 五层可变性框架（pretraining/post-training/self-narrative/memory/weights）；初步实验：回退可见自我描述后，identity hysteresis ratio 0.68——行为没有完全恢复。 | **A**（论文） |

**判断**：
- **ANCHOR 是最贴近「伴侣长程人格连续性」的审计**，但它是合成 benchmark，不是线上监控。
- **PICon 最贴近「一致性审讯」**，适合做 persona QA，但不测几个月尺度。
- **Nautilus Compass 最接近「生产可用」**，但面向 coding agents，不是伴侣；其「不在索引时调用 LLM」思路很适合零依赖插件。
- **Anthropic persona vectors 是白盒方法**，插件拿不到闭源模型权重，不能直接用。
- 结论：**「除了 Anchor 还有谁」——至少 7 家学术/开源方向；但「伴侣产品的生产级连续性审计」仍然没有人做。**

### 3.2 谁在做「人格版本管理 / diff / 回滚」？

| 项目/工作 | 做了什么 | 局限 | 证据 |
|---|---|---|---|
| **Personas**（.NET 10 tool，MIT，NuGet `Personas`） | 最接近「人格 Git」的真实工具：`persona build` 生成 **versioned persona pack**（`persona-pack.json` + memory/review-rubric/tone-profile/evidence-map/matcher-specs）；`persona pack-diff` 比较两个 persona pack 并输出 changelog；`persona export/install` 导出 `.persona` bundle；`identity approve/reject` 管理身份候选。 | 面向**代码评审人格**（从 PR/评论/提交中学习某位工程师），不是伴侣/个人助理；没有 UI，CLI/MCP。 | **B**（NuGet 包+源码，真实可用） |
| **Emergi-PersonaOS**（arXiv 2609.27417） | 三层人格表示（dispositional traits / characteristic adaptations / narrative identity）；长期发展中记录经验与结果，通过 change attribution、meaning-making、behavioral testing 产生 revision candidates；**explicit review、traceable evidence、version records、可拒绝候选**。 | 论文/prototype；没有公开产品；评测以电视剧角色对话为材料。 | **A**（论文） |
| **Layered Mutability**（arXiv 2604.14717） | 把 self-narrative 层定义为「可读、可 diff、可 revert」；提出 governance load / hysteresis 公式；实验表明**浅层回退不能恢复行为**（hysteresis 0.68）。 | 概念框架 + 初步实验，不是工具。 | **A**（论文） |
| **SillyTavern Character Card V3** | 卡内字段 `character_version`、`creation_date`、`modification_date`；V2 规范说 `character_version` 让应用「区分版本」。 | **只是元数据**：没有版本历史、diff、回滚；`character_version` 是字符串，不是语义版本。 | **B**（规范+源码） |
| **Letta AgentFile (.af)** | 把 agent 配置导出为开放标准文件，可 import/export，便于快照和迁移。 | 是**快照/可移植格式**，不是 diff/rollback 引擎；没有内建变更历史。 | **S**（文档+代码） |
| **Semantic Versioning for Agent Personas**（moltbook 文章）/ **SemanticEd 文章** | 提出给 agent persona 打 semver、Telemetry Log、Slipstream Protocol（人工检查当前版本再打补丁）。 | 只有博客/文章，没有开源实现或产品。 | **D**（博客） |

**判断**：
- **「人格版本管理」不是完全没有**：`Personas` 已经做了 persona pack 的 diff/changelog/export，但它是代码评审领域，不是陪伴产品。
- **「人格 diff / 回滚」在伴侣/个人助理赛道基本空白**：没有产品把「人格」当 Git 对象管理；SillyTavern 只有版本号字段，Letta 只有文件快照。
- **回滚不是万能**：Layered Mutability 的 hysteresis 0.68 说明，回退 prompt/人格文件不等于回退行为；必须同时管记忆层。
- **MaiBot 有「记忆回滚」但不是人格回滚**：它的「记忆抹除→历史回滚」是记忆内容级别，不是人格版本级别。

### 3.3 谁在做「人格 + 记忆 + 行动」三者闭环？

| 项目 | 闭环方式 | 缺什么 | 证据 |
|---|---|---|---|
| **PersonaAgent**（ACL 2026 Findings） | persona（system prompt）作为中介：个性化 memory（episodic+semantic）→ 控制 action（工具调用）→ action 结果反过来 refine memory；test-time 用模拟交互优化 persona prompt。 | persona 只是 prompt，没有版本/审计；action 多为任务工具，不是长期关系行为；评测是任务偏好而非陪伴连续性。 | **A**（论文） |
| **Generative Agents**（Park 2023） | memory stream → reflection → planning → action；行动结果继续写入 memory stream。 | 没有「用户人格」和「AI 人格」的区分；面向模拟；无隐私/删除；无版本管理。 | **S**（论文+代码） |
| **Letta / MemGPT** | memory blocks + tools/action；persona block 可被 agent 自编辑；sleep-time agent 异步整理。 | persona 只是 block；无「人格状态→行动→人格变化」的显式审计；无版本。 | **S**（论文+代码） |
| **Emergi-PersonaOS**（arXiv 2609.27417） | 三层人格 + 检索记忆 + 当前 interlocutor/relationship/event → 推断 persona state → 生成 actions/replies；长期记录经验并评估 revision candidates。 | 论文 prototype；没有公开代码/产品；评测有限。 | **A**（论文） |
| **OpenHanako / MaiBot / 千雪** | 产品级：人格设定 + 长期记忆 + 主动发言/工具/定时任务/心跳。 | 无公开评测；人格演化多为设定/记忆驱动，不是可审计闭环。 | **B**（源码/文档） |
| **Memory as Action**（ACL 2026 Findings，arXiv 2510.12635） | 把「记忆管理」本身作为 action（自主 context curation）。 | 不是人格闭环；只解决长任务上下文。 | **A**（论文） |

**判断**：**真正把三者作为显式框架的论文只有 PersonaAgent 和 Emergi-PersonaOS 比较接近**；Generative Agents 是「记忆→计划→行动」但没有「人格」对象；Letta 是「记忆+工具」但人格只是 block。产品端有形态，但没有可验证的闭环。  
**真实空白**：**「行动结果如何改变人格」没有运行时审计**——PersonaAgent 只做 test-time prompt 优化；其他系统基本不回写人格。

### 3.4 中文场景：有没有专门做中文长期助手人格的论文/项目？

有，但集中在 2022 和 2026 的学术/设计研究，工业级开源几乎没有：

| 工作 | 语言/场景 | 关键点 | 证据 |
|---|---|---|---|
| **CharacterEval**（ACL 2024，arXiv 2401.01275） | 中文角色扮演 | 1,785 段多轮对话、23,020 样本、77 个中文小说/剧本角色；13 指标/4 维度；中文 LLM 表现优于 GPT-4。 | **S** |
| **DuLeMon / PLATO-LTM**（ACL 2022 Findings，百度） | 中文长程人格对话 | **27,501 段中文多轮对话**；同时建模用户与 bot 的 persona；Persona Extractor 实时抽取、Long-Term Memory 读写、生成时检索；一致性显著提升。 | **S**（论文+代码） |
| **Mem-PAL / PAL-Bench**（AAAI 2026 Oral，arXiv 2511.13410） | 中文个性化服务助手 | **首个中文多 session 用户日志+对话数据集 PAL-Set**；H²Memory 分层异构记忆框架；面向长期 user-agent 交互。 | **A**（论文） |
| **RECALLbot**（CHI 2026，浙江大学） | 中文社交陪伴 AI | **Me Memory（AI 自身成长背景+日记）+ We Memory（与用户共建的对话+画像）**双记忆；根据对话主导度动态切换自我披露/邀请用户披露；轻量用户控制。 | **A**（论文） |
| **ThinkPersona**（ACL 2026，浙江大学） | 中文忠实角色扮演 | 从大规模真实访谈视频构建**人物画像图谱**（基本信息/价值系统/社会关系/人生事件及影响）；先基于人物证据推理再回答；长对话更稳定保持角色身份。 | **A**（论文） |
| **星野 / 筑梦岛 / 千雪 / MaiBot / OpenHanako** | 中文产品/开源 | 星野/筑梦岛只有宣传；千雪/MaiBot/OpenHanako 有源码但无学术评测。 | **D / B** |

**判断**：中文**有**专门的长期人格论文（DuLeMon、Mem-PAL、RECALLbot、ThinkPersona、CharacterEval），但**没有一个工业级开源中文伴侣项目公开人格连续性评测**。这既是空白，也是机会。

### 3.5 哪些项目「营销文案大于技术实现」？

| 类别 | 项目 | 证据等级 | 说明 |
|---|---|---|---|
| **只有官方宣传/帮助文档** | Replika、Character.AI、Talkie/星野、筑梦岛、Pi | **D**（筑梦岛部分 **E**） | 没有源码/论文；「记忆」「人格」是产品文案，无法核验实现。Character.AI 有训练工程博客（Inside Kaiju/Squinch），但那是预训练基础设施，不是 persona/memory 技术。 |
| **只有 README/源码、无公开评测** | OpenHanako、MaiBot、千雪、Personal OS | **B/C** | 能读代码，但作者没有给出可复现的人格/记忆评测；OpenHanako README 自己承认「记忆系统有待优化」。 |
| **有论文+代码** | Letta/MemGPT、Generative Agents、A-MEM、Mem0、Zep/Graphiti、CharacterEval、CharacterBench、InCharacter | **S/A** | 最值得精读；注意 Mem0/Zep 是厂商论文，指标自报。 |
| **有论文、无公开代码** | ANCHOR（Best Friends, Not Forever）、Emergi-PersonaOS、Layered Mutability、CORE/PERSIST | **A** | 方法论可借，工程不能直接抄。 |
| **有真实代码/包、无学术评测** | Personas（.NET，NuGet）、Memobase | **B** | Personas 是真实可用工具（代码评审人格）；Memobase 有源码和自报 LOCOMO。 |
| **只有博客/文章** | Semantic Versioning for Agent Personas（moltbook）、SemanticEd 文章、Future AGI 的 persona drift 博客 | **D** | 只能当观点/线索，不能当技术依据。 |

**点名「营销大于技术」**：**星野 / 筑梦岛 / Talkie > Replika / Character.AI / Pi**。前三个只有官网宣传；后三个至少有帮助中心/产品文档和长期运营，但仍没有可核验的 persona/memory 技术论文。**Character.AI 的「Story Memory / Facts / Memory Usage」是官方博客级别，不能当架构文档。**

### 3.6 「未找到」清单（避免把没查到说成没有）

- **Replika 的模型/prompt/记忆架构技术细节**：未找到公开技术文档或论文；只有帮助中心说明 + 第三方 HCI 用户研究。
- **Character.AI 的人格/记忆技术论文**：未找到；只有官方博客和训练工程博客（Inside Kaiju / Squinch）。公开的 **Character Card 规范**也**未找到**（其角色定义为平台内格式，不是 SillyTavern 的开放卡片标准）。
- **Talkie / 星野 / 筑梦岛 的技术实现**：未找到公开论文、源码或架构文档。
- **Pi 的具体人格设定/系统提示**：未找到；只有官方帮助中心的记忆范围说明。
- **ANCHOR 的公开代码/数据**：未找到（截至 2026-11-05 检索）。
- **PersonaAgent 的公开代码**：未找到（论文发表，代码发布情况待核）。
- **Emergi-PersonaOS / Layered Mutability / CORE-PERSIST 的公开代码**：未找到（论文阶段）。
- **Memobase 的独立第三方评测**：未找到；其 LOCOMO SOTA 为官方自报。

---

## 4. 这个领域的真实空白

### 4.1 真空白（没人做好，或根本没人做）

1. **人格 Git：人格的版本管理 / diff / 回滚**
   - 现状：`Personas`（.NET）只有代码评审人格的 pack-diff；`Emergi-PersonaOS` 只有论文里的 version records；SillyTavern 只有 `character_version` 元数据；Letta 只有 `.af` 快照。
   - 空白：**没有面向伴侣/个人助理的「人格 Git」**——没有 commit history、branch、diff、blame、rollback，也没有「回滚后行为是否真的恢复」的验证。
   - 证据：SillyTavern V2/V3 规范；Personas NuGet；Emergi-PersonaOS；Layered Mutability 的 hysteresis 0.68。

2. **生产级「人格连续性审计」**
   - 现状：ANCHOR/PICon/ContextEcho 是离线 benchmark；Nautilus Compass 面向 coding agents；Anthropic persona vectors 需要模型权重。
   - 空白：**没有面向陪伴产品的实时、黑箱、可解释的连续性审计**；没有行业统一指标；没有「审计结果 → 产品告警」的闭环。
   - 证据：ANCHOR 44.4% trajectory accuracy；PICon；Nautilus；ContextEcho。

3. **人格状态作为一等公民（first-class object）**
   - 现状：绝大多数系统把人格当 system prompt / character card / 一个 memory block；没有独立状态机、没有合法状态转移、没有「人格变更影响评估」。
   - 空白：**人格的 immutable/stable/plastic 分层、变更审批、影响面分析**——几乎没有工程实现。千雪的三层人格是最接近的设计，但它没有审计/版本。
   - 证据：千雪 README；Letta memory blocks；PersonaAgent 的 persona=system prompt。

4. **「Me Memory」与「We Memory」的分离**
   - 现状：记忆系统几乎都只记「用户」（user profile / facts）；AI 自己的经历、成长、日记、关系叙事基本不存。RECALLbot 的 Me Memory + We Memory 是唯一明确把两者分开的研究。
   - 空白：**AI 自身人格连续性**（它记得自己是谁、经历过什么、和你的关系如何变化）没有工业级实现。
   - 证据：RECALLbot（CHI 2026）；Replika/Character.AI/Memobase 的记忆都是用户侧。

5. **行动对人格的反作用（action → persona feedback）**
   - 现状：PersonaAgent 用 action 结果 refine memory，但人格本身只做 test-time prompt 优化；Letta 的 persona block 可自编辑但没有审计。
   - 空白：**工具行动/环境行动如何改变人格**（例如 Agent 做了某件事后，它的价值观/关系状态如何变化）没有可审计的运行时机制。
   - 证据：PersonaAgent；Letta；Emergi-PersonaOS。

6. **中文工业级长期助手人格**
   - 现状：DuLeMon/PLATO-LTM、Mem-PAL/PAL-Bench、RECALLbot、ThinkPersona 都是论文/原型；星野/筑梦岛无技术披露；千雪/MaiBot/OpenHanako 无学术评测。
   - 空白：**中文、可本地部署、零依赖、可审计的长期人格助手**——没有成熟开源项目。
   - 证据：上述论文；产品官网。

### 4.2 伪需求（看起来很热，但不值得做）

1. **「无限记忆 / 记住一切」是伪需求。**
   - ANCHOR 显示：给不同记忆设置也救不了连续性；Pi 明确只记「长期稳定事实」，不记临时计划；Mem0 的 90% token 节省来自压缩而非全存。
   - 用户真正需要的是**可检索、可解释、可删除**，不是无限上下文。

2. **「人格卡字段越多越强」是伪需求。**
   - SillyTavern V3 新增的主要是 assets、nickname、多语言 notes、group greetings、时间戳、lorebook decorators——这些提升**表现力/兼容性**，不提升**人格连续性**。
   - `character_version` 只是字符串，不是语义版本，不能证明行为一致。

3. **「单一质量分」是伪需求。**
   - ANCHOR 明确说不要把 persona enactment、trajectory recall、evaluator provenance、deployment context 混成一个 trust/stability score；问卷结果和 turn-level 行为会不一致。
   - 正确做法：**分维度报告**（enactment / trajectory / stability），并标注 evaluator。

4. **「全自动人格演化」是伪需求（甚至是风险）。**
   - Layered Mutability 的结论：self-modification 的治理难度随「变更快、下游耦合强、可逆性差、可观测性低」上升；没有审计的自动演化会产生 compositional drift。
   - 人格演化应该是 **候选 → 评审 → 版本记录 → 可回滚**，不是自动改。

5. **「关系等级 / 好感度数值」是伪需求。**
   - 这是游戏化/运营手段，不是人格连续性。没有任何论文证明「好感度」能提升长期人格稳定性；反而可能鼓励用户过度依赖。

6. **「多 Agent 群聊人格」对个人插件是伪需求。**
   - MaiBot/OpenHanako 的多 Agent/群聊是平台型功能，不是个人长期记忆的核心；个人插件做多 Agent 只会增加记忆隔离和人格串扰的复杂度。

7. **「本地优先 = 零依赖」是错误等式。**
   - OpenHanako 本地但 Electron+SQLite；SillyTavern 本地但 Node 多依赖；Memobase 可本地但 FastAPI+Postgres+Redis。**本地部署不等于零依赖。**

### 4.3 机会窗口（给我们的）

- **人格版本管理 + 连续性审计**是最大空白，也是最适合零依赖插件做的：不需要 GPU、不需要图数据库、不需要模型训练；只需要**结构化 JSON + 哈希 + 快照 + 可解释检索 + 固定审计题库**。
- **「人格 Git」+「记忆审计」组合**可以成为差异化：竞品要么只做记忆（Mem0/Zep），要么只做角色卡（SillyTavern），要么只做评测（ANCHOR/PICon），没有人把三者打包成轻量本地插件。
- **中文场景**：星野/筑梦岛不公开技术，千雪/MaiBot 无评测；一个中文、零依赖、可审计的插件有明确空位。

---

## 5. 给我们的选型建议

### 5.1 借哪 3 个

#### ① 借 MaiBot 的「人格 JSON + 记忆纠错回滚」

**借什么：**
- 人格 JSON 的字段分组：`personality`（性格）、`behavior_style`（行为风格）、`reply_style`（回复风格）、`group_chat_prompt` / `private_chat_prompts`（场景提示分开）、`multiple_reply_style` / `multiple_probability`（可选行为）。
- 记忆纠错协议：**生成修改计划 → 人工确认 → 执行 → 可回滚**；这是把「记忆修改」当数据库事务，而不是让 LLM 直接覆盖。
- 记忆流（memory stream）/ 审计时间线：每次 add/update/delete 都有事件记录。
- 记忆包导出：`.amembundle` 思路——插件可以导出 `.json` 人格+记忆包，便于迁移。

**不借：** GPL-3.0 代码、SQLite/FAISS 重依赖、群聊假设。

**落地：** 我们的 `persona.json` 可以直接用这套字段命名（做减法），`memory-ops.jsonl` 记录每次变更与回滚点。

#### ② 借 Memobase 的「Profile + Event Timeline」+ Pi 的「只记稳定事实」

**借什么：**
- `profile.json`：结构化用户画像（basic_info / preferences / goals / relationships / communication_style）。
- `events.jsonl`：事件时间线（时间、来源、置信度、valid_from/valid_to），解决「什么时候发生的事」。
- `context()` 思路：按 token 预算打包 profile + 最近事件 + 相关记忆，而不是把全部历史塞进 prompt。
- Pi 的筛选原则：**只记 lastingly true 的事实**；不记一次性事件/临时计划。这条规则能显著减少记忆噪声。
- buffer 批量处理：把多次对话合并成一次整理，降低 LLM 调用成本（我们的插件甚至可以规则化，不调 LLM）。

**不借：** FastAPI/Postgres/Redis 服务端；以用户画像为中心、忽略 AI 自身人格。

**落地：** `memory/profile.json` + `memory/events.jsonl`；所有事件带 `valid_from/valid_to`，删除用软删除/墓碑，不物理抹掉。

#### ③ 借 ANCHOR / PICON 的「连续性审计」

**借什么：**
- **双轴指标**：persona enactment（人格是否还在）+ trajectory recall（共同经历是否记得），不要合成一个总分。
- **密封问卷**：50–100 道固定题，覆盖人格特质、边界、价值观、说话风格；每次版本变更后重跑。
- **反事实轨迹题**：30–50 道「如果当时是 X，你会怎么反应」的问题，测关系记忆与行为一致性。
- **多 evaluator**：规则匹配 + LLM judge + 人工抽检；记录 evaluator 版本，避免「换 judge 就换分数」。
- **版本回归**：每次 `persona` 或记忆策略变更，跑同一套审计，输出 diff 报告。

**不借：** ANCHOR 的合成数据生成器（我们不需要造 2,008 段对话）；PICON 的多轮审讯可以裁剪成 20–30 轮。

**落地：** `audit/persona-probes.json`（固定题库）+ `audit/reports/`（每次版本一份 JSON）；发布前用 [ctxt-00001] 的发版流程跑一遍。

### 5.2 避开哪 3 个

#### ① 避开 Letta / MemGPT / Zep / Graphiti 的「重运行时」

- 它们需要 SQLite/Postgres/Neo4j/向量库/LLM 抽取服务；零依赖插件无法承载。
- **只借概念**：memory block 四元组、core/recall/archival 分层、`valid_at/invalid_at`、provenance、sleep-time 反思。
- 不要把「引入 Letta」当成选型——它是另一个产品，不是库。

#### ② 避开 Character.AI / Replika / 星野 / 筑梦岛 / Pi 的「黑箱记忆营销」

- 它们没有任何可核验的 persona/memory 技术文档；「记忆」是产品文案。
- 不要复制「Memory tab」而没有 source/confidence/delete；不要承诺「记住一切」。
- 可以借 UX 表达（可见记忆列表、手动删除、记忆分类），但**底层必须自己可审计**。

#### ③ 避开「人格 = 一段 system prompt」和「单一总分」

- PersonaAgent 的 persona 是 system prompt；SillyTavern 的角色卡最终也是 prompt；它们**不是人格状态机**。
- CharacterEval/CharacterBench 的单一 benchmark 分数不能代表长期连续性；ANCHOR 明确反对单一 trust score。
- 正确做法：**人格结构化分层（immutable/stable/plastic）+ 版本快照 + 分维度审计**。

> 额外两个小坑：**SillyTavern 是 AGPL-3.0**，不能把代码直接搬进闭源/宽松许可插件；**OpenHanako 是 Electron+better-sqlite3**，不是「零依赖」，只能借数据组织方式。

### 5.3 落到纯 JSON 插件（cognition-engine 类）的具体形态

建议数据布局（全部 UTF-8 JSON/JSONL，无外部依赖）：

```text
data/
  persona/
    persona.json          # id, version, parentHash, layers {immutable, stable, plastic}, traits, style, boundaries
    changelog.jsonl       # 每次变更：version, parentHash, diff, reason, evidence, createdAt
    versions/0001.json    # 完整快照（可 diff / rollback）
  memory/
    profile.json          # basic_info, preferences, goals, relationships, communication_style
    events.jsonl          # eventId, ts, validFrom, validTo, source, confidence, summary, tags
    notes/                # A-MEM 风格：id, summary, keywords, tags, links[], createdAt, updatedAt
  audit/
    memory-ops.jsonl      # ADD/UPDATE/DELETE/NOOP, beforeHash, afterHash, reason, evidence
    persona-diffs.jsonl   # 每次 persona 变更的 diff
    reports/              # 每次审计报告（JSON）
```

关键设计：
- **人格三层**（借千雪）：`immutable`（底线/价值观）、`stable`（性格/语气）、`plastic`（偏好/关系状态）；每层有 `maxChangePerVersion`，防止 plastic 层被一次对话带跑。
- **记忆双轨**（借千雪 + Memobase）：`profile`（稳定事实）+ `events`（带时间的事件）；`notes` 做 A-MEM 式链接。
- **检索**：用 **recency + importance + keyword overlap**（Generative Agents 三因子）代替向量检索；零依赖、可解释；以后有 embedding 再插拔。
- **写入**：每条记忆写入前先查重（Mem0 的 ADD/UPDATE/DELETE/NOOP 逻辑，规则版即可）；写入必须带 `source`（哪句话/哪个事件）和 `confidence`。
- **审计**：`persona diff`、`persona rollback`、`memory why`、`memory forget` 四个命令；所有操作写 `audit/*.jsonl`。
- **迁移**：`persona export/import` 为 zip（借 OpenHanako 的角色卡打包思路），白名单包含 persona + profile + 可选记忆 + 审计摘要。

### 5.4 8–12 周 MVP 路线（建议）

| 阶段 | 目标 | 验收 |
|---|---|---|
| **第 1–2 周** | `persona.json` 三层 + `versions/` + `persona diff/rollback` | 任一人格变更可 diff、可回滚到上一版；回滚后审计题分数可对比 |
| **第 3–4 周** | `profile.json` + `events.jsonl` + `notes/` 链接 + 规则版 ADD/UPDATE/DELETE/NOOP | 100 条模拟对话导入后，检索命中率/噪声率有基线 |
| **第 5–6 周** | `audit/persona-probes.json` + `audit/reports/` + 命令行 | 同一套 50 题在 3 个版本上跑出分维度报告 |
| **第 7–8 周** | 中文 README/示例 + 一键安装验证 + 发版 | 按 [ctxt-00001] 六步：卸载验证→兼容性检查→代码优化→README 覆盖检查→一键安装验证→发布；按 [ctxt-00003] 保持零外部依赖、纯 JSON |

---

## 6. 附：一句话记住每个项目

- **Replika**：记忆 tab + traits 付费，黑箱但产品化最好。
- **Character.AI**：角色定义/Lorebook + 用户 Persona，记忆靠官方博客，没有技术论文。
- **SillyTavern**：角色卡 V2/V3 是生态标准，但「卡片」不是「记忆」。
- **Talkie/星野**：人格三件套（脸/人设/声音）+「星念」剧情卡片，营销大于技术。
- **筑梦岛**：人格小传/小剧场 +「云端梦境」，内容产品。
- **Pi**：只记长期稳定事实、可编辑可清除，克制是最大优点。
- **Letta/MemGPT**：memory block + core/recall/archival + sleep-time，记忆层的「操作系统」。
- **Generative Agents**：memory stream + reflection + planning，所有记忆插件的祖师爷。
- **A-MEM**：Zettelkasten 笔记 + 动态链接 + 记忆演化。
- **Mem0**：ADD/UPDATE/DELETE/NOOP，工程化记忆层。
- **Zep/Graphiti**：双时间轴知识图谱，事实有效期。
- **Memobase**：Profile + Event Timeline，用户画像记忆。
- **OpenHanako**：Agent=文件夹，人格/记忆打包，但重栈。
- **MaiBot**：人格 JSON + A-Memorix，记忆管理最细，但 GPL+重依赖。
- **千雪**：三层人格 + 体验/信息双轨 + 梦境，设计最像「人」。
- **Personal OS**：小项目，Markdown 记忆思路值得看。
- **CharacterEval/InCharacter/CharacterBench**：人格评测老三样。
- **PersonaAgent**：persona 作为记忆与行动的中介。
- **Anchor**：把「人格连续性」拆成 enactment + trajectory 两面照妖镜。

---

### 参考链接（按首次出现顺序）

- Replika 记忆：<https://help.replika.com/hc/en-us/articles/37208679176077-How-does-Replika-s-memory-work>
- Replika 记忆内容：<https://help.replika.com/hc/en-us/articles/360000874712-What-does-my-Replika-remember-about-me>
- Replika traits：<https://help.replika.com/hc/en-us/articles/360062096391-How-do-Traits-Interests-work>
- Replika backstory：<https://help.replika.com/hc/en-us/articles/37208430613261-How-your-Replika-s-backstory-shapes-its-personality>
- Skjuve et al. 2021：<https://www.sciencedirect.com/science/article/pii/S1071581921000197>
- Character.AI memory blog：<https://blog.character.ai/memory/>
- Character.AI memory 2：<https://blog.character.ai/helping-characters-remember-what-matters-most>
- Character.AI User Personas：<https://book.character.ai/character-guide/user-personas>
- Character.AI Character Definition：<https://support.character.ai/hc/en-us/articles/50609183646875-5-Character-Definition>
- Character.AI Inside Kaiju：<https://blog.character.ai/inside-kaiju-building-conversational-models-at-scale/>
- Character.AI Squinch：<https://blog.character.ai/squinch/>
- SillyTavern 文档：<https://docs.sillytavern.app>
- SillyTavern 角色设计：<https://docs.sillytavern.app/usage/core-concepts/characterdesign/>
- Character Card V2：<https://github.com/malfoyslastname/character-card-spec-v2>
- Character Card V3：<https://github.com/kwaroran/character-card-spec-v3>
- V2/V3 对照（二手）：<https://tavernsprite.com/blog/sillytavern-character-card-v2-vs-v3>
- 星野官网：<https://xingye-ai.com.cn/>
- 筑梦岛官网：<https://zhumengdao.com/>
- Talkie：<https://www.talkie-ai.com/>
- MiniMax/Talkie=星野海外版：<https://www.stcn.com/article/detail/3550404.html>
- Pi memory：<https://help.pi.ai/en/articles/15425697-pi-s-memory>
- Inflection press：<https://inflection.ai/press>
- MemGPT：<https://arxiv.org/abs/2310.08560>
- Letta memory：<https://www.letta.com/blog/agent-memory>
- Letta memory blocks：<https://docs.letta.com/v1-sdk/memory/memory-blocks>
- Letta AgentFile：<https://docs.letta.com/v1-sdk/concepts/agent-file>
- Sleep-time compute：<https://arxiv.org/abs/2504.13171>
- Generative Agents：<https://arxiv.org/abs/2304.03442>
- A-MEM：<https://arxiv.org/abs/2502.12110>
- Mem0：<https://arxiv.org/abs/2504.19413>
- Mem0 docs：<https://docs.mem0.ai/core-concepts/memory-operations/add>
- Zep：<https://arxiv.org/abs/2501.13956>
- Graphiti 时序：<https://www.getzep.com/blog/beyond-static-knowledge-graphs/>
- Graphiti：<https://github.com/getzep/graphiti>
- Memobase：<https://github.com/memodb-io/memobase>
- OpenHanako：<https://github.com/liliMozi/openhanako>
- MaiBot：<https://github.com/Mai-with-u/MaiBot>
- MaiBot 人格：<https://docs.maibot.chat/en/manual/personality>
- MaiBot 记忆：<https://docs.maibot.chat/en/manual/webui/memory-management>
- MaiBot A-Memorix：<https://docs.maibot.chat/en/manual/configuration/amemorix-config>
- 千雪：<https://github.com/Stevehim0/Qianxue>
- Personal OS ①：<https://github.com/waynevianzhang-bit/personal-os>
- Personal OS ②：<https://github.com/Iuanin666/personal-reasoning-os>
- Personas（.NET）：<https://www.nuget.org/packages/Personas/0.4.0> / <https://github.com/MoaidHathot/personas>
- Semantic Versioning for Agent Personas（博客）：<https://moltbook.com/post/5abde37a-adc0-4ece-ad40-69d419b1abd2>
- SemanticEd 文章：<https://semanticed.online/developer-tools/my-ai-agents-version-themselves-how-we-built-self-evolving-personas-using-semant-277a384d>
- CharacterEval：<https://arxiv.org/abs/2401.01275>
- InCharacter：<https://aclanthology.org/2024.acl-long.102/>
- CharacterBench：<https://arxiv.org/abs/2412.11912>
- PersonaAgent：<https://arxiv.org/abs/2506.06254> / <https://aclanthology.org/2026.findings-acl.1315/>
- ANCHOR / Best Friends：<https://arxiv.org/abs/2607.28818>
- PICon：<https://arxiv.org/abs/2603.25620> / <https://kaist-edlab.github.io/picon/>
- Nautilus Compass：<https://arxiv.org/abs/2605.09863> / <https://github.com/chunxiaoxx/nautilus-compass>
- Anthropic persona vectors：<https://www.anthropic.com/research/persona-vectors> / <https://arxiv.org/abs/2507.21509>
- Measuring and Controlling Persona Drift：<https://arxiv.org/abs/2402.10962>
- ContextEcho：<https://arxiv.org/abs/2605.24279>
- CORE / PERSIST：<https://arxiv.org/abs/2609.12373>
- Layered Mutability：<https://arxiv.org/abs/2604.14717>
- Emergi-PersonaOS：<https://arxiv.org/abs/2609.27417>
- Mem-PAL：<https://arxiv.org/abs/2511.13410>
- DuLeMon：<https://aclanthology.org/2022.findings-acl.207/>
- RECALLbot：<https://doi.org/10.1145/3772318.3790714> / <http://www.idi.zju.edu.cn/project/5115.html>
- ThinkPersona：<https://aclanthology.org/2026.acl-long.449/> / <http://www.idi.zju.edu.cn/project/5127.html>
