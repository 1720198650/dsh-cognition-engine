# 场合判定的依据调研（干活 / 闲聊）

> 写于 2026-11-08。目的：在给「按场合切换语气」动手之前，先看别人怎么做。
> 结论：**工程界有成熟的级联做法，我们不需要训练模型。**

## 一、这个任务有专门的研究：Chat Discrimination

**Moirangthem & Lee, 2018.** *Chat Discrimination for Intelligent Conversational Agents
with a Hybrid CNN-LMTGRU Network.* ACL RepL4NLP 2018.
<https://aclanthology.org/W18-3004/>

- 任务定义与我们完全一致：把用户一句话判成 **task-oriented** 还是 **chit-chat**。
- 方法：CNN + 多时间尺度 GRU（LMTGRU），端到端训练。
- 原文提到**数据不足**，所以自建了数据集（Twitter + Maluuba Frames）。

**对我们的意义**：方向被学术界确认过，但**这条路要数据集和训练**。我们没有标注数据，
走不了。

另有 **SIGDIAL 2024**, *A Few-shot Approach to Task-oriented Dialogue Enhanced with Chitchat*
<https://aclanthology.org/2024.sigdial-1.50/>，处理两者混合的对话，同样是模型路线。

## 二、工程界的做法：Rasa 的组件化流水线（我们照这个）

Rasa 把这件事拆成几个可组合的组件，每个职责单一：

### 1. `KeywordIntentClassifier` —— 关键词层

文档：<https://github.com/RasaHQ/rasa/blob/main/docs/docs/components.mdx>

> 简单关键词匹配意图分类器，**面向小型、短期项目**。
> 匹配默认**区分大小写**，只做关键词字符串在用户消息里的**精确子串匹配**。
> 命中给 `confidence: 1.0`。

**要点**：明确的话**直接定、置信度 1.0、不进打分**。
明确的和模糊的混在一个分数里算，必然互相污染。

另配套 `RegexMessageHandler` / `RegexFeaturizer` 做模式匹配。

### 2. `LexicalSyntacticFeaturizer` —— 表层特征层

Rasa 这层是 token 级（前后缀、长度、大小写、是否含数字）。
我们的场景更适合**句子级**特征，这批我们已经在 `src/style.ts` 的 `analyzeTurn()` 里算好了：
整条长度、语气词密度、第一人称密度、表情密度、标点密度。

### 3. `FallbackClassifier` —— 双阈值兜底（这层最有价值）

源码：<https://raw.githubusercontent.com/RasaHQ/rasa/main/rasa/nlu/classifiers/fallback_classifier.py>

逻辑是**两个条件**，不是单一阈值：

```python
# 条件一：没有任何意图的置信度 >= threshold
if below_threshold:            # 最高分都不到线 → 判不了
    → nlu_fallback

# 条件二：top-2 的置信度差 < ambiguity_threshold
if confidence_gap < ambiguity_threshold:   # 前两名挨太近 → 分不清
    → nlu_fallback
```

- `threshold`：绝对分不够
- `ambiguity_threshold`：**相对分差不够**

第二个条件是我们最初没想到的：它解决「两个候选都很像」的情况。
分数打平的时候硬选一个，是最容易出错的。

> 常见默认值 `threshold = 0.3`、`ambiguity_threshold = 0.1`。
> 组件文档页没有写明文数值（从源码结构可确认这两个键），部署时以实机配置为准。

### 4. `two_stage_fallback` 策略

Rasa 还有两段式兜底：第一次没听懂先问一句，再没懂就转人工。
我们没有人工接管，所以只用它的**双阈值**部分。

## 三、生产上的共识：级联，而不是单模型

TianPan, *大多数 Agent 路由器跳过的意图分类层* (2026-04)
<https://tianpan.co/zh/blog/2026/04/16/intent-classification-agent-routers>

给出的四层级联：

```
1. 关键词过滤      亚毫秒，零模型
2. 嵌入路由        16–100ms，92–96% 精确率
3. 微调小模型      50–200ms
4. LLM 兜底        1–5 秒
```

阈值口径：`>0.8` 自动路由，`0.5–0.8` 路由但标记待审，`<0.5` 升级下一层。

**我们只用第 1 层 + 表层特征 + 双阈值**。嵌入路由需要模型，违反插件的零依赖约束。

## 四、我们自己踩过的一个坑（直接复用）

`src/injection_log.ts` 的 `classifyFeedback()` 是同类「关键词判定」，注释里记了教训：

> 刻意**只收明确肯定**。v1 把「可以 / 好的 / 行 / 嗯」也算确认，
> 但这些词多半是「同意下一步动作」而不是「你这条准则用对了」，
> 误判会直接抬高 appliedGood，把整条证据链洗白。

所以场合判定里，**应答词必须单独处理**：
「好的 / 行 / 可以 / 嗯 / 继续」既不是派活也不是闲聊，是「继续当前工作」→ 按干活。

## 五、两个实测发现的陷阱

### 1. 运行时上下文也走 `user/message` 事件

宿主会把自己注入的上下文块（`Time sampled while preparing turn…`、
`Tokens prefixed with @…`、`<system-reminder>`、workspace 的 `Instructions from:`）
作为 user 消息发出来。不跳过的话：

- 记录里塞满机器文本，统计失真
- 里面的英文单词会误命中关键词（实测 `PR` 命中 `preparing`）

**修法**：`isRuntimeContext()` 按特征串跳过；纯 ASCII 关键词按**词边界**匹配。

### 2. 中文派活常被逗号切成短句

「这个函数报错，帮我改成 async，顺便加个测试」——按逗号切全是短句，
`shortRatio = 1`，用短句率会把**派活判成闲聊**。
所以不用 `shortRatio`，改用**整条消息总长度**判断「短」：闲聊是整体短，不是分句短。

## 六、代价不对称（决定兜底方向）

| 判错方向 | 后果 |
|---|---|
| 闲聊判成干活 | 说话官腔重（难听，但无害） |
| 干活判成闲聊 | 该动手时跟你闲扯（**真会把事搞砸**） |

所以 **分不清一律按「干活」**。这条比任何阈值都重要。

## 七、落地策略：先只记录，不改行为

我们没有中文闲聊的标注数据，阈值是从 Rasa 抄的（英文意图分类）。
所以第一版：

- **一个字都不改注入内容**
- 每轮记一行（`cognition-register.jsonl`，只存前 40 字摘要）
- 面板上能看，你能标「判错了」
- 攒够样本、有了你的修正，再决定要不要真的切换注入

这与 CPE、检索标注的纪律一致：**没有样本量就不下判断**。

## 参考链接

- <https://aclanthology.org/W18-3004/> — Chat Discrimination（ACL 2018）
- <https://aclanthology.org/2024.sigdial-1.50/> — Few-shot task-oriented + chitchat（SIGDIAL 2024）
- <https://github.com/RasaHQ/rasa/blob/main/docs/docs/components.mdx> — Rasa 组件文档
- <https://raw.githubusercontent.com/RasaHQ/rasa/main/rasa/nlu/classifiers/fallback_classifier.py> — FallbackClassifier 源码
- <https://tianpan.co/zh/blog/2026/04/16/intent-classification-agent-routers> — 意图分类层与级联
- <https://legacy-docs-oss.rasa.com/docs/rasa/fallback-handoff/> — Rasa 兜底与转人工
