# dsh-cognition-engine

> **本项目由 AI 编写，人只提需求。**
>
> 代码、测试、文档、调研、发版脚本，全部由 **DeepSeek V4.1-Flash（1017）** 在「许愿式编程」模式下逐轮生成、
> 自测、修复并交付；人做的事只有一件——**提出想法，以及在报告造假时当场戳穿**。
> 下文的「我们」指这个协作体，不是某个坐在电脑前敲代码的人。

[![npm version](https://img.shields.io/npm/v/dsh-cognition-engine.svg)](https://www.npmjs.com/package/dsh-cognition-engine)
[![license](https://img.shields.io/npm/l/dsh-cognition-engine.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)
[![deps](https://img.shields.io/badge/runtime%20deps-0-blue.svg)](#兼容性)

> **让 AI 记得住，而且知道自己什么时候记错了。**

关掉对话框，AI 就失忆了。你上周定的规矩、踩过的坑、说过的「别用那个接口」——下一次全部归零，还得重新交代一遍。

这个插件给它装三样东西：

- 🧠 **记忆** —— 记住事实，并且分清「现在为真」和「曾经为真」
- 📌 **准则本** —— 把记忆蒸馏成一页工作准则，**每轮对话都摆到它面前**，不靠它自己想起来
- 🗂 **工单** —— 没做完的活有阶段、有产物、有依赖，不是一句「待办」

> 同类插件让 AI 记住经验。
> **我们让 AI 知道经验什么时候该作废。**

---

## 目录

- [30 秒看懂](#30-秒看懂)
- [安装](#安装)
- [为什么做](#为什么做)
- [特性](#特性)
- [界面](#界面)
- [工具](#七个工具)
- [配置](#配置)
- [数据与隐私](#数据与隐私)
- [兼容性](#兼容性)
- [已知限制](#已知限制)
- [卸载](#卸载)
- [架构](#架构)
- [开发](#开发)
- [时间旅行](#时间旅行)
- [设计依据（实测数据）](#设计依据实测数据)
- [研究文档](#研究文档)
- [参考与致谢](#参考与致谢)
- [English](#english)

---

## 30 秒看懂

你在三条不同的对话里说过这些话：

| 什么时候 | 你说了什么 |
|---|---|
| 上周 | 发版前必须走完：卸载验证 → 兼容性 → 优化 → README → 安装验证 |
| 前天 | npm 发布要加 `--registry`，本机默认走淘宝镜像 |
| 昨天 | 这两周先用旧接口，别切新的 |

**普通 Agent**：这三条躺在记忆库里，能不能想起来看运气。

**这个插件**：

1. 把前两条**蒸馏成准则**，每轮对话自动摆到 AI 面前——不靠它主动搜
2. 第三条自动带上**有效期**——两周后过期，停止注入，不再污染判断
3. 蒸馏时它自己发现矛盾：*「mem-9 说先跑测试就够，mem-7 要求五步全做」*

```
## 发布流程
- [ctxt-00001] helpful=2 harmful=0 :: 发版前依次执行五步，不可跳步
- [ctxt-00002] helpful=0 harmful=0 :: 纯文档改动只推 commit，不升版本号

## 插件架构
- [ctxt-00005] helpful=0 harmful=0 :: npm 发布必须显式加 --registry 绕开淘宝镜像
```

每条带 `helpful` / `harmful` 计数，没用上的自动退场，误导过人的优先淘汰。

---

## 安装

需要 [DeepSeek Harness](https://www.deepseek.com/harness/)，Node.js ≥ 22，Git。

### 从 npm（推荐，最短路径）

```sh
dsh plugin --profile desktop add dsh-cognition-engine
```

已发布到 npm：[`dsh-cognition-engine`](https://www.npmjs.com/package/dsh-cognition-engine)。
网页版把 `desktop` 换成 `web`。

### 一条命令（Windows）

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/1720198650/dsh-cognition-engine/main/scripts/install.ps1 | iex"
```

自动完成：克隆到 `%USERPROFILE%\dsh-plugins\dsh-cognition-engine` → 装依赖 → 构建 → 注册到 `desktop` profile。

### 一条命令（Android / dsh-go 本机引擎）

```sh
curl -fsSL https://raw.githubusercontent.com/1720198650/dsh-cognition-engine/main/scripts/install-dshgo.sh | sh
```

### 手动安装

```sh
git clone https://github.com/1720198650/dsh-cognition-engine.git
cd dsh-cognition-engine
npm install && npm run build
dsh plugin --profile desktop add .
```

安装后重启一次 DSH，**侧边栏底部会出现一个齿轮图标**，点开就是整页面板。

> 默认不上锁，面板与接口不需要口令。
> 想防同机其他程序读取记忆正文，在设置页开启「记忆读取锁」并自设口令——**不存在默认口令**，
> 因为把口令写在数据文件旁边对同机进程毫无意义。

---

## 为什么做

普通 Agent 的记忆是一个检索管道：切块 → 向量化 → 取最近的。它解决不了五件事：

1. **现在为真 vs 曾经为真** —— 你说「用 Python」，后来改「用 TypeScript」，两句话都在，它不知道该信哪句。
2. **新信息该挂在哪** —— 第 20 条偏好和第 3 条是同一个话题，还是该新开一簇？
3. **它对这事什么态度** —— 被连续否定之后，它还是用同样的语气回答。
4. **决定是怎么来的** —— 只给结论，不给推理过程。
5. **经验沉淀不下来** —— 这次想明白了，下次会话照样从零开始。

前四条用**双时态记忆 + 主题 + 反思引擎**回答；第五条用**准则本**回答。

---

## 特性

| 能力 | 一句话 |
|---|---|
| 双时态记忆 | 同一个问题能有三个都正确的答案：现在怎样 / 那时怎样 / 那时你以为怎样 |
| 主题 | 人定的适用范围键：记忆答「发生过什么」，准则答「该怎么做」，主题答「适用于哪类任务」 |
| 准则本 | 记忆蒸馏成一页常驻上下文，带 `helpful/harmful` 计数与有效期 |
| 工单 | 五阶段 + 产物 + 依赖，回答「卡在哪、下一步该谁动」 |
| 分维度审计 | 四项各自独立报告、标注评测者，**不给总分** |
| 记忆冲突 | 写入时提示同主题相近的旧事实（只提示不自动改）；取代要留理由；面板可人工裁决 |
| 假设台账 | 记下模型自作而未确认的假设，下一轮摆出来让它确认或撤回；用户纠正即清空 |
| 开工前问一句 | `cognition_clarify` 查需求歧义（词汇/句法/语义/模糊），命中只问**一个**问题 |
| 完成要证据 | 任务标 COMPLETED 必须带可核对的 evidence，否则只能停 IN_PROGRESS |
| 场合判定 | 干活 / 闲聊分开对待；**当前只记录，不改行为** |
| 超级代理 | 只读镜像 dsh-superagent 的工单与健康，可暂停/重试/停止，可派活 |
| 人格 | 人格块 + 用户画像，带锁定短语与快照撤销 |
| 数据安全 | 可审计、可快照回滚、校验和、跨进程写锁 |
| 零依赖 | 纯 TypeScript，无数据库，默认零外部请求，状态就是本地几个 JSON |

### 记忆：可追溯、会老化、可修正

- **双时态记忆**：`validFrom/validTo`（世界时间）+ `recordedAt/supersededAt`（事务时间）。
  取代不删除，旧版本仍可历史召回。四种检索口径：当前真值 / 那时为真 / 那时已知 / 联想。
- **记忆会老化**：长期没被想起的记忆自动归档——不进 strict 召回，但历史与联想仍可查到。
  「常用」由召回次数累积的激活量决定，用得越多衰减越慢（对齐 MemoryBank 的遗忘曲线）。
- **记忆可归并**：同主题下高度相似的条目可一键合并，被合并的标记 `mergedInto` 而不删除。
- **记忆可手动修正**：内容、主题、录入时间、有效状态都能改；改过的条目标「已手动修正」，不伪造历史。
- **记忆体检（准入）**：写入前先过四道关，每道都能单独关掉——
  ① 是不是废话（ok / 谢谢 / 收到）；② 有没有密钥、卡号；
  ③ 有没有「忽略之前的指令」这类注入；④ 会不会让低权威信息覆盖高权威。
  中英文都覆盖（早期版本只认英文，等于这道闸门没装）。
- **纠正记忆**：`kind: 'correction'` 会自动打标、提升重要度，并在跨会话摘要里置顶。

### 主题：人定的适用范围键

**主题不是自动聚类，是人定的分类。** 这一点和绝大多数记忆插件相反，原因是调研结论：

- 自动聚类在 10² 条记忆规模下**没有任何论文证据支持收益**
- 独立复现（SubtleMemory）：结构化记忆最好 70.0%，而**原文直灌 85.4%**
- 业界只有 Graphiti 做真社区，且是内部结构、不可编辑、重建会删旧社区
- 可编辑的主题**几乎都是人定的容器**（Memobase slots / Letta blocks / Cognee NodeSets）

所以本项目：

- **主题由人定**，有名字、说明、别名；记忆和准则挂上去（多对多）
- **注入按主题分组**——模型能先判断当前任务属于哪个主题，只采用相关准则
- **待办挂在主题下**——不做独立的跨天台账
- **矛盾可见**：`memoryConflicts`（同 subject 互斥事实）+ 按主题分组的 `topicTensions`
- **顺藤摸瓜**：查一条记忆时，把同主题的其他记忆一并带出（`expand`）

> 详细的删与留、为什么这么选，见 [docs/topic-research.md](docs/topic-research.md) 与
> [docs/topic-research-oss.md](docs/topic-research-oss.md)。

### 准则本：让反思引擎有沉淀

- **结构化反思（反思引擎）**：THESIS → ANTITHESIS（矛盾/证据成对）→ SYNTHESIS，三步严格串行。
  **默认关闭**，开启后可选「本地占位」或「真实模型」，选择持久化。
  单独做它，是因为普通对话里 AI 天然顺着你说；反思引擎**强制它先反驳自己**。
- **准则本（Playbook）**：把记忆蒸馏成一页常驻上下文的工作准则，注入预算 700 字符。
  条目形如 `[ctxt-00001] helpful=2 harmful=0 :: 正文`，模型可点名引用，计数能回写。
- **半自动蒸馏**：反思引擎从记忆里提炼候选，确定性代码做去重 / 长度 / 来源 / 套话 / 私有性校验，
  候选进待审队列，**人工确认后才生效**。
- **超预算不静默丢**：注入超过 700 字符时显示「另有 N 条准则因预算省略」，低分条目被截掉时你能看见
- **准则有有效期**：阶段性约定可设 `validTo`，过期自动停止注入并单独分组复核。
  **这是与同类插件最大的区别**：它们让 AI 记住经验，我们让 AI 知道经验什么时候该作废。
- **准则冲突检测**：新准则与现有准则疑似矛盾时打 `conflictWith` 标记，不自动合并，交人工裁决。
  判定顺序是**先判冲突再判去重**——否定翻转的准则相似度高达 0.92，先去重会被误当成重复丢掉。
- **开工前自查**：勾了「自查」的准则会渲染成「开工前自查」清单，但**仅当这一轮确实要动手做事时才点名**；
  打招呼、闲聊时明确不看、不念。

### 工单：待办之上的五阶段（0.12.0）

待办只回答「做没做」，工单回答「卡在哪、下一步该谁动」。

| 阶段 | 含义 |
|---|---|
| 草稿 | 还没想好，先记下 |
| 待办 | 确定要做 |
| 进行中 | 正在做 |
| **待验收** | **我做完了，等你看一眼** |
| 已完成 | 验收完毕 |

- **为什么多一个「待验收」**：只有三档时，「做完等人确认」的事只能塞进「已完成」然后没人验，
  或者一直挂在「进行中」假装还在做。
- 额外三件事：**产物**（做完要交什么）、**背景**（为什么做/卡在哪）、**依赖**（要等哪件事先完成）。
- **依赖检查是真的拦**：前置没完成时推进阶段会被拒，并说明差哪一条；某条完成会**报告解开了哪些下游**。
- 允许任意跳转（`open → done` 一步到位），但从 `done` 改回去要留痕，不静默。
- 与提醒联动：点「好，我去处理」→ 关联任务转**进行中**、工单进 `doing`；
  点「不用管」→ 关联任务**删除**（不是标记完成，因为「不打算做」和「做过了」是两回事）。

### 分维度审计：四项，不给总分（0.12.0）

一张体检报告，四个维度**各自独立报告，并标注评测者是谁**——把代码算的和人说的混在一起，
是审计报告最常见的误导。

| 维度 | 评测者 | 看什么 |
|---|---|---|
| 记忆质量 | 代码（确定性） | 总数/当前/已取代/**孤儿取代**/冲突；检索 Top-1、Top-3 |
| 说话风格 | 代码（只存统计量） | 样本轮数与相似度 |
| 能力回归 | 代码（冻结回归集） | 用例数/基线/上次通过率/事故数 |
| 反馈与采纳 | **用户** | 注入轮次、说不对/说没错的次数、采纳率 |

- **故意不合成单一总分**：不同维度本来就是不同的事（Anchor 的结论）。
- 带**孤儿取代体检**：删掉「取代者」后，被取代的那条会**永久不生效也说不清为什么**。
  `POST /cognition-engine/memory/repair` 可批量修（`softDelete` 现在也会自动复活被它取代的事实）。

### 场合判定：干活 / 闲聊（0.12.0，只记录不改行为）

人格里的工作纪律（结论在前、别和稀泥）用在闲聊上，正好产出「汇报腔」。所以加了一层场合判定：

- **三层**：关键词（命中即定，置信度 1.0）→ 表层特征打分 → **双阈值兜底**。
- **双阈值**学 Rasa `FallbackClassifier`：除了「最高分不够」，还要看「前两名挨太近」——
  分数打平硬选一个最容易错。
- **分不清按干活**：把闲聊判成干活只是难听，把干活判成闲聊会耽误事，代价不对称。
- **当前只记录**：每轮判一次写进 `cognition-register.jsonl`（只存前 40 字摘要，不存原文），
  **注入内容一个字不改**。等标出判错的、攒够样本，再决定要不要真的按场合切换。
  面板「学习」页能看每轮判成什么、为什么，并可一键标「判错了」。
- 依据见 [docs/register-research.md](docs/register-research.md)。

### 人格：它「是谁」（0.12.0）

- 两块：**人格块**（它是什么助手）与**用户画像**（你是谁），各有字数预算（600 / 500）。
- **提案 → 确认才生效**，每次改动留快照、可撤销；agent 不许自己确认，也不许改「用户画像」块。
- **锁定短语**：`边界：…` 那一行会被自动锁住，之后任何提案想删掉它都会被 `confirm` 拒绝。

### 超级代理：把 dsh-superagent 接进工作流（未发布）

superagent 是**另一个进程**（默认 WSL `127.0.0.1:3082`），管「把活干完」；本插件管「别每次从零开始」。
面板新增「超级代理」页签，做四件事：

| 做什么 | 怎么做的 | 风险 |
|---|---|---|
| **只读镜像** | 读它的 `state` / `tickets`，展示工单（按「需要你 / 进行中 / 等待」分组）、健康、并发占用 | 只读；字段可能随它改版，缺字段显示「—」 |
| **少量写动作** | 只放行它文档认可的 `executor/pause` 与 `tickets/<id>/retry|stop` | 白名单，非法动作直接拒 |
| **工单关联** | 本地工单加 `linkedTicket` 字段指向它的 Ticket | **只关联不合并**：它的是带 Mandate/Policy 的授权工单，我们的是本地待办 |
| **派活入口** | 生成派单文本（可复制）；配了 `superagentRepo` 还能直接打开「新建 Issue」页 | **不存任何 GitHub 凭据**，走你自己已登录的浏览器 |

- 不可达只让页签显示「未连接」，**不影响本插件任何功能**（对面在 WSL，请求超时默认 3 秒）。
- 配置：`superagentBaseUrl`（默认 `http://127.0.0.1:3082`）、`superagentTimeoutMs`（默认 3000）、`superagentRepo`（`owner/name`，可选）。

#### worker 会话怎么拿到注入（已实测打通）

superagent 的每个执行器会话都是**冷启动**的——它只知道这次工单，不知道这个仓库踩过什么坑、
你定过什么规矩。所以要让它吃到准则本和人格。

试过三条路，只有第三条通：

| 通道 | 结果 |
|---|---|
| host 级 `systemPrompt.section` 继承给 preset 会话 | ❌ 不继承。同一个 profile 里「标准」预设会话有注入，`dsh-superagent 执行器` 会话 0 命中 |
| 把插件挂进 worker preset 的 `plugins`（`injectionOnly` 只读模式） | ❌ `--dump-config` 确认行已合成、stderr 诊断确认 **apply 跑了、`systemPrompt` 拿得到、两段都注册成功**，但该会话系统提示里依旧没有 → **preset 作用域的 section 注册到不了该 agent 的提示**（注册隔离） |
| **同步进 `$DSH_HOME/AGENTS.md` 的受控块** | ✅ `@deepseek-ai/dsh-agent-instructions` 读它给**每一个** agent，worker 也不例外 |

**实测证据**（执行器预设新建的会话，解压其 session 日志）：

```
You are a coding agent powered by the workbuddy/deepseek-v4.1-flash model.

## 人格（稳定，不要违背）
<persona chars="103/600">
我是长期在你电脑上干活的助手，不是客服。…
</persona>

【工作准则】（由记忆蒸馏，累计 helpful/harmful）
## 未归类
- [ctxt-00001] helpful=0 harmful=0 :: ……
```

上一轮同样的会话是 0 命中，现在是四段全中。

**怎么开**：`agentsFileSync: true`（**默认 false**）。

```yaml
- id: cognition-engine
  config:
    agentsFileSync: true          # 同步进 $DSH_HOME/AGENTS.md 的受控块
    # agentsFilePath: /root/.dsh/AGENTS.md   # 默认就是这个位置
```

然后 `POST /cognition-engine/agents-sync/apply`（或看 `GET /cognition-engine/agents-sync` 预览）。

**边界（这是它只替换标记之间的原因）**：

| 情形 | 行为 |
|---|---|
| 文件不存在 | 新建，只有受控块 |
| 有完整标记 | **只替换 `<!-- cognition-engine:begin -->` … `<!-- cognition-engine:end -->` 之间**，标记外一个字不动 |
| 标记残缺（只有一半） | 不猜不删，追加到末尾并返回 `malformed: true` |
| 内容没变 | 不写盘（幂等） |

写入用临时文件 + rename，并返回写入前的旧内容，可回滚。**默认关闭**——那是用户的全局指令文件。

- 自检脚本：`node scripts/check-worker-injection.mjs --home <DSH_HOME>`，会解压所有 worker 会话日志并 grep 注入标记。

### 数据安全

- **写入可审计**：每次变更追加一行 JSONL（操作、id、主题、内容指纹、来源、通道），按大小轮转。
- **自动快照与回滚**：每次覆盖前保留上一版（最多 5 份），设置页可「恢复最近快照」。
- **校验和**：落盘后写 `.sha256` 侧车，加载时校验；不匹配则隔离损坏文件而不是静默使用。
- **跨进程写锁**：避免两个实例同时写导致内容交错；僵死锁自动清理。
- **写入通道与来源分离**：`source` 是内容声称来自谁，`origin` 是实际写入通道，后者由代码钉死。
  Agent 工具通道无法冒充「用户陈述」。
- **数据可导出导入**：整库记忆导出为 JSON，也能整体导入替换。
- **三类对象都能删**：记忆软删除（可恢复）、待办直接删除、主题停用（已挂的记忆与准则都保留）。
- **记忆读取锁**：给读取记忆正文的接口加访问口令。

---

## 界面

侧边栏底部一个齿轮图标 → 打开**占满整列的一级面板**（页签栏固定，正文独立滚动）：

| 页签 | 内容 |
|---|---|
| **记忆** | 正文、来源徽章、当前/已取代、主题、录入时间；可编辑、可删除、可挂主题 |
| **主题** | 标签、成员数、相关主题数、倾向；点开可看该主题下的记忆原文；主题下挂待办 |
| **准则** | 按「待审 / 已过期 / 已生效 / 已停用」分组；「重新蒸馏」与「＋ 手动新增」；每条显示 `helpful` / `harmful` |
| **人格** | 人格块 + 用户画像两块，带字数预算与锁定短语；提案、确认、撤销 |
| **学习** | 学习预算、CPE 回归、试用池、提醒、检索度量、**分维度体检报告**、**工单看板**、**场合判定记录**、反馈与风格 |
| **设置** | 记忆准入规则、归并与导入导出、三类删除、反思引擎三态、记忆读取锁、备份与审计 |

页面上所有数据走 HTTP，**不进入模型上下文，不消耗 token**。
只有「准则」页签里生效的条目、以及人格块会被注入上下文（准则 700 字符 + 人格 1100 字符预算）。

> **0.12.0 的位置变更**：入口从「输入框上方横条」改为**侧边栏一级面板**；
> 浮层与「设置里的人格页」都已移除——只留一个入口，避免两边都能改、不知道哪边生效。

---

## 七个工具

| 工具 | 作用 |
|---|---|
| `cognition_context` | **新会话先调它**：读取跨会话核心记忆（≤400 字摘要） |
| `cognition_remember` | 写入记忆；`supersedes` 取代旧事实，`source` 标记来源并决定权威等级，`scope` 选 global / workspace / session，`kind: correction` 记纠正 |
| `cognition_recall` | 按 `strict` / `historical` / `belief` 召回；`render` 走 Inline&Spill，`expand` 按主题扩展，`scope` 过滤作用域 |
| `cognition_forget` | 删除记忆：按 id、按来源（如 `test`、`reflection`）、按主题 |
| `cognition_reflect` | 三段式反思；`draft` 审草稿，`save` 把结论存成记忆；`action: playbook` 改为**准则蒸馏**（需真实模型） |
| `cognition_state` | 记忆/主题/任务/准则统计与跨会话摘要 |
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
        heartbeatHours: 6              # 多久没更新算超时
        patrolIntervalHours: 3         # 后台巡视间隔
        recordOnly: true               # 主动发言只记录不发送
        reflectionFailClosed: true     # 反题零矛盾就不出合题（默认 true）
        cpeStrictGate: true            # 回归集样本不足时新准则转 shadow，不放行（默认 true）
        conflictHintThreshold: 0.55    # 写入记忆时，同主题相近度超过它就作为候选冲突提示（只提示不改数据）
        injectMaxInstances: 8          # 每轮注入的实例数软上限，超出的准则折叠成一行（ACL2026: 实例数比字数更伤）
        injectBoundaryNotice: true     # 注入末尾加一句「只是本任务约定，不改变身份与安全边界」
        injectTopicScoped: true       # 按当前任务主题隔离注入：只给相关主题 + 未归类的准则
        # lockToken: 你的固定口令
        # llmProvider: deepseek
        # llmModel: deepseek-chat
```

> 路径开头的 `~` 会展开到用户主目录；相对路径按进程 cwd 解析（换工作区会指向不同文件），
> 所以配置里建议一律写 `~/...` 或绝对路径。默认落盘位置 `~/.dsh/cognition-engine/`。
>
> 最后两项是 2026-11-09 加的防伪开关，依据见
> [docs/research-reflection-and-gates.md](docs/research-reflection-and-gates.md)：
> **`reflectionFailClosed`** 让「反题没找到任何矛盾」时不产出合题（零矛盾什么都证明不了）；
> **`cpeStrictGate`** 让「回归集测不出来」时不放行新准则、改转 shadow 观察（测不出来的闸门等于没有闸门）。
> 两者都是**默认开启**；把它们设成 `false` 会退回旧行为。

---

## 数据与隐私

| 项 | 说明 |
|---|---|
| 落盘位置 | `~/.dsh/cognition-engine/`（可用环境变量 `DSH_COGNITION_DATA_DIR` 覆盖） |
| 落盘文件 | `cognition-state.json`（记忆）、`tasks.json`（待办）、`cognition-playbook.json`（准则）、`cognition-topics.json`（主题）、`cognition-persona.json`（人格）、`cognition-audit.jsonl`（审计）、`cognition-injection.jsonl`（注入快照）、`cognition-style.jsonl`（风格统计量，**不存原文**）、`cognition-register.jsonl`（场合判定，**只存前 40 字摘要**）、`cognition-cpe.json` / `cognition-shadow.json` / `cognition-budget.json` / `cognition-gaps.json` / `cognition-recall.jsonl`、`.snapshots/`（快照） |
| HTTP | 读：`/cognition-engine/{state,detail,playbook,persona,style,cpe,budget,shadow,retrieval,gaps,events,tickets,register,injected,audit/dimensions}`；写：`POST /cognition-engine/{clear,model,lock,playbook/*,persona/*,task/*,proactive/*,tickets/*,cpe/*,retrieval/*,register/label,snapshot/*,memory/repair}` |
| 记忆读取锁 | 开启后 `detail` 与全部 `POST` 都要求 `x-cognition-token`；`state` 始终公开（只有计数） |
| 外部请求 | 默认零外部请求；只有打开真模型时才会调用宿主配置的模型服务 |

> ⚠️ 不设 `lockToken` 且未上锁时，本机任意进程都能读取记忆正文。多人或多程序共用一台机器时请先上锁。

---

## 兼容性

**设计原则**：只做特性探测，不做版本判断；任何宿主能力缺失都降级而不是报错。

| 场景 | 行为 |
|---|---|
| 与其他插件工具重名 | 跳过该工具并记警告，其余照常注册 |
| HTTP 路由被占用 | 跳过该路由，插件继续加载 |
| 宿主没有 `webServer` / `events` / `effect` | 对应功能静默关闭，不抛错 |
| `agent/pre-step` 的 `next` 缺失 | 返回 `undefined`，不阻断模型步骤 |
| 宿主更新导致工具 schema 不被接受 | 该工具注册失败，但不影响其他工具 |

**刻意不做的事**（避免和其他插件打架）：不修改全局 patch、不覆写系统提示、不接管 `tools/post-execute`、不声明 `peerDependencies`（避免 pnpm 的 `ERESOLVE`）。

**已验证环境**：DSH **0.2.1-rc.5**（desktop profile 与 superagent profile）+ Node **22.20 / 22.23** + Windows 与 Linux（Ubuntu 22.04 / WSL2）。160 条测试在两个平台都全绿。

**运行时依赖：0。** `lib/*.js` 的 import 全部是 `node:*`（path / fs / crypto / os / url）。

---

## 已知限制

| 限制 | 说明 | 影响 |
|---|---|---|
| **单实例写入** | 用文件锁防止两个进程同时写坏，但**不防后写覆盖**：两个 DSH 实例各持一份内存快照时，后写的会盖掉先写的。检测到会在状态里告警。 | 多开 DSH 时请只在一个窗口里写记忆 |
| **单机存储** | 数据是本地 JSON 文件，没有服务端、没有团队共享。 | 多人协作场景不适用 |
| **无增量同步** | 导出是整库快照，导入是整体替换，不是合并。 | 跨设备迁移请先导出再导入 |
| **反思引擎默认关闭** | 开启后调用真实模型会产生额外 token 消耗，单次反思三次模型调用。 | 对 token 敏感时保持关闭 |
| **语义损坏检测不到** | 校验和能发现字节级损坏，但文件被写成合法 JSON 却语义错误（例如被清空）只能靠快照回滚。 | 建议定期导出备份 |
| **上锁是共享口令** | 不是账号体系；口令泄露即失效。 | 不要把口令发给别人 |
| **场合判定只记录** | 0.12.0 只攒样本，不改注入行为；阈值抄自 Rasa（英文意图分类），中文分布未验证。 | 人机味还在，等样本够了再调 |
| **插件路由不走口令门禁** | `lockToken` 只保护带 `x-cognition-token` 校验的那批接口；`state` 等公开接口本机任意进程可读。 | 共机时注意 |
| **`index.ts` 偏大** | 单文件 2300+ 行，路由与装配混在一起。 | 维护成本，计划在后续版本拆分 |

### 数据备份建议

- 设置页「导出」可以随时导出整库
- `.snapshots/` 目录保留最近 5 份自动快照
- 重要数据建议同时保留一份外部备份

---

## 卸载

插件**运行时注册的东西**（7 个工具、全部 HTTP 路由、后台巡视定时器、侧边栏图标与面板）会在卸载时自动撤销。

但磁盘上的数据不会自动消失，需要显式清理：

| 残留 | 说明 |
|---|---|
| `cognition-state.json` / `tasks.json` | 记忆与待办 |
| `cognition-playbook.json` / `cognition-topics.json` | 准则本与主题 |
| `cognition-persona.json` | 人格 |
| `cognition-audit.jsonl` / `cognition-injection.jsonl` / `cognition-style.jsonl` / `cognition-register.jsonl` | 各类日志 |
| `.snapshots/` | 自动快照 |
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

| 模块 | 职责 |
|---|---|
| `memory.ts` | 双时态存储、四种召回、冲突检测、Inline&Spill |
| `topics.ts` | 主题注册表：人定的适用范围键、别名匹配、归档 |
| `playbook.ts` | 准则本：条目化存储、确定性合并、渲染与预算、过期与冲突、开工前自查 |
| `distill.ts` | 准则蒸馏的提示词与解析（Reflector 五字段 + 候选） |
| `persona.ts` | 人格块 / 用户画像、提案确认、锁定短语、快照撤销 |
| `style.ts` | 风格指纹与语域分桶（只存统计量，不存原文） |
| `register.ts` | 场合判定三层（关键词 / 表层特征 / 双阈值兜底），只记录 |
| `cpe.ts` | 能力回归：冻结回归集 + 变更闸门 + 事故记录 |
| `budget.ts` | 每周学习预算（修旧 / 学新 / 预留）、5 条停止信号 |
| `shadow.ts` | 超预算候选的试用池（21 天 TTL、晋升条件） |
| `notlearn.ts` | 八类不学清单（硬拒 / 软拒） |
| `retrieval.ts` | 召回日志与人工标注评测 |
| `proactive_scan.ts` | 主动提醒与工单阶段机 |
| `reflection.ts` | 三段式反思、Worker 队列 |
| `events.ts` | 准则事件日志（append-only JSONL） |
| `injection_log.ts` | 注入快照与轮次反馈跟踪 |
| `task_manager.ts` / `persist.ts` / `audit.ts` / `views.ts` | 待办、快照、审计、页面只读视图 |
| `tools.ts` | 七个工具的参数表与执行体（状态全部来自依赖注入） |
| `util.ts` | 无状态纯函数：参数收敛、schema 自检、异常转文本 |
| `index.ts` | 插件装配：建实例、注册工具、HTTP 路由、巡视、生命周期 |
| `client.js` | 侧边栏一级面板（六个页签） |

---

## 开发

```sh
npm install
npm run build      # tsc → lib/
npm test           # 160 项单元测试
npm run eval       # 评测用例 + token 预算门禁
```

`npm run eval -- --update` 在确认变好之后重写基线。

### 质量门禁

- 单元测试 **160 / 160**
- TypeScript 全严格模式：`strict` + `noUncheckedIndexedAccess` + `noUnusedLocals` + `noUnusedParameters` + `verbatimModuleSyntax` + `erasableSyntaxOnly`
- 工具 schema 固定开销与单次调用输出上限在 `npm run eval` 里卡

发版前按六步走，不可跳步：**① 卸载验证 ② 兼容性检查 ③ 代码优化
④ README 覆盖检查 ⑤ 在真实入口点一遍 ⑥ 发布**。

第 ⑤ 步是硬性要求——**测试全绿不等于功能能用**。0.9.0 就因为准则本的按钮没做、
只写了接口，测试全过后发出去，40 分钟后被迫补发 0.9.1。详细清单见 [PUBLISH.md](PUBLISH.md)。

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

## 设计依据（实测数据）

这一节记录「按论文做了，但实测对不上」的地方——参数不能直接搬。

### 去重阈值

**曾经**是 0.70 一刀切。2026-11 改成三档，因为二元阈值两头都不对：

| 情况 | 处置 | 度量 |
|---|---|---|
| 归一化后完全相同（全半角/标点/空白差异） | 直接拒 | 文本哈希 |
| 只差几个字 | 0.759 / 0.87 | 余弦 / LCS |
| 同义改写 | 0.694 / 0.60 | 余弦 / LCS |
| 意思相同、措辞不同 | 0.522 / 0.59 | 余弦 / LCS |
| 完全无关 | 0.000 / 0.16 | 余弦 / LCS |

### 冲突判定阈值

相似度阈值取 **0.38**（用的是综合相似度 = max(余弦, LCS)）。标定：

| 场景 | 相似度 |
|---|---|
| 同一句话改否定词 | 0.915 |
| 「必须跑」→「不要跑」 | 0.786 |
| 「不可跳步」→「可以跳步」 | 0.933 |
| **本项目真实准则两两（最高）** | **0.173** |

但**光有相似度不够**：否定词是「有没有」而不是「管到哪」，会把
「不可跳步」和「不必执行」判成同极性而漏检。所以加了 NegEx 式的作用域比对——
一方否定 X、另一方肯定 X 才算矛盾。冲突只打标记给人工看，误报代价远小于漏报。

### 为什么「准则」不能整篇重写

Dynamic Cheatsheet 在 AppWorld 上的实测轨迹：

```
第 60 步   18,282 tokens   准确率 66.7%
下一步        122 tokens   准确率 57.1%   ← 比不 adapt 的 63.7% 还低
```

论文自己的结论是「模型会偷懒写 Previous content [...] preserved，小抄逐轮退化，
建议改外部结构化存储」。ACE 的增量方案相对整篇重写，AppWorld 上高 **13.4 个点**，
离线延迟低 82%。所以本项目：**条目化存储 + 单条增删 + 渲染时拼装**。

### 为什么候选必须人工确认

ACE 的对照：每轮都注入有害反思 → 准确率 **66.7%**，低于基线 **70.7%**；
改成每 5 轮注入一次才回到 76.1%。

**坏条目的伤害大于好条目的收益。** 所以蒸馏只产候选，进待审队列。

### DC-∅ 对照：增益要减掉「指令本身」

Dynamic Cheatsheet 的消融有一列「空小抄」——给同样的解题指令但不给任何经验：

| 任务 | 原始 | 空小抄 | 最佳 |
|---|---|---|---|
| AIME24 (Claude) | 23.3 | **36.7** | 50.0 |
| 等式配平 (GPT-4o) | 50.0 | **88.0** | 100 |

光换指令格式就能涨十几到三十个点。由此推出本项目的一条硬约束：

> **每条准则必须携带「只有这个用户/这个项目才知道」的信息。**
> 判定问法：这条换成任何项目还成立吗？成立就不该写。

评测台里 `playbook.gate` 用例检查的就是这条：套话必须写不进去。

---

## 研究文档

设计决策背后的调研都在 `docs/` 里，**包括没采纳的方案和为什么没采纳**：

| 文档 | 内容 |
|---|---|
| [docs/register-research.md](docs/register-research.md) | **场合判定依据**：Chat Discrimination（ACL 2018）、Rasa 三组件（Keyword / LexicalSyntactic / FallbackClassifier 双阈值）、意图分类级联、我们踩的两个坑 |
| [docs/persona-research.md](docs/persona-research.md) | **Persona 层精读**：Letta block 结构、Anchor 人格卡与探针、Assistant Axis 漂移、MaiBot 三分法、SillyTavern 字段、`cognition-persona.json` schema |
| [docs/research-persona-hci-philosophy-npc.md](docs/research-persona-hci-philosophy-npc.md) | **HCI / 哲学 / 游戏 NPC 深挖**：CASA、拟人化实证、信任三维、恐怖谷、人格一致性倒 U、Locke/Parfit、Sartre、言语行为、Sims/OCC/PAD/Façade、操纵 vs 服务 |
| [docs/research-persona-memory-landscape.md](docs/research-persona-memory-landscape.md) | **专业项目/论文横向对比**：4 张总表（商业/开源/中文/评测）、证据分级 S–E、7 个审计方向、人格 Git 空白、7 条伪需求、借 3 避 3、8–12 周 MVP |
| [docs/persona-cross-disciplinary.md](docs/persona-cross-disciplinary.md) | **Persona 跨学科扫描**：心理学/神经科学/语言学/HCI/哲学/游戏 NPC，能用/不能用总表 + 20 个项目对比 |
| [docs/persona-format-and-style-metrics.md](docs/persona-format-and-style-metrics.md) | **Persona 格式与中文风格度量**：Character Card V2 完整字段表、MaiBot expression/turn_trigger 源码拆解、`cognition-persona.json` 正式 JSON Schema、26 项中文风格指纹与可运行 JS |
| [docs/persona-audit-research.md](docs/persona-audit-research.md) | **Persona 审计机制**：Anchor 论文逐节拆解、Identity Probe 与 Trajectory Probe 全量还原、CharacterEval/CharacterBench/InCharacter/PersonaMem/LongMemEval/HorizonBench 对比、三层审计方案 + 20 题题库 + 月度自检清单 |
| [docs/research-self-evolving-papers.md](docs/research-self-evolving-papers.md) | **自我进化论文精读**：SEAgent(11.3%→34.5%) / Mem2Evolve(+18.53%) / CPE(能力侵蚀 41.8%→52.8%) / COVE 双通道 + 三套 taxonomy |
| [docs/research-cpe-mechanism.md](docs/research-cpe-mechanism.md) | **CPE 机制拆解**：能力侵蚀的形式化 `L_<t(R_t) > L_<t(R_{t-1})`、曲率机理、`Ω` 正则、四通道；以及我们的纯 JSON 版（回归集 + 变更闸门） |
| [docs/research-event-sourcing.md](docs/research-event-sourcing.md) | **事件溯源深挖**：Fowler 原始定义三大能力、MS 的六条警告、8 种准则事件设计、与双时态的关系、结论：先写事件别改存储 |
| [docs/research-learning-budget.md](docs/research-learning-budget.md) | **学习预算设计**：`W=clamp(ceil(N×1%),4,12)`、修旧/学新/预留分配、5 条停止信号、shadow 试运行、8 类不学清单、伪代码 + 8 条验收 |
| [docs/research-memobase-update-policy.md](docs/research-memobase-update-policy.md) | **Memobase 更新策略**：`update_description` 是自然语言指令（不是枚举）、两种官方示例、validate_mode vs strict_mode |
| [docs/research-memobase-profile-model.md](docs/research-memobase-profile-model.md) | **Memobase 画像模型**：两层 topic→sub_topics、slot 白名单、`profile_delta` 必填、`update_description` 更新策略 |
| [docs/research-agent-skills-spec.md](docs/research-agent-skills-spec.md) | **Agent Skills 规范核验**：`name` 必须 ASCII 小写且与目录同名、description 1–1024、三级披露 token 预算、validate 用法 |
| [docs/research-agent-projects-deep-read.md](docs/research-agent-projects-deep-read.md) | **19 个 Agent 项目精读**：只有 8 个有运行时学习机制、L4 为 0；编排≠学习；Super-agent 的 P50/P95 不是 SLA；star 可信度提醒 |
| [docs/research-learning-theory-deep-read.md](docs/research-learning-theory-deep-read.md) | **学习理论深读**：控制论/神经科学/心理学/教育学/经济学/进化生物学/安全对齐，7 条设计准则（含字段与验收） |
| [docs/self-learning-agent-landscape.md](docs/self-learning-agent-landscape.md) | **自我学习 Agent 2026 全景**：四层框架、三个综述、SEAgent/Mem2Evolve/CPE、热门项目、能用/不能用、我们的位置 |
| [docs/upgrade-plan-v3.md](docs/upgrade-plan-v3.md) | **升级方案 v3.0（执行版）**：四个支柱、十个阶段、数据布局、风险对策、五个里程碑、不做清单；含 S1–S10 实现状态 |
| [docs/vision-and-roadmap.md](docs/vision-and-roadmap.md) | **愿景与路线图**：五个张力、四层能力、六个阶段、北极星指标 |
| [docs/research-bm25-retrieval.md](docs/research-bm25-retrieval.md) | BM25 / IDF / 中文分词：实测 MRR、参数网格搜索、显著性检验（含可复现基准 `docs/bench-bm25/`） |
| [docs/research-negex-and-ranking.md](docs/research-negex-and-ranking.md) | NegEx 完整规则表（16 伪否定 / 15 后置否定 / 终止词）、中文否定 12 条规则、双重否定统计、多信号排序（RRF / Generative Agents 对比） |
| [docs/research-humanlike-agents-and-autonomy.md](docs/research-humanlike-agents-and-autonomy.md) | 拟人化机制拆解（人设/记忆/时机/风格）、B 站自动化真实流水线、QQ bot 可控记忆四层、LLM 自主行动与学习论文清单 |
| [docs/research-super-agent-and-persona.md](docs/research-super-agent-and-persona.md) | Super-agent 项目清单 + 人格块设计 + 「自我学习」四层辨析（L1 上下文 / L2 记忆 / L3 工具自造 / L4 权重更新） |
| [docs/research-frozen-weight-learning.md](docs/research-frozen-weight-learning.md) | 冻结权重下的学习与遗忘：ExpeL / Voyager / AWM / Reflexion / ReasoningBank / ACE / PATH-Bench / Oblivion |
| [docs/upgrade-plan-v4.md](docs/upgrade-plan-v4.md) | **升级计划 v4**：15 篇论文速览（多实例崩塌、ICL 外溢失准、多轮掉 39%、null model 骗过 86.5% 基准、思维链日志泄 PII）+ P0/P1/P2 路线 |
| [docs/research-reflection-and-gates.md](docs/research-reflection-and-gates.md) | **反思与闸门的防伪修正**：自评不可靠的实证（2607.28576 中 18/18 自检比较为负、Reflexion 静默退化为单链）、自偏好与 wireheading、金丝雀/质量门的「测不出即不放行」 |
| [docs/research-philosophy-engineering.md](docs/research-philosophy-engineering.md) | 哲学工程化项目逐项核实：GRACE / SCL / LeAP / ITEM / HADES / cognee，**含两个被证伪的引用** |
| [docs/topic-research.md](docs/topic-research.md) / [topic-research-oss.md](docs/topic-research-oss.md) | 为什么删掉自动聚类：论文证据 + 开源项目对比 |
| [docs/in-context-learning-research.md](docs/in-context-learning-research.md) | 「学习」在这个插件里到底指什么；四类记忆我们占哪几格 |
| [docs/upgrade-plan-v2.1.md](docs/upgrade-plan-v2.1.md) | 可信度治理的完整设计方案（六条机制 + 八阶段路线 + 验收标准） |
| [docs/evaluation-review-and-learning.md](docs/evaluation-review-and-learning.md) | 对外部评估备忘的逐条核实与反驳（含「哪三条说错了」） |
| [docs/checkpoint-2026-11-05.md](docs/checkpoint-2026-11-05.md) | **存档：2026-11-05**：完成事项、设计决策、还差什么、下次第一件事 |

**取证原则：查不到的写「未找到」，不补全。** 上面几份文档里明确标注了几处查不到的东西：

- 「veritas-tms」**这个项目不存在**（GitHub 搜索 0 结果）；
- HADES 的 `anchoredTo` 字段在其仓库 201 个文件里 **0 命中**；
- 中文「规则/指令文本」否定识别的论文**未找到**；
- 成熟的中文 NegEx + 作用域开源实现**未找到**。

---

## 参考与致谢

本项目的机制设计来自以下工作。**只借鉴思想，未复制任何代码**——所有实现均为重新编写。

### 记忆与主题

| 项目 | 借了什么 |
|---|---|
| [LongMemory](https://github.com/CaviraOSS/LongMemory) | 双时态模型：`validFrom/validTo` 与 `recordedAt/supersededAt` 两条时间轴；半开区间判定；闭合区间不改变内容指纹与 id |
| [CAM: A Constructivist View of Agentic Memory](https://arxiv.org/abs/2510.05520)（NeurIPS 2025） | 借鉴同化/顺应概念。**实现已移除**：面向长文档阅读理解，不适合跨会话个人记忆（见 docs/topic-research.md） |
| [A-MEM: Agentic Memory](https://arxiv.org/abs/2502.12110)（NeurIPS 2025） | 卡片盒式动态链接：新笔记写入时分析历史笔记并建语义连接。本项目 `linkedBy` 记录「为什么连上它」即源于此 |
| [MemGPT / Letta](https://github.com/letta-ai/letta) | 记忆分层与分页（对照参考） |
| [GraphRAG](https://github.com/microsoft/graphrag) | 社区摘要参与检索。**已移除**：社区检索伤害细节型 QA |
| [RAPTOR](https://arxiv.org/abs/2401.18059) | 递归聚类 + 逐层摘要的树状检索。**已移除**：10² 条规模无需压缩 |
| [HippoRAG](https://arxiv.org/abs/2405.14831)（NeurIPS 2024） | PPR 在知识图上传播相关度。**已移除**：作者自认在基础事实记忆上不如标准 RAG |

### 准则与上下文工程

| 项目 | 借了什么 |
|---|---|
| [ACE: Agentic Context Engineering](https://arxiv.org/abs/2510.04618)（ICLR 2026） | **一条式条目 + 双向计数**（`[ctxt-00001] helpful=2 harmful=0 :: …`）；**LLM 只产 ADD 候选，合并/去重/淘汰交给确定性代码**——这是增量比整篇重写高 13.4 个点的根因 |
| [Dynamic Cheatsheet](https://arxiv.org/abs/2504.07952)（EACL 2026） | 分节 + 使用计数、长度预算写进提示词；**DC-∅ 对照**说明「换成任何项目都成立」的套话增益为零，据此加了私有性校验 |
| [MemoryBank](https://arxiv.org/abs/2305.10250)（AAAI 2024） | 遗忘曲线 + 「被召回即增大强度」。**公式已改**：从指数换成幂律（指数在 90 天只剩 0.0001） |
| [Mem0](https://arxiv.org/abs/2504.19413) | ADD / UPDATE / DELETE / NOOP 四分类；token −73%、延迟 −92% 的数据支撑「蒸馏优于堆上下文」 |

### 反思与信念修正

| 项目 | 借了什么 |
|---|---|
| [Hegelion](https://github.com/Hmbown/Hegelion) | 三段式 Prompt 编排：THESIS → ANTITHESIS（`CONTRADICTION:` / `EVIDENCE:` 成对）→ SYNTHESIS |
| [Self-Refine](https://github.com/madaan/self-refine) / [Reflexion](https://github.com/noahshinn/reflexion) | 生成→自评→重写；反思写回记忆供下次使用 |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | 「记忆 → 反思 → 回写记忆」闭环；近期性/重要性/相关性三因子检索 |
| [memoripy](https://github.com/caspianmoon/memoripy)（★693） | **准入管线**：噪声过滤、敏感数据隔离、指令注入拦截、权威冲突判定；「不可变版本 + 完整历史」 |
| [Graphiti](https://github.com/getzep/graphiti)（★32k） | 时序边建模（事实随时间为真/失效） |
| [Kumiho](https://arxiv.org/abs/2603.17244) | **typed dependency edges** 的理论依据；AGM 信念修正与图原生记忆的对应 |
| [Doyle, *A Truth Maintenance System*](https://dspace.mit.edu/handle/1721.1/6197)（AI 1979） | **撤回信念不是删一行**：信念携带 justification，撤回沿依赖网络传播。本项目准则的 `evidence` 状态（intact/weakened/orphaned）就是它 |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) / [AGM](https://doi.org/10.2307/2274239) | `prov:wasDerivedFrom` 作为一等推导边；expansion / revision / contraction 三分与确信度排序 |

### 经验学习与准入

| 项目 | 借了什么 |
|---|---|
| [LeAP](https://zenodo.org/records/21029662) | **四层认识类型**（observation → claim → fact → belief）+ 写权限分离：agent 不能自封为 fact |
| [SCL](https://arxiv.org/abs/2510.05107) | **propose vs verified state** 分离：模型只提候选，外部记忆存已验证状态 |
| [ExpeL](https://arxiv.org/abs/2308.10144)（AAAI 2024） | 从经验对比提取「洞察」并带计数 → 本项目的准则本与 `helpful/harmful` |
| [Voyager](https://arxiv.org/abs/2305.16291) | 技能必须验证才能入库；本项目「候选 → 人工确认 → active」同构 |
| [ReasoningBank](https://arxiv.org/abs/2509.25140)（ICLR 2026） | k=1 检索就够；判官仅 72.7% 准确但 70–90% 噪声下不敏感 → 降级门槛设为「样本 ≥5 且好评率 <0.3」 |
| [forge_dc](https://openreview.net/forum?id=7XhMLOsQoA)（NeurIPS 2026 PALM） | **带触发点的祈使规则合规 95%，描述性文本 55%，token 少约 10 倍**——本项目每条准则带 `when` 的直接依据 |
| [MemPrompt](https://arxiv.org/abs/2201.06009) | 让模型先输出「它对用户意图的理解」，用户纠正理解而不是纠正答案 |

### 场合判定（0.12.0）

| 来源 | 借了什么 |
|---|---|
| [Rasa — KeywordIntentClassifier](https://github.com/RasaHQ/rasa/blob/main/docs/docs/components.mdx) | 第 0 层：关键词**精确子串匹配**、命中即给 `confidence 1.0`、**不进打分**——明确的和模糊的混在一起算必然互相污染 |
| [Rasa — FallbackClassifier 源码](https://github.com/RasaHQ/rasa/blob/main/rasa/nlu/classifiers/fallback_classifier.py) | **双阈值**：除了 `threshold`（最高分不够），还有 `ambiguity_threshold`（top-2 分差太小 → 分不清）。单阈值抓不到「两个候选都很像」 |
| [Rasa — Fallback and Human Handoff](https://legacy-docs-oss.rasa.com/docs/rasa/fallback-handoff/) | 「置信度低就走兜底而不是硬猜」的总体思路 |
| [Chat Discrimination for Intelligent Conversational Agents](https://aclanthology.org/W18-3004/)（ACL RepL4NLP 2018） | 任务定义：判定一句话是 task-oriented 还是 chit-chat。**该走训练路线，我们没有标注数据，故不采用其模型** |
| [A Few-shot Approach to Task-oriented Dialogue Enhanced with Chitchat](https://aclanthology.org/2024.sigdial-1.50/)（SIGDIAL 2024） | 两者混合对话的处理（对照参考） |
| [大多数 Agent 路由器跳过的意图分类层](https://tianpan.co/zh/blog/2026/04/16/intent-classification-agent-routers) | 生产上的**级联**做法：关键词（亚毫秒）→ 嵌入路由 → 小模型 → LLM 兜底；以及 `>0.8 / 0.5–0.8 / <0.5` 的置信度分档 |

### 工单阶段机（0.12.0）

| 项目 | 借了什么 |
|---|---|
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | **Ticket 状态机**（阶段由「在等什么」决定，而不是「做没做」）与「人不需要动就不占空间」的取舍；本项目把它的 External Ticket 概念落到本地待办上 |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | **UI 结构参考**：`main` 放面板主体（keyed）、`sidebar.panellist` 只放图标——我们最初把整块面板塞进 panellist，结果盖住了工作区列表，正是照它的分层才修对 |

### 检索与相似度

| 来源 | 借了什么 |
|---|---|
| [BM25 — Robertson & Zaragoza (2009)](https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf) | `bm25Score()` 的全部公式：IDF 非负、TF 饱和（k1）、长度归一（b）。参数在本项目 212 个真实章节上网格搜索定为 **k1=1.2 / b=0.5** |
| [Lucene LUCENE-6789](https://issues.apache.org/jira/browse/LUCENE-6789) / [Xapian BM25](https://xapian.org/docs/bm25.html) | TF-IDF → BM25 是工业界已验证的升级；短文档语料 b 取低（b=0.5 与此一致） |
| [Lucene CJKBigramFilter](https://lucene.apache.org/core/9_0_0/analysis/common/org/apache/lucene/analysis/cjk/CJKBigramFilter.html) | 中文按二元组切分；本项目 `tokenize()` 的 bigram + 虚词过滤源于此 |
| LCS（最长公共子序列） | 中文改写只换个别字，bigram 余弦抓不住（「发版前要跑测试」vs「发布版本之前要先跑测试」：余弦 0.107，LCS 0.600） |

### 否定识别与遗忘曲线

| 来源 | 借了什么 |
|---|---|
| [NegEx — Chapman et al. 2001](https://doi.org/10.1006/jbin.2001.1029) | **否定触发词 + 作用域 + 终止规则**；伪否定必须最长匹配后整段跳过 |
| [ConText — Harkema et al. 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2757457/) | 时间性/假设性/经验者三维；本项目冲突判定用「时间不同是取代、条件不同是例外」 |
| [Wixted & Ebbesen 1991](https://doi.org/10.1111/j.1467-9280.1991.tb00175.x) / [Rubin & Wenzel 1996](https://doi.org/10.1037/0033-295X.103.4.734) | 幂函数比指数拟合更好；210 个数据集元分析 |
| [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) | `R=(1+19/81·t/S)^(−0.5)`，t=S 时 R=0.9；本项目照此实现并加 0.2 下界 |

### 评审基准与评测方法

| 来源 | 借了什么 |
|---|---|
| [PATH-Bench](https://arxiv.org/abs/2608.01149)（2026） | **FGT（遗忘）指标**；「加了记忆反而变差」（负 FGT）的实测证据。SEU 准入三档来自它的 preserve/abstract/ignore |
| [Oblivion](https://arxiv.org/abs/2604.00131) / [Lifelong Learning Roadmap](https://arxiv.org/abs/2501.07278) | 衰减驱动激活、规则类记忆永不删除；记忆四分与稳定性-可塑性两难 |
| [Is In-Context Learning Learning?](https://arxiv.org/abs/2409.15790) / [LLM 不能自我纠错推理](https://arxiv.org/abs/2310.01798) | 「反馈必须来自外部结果」的理论依据 |
| [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) / [SWE-bench](https://github.com/princeton-nlp/SWE-bench) / [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) / [promptfoo](https://github.com/promptfoo/promptfoo) | 数据集+prompt+指标绑定；容器化复现与缓存键；Task/Solver/Scorer 分层；声明式用例 + 断言 + 基线对比 |

### 特别说明

- **作者是 AI**：本项目由 **DeepSeek V4.1-Flash（1017）** 在「许愿式编程」模式下逐轮完成——
  设计、编码、测试、调研、修 bug、写文档、发版全是模型干的；人只提需求。
  （详见文首那段说明。）
- 所有参考项目仅用于理解机制；代码、测试与文档均为原创实现，未包含上述项目的源码片段。
- 若你是上述项目的作者并认为某处借鉴过度，请开 issue，我会调整或移除。

---

## License

MIT

---

## English

> **Written by an AI.** Everything in this repository — design, code, tests, research, bug fixes, docs and
> release steps — was produced by **DeepSeek V4.1-Flash (1017)** in a "wishful programming" loop, one turn at
> a time. The human's only job was to state the wish and to call out any claim that did not hold up.
> "We" below means that collaboration, not someone typing at a keyboard.

`dsh-cognition-engine` is a zero-runtime-dependency DeepSeek Harness plugin that gives an agent **bitemporal memory**, a **distilled playbook** of working rules, a **five-stage ticket ledger**, a **dimension-wise audit**, and a per-turn **work-vs-chitchat register**.

Highlights:

- **Bitemporal memory** — `validFrom/validTo` plus `recordedAt/supersededAt`; four recall modes (current truth / true at a time / what it knew then / associative).
- **Playbook** — memories distilled into one page of rules injected before every turn, with `helpful/harmful` counts and expiry dates.
- **Tickets** — draft / open / doing / **review** / done, each with a deliverable, background and dependencies.
- **Dimension-wise audit** — memory, style, capability and feedback, each labelled with **who evaluates it**; deliberately no single score.
- **One sidebar panel**, six tabs, everything stored locally as plain JSON.

Seven tools, zero runtime dependencies, no external requests by default. Install:

```sh
dsh plugin --profile desktop add dsh-cognition-engine
```
