# Persona 文件格式与中文风格度量：精读报告

> 2026-11-05
> 目标：给 `dsh-cognition-engine` 的 Persona 层（`persona` + `human` 两块）定格式、定预算、定审计指标。
> 约束：零外部依赖、纯 JSON、中文为主、字符预算有限。

## 0. 开工前自查

- `[ctxt-00001]`（功能发版前六步：卸载验证→兼容性检查→代码优化→README 覆盖检查→一键安装验证→发布）：**本次不适用**。本次是研究与格式设计，不是发版。
- `[ctxt-00002]`（纯文档只推 commit，不动版本号）：**本次适用**。报告与设计文档不改版本号、不打 tag。
- `[ctxt-00003]`（插件零外部依赖、记忆只用纯 JSON）：**本次适用**。下面的 schema、表达式表、风格指纹函数都按零依赖设计。
- `[ctxt-00005]`（npm 发布必须显式 `--registry=https://registry.npmjs.org`）：**本次不适用**，不涉及发布。

### 五条结论

1. **Character Card V2 是「角色扮演卡」不是「长期助手卡」**：真正值得抄的是 `name`/`description`/`personality`/`mes_example`/`post_history_instructions` 五个字段的**功能**，不是整套字段。
2. **MaiBot 当前仓库没有人设卡目录**：2026-11 的 `main` 分支里找不到 `prompts/persona-cards/`，当前实现是 `maibot.personality` JSON + WebUI 人设库；`private/public` 的目录加载顺序来自一篇参考实现文章（NoneBot2 + NapCatQQ），不是 MaiBot 官方代码。
3. **Persona 应该是「两个 block + 一个审计层」**：`persona` 600 字符、`human` 500 字符；`value` 是注入文本，`traits`/`history`/`revision` 只做审计，不占注入预算。
4. **「像人」可以纯代码量化**：句长分布、语气词频率、第一人称率、标点密度、emoji、叠词、儿化、口头禅等 20 个左右的指标，按每千字归一后做有界加权距离；同人同风格通常落在 0.75–0.85，低于 0.65 且连续 3 个窗口才报漂移。
5. **表达学习要像 MaiBot 一样「可关、可审、可淘汰」**：只从用户消息学，候选进 `candidate`，≥3 次且跨 2 天才转 `active`，每轮最多注入 5 条/300 字符，60 天不用就衰减淘汰。

---

## 1. SillyTavern Character Card V2 精读

### 1.1 V1 / V2 / V3 的关系

| 版本 | 结构 | 新增内容 |
|---|---|---|
| V1 | 六个扁平字段，无版本标记 | `name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` |
| V2 | `spec: "chara_card_v2"` + `spec_version: "2.0"` + 所有 V1 字段放进 `data` | `creator_notes`、`system_prompt`、`post_history_instructions`、`alternate_greetings`、`character_book`、`tags`、`creator`、`character_version`、`extensions` |
| V3 | `spec: "chara_card_v3"`，CHARX ZIP 容器 | `nickname`、`assets`、`group_only_greetings`、`creator_notes_multilingual`、`source`、创建/修改时间、lorebook 的 `use_regex`/decorators |

V2 的完整 TypeScript 定义见 [spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)；V1 的六个字段定义见 [spec_v1.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v1.md)。V2 对 V1 的核心改动是**加了一层 `data` 包装 + 9 个新数据字段 + `spec`/`spec_version` 两个标记 + 内置 `character_book`**，V1 六字段在 `data` 内仍然沿用 V1 规范。V3 的差异可参考 [Character Card Converter 的 V1/V2/V3 对比](https://charactercardconverter.com/guides/character-card-v1-v2-v3-differences.html) 与 [LoreWeaver 指南](https://www.loreweaverai.com/guides/character-cards-explained)。

一个最小的 V2 JSON 形状（字段全部可空串，但键要存在；`extensions` 必须为对象）：

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "角色名",
    "description": "角色描述……",
    "personality": "性格摘要……",
    "scenario": "当前情境……",
    "first_mes": "第一句话……",
    "mes_example": "<START>\n{{user}}: 你好\n{{char}}: 你好呀。",
    "creator_notes": "",
    "system_prompt": "",
    "post_history_instructions": "",
    "alternate_greetings": [],
    "character_book": { "entries": [], "extensions": {} },
    "tags": [],
    "creator": "",
    "character_version": "1.0",
    "extensions": {}
  }
}
```

分发形态：V1/V2 卡片最常见的是 PNG 的 `chara` tEXt chunk（JSON 做 base64 后藏进图片元数据），V3 用 `ccv3` chunk 或 CHARX ZIP（`card.json` + assets）；JSON 文件也可以直接交换（[LoreWeaver 说明](https://www.loreweaverai.com/guides/character-cards-explained)）。

### 1.2 字段表（作用 / 必填 / 典型长度 / 我们是否采用）

> 说明：规范只规定类型与语义，**不规定长度**。下表的「典型长度」是社区实践 + SillyTavern 文档的经验值，标注为「经验值」；`description` 的 200–2000 tokens 直接来自 SillyTavern 文档。

| 字段 | 作用 | 必填 | 典型长度（经验值） | 我们是否采用 |
|---|---|---|---|---|
| `name` | 角色名，替换 `{{char}}` | V1 规范：必填（可为空串）；SillyTavern 实际：唯一必填 | 1–30 字 | **部分采用** → `persona.displayName`（可选） |
| `description` | 角色描述、外观、背景、性格等；**永久 token，每轮都发** | V1 必填（可空串） | 200–2000 tokens；中文约 300–1200 字 | **采用其功能** → `persona.value` 的主体（压到 600 字内） |
| `personality` | 性格短摘要；永久 token | V1 必填（可空串） | 20–150 字 | **采用** → `persona.traits` + `value` 里的风格句 |
| `scenario` | 对话开场的情境；永久 token | V1 必填（可空串） | 30–200 字 | **不采用**（我们不是角色扮演，没有虚构场景） |
| `first_mes` | 开场白；只在聊天开始时发一次；**模型最容易模仿的风格锚点** | V1 必填（可空串） | 50–300 字 | **不直接采用** → 用 `persona.examples` 的 1–2 句替代 |
| `mes_example` | 示例对话；上下文满后被逐块挤出 | V1 必填（可空串） | 2–3 组短对话，约 300–800 字 | **采用** → `persona.examples`（最多 2 条，每条 ≤60 字） |
| `creator_notes` | 给人类看的说明；**规范明确禁止用于 prompt** | V2 新增；可空 | 100–1000 字 | **采用为元数据** → `meta.notes`，不注入 |
| `system_prompt` | 替换全局 system prompt；支持 `{{original}}` 占位符 | V2 新增；可空 | 0–500 字（可更长，取决于前端） | **不采用**（危险：会覆盖插件自己的系统提示） |
| `post_history_instructions` | 替换 ujb/jailbreak；**在历史之后注入**；支持 `{{original}}` | V2 新增；可空 | 0–300 字 | **部分采用**：只吸收「末尾再强调一次边界」的机制，不开放自由覆盖 |
| `alternate_greetings` | 备用开场白数组；前端做 swipe | V2 新增；可空 | 0–10 条，每条 50–300 字 | **不采用** |
| `character_book` | 角色专属世界书；条目含 `keys`/`content`/`enabled`/`insertion_order` 等 | V2 可选（`?`） | 0–1000 条，每条 50–500 字 | **不采用**（我们的 memory/topics 已覆盖知识检索） |
| `tags` | 前端搜索/筛选；**不用于 prompt** | V2 新增；可空 | 0–10 个短标签 | **采用为元数据** → `meta.tags` |
| `creator` | 作者署名；不用于 prompt | V2 新增；可空 | 1 行 | **不采用** |
| `character_version` | 角色版本；不用于 prompt；仅供展示/排序 | V2 新增；可空 | `1.0` 这类短字符串 | **采用其概念** → `revision` 整数（真正可审计） |
| `extensions` | 任意 JSON 键值；必须默认 `{}`，不得销毁未知键 | V2 必填（默认 `{}`） | 任意 | **不采用**（我们自己的 schema 已版本化） |

**必填的准确说法**：V1 规范说六个字段「全部必填，且必须默认为空字符串，不能是 null/缺失」；SillyTavern 文档则说「只有 Character Name 必填，其余可空」。两者不矛盾——规范层面字段存在但可为空，应用层面只有 `name` 是硬性必填。V2 新增字段在规范类型里大多为必填字符串，但前端普遍接受缺失并按空串处理。

**`character_book` 的条目字段**（完整定义见 spec_v2 的 `CharacterBook` 类型）：`keys: string[]`、`content: string`、`extensions: {}`、`enabled: boolean`、`insertion_order: number`（越小越靠前）、`case_sensitive?`、`name?`（不参与 prompt）、`priority?`（预算不足时低优先级先丢）、`id?`、`comment?`、`selective?`、`secondary_keys?`、`constant?`、`position?: 'before_char' | 'after_char'`。这套结构适合「按关键词触发世界书」，不适合我们这种「记忆按相关度召回」的模型，所以不采用。

### 1.3 `mes_example` 的格式

规范要求（[spec_v1.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v1.md)）：

```text
<START>
{{user}}: hi
{{char}}: hello
<START>
{{user}}: hi
Haruhi: hello
```

- `<START>` 标记「一段新对话」的开始，可以被前端转换成 System 消息「Start a new conversation.」；它本身不会出现在 prompt 中。
- `{{char}}` 替换为卡片的 `name`，`{{user}}` 替换为应用的显示名；`<BOT>`/`<CHAR>`/`<USER>` 是旧写法别名，大小写不敏感。
- 示例对话默认只在上下文有空间时保留，真实聊天填满后会被逐块挤出（可由用户配置强制保留）。
- 写作建议：**2–3 组短对话，比十段形容词更能教出声音**（[LoreWeaver 写作指南](https://www.loreweaverai.com/guides/character-cards-explained)）。

### 1.4 `system_prompt` 与 `post_history_instructions` 的区别

| | `system_prompt` | `post_history_instructions` |
|---|---|---|
| 位置 | 替换「主系统提示」，通常在历史**之前**、prompt 最前面 | 替换「ujb/jailbreak」，在**聊天历史之后**、生成之前 |
| 作用 | 定义模型的总体行为、角色框架 | 最后一遍强调/覆盖，模型通常给更高优先级 |
| 占位符 | `{{original}}` 替换为前端原本的 system prompt | `{{original}}` 替换为前端原本的 ujb/jailbreak |
| 默认行为 | 前端**必须**用它替换全局 system prompt；空串时回退 | 前端**必须**用它替换全局 ujb/jailbreak；空串时回退 |
| 风险 | 可以直接改写整个系统指令，**不建议开放给普通用户** | 可以压过主提示，**只适合放简短的边界提醒** |

来源：V2 规范原文（上表 spec_v2 链接）与 [SillyTavern Prompts 文档](https://docs.sillytavern.app/usage/prompts/)（PHI「sent after the main prompt and the user message」「usually gives them a higher priority」）。

### 1.5 哪些字段适合「不是角色扮演、是长期助手」的场景

**适合（按价值排序）**：

1. `description` 的功能：写「我是谁 + 怎么说话」，但压缩到 600 字以内。
2. `mes_example` 的功能：1–2 条「说话示例」是最强风格锚点，比「你要简洁」有效。
3. `personality` 的功能：用 5–7 个 0–1 的 trait 做审计目标，而不是写一段形容词。
4. `post_history_instructions` 的机制：在每轮末尾用一行提醒边界（如「不编造事实」）。
5. `creator_notes`/`tags` 的功能：只做元数据，不占 prompt。

**不适合**：

- `scenario` / `first_mes` / `alternate_greetings`：角色扮演的开场结构，长期助手没有「第一句话」。
- `character_book`：我们已有记忆/主题/准则，重复造世界书会稀释预算。
- `system_prompt`：会覆盖插件系统提示，破坏安全边界。
- `character_version`：只是展示字符串，不能防漂移；我们要 `revision + history + hash`。

---

## 2. MaiBot 精读

### 2.1 当前 MaiBot：人设库 JSON，不是 `prompts/persona-cards/`

**先说查证结果**：在 2026-11 的 `Mai-with-u/MaiBot` `main` 分支中，`git tree` 里**没有** `prompts/persona-cards/` 目录（我用 GitHub API 的 recursive tree 查过）；当前人设实现是：

- `config/bot_config.toml` 的 `[personality]` 段：`personality`、`behavior_style`、`reply_style`、`multiple_reply_style`、`multiple_probability`、`selected_profile`、`profiles`。
- WebUI「身份与人格」页 + 人设库；保存/切换后热重载，下一条回复生效。
- 导入格式 `maibot.personality` v1：

```json
{
  "format": "maibot.personality",
  "version": 1,
  "profile": {
    "name": "温柔的麦麦",
    "personality": "温柔、好奇，喜欢和朋友分享日常。",
    "behavior_style": "自然参与聊天，认真倾听，不强行找话题。",
    "reply_style": "简短自然，语气温和。",
    "group_chat_prompt": "留意群友之间的互动，适时参与，不必逐条回复。",
    "private_chat_prompts": "关注对方的想法，保持自然连贯的一对一交流。",
    "multiple_reply_style": ["偶尔用一句俏皮话回复"],
    "multiple_probability": 0.1
  }
}
```

`profile` 前六个字段是必填字符串，名称不能全空白；`multiple_reply_style` 默认 `[]`，`multiple_probability` 默认 `0`；不接受额外字段、自动类型转换或远程资源；单份文本最多 65536 个 JavaScript 字符（UTF-16 code units）。见 [MaiBot 人设库与导入文档](https://docs.maibot.chat/manual/personality) 与仓库内 [docs/personality-import.md](https://github.com/Mai-with-u/MaiBot/blob/main/docs/personality-import.md)。

**三段各管什么**（[Bot 配置文档](https://docs.maibot.chat/manual/configuration/bot-config)）：

| 字段 | 管什么 | 我们对应到 |
|---|---|---|
| `personality` | 她是谁、什么性格；1–2 句即可，太长反而稀释 | `persona.value` 的身份段 + `traits` |
| `behavior_style` | 行动准则：什么时候参与、什么时候安静、怎么观察局面 | `persona.behavior`（也是主动闸门输入） |
| `reply_style` | 说话风格：长短、语气、口癖 | `persona.value` 的风格段 + `examples` |

### 2.2 参考实现的 `private/public` 角色卡结构

用户提到的 `prompts/persona-cards/`、`private/public` 加载顺序，来自一篇 QQ bot 实战文章（[给 QQ AI 机器人设计“可控记忆”](https://juejin.cn/post/7655701939900694568)），不是 MaiBot 官方仓库。文章的设计是：

```text
prompts/persona-cards/
  public/      脱敏模板，可提交 Git
  private/     真实角色卡，不提交 Git
```

加载顺序：

```text
private/ -> persona-cards 根目录旧本地卡 -> public/
```

文章给出的上下文组装顺序也值得抄：

```text
1. 基础系统提示词 prompts/system.md
2. 通用底层聊天协议 prompts/base/chat-core.json
3. 当前角色卡 prompts/persona-cards/*.md
4. 当前发言者身份上下文
5. 主人公开信息规则
6. 主人手动长期记忆
7. 当前会话摘要
8. 最近短期原文
9. 用户本次消息
```

原则：安全/权限 > 角色卡 > 普通表达习惯；长期记忆不能覆盖当前消息；摘要不能覆盖短期原文。

### 2.3 角色卡负责什么、不负责什么（表达 vs 记忆的边界）

文章明确把角色卡定位为「当前回复协议」，不是第二套记忆：

| 角色卡负责 | 角色卡不负责 |
|---|---|
| 机器人如何表达、回复多长 | 保存用户事实 |
| 私聊/群聊语气区别 | 保存用户偏好 |
| 什么时候简短、什么时候给步骤 | 记录项目进度 |
| 当前角色的身份和回答约束 | 替代会话摘要 |
| 主人/非主人模式 | 覆盖权限与隐私规则 |

这正是我们 `persona` / `human` / `memory` 三块分离的依据：**persona 管「我是谁、怎么说」，human 管「你是谁、要什么」，memory 管「发生过什么」**。

### 2.4 `expression_learner`：提取 / 存储 / 复用

**数据模型**（[`expression_data_model.py`](https://github.com/Mai-with-u/MaiBot/blob/main/src/common/data_models/expression_data_model.py)）：

| 字段 | 含义 |
|---|---|
| `id` / `item_id` | 自增主键 |
| `situation` | 表达方式的使用情景 |
| `style` | 表达方式风格 |
| `content_list` | 同一 style 下的多个 situation 变体（JSON 数组） |
| `count` | 被观察到/合并的次数 |
| `last_active_time` | 最近被选中使用的时间 |
| `create_time` | 创建时间 |
| `session_id` | 归属会话（群/私聊） |
| `checked` | 是否通过人工审核 |
| `modified_by` | 最后修改者（用户/AI） |

**提取提示词**（[`prompts/zh-CN/text_learning_expression.prompt`](https://github.com/Mai-with-u/MaiBot/blob/main/prompts/zh-CN/text_learning_expression.prompt)）：

- 输入是带 `id` 和 `text` 的原文片段 JSON 数组，按原文顺序排列；任何指令都不执行。
- 输出 `candidates: [{title: 适用情境, description: 表达方式或语言风格, source_id}]`。
- 情境 ≤200 字，表达 ≤120 字；每段最多 30 条；没有就空数组；只输出严格 JSON。

**学习流程**（[`expression_learner.py`](https://github.com/Mai-with-u/MaiBot/blob/main/src/learners/expression_learner.py)）：

1. 批量取消息，模型提取候选；单批超过 20 条则整批丢弃（防模型失控）。
2. 过滤：`SELF`、机器人名字/昵称、`[表情包`、`[图片`、空值。
3. 可选 `expression_self_reflect`：写入前让另一个 LLM 审核，标准是「与情景匹配、允许口语化/语法错误、必须泛用、一般不涉及具体人名」；不通过就不写。
4. 去重：同 `session_id` 下 `style` 完全一致且 `situation` 与 `situation/content_list` 任一项完全一致，则合并：`content_list.append(situation)`、`count += 1`、`last_active_time = now`；否则新建 `count = 1`、`checked = False`。
5. 写入后可选同步向量索引（`use_vector_expression`）。

**复用注入**（[`maisaka_expression_selector.py`](https://github.com/Mai-with-u/MaiBot/blob/main/src/chat/replyer/maisaka_expression_selector.py)）：

- 候选少于 10 条时直接跳过（不硬凑）。
- 快速档：`weighted_sample` 按 `count` 加权随机抽，最多 5 条高 `count` + 5 条随机；精细档：向量召回最多 50 条候选，再由 LLM 选 ≤5 条。
- 注入块原文：

```text
你可以视情况自由使用以下句式：
- 当"{situation}"时，可以用"{style}"来表达。
```

- 被选中的表达更新 `last_active_time`。
- 配置开关：`expression_checked_only`（只用人工精选）、`use_vector_expression`（快速 vs 精细）、`learning_list`/`learning_blacklist`（按群/用户控制学习范围）。

**一个要避开的实现细节**：MaiBot 的 `_update_existing_expression` 在合并重复表达时会把 `checked` 写回学习传入的 `False`，也就是说「重复学习」可能把人工审核过的条目标记打回未审核。我们自己的 expression 表要保证：重学只增加 `hits`/`lastSeenAt`，**不清除 `checked`、不降级已 `active` 的条目**。

### 2.5 `turn_trigger`：发言时机怎么判断

`src/maisaka/` 是 MaiBot 当前的 Maisaka 运行时目录，`src/maisaka/turn_trigger/` 下有 `gates.py`、`scheduler.py`、`dynamic_gate.py`、`reply_likelihood.py`、`idle_backoff.py`；下面只看最核心的两个文件。

MaiBot 的 `reply_likelihood.py` 是一个**逻辑回归**，输入是对话快照，输出「这批新消息进入 Planner 后会调用 reply 的概率」：

```text
logit = -1.2005
      + 1.5852 * mention_bot            # 提到麦麦的名字
      - 1.1157 * at_other               # @ 了麦麦以外的人
      + 0.4807 * has_question_mark      # 带问号
      - 1.0281 * placeholder_only       # 只有表情/图片等占位
      + 2.6525 * recent_self_ratio      # 最近 5 分钟麦麦发言占比
      - 0.0367 * recent_message_count   # 最近 5 分钟消息条数
      + 0.0571 * log1p(seconds_since_bot_message)
      + 0.1012 * min(20, pending_count) # 本批新消息条数
p = 1 / (1 + exp(-logit))
```

文件：[`reply_likelihood.py`](https://github.com/Mai-with-u/MaiBot/blob/main/src/maisaka/turn_trigger/reply_likelihood.py)。直观解释：被点名/提到会显著提高概率；@ 别人、纯表情包会降低；最近自己说得越多越容易继续说；越久没说话越容易开口；消息积压越多越容易进入处理。

`dynamic_gate.py` 再按「回复频率」动态卡阈值：

- 1 小时滑动窗口，统计「预计回复数」（概率之和 + @ 强制触发按 0.91 次计）和「实际回复数」。
- 目标回复数 = `frequency × expected_total`；保留比例 = 目标 / 预计；阈值 = 按概率从高到低累计到预算时的分值。
- 窗口内评分少于 20 次时用离线静态阈值表（如保留 0.5 → 阈值 0.336；保留 0.2 → 0.482；保留 0.8 → 0.250）。
- 只收紧不放宽：实际回复过多就提高阈值，避免「一波消息刚到时预计数先涨」导致系统性多话。

文件：[`dynamic_gate.py`](https://github.com/Mai-with-u/MaiBot/blob/main/src/maisaka/turn_trigger/dynamic_gate.py)。防抖档位（`natural` 默认）：安静 2 秒、活跃 5 秒；同一人续发 2 秒、换人 0.5 秒；整批最多等 8 秒；被 @ 最多等 1 秒（[Bot 配置文档](https://docs.maibot.chat/manual/configuration/bot-config)）。

**对我们的启发**：persona 的 `behavior` 字段应该只写「什么时候该说/不该说」的定性规则；真正的发言闸门用类似的确定性打分，不要塞进 persona 文本里。

---

## 3. `cognition-persona.json` schema 建议

### 3.1 设计原则

1. **两个块，不是一个**：`persona`（agent 自己）+ `human`（用户）。前者是「我是谁、怎么说」，后者是「你是谁、要什么」。
2. **`value` 是唯一注入源**：中文自然语言最好编辑；`traits`、`examples`、`history` 是审计/锚点，不单独占注入预算（`examples` 会拼接在 `value` 后面，所以计入 `limit`）。
3. **边界永远只读**：`persona` 里的价值观/边界不能由 agent 自动改；agent 只能 `propose`，用户 `confirm`。
4. **一切变更留痕**：`revision` 自增，`history` 存 before/after hash 与操作者；单次改动与旧值 LCS 相似度 <0.7 时二次确认。
5. **存储位置**：`~/.dsh/cognition-engine/cognition-persona.json`（用现有 `resolveDataFile()`，**不要放插件代码目录**；这是之前两次发版误删用户数据的根因）。同目录另有 `cognition-expressions.json`。

> 预算换算：1100 个中文字符约 660–900 tokens（取决于 tokenizer），对 1M 上下文几乎可忽略；真正要控制的是「每轮都带」的固定成本。

### 3.2 完整 JSON 示例（中文默认值）

```json
{
  "schema": "cognition.persona",
  "version": 1,
  "revision": 1,
  "updatedAt": 1793790459061,
  "budget": {
    "persona": 600,
    "human": 500,
    "total": 1100
  },
  "meta": {
    "notes": "人类可读说明，不注入 prompt",
    "tags": ["长期助手"]
  },
  "blocks": {
    "persona": {
      "label": "persona",
      "displayName": "小认",
      "limit": 600,
      "readOnly": false,
      "value": "我是小认，一个直接、务实的长期协作助手。\n风格：先给结论，再给理由；短句；少铺垫；不确定时明说。\n价值观：准确优先于讨好；先查证再动手；不假装有意识。\n边界：不编造事实；不替用户做不可逆决定；不假装情感体验。",
      "examples": [
        "这件事我查过了，结论是 A。理由有两条：……",
        "这个我没把握，先确认一下再回你。"
      ],
      "traits": {
        "directness": 0.85,
        "warmth": 0.55,
        "verbosity": 0.3,
        "humor": 0.2,
        "formality": 0.4
      },
      "lockedPhrases": ["不编造事实", "不替用户做不可逆决定", "不假装情感体验"],
      "history": []
    },
    "human": {
      "label": "human",
      "displayName": "用户",
      "limit": 500,
      "readOnly": false,
      "value": "做文档整理，中文为主；要求先查证再动手；讨厌空话和总结性废话。",
      "facts": [
        { "key": "工作", "value": "文档整理", "confidence": 1.0 }
      ],
      "interactionStyle": {
        "warmth": 0.5,
        "formality": 0.4,
        "humor": 0.2,
        "proactivity": 0.4,
        "directness": 0.8,
        "boundaries": 0.7
      },
      "history": []
    }
  }
}
```

### 3.3 字段表（字段 / 类型 / 默认值 / 字符上限 / 说明）

| 字段 | 类型 | 默认值 | 上限 | 说明 |
|---|---|---|---|---|
| `schema` | string | `"cognition.persona"` | — | 固定标识 |
| `version` | number | `1` | — | 文件格式版本，只升不降 |
| `revision` | number | `1` | — | 内容修订号，每次保存 +1 |
| `updatedAt` | number | `Date.now()` | — | 毫秒时间戳 |
| `budget.persona` | number | `600` | ≤800 | persona 块字符预算 |
| `budget.human` | number | `500` | ≤700 | human 块字符预算 |
| `budget.total` | number | `1100` | ≤1500 | 两块合计硬上限 |
| `meta.notes` | string | `""` | 500 字 | 人类可读说明，不注入 |
| `meta.tags` | string[] | `[]` | 10 个 | 元数据，不注入 |
| `blocks.persona.label` | string | `"persona"` | — | 固定 |
| `blocks.persona.displayName` | string | 空 | 20 字 | agent 自称/展示名，可空 |
| `blocks.persona.limit` | number | `600` | ≤800 | 单块上限，必须 ≤ budget.persona |
| `blocks.persona.readOnly` | boolean | `false` | — | 整个块是否只读（默认 false，但 boundaries 永远只读） |
| `blocks.persona.value` | string | 见示例 | 600 字 | **唯一注入正文**；按 Unicode code point 计 |
| `blocks.persona.examples` | string[] | `[]` | 2 条 × 60 字 | 说话示例，拼在 value 后；总字符计入 limit |
| `blocks.persona.traits` | object | 5 个常用维度 0.5（可扩展至 7 个） | 7 个维度 | 审计目标值，不注入；值 0–1 |
| `blocks.persona.lockedPhrases` | string[] | `[]` | 5 条 × 30 字 | 必须原样出现在 `value` 中的边界短语；删除/改写即拒绝保存 |
| `blocks.persona.history` | array | `[]` | 50 条 | 审计历史；每条存 `at/by/op/beforeHash/afterHash/reason` |
| `blocks.human.label` | string | `"human"` | — | 固定 |
| `blocks.human.displayName` | string | 空 | 20 字 | 用户称呼（可空） |
| `blocks.human.limit` | number | `500` | ≤700 | 单块上限 |
| `blocks.human.readOnly` | boolean | `false` | — | agent 永远不能直接改；只能 propose |
| `blocks.human.value` | string | `""` | 500 字 | **唯一注入正文**；只放 3–5 条「始终需要知道」的事实/偏好 |
| `blocks.human.facts` | array | `[]` | 5 条 | 结构化事实（key ≤12 字、value ≤60 字），用于 UI/审计，不重复注入 |
| `blocks.human.interactionStyle` | object | 6 个 0.5 | 6 个维度 | 用户相处方式（warmth/formality/humor/proactivity/directness/boundaries），来自 Qianxue 的 6 维设计 |
| `blocks.human.history` | array | `[]` | 50 条 | 同 persona |

**字符计算**：`Array.from(value).length`（按 Unicode code point，不按 UTF-16 code unit）；`value + examples.join('\n')` 的总长度必须 ≤ `limit`。超限时**拒绝保存**，不要静默截断（截断会悄悄改变人格）。

### 3.4 注入格式

放在插件系统提示段的**最前面**（`systemPrompt.section({ name:'cognition-engine-persona', order:100, ... })`，现有记忆段是 `order:900`，所以 100 更靠前）：

```text
## 人格（稳定，不要违背）
<persona chars="420/600">
我是小认，一个直接、务实的长期协作助手。
风格：先给结论，再给理由；短句；少铺垫；不确定时明说。
价值观：准确优先于讨好；先查证再动手；不假装有意识。
边界：不编造事实；不替用户做不可逆决定；不假装情感体验。
示例：
- 这件事我查过了，结论是 A。理由有两条：……
- 这个我没把握，先确认一下再回你。
</persona>

<human chars="180/500">
做文档整理，中文为主；要求先查证再动手；讨厌空话和总结性废话。
</human>
```

规则：
- `value` 为空时不输出对应块（不占 token）。
- `examples` 最多 2 条；只放在 persona 块内，不要重复放进 human。
- 末尾可加一行 `postHistory` 提醒（来自 `post_history_instructions` 的机制），但只允许从 `persona.boundaries` 生成，例如：「提醒：不编造事实；不替用户做不可逆决定。」

### 3.5 编辑权限与漂移控制

| 操作 | 谁能做 | 行为 |
|---|---|---|
| 读 | agent / UI | `cognition_persona action=read` 或 GET `/persona` |
| 直接编辑 persona | 用户 UI | 保存即生效，`revision +1`，写 history |
| 提议修改 persona | agent | `action=propose` 写候选，不生效，返回 diff；用户 confirm 才落盘 |
| 修改 human | **仅用户 UI** | agent 永远不能直接改；只能 propose；用户 confirm 才落盘 |
| 修改 boundaries/values | 用户 UI | 必须二次确认（即使只改 1 个字） |
| 单次改动相似度 <0.7 | 用户 UI | 弹二次确认，防「人格被悄悄重写」 |

**漂移控制三层**：
1. **结构层**：`boundaries`/`values` 只读；`revision` + `history` 全量留痕；`history` 最多 50 条，超出丢最旧。
2. **计算层**：每次保存后，用第 4 节的风格指纹算「当前回复 vs 基线」；连续 3 个窗口 `similarity < 0.65` 且 `confidence ≥ 0.5` 才提示漂移。
3. **人工层**：月度 20 题场景审计（Role/Boundaries/Values/Style 各 5 题，三级评分 held/soft/hard），boundaries 的 hard failure 必须为 0。这个来自 AnchorBench 的四轴思路（见 [persona-research.md](persona-research.md) 的整理），但不需要每次跑。

### 3.6 正式 JSON Schema（可直接落地）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "cognition-persona.schema.json",
  "type": "object",
  "required": ["schema", "version", "revision", "updatedAt", "blocks"],
  "properties": {
    "schema": { "const": "cognition.persona" },
    "version": { "const": 1 },
    "revision": { "type": "integer", "minimum": 1 },
    "updatedAt": { "type": "integer", "minimum": 0 },
    "budget": {
      "type": "object",
      "properties": {
        "persona": { "type": "integer", "minimum": 100, "maximum": 800, "default": 600 },
        "human": { "type": "integer", "minimum": 100, "maximum": 700, "default": 500 },
        "total": { "type": "integer", "minimum": 200, "maximum": 1500, "default": 1100 }
      },
      "additionalProperties": false
    },
    "meta": {
      "type": "object",
      "properties": {
        "notes": { "type": "string", "maxLength": 500 },
        "tags": { "type": "array", "maxItems": 10, "items": { "type": "string", "maxLength": 20 } }
      },
      "additionalProperties": false
    },
    "blocks": {
      "type": "object",
      "required": ["persona", "human"],
      "additionalProperties": false,
      "properties": {
        "persona": { "$ref": "#/$defs/block" },
        "human": { "$ref": "#/$defs/block" }
      }
    }
  },
  "$defs": {
    "block": {
      "type": "object",
      "required": ["label", "limit", "value"],
      "properties": {
        "label": { "enum": ["persona", "human"] },
        "displayName": { "type": "string", "maxLength": 20 },
        "limit": { "type": "integer", "minimum": 100, "maximum": 800 },
        "readOnly": { "type": "boolean", "default": false },
        "value": { "type": "string", "maxLength": 800 },
        "examples": { "type": "array", "maxItems": 2, "items": { "type": "string", "maxLength": 60 } },
        "traits": {
          "type": "object",
          "additionalProperties": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "lockedPhrases": {
          "type": "array",
          "maxItems": 5,
          "items": { "type": "string", "maxLength": 30 }
        },
        "facts": {
          "type": "array",
          "maxItems": 5,
          "items": {
            "type": "object",
            "required": ["key", "value"],
            "properties": {
              "key": { "type": "string", "maxLength": 12 },
              "value": { "type": "string", "maxLength": 60 },
              "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
            },
            "additionalProperties": false
          }
        },
        "interactionStyle": {
          "type": "object",
          "additionalProperties": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "history": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "type": "object",
            "required": ["at", "by", "op", "afterHash"],
            "properties": {
              "at": { "type": "integer" },
              "by": { "enum": ["user", "agent", "system"] },
              "op": { "enum": ["create", "replace", "reset"] },
              "beforeHash": { "type": "string" },
              "afterHash": { "type": "string" },
              "reason": { "type": "string", "maxLength": 200 }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  }
}
```

---

## 4. 中文风格指纹：可计算指标清单

### 4.1 指标总表

> 记 `N` = 可计字符数（汉字 + 拉丁字母 + 数字，不含标点空白），`S` = 句子数（按 `。！？!?…` 换行切分），`M` = 消息条数。频次类统一 `perK = 次数 × 1000 / N`。

| # | 指标 | 怎么算 | 典型区间（经验值） | 怎么避免误判 |
|---|---|---|---|---|
| 1 | `meanSentLen` 平均句长 | `Σ句长 / S`，句长只算实字 | 口语 8–18；正式 25–40；助手 12–28 | 至少 8 句才算；与同场景基线比，不跨场景 |
| 2 | `sentLenStd` 句长标准差 | `std(句长)` | 8–18（自然波动） | 太短文本不算；std 低=机械，高=节奏散 |
| 3 | `sentLenCv` 句长变异系数 | `std / mean` | 0.45–0.85 | 用 CV 而不是 std，避免平均句长影响 |
| 4 | `shortRatio` 短句比 | 句长 ≤8 字的句子 / S | 口语 0.3–0.6；正式 0.05–0.2 | 短句多不等于不正式，需结合语气词 |
| 5 | `longRatio` 长句比 | 句长 ≥30 字的句子 / S | 口语 <0.15；正式 0.2–0.4 | 技术回答天然长句，按场景分桶 |
| 6 | `clauseLen` 分句长度 | 逗号/顿号/分号切开的平均实字数 | 8–15 | 长定语会拉高，结合 `commaPerSent` |
| 7 | `tonePerK` 语气词频率 | 吧/呢/啊/嘛/呀/啦/哦/呗/哈/嘿/唉/哎/咦/噢/喔/嗯/哼/咯/喽/呦 次数 ×1000/N | 正式≈0；口语 20–60 | 单字「哈」会把「哈哈」算 2 次，这是想要的；但新闻引语会误伤，先剥离引号 |
| 8 | `finalToneRatio` 句末语气词比 | 句末是 吧/呢/啊/嘛/呀/啦/哦/呗/哈 的句子 / S | 口语 0.2–0.5；正式 <0.05 | 问句本身带「吗」不算语气词，单独看 `questionRatio` |
| 9 | `firstPersonPerK` 第一人称率 | 我/我们/咱/咱们 次数 ×1000/N | 口语 10–40；正式 2–10 | 「我们」先匹配，避免被「我」重复计；话题影响大，权重放低 |
| 10 | `secondPersonPerK` 第二人称率 | 你/您/你们 ×1000/N | 对话 10–35；说明文 0–5 | 引用用户原话会拉高，先剥离引号 |
| 11 | `formalConnPerK` 书面连接词率 | 因此/此外/然而/综上/基于/旨在/以及/并且/从而/鉴于/由此可见/与此同时 ×1000/N | 正式 5–20；口语 <3 | 词表可扩展；只做相对比较，不追求绝对值 |
| 12 | `casualWordPerK` 口语词率 | 搞定/咋/啥/凑合/差不多/拉倒/挺好/超级 等 ×1000/N | 口语 5–25；正式 <3 | 避免单字词（老/特/贼）误伤，使用多字词表 |
| 13 | `slangPerK` 网络用语率 | 绝了/好家伙/笑死/离谱/绷不住/666/emmm/awsl/栓Q/yyds/破防/真香/无语/服了 等 ×1000/N | 年轻群聊 3–30；正式 0 | 词表随人群变化；只对同一群体比较 |
| 14 | `hedgePerK` 模糊限制语率 | 可能/也许/大概/应该/似乎/感觉/或许/不一定/看情况/估计 ×1000/N | 谨慎型 5–20；果断型 0–5 | 「应该」有歧义（应该做=义务），可只保留「可能/也许/大概/似乎/或许」 |
| 15 | `catchphrasePerK` 口头禅频率 | 自定义 3–5 个口头禅 ×1000/N | 因人不一，基线 ±50% | 必须按人配置；不要用通用词表硬套 |
| 16 | `punctPer100` 标点密度 | 所有标点 / N ×100 | 聊天 8–16；正式 5–10 | 代码/公式先剥离；英文标点也算 |
| 17 | `commaPerSent` 逗号密度 | 逗号/顿号 / S | 0.8–1.8 | 长句多则高；与 `clauseLen` 一起看 |
| 18 | `ellipsisPerK` 省略号频率 | `…+` 或 `...` ×1000/N | 0–10 | 正式文本也会用；权重放低 |
| 19 | `exclaimPerK` 感叹号频率 | `！!` ×1000/N | 0–15 | 多于 20 往往情绪化；不要单凭此判定 |
| 20 | `questionRatio` 问句比 | 句末 `?/？` 的句子 / S | 聊天 0.1–0.3；说明文 <0.05 | 反问句也算；和 `finalToneRatio` 分开 |
| 21 | `emojiPerK` emoji 频率 | `\p{Extended_Pictographic}` ×1000/N | 0–50（看平台） | 平台差异极大；只在同一平台比较 |
| 22 | `emojiDiversity` emoji 多样性 | 不同 emoji 数 / emoji 总数 | 0.3–0.9 | emoji 太少时不稳定，样本 <10 个不算 |
| 23 | `redupPerK` 叠词频率 | `([\u4e00-\u9fff])\1{1,2}` ×1000/N（哈哈/嗯嗯/看看/慢慢） | 口语 5–30；正式 0–3 | 「谢谢」等固定词也算；可与词表叠加 |
| 24 | `erhuaPerK` 儿化频率 | `X儿`，排除女儿/婴儿/孤儿/幼儿/胎儿等 ×1000/N | 北方口语 0–10 | 南方作者接近 0；不要当缺点 |
| 25 | `mattr100` 词汇丰富度 | 100 字窗口的 moving-average TTR，步长 20 | 聊天 0.55–0.75；正式 0.7–0.9 | 比 TTR 抗长度；短文本仍不稳，<200 字不算 |
| 26 | `msgLenMedian` 消息长度中位数 | 每条消息实字数中位数 | 聊天 5–30；助手 30–150 | 多消息输入才有意义；单条文本不用 |

**推荐的核心 8 项**（每轮回复可算、成本极低）：
`meanSentLen`、`sentLenCv`、`shortRatio`、`tonePerK`、`firstPersonPerK`、`punctPer100`、`emojiPerK`、`catchphrasePerK`。
其余作为周报/深度审计的扩展项。

### 4.2 计算函数（零依赖 JavaScript，可直接用）

完整可运行文件：`docs/persona/style-fingerprint.cjs`（原始文件在 `_research/persona/style-fingerprint.js`）（Node 18+，无第三方包；实现了上表全部 26 项）。下面是核心逻辑（简化显示，省去 `secondPersonPerK`/`casualWordPerK`/`slangPerK`/`hedgePerK`/`clauseLen`/`msgLenMedian`/`emojiDiversity` 等扩展项，完整版以文件为准）：

```js
const TONE_PARTICLES = ['吧','呢','啊','嘛','呀','啦','哦','呗','哈','嘿','唉','哎','咦','噢','喔','嗯','哼','咯','喽','呦'];
const FINAL_TONE = ['吧','呢','啊','嘛','呀','啦','哦','呗','哈'];
const FIRST_PERSON = ['我们','咱们','我','咱'];
const FORMAL_CONNECTIVES = ['因此','此外','然而','综上','基于','旨在','以及','并且','从而','鉴于','由此可见','与此同时'];

function chars(text) {
  return Array.from(text).filter(ch => /[\p{L}\p{N}]/u.test(ch));
}
function countChars(text) { return chars(text).length; }

// 最长优先匹配，避免“我们”和“我”重复计数
function countTerms(text, terms) {
  let rest = text, count = 0;
  for (const term of [...terms].sort((a,b) => b.length - a.length)) {
    const parts = rest.split(term);
    count += parts.length - 1;
    rest = parts.join('\u0000');
  }
  return count;
}

function splitSentences(text) {
  return text.split(/[。！？!?]+|…+|\.{3,}|\n+/).map(s => s.trim()).filter(s => countChars(s) > 0);
}

function mattr(text, windowSize = 100) {
  const arr = chars(text);
  if (!arr.length) return 0;
  if (arr.length <= windowSize) return new Set(arr).size / arr.length;
  let sum = 0, n = 0;
  for (let i = 0; i + windowSize <= arr.length; i += 20) {
    const slice = arr.slice(i, i + windowSize);
    sum += new Set(slice).size / windowSize;
    n++;
  }
  return n ? sum / n : 0;
}

function extractStyle(input, options = {}) {
  const messages = Array.isArray(input) ? input : [input];
  const text = messages.join('\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/[^\s)）\]】]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>|]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const nChars = countChars(text);
  const sents = splitSentences(text);
  const lens = sents.map(countChars);
  const nSent = sents.length;
  const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
  const std = xs => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(mean(xs.map(x => (x-m)**2)));
  };
  const perK = n => nChars ? n * 1000 / nChars : 0;
  const per100 = n => nChars ? n * 100 / nChars : 0;

  const meanSentLen = mean(lens);
  const stdSentLen = std(lens);
  const toneCount = countTerms(text, TONE_PARTICLES);
  const finalToneCount = sents.filter(s => FINAL_TONE.includes(Array.from(s).at(-1))).length;
  const emojiMatches = text.match(/\p{Extended_Pictographic}/gu) || [];
  const redupCount = (text.match(/([\u4e00-\u9fff])\1{1,2}/g) || []).length;
  const erhuaCount = (text.match(/([\u4e00-\u9fff])儿/g) || [])
    .filter(m => !['女','婴','孤','幼','胎','少','男'].includes(m[0])).length;

  return {
    nChars, nSent, nMsg: messages.length,
    confidence: Math.max(0, Math.min(1, Math.min(nChars / 300, nSent / 8))),
    meanSentLen, sentLenStd: stdSentLen,
    sentLenCv: meanSentLen ? stdSentLen / meanSentLen : 0,
    shortRatio: nSent ? lens.filter(n => n <= 8).length / nSent : 0,
    longRatio: nSent ? lens.filter(n => n >= 30).length / nSent : 0,
    tonePerK: perK(toneCount),
    finalToneRatio: nSent ? finalToneCount / nSent : 0,
    firstPersonPerK: perK(countTerms(text, FIRST_PERSON)),
    formalConnPerK: perK(countTerms(text, FORMAL_CONNECTIVES)),
    punctPer100: per100(Array.from(text).filter(ch => /[，。！？、；：,.!?;:…—～~"'“”‘’（）()《》【】]/.test(ch)).length),
    ellipsisPerK: perK((text.match(/…+|\.{3,}/g) || []).length),
    exclaimPerK: perK((text.match(/[！!]/g) || []).length),
    questionRatio: nSent ? sents.filter(s => /[?？]$/.test(s)).length / nSent : 0,
    emojiPerK: perK(emojiMatches.length),
    redupPerK: perK(redupCount),
    erhuaPerK: perK(erhuaCount),
    mattr100: mattr(text),
    catchphrasePerK: perK(countTerms(text, options.catchphrases || [])),
  };
}
```

### 4.3 相似度：有界加权距离，而不是裸欧氏距离

裸欧氏距离的问题：语气词每千字 200 次 vs 0 次，单项就会淹没其他所有维度。做法是**每个维度先除以「可容忍波动」，再截断到 1**：

```js
const SCALE = { meanSentLen: 8, sentLenCv: 0.25, shortRatio: 0.15, longRatio: 0.12,
  tonePerK: 15, finalToneRatio: 0.12, firstPersonPerK: 10, formalConnPerK: 6,
  punctPer100: 4, emojiPerK: 20, redupPerK: 10, erhuaPerK: 5, mattr100: 0.08 };
const WEIGHT = { meanSentLen: 1, sentLenCv: 1, shortRatio: 0.8, longRatio: 0.8,
  tonePerK: 1.2, finalToneRatio: 1, firstPersonPerK: 0.5, formalConnPerK: 0.9,
  punctPer100: 0.7, emojiPerK: 0.4, redupPerK: 0.8, erhuaPerK: 0.3, mattr100: 0.6 };

function styleDistance(a, b) {
  let num = 0, den = 0;
  for (const key of Object.keys(SCALE)) {
    const av = Number(a?.[key]), bv = Number(b?.[key]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const d = Math.min(1, Math.abs(av - bv) / (SCALE[key] * 3)); // 3 个日常波动封顶
    num += WEIGHT[key] * d;
    den += WEIGHT[key];
  }
  return den ? num / den : 0; // 0..1
}
const styleSimilarity = (a, b) => 1 - styleDistance(a, b);
```

**判断阈值（先用个人基线校准，不要直接当真理）**：

| 相似度 | 解释 | 动作 |
|---|---|---|
| ≥0.85 | 几乎同一个人同一天 | 正常 |
| 0.75–0.85 | 同风格，轻微波动 | 记录，不报警 |
| 0.65–0.75 | 可感知的风格偏移 | 观察；连续 3 个窗口才提示 |
| <0.65 | 明显漂移 | 提示「风格漂移」，列出差异最大的 3 个维度 |

**基线法（更稳）**：
- 取前 20–30 条该 persona 的回复（≥3000 字）算指纹，存中位数 `medianFp`。
- 新窗口与 `medianFp` 比；同时算历史距离的中位数 `medDist` 与 MAD，阈值 `max(0.55, medDist + 3×max(MAD, 0.05))`。
- 只有 `confidence ≥ 0.5`（≥300 字且 ≥8 句）才参与判断；否则只记录。

**实测样例**（本机脚本，文本仅作演示）：
- 正式报告：`meanSentLen≈28`、`tonePerK=0`、`formalConnPerK≈36`、`punctPer100≈10.7`、`mattr100≈0.90`。
- 群聊口语：`meanSentLen≈15.5`、`tonePerK≈177`、`firstPersonPerK≈48`、`emojiPerK≈32`、`redupPerK≈48`、`mattr100≈0.63`。
- 两段同风格助手回复：相似度 0.89；助手 vs 群聊口语：0.50；群聊 vs 正式报告：0.37。

### 4.4 关键坑

1. **长度归一**：所有频次按每千字算；句长类指标本身与长度无关，但句数 <8 时方差不可信，直接标 `low confidence`。
2. **话题影响**：第一人称、第二人称、专业词会被话题带偏；权重放低，且只比较同场景（技术回答 vs 技术回答、闲聊 vs 闲聊）。
3. **样本量**：<200 字或 <5 句只记录不判断；建议 300 字/8 句以上；周报至少 20 条回复。
4. **代码与引用**：必须先剥离 ```代码块```、行内代码、URL、Markdown 链接；引用用户原话时先去掉引号内容，否则第一/第二人称会失真。
5. **平台差异**：微信/QQ/网页对 emoji、标点、换行的处理不同；同一平台内比较，跨平台只比文本特征。
6. **输入法差异**：全角/半角、中文引号/英文引号会改变标点密度；统计前统一 `，。！？` 与 `,.!?`。
7. **口头禅词表要按人**：通用词表会把「应该」「感觉」当口头禅；每个 persona 单独配置 3–5 个词。
8. **不要用风格相似度判断「是不是同一个人」**：它只能判断「写法接近」，不能做身份识别（TATOOLS 也明确写了这一点：[文体风格指纹](https://tatools.cn/tools/style-fingerprint)）。

### 4.5 论文 / 开源实现

| 来源 | 是什么 | 可借什么 |
|---|---|---|
| [CharacterEval (ACL 2024)](https://aclanthology.org/2024.acl-long.638/) / [GitHub](https://github.com/morecry/CharacterEval) | 中文角色扮演对话评测基准：1,785 段多轮对话、77 个角色、13 项指标、4 个维度（对话能力/角色一致性/角色扮演吸引力/人格回溯-MBTI），并有 CharacterRM 奖励模型（注：论文摘要与仓库 README 的示例数口径不一致，引用时以论文为准） | 「像人」不只看语气，还要看角色一致性、知识一致性、表达多样性、共情；适合做月度 LLM 审计，不是纯代码 |
| [AushorShipAnalysis](https://github.com/Asuraqi/AushorShipAnalysis) | 中文小说作者识别：329 维特征（段落/句长 3 + 标点 9 + 词长 8 + 词性 9 + 虚词 300），5 位作者准确率约 94–99% | 虚词/标点/句长是稳定风格特征；300 维虚词词频适合离线校准，不适合每轮算 |
| [qh · china Stylometry](https://www.qhchina.org/docs/stylometry/) | 中文计算文体学工具包：Burrows' Delta、Eder's Delta、余弦相似度、MATTR、rolling delta | 用 z-score/Delta 做基线比较；用 MATTR 代替裸 TTR |
| [vierth/chinese_stylometry](https://github.com/vierth/chinese_stylometry) | Stanford DHAsia 中文文体分析 Notebook（PCA、聚类、作者识别） | 中文文本预处理、特征矩阵、PCA 可视化的教学实现 |
| [Function Words for Chinese Authorship Attribution (NAACL 2012)](https://lacuna.tiptreesystems.com/work/function-words-for-chinese-authorship-attribution) | 35 个中文虚词做作者识别；小说 90%、散文 85%、博客 68% | 虚词比实词更稳定；但**体裁干扰很大**，必须同体裁比较 |
| [大模型语义——换个文体它就换了个人格](https://tushouhao.blog.csdn.net/article/details/168448570) | 工程博客，给出 `style_profile`/`style_distance` 的可运行 Python 代码与经验区间 | 句长均值/标准差、语气词每千字、正式度词表；直接可改写成 JS |
| [TATOOLS 文体风格指纹](https://tatools.cn/tools/style-fingerprint) | 在线工具：句长/句型、词长/实虚词、词性、标点、人称；输出相似度 | 指标清单与「标准化后再比较」的工程做法；不开源 |

**未找到**：没有找到专门针对「中文长期助手 persona 风格」的公开评测基准；CharacterEval 是角色扮演，不是长期助手。也没有找到 MaiBot `expression_learner` 的官方论文；只有源码与文档。

---

## 5. expression 表的设计

### 5.1 数据文件与字段

文件：`~/.dsh/cognition-engine/cognition-expressions.json`（与 persona 分开，便于单独备份/关闭）。

```json
{
  "schema": "cognition.expressions",
  "version": 1,
  "updatedAt": 1793790459061,
  "items": [
    {
      "id": "expr_1793790459061_a1b2",
      "situation": "被问到不确定的事",
      "style": "先承认不确定，再说去确认",
      "examples": ["这个我没把握，先查一下再回你。"],
      "scope": "global",
      "source": { "kind": "user", "refs": ["msg_hash_1", "msg_hash_2"] },
      "status": "active",
      "score": 0.72,
      "hits": 4,
      "uses": 3,
      "good": 2,
      "bad": 0,
      "createdAt": 1793790459061,
      "lastSeenAt": 1793790459061,
      "lastUsedAt": 1793790459061,
      "ttlDays": 90,
      "tags": ["口语", "谨慎"],
      "dedupeKey": "sha256(normalized_style)"
    }
  ]
}
```

| 字段 | 类型 | 默认 | 上限 | 说明 |
|---|---|---|---|---|
| `id` | string | 自动 | — | `expr_<ts>_<rand>` |
| `situation` | string | — | 120 字 | 什么时候用（条件） |
| `style` | string | — | 80 字 | 怎么说（风格/句式） |
| `examples` | string[] | `[]` | 2 条 × 60 字 | 具体例句，最强锚点 |
| `scope` | string | `"global"` | — | `global` / `workspace` / `session:<id>` / `topic:<id>` |
| `source.kind` | string | `"user"` | — | `user` / `agent` / `manual` |
| `source.refs` | string[] | `[]` | 20 个 | 消息 id 或 hash，不存原文 |
| `status` | string | `"candidate"` | — | `candidate` / `active` / `rejected` / `retired` |
| `score` | number | `0` | 0–1 | 综合分 |
| `hits` | number | `0` | — | 被观察到次数 |
| `uses` | number | `0` | — | 被注入次数 |
| `good` / `bad` | number | `0` | — | 用户反馈计数 |
| `createdAt` / `lastSeenAt` / `lastUsedAt` | number | 0 | — | 毫秒时间戳 |
| `ttlDays` | number | `90` | — | 超过天数未出现开始衰减 |
| `tags` | string[] | `[]` | 10 个 | 人群/场景标签 |
| `dedupeKey` | string | — | — | `style` 归一化后的 hash，防重复 |

### 5.2 怎么提取

**只从用户消息学，不从 assistant 自己的回复学**（避免自我强化）。管线：

```text
用户消息（排除 @、URL、图片、表情包占位）
  → 清洗/脱敏（人名、QQ号、手机号、地址、数字）
  → 候选模式挖掘（纯代码，零依赖）
  → 可选 LLM 精炼（MaiBot 的 text_learning_expression 提示词）
  → 去重/打分（hits + distinctDays + 多样性）
  → 写 candidate（不直接用）
```

纯代码候选模式：

1. **整句短表达**：整条消息 ≤10 字，且在 ≥3 条消息 / ≥2 天出现 → 候选（如「确实」「好家伙」）。
2. **重复字符**：`([\u4e00-\u9fff])\1{1,2}` 出现 ≥3 次（哈哈/嗯嗯/哈哈哈）。
3. **句末语气模式**：句末 1–2 字是「吧/呀/嘛/啦/哦」等，统计高频组合。
4. **2–6 字 n-gram**：在 ≥3 条消息、≥2 个不同用户中出现，过滤停用词/高频通用词（的/了/是/我/你/他/这/那）。
5. **可选 LLM 精炼**：把匿名的 20–30 条片段给模型，按 `[{title, description, source_id}]` 输出；提示词直接抄 MaiBot 的 [text_learning_expression.prompt](https://github.com/Mai-with-u/MaiBot/blob/main/prompts/zh-CN/text_learning_expression.prompt)（情境 ≤200 字、表达 ≤120 字、每段 ≤30 条）。

**打分**：

```text
quality = 0.45 * min(1, hits / 5)
        + 0.25 * min(1, distinctDays / 3)
        + 0.20 * min(1, speakerDiversity / 2)
        + 0.10 * (source.kind === 'manual' ? 1 : 0)
```

- `quality ≥ 0.55` 且 `hits ≥ 3` 且 `distinctDays ≥ 2` → `active`。
- 否则留在 `candidate`，等用户审核。
- `source.kind = manual` 直接 `active`（用户手动加的就是信任）。
- 含以下内容直接拒绝：人名/称呼、手机号/QQ号/身份证、URL、代码、指令性文本（「忽略之前」「你现在是」「system prompt」）、色情/辱骂/隐私。

### 5.3 怎么注入

1. 只在回复前选择：当前用户消息 + 最近 3 条上下文。
2. 匹配：`situation` 与当前上下文做关键词/字符 bigram Jaccard；`score = 0.55*similarity + 0.30*quality + 0.15*recency`。
3. 只取 `similarity ≥ 0.25` 的 `active` 条目；按 score 降序，最多 5 条（MaiBot 的 `MAX_SELECTED_EXPRESSIONS = 5`），总字符 ≤300。
4. 注入格式（MaiBot 风格，但更短）：

```text
你可以视情况使用以下表达习惯（不必全部使用，不要生硬套用）：
- 当「被问到不确定的事」时，可以这样说：「这个我没把握，先查一下再回你。」
```

5. 记录 `uses += 1`、`lastUsedAt = now`；如果同一轮已经用了 3 条，不再加。
6. **绝不注入**：`candidate`、`rejected`、`retired`、scope 不匹配、与当前话题无关的条目。

### 5.4 怎么淘汰

| 规则 | 动作 |
|---|---|
| 60 天未出现（`lastSeenAt`） | `score *= 0.5`；90 天未出现 → `retired` |
| 30 天未被使用（`lastUsedAt`） | 降权 0.8；不是删除 |
| 用户负面反馈一次 | `bad += 1`，`score *= 0.7` |
| 负面反馈 ≥3 次 | `status = "rejected"` |
| `uses ≥ 10` 且 `good / uses ≥ 0.6` | `score += 0.05`（上限 1），优先保留 |
| 总数超上限 | `active` 保留最多 120 条，`candidate` 最多 300 条；超出按 `score` 从低到高淘汰，`manual` 不淘汰 |
| 重复合并 | 同 `dedupeKey` 的候选合并：`hits += 1`、`lastSeenAt = now`，保留最早的 `createdAt` |
| 敏感/隐私 | 立即 `rejected`，不参与任何统计 |

**一句话**：`candidate` 是「观察」，`active` 是「可用」，`retired/rejected` 是「留档但不注入」。永远不要让模型自己把 candidate 直接改成 active。

### 5.5 与 persona / human / memory 的边界

| 块 | 存什么 | 不存什么 |
|---|---|---|
| `persona` | agent 的身份、风格、价值观、边界、说话示例 | 用户事实、项目进度、临时情绪 |
| `human` | 用户 3–5 条「始终需要知道」的稳定事实/偏好 | 聊天摘要、一次性状态、AI 对用户的推测 |
| `memory` | 发生过什么、事实、偏好、任务、主题 | 人格设定、表达风格 |
| `expression` | 「怎么说话」的可复用句式（从用户消息学） | 用户隐私原文、事实知识、人格价值观 |

**优先级**：安全/权限 > `persona.boundaries` > `persona` 风格 > `human` 偏好 > `expression` 句式 > 普通 memory。expression 永远不能覆盖 persona 的边界。

---

## 6. 竞品 persona 设计对比

| 产品/项目 | 人格是「一段文字」还是「结构化字段」 | 具体结构 | 版本管理 | 漂移控制 |
|---|---|---|---|---|
| **OpenHanako** | **文本为主，打包层结构化** | `identity.md`（几行身份速写）+ `AGENTS.md`（人格主文件：性格、说话方式、原则）+ `AGENTS.public.md`（对外人格）；角色卡 `card.json` 的 `prompts.identity/agents/publicAgents` 存全文；`schemaVersion: 1`、`agent.name`、`agent.yuan`（hanako/butter/ming/kong）、`assets`、`skills` | 只有 `schemaVersion`（包格式版本）；**没有内容版本/历史** | 四级回落（Agent 目录 AGENTS.md → 语言模板 → 通用模板 → 示例兜底）；`AGENTS.public.md` 隔离对外人格；**没有自动漂移检测** |
| **Personal OS**（[waynevianzhang-bit/personal-os](https://github.com/waynevianzhang-bit/personal-os)） | **结构化数值** | SQLite `personality_traits`：`trait` ∈ `formality/verbosity/humor/directness/analytical`，`score` 0–1，`evidence_count`，`updated_at`；`build_system_prompt` 按 >0.7/<0.3 生成风格句 | 无内容版本；只有 `updated_at`/`evidence_count`；`reset_traits` 可重置 0.5 | LLM 从最近 50 条对话打分更新；没有 diff/历史/审计；**弱** |
| **千雪 Qianxue**（[Stevehim0/Qianxue](https://github.com/Stevehim0/Qianxue)） | **文本 + 嵌入 YAML 的混合** | `identity.md` 三层：`## 不变层`（硬约束）、`## 稳定层`（行为模式）、`## 可塑层`（`<!-- MALLEABLE_START -->` 内嵌 YAML：style.tone/speech、preferences.topics/interaction、emotional.baseline/expression）；`Identity` dataclass 拆成 `invariant_text/stable_text/malleable_yaml/malleable_data` | 无版本号；`IdentityLoader.update_malleable()` 直接重写文件并 reload；无历史 | **结构性控制最强**：不变层不可被梦境改，只有可塑层可由 `dream_malleable_task` 改写；`core_routes.py` 提供 `/api/core/malleable` 更新；但没有审计/回滚 |
| **MaiBot** | **结构化字符串字段** | `maibot.personality` v1：`name/personality/behavior_style/reply_style/group_chat_prompt/private_chat_prompts` + `multiple_reply_style[]/multiple_probability`；`[personality]` 运行时读 `personality/behavior_style/reply_style/multiple_*` | `version: 1` 只是**导入格式版本**；多套人设库可切换；无内容版本 | 切换人设即漂移来源；无 diff/历史/自动检测；`multiple_probability` 是刻意的随机换风格（不是漂移） |
| **Character Card V2** | 结构化 JSON | `data` 下 15 个字段；`character_version` 只是展示字符串 | `spec_version: "2.0"` 是格式版本；`character_version` 无强制语义 | 无；`extensions` 可放第三方数据但没有标准 |

**结论**：
- 产品界主流是「一段/几段文本」或「5 个数值 trait」，**没有一家把版本管理和漂移检测做成产品能力**。
- 千雪的结构最接近我们的思路（不变层/稳定层/可塑层），但没有审计历史；我们的 `revision + history + 风格指纹` 是差异化。
- OpenHanako 的「对外人格单独一份」值得抄：我们可预留 `persona.publicValue`（可选，默认空），用于对外/陌生会话。

---

## 7. 落地清单（给实现用）

| 项 | 内容 | 验收 |
|---|---|---|
| `src/persona.ts` | `PersonaStore`：load/flush/get/update/propose/confirm/history/render；用 `JsonStateStore` + `resolveDataFile('cognition-persona.json')` | 单测 12 条：schema、limit、边界只读、history、diff、LCS 保护 |
| `src/persona_render.ts` | `renderPersona(persona): string`，输出 `<persona chars="...">` + `<human chars="...">` | 空块不输出；超限抛错 |
| `src/style_fingerprint.ts` | 第 4 节 JS 的 TS 版本；`extractStyle` / `styleDistance` / `styleSimilarity` / `topStyleDiffs` | 用 20 条真实回复跑出基线；单测覆盖空文本、纯代码、纯 emoji、超短文本 |
| `src/expression_store.ts` | expression JSON 读写；candidate/active/rejected/retired 状态机；去重/衰减/上限 | 单测：合并、淘汰、scope、隐私过滤 |
| `src/index.ts` | `systemPrompt.section({ name:'cognition-engine-persona', order:100, text })`；工具 `cognition_persona`（read/propose） | 注入顺序在 memory（900）之前 |
| `client.js` | 设置页两个编辑框（persona/human）+ 字符计数 + 历史 diff + 重置 | 刷新可见；超限阻止保存 |
| `docs/persona-format-and-style-metrics.md` | 本文件 | README 文档索引加一行 |

**不做**：自动从聊天提取 persona 并直接生效；自动修改 human；自动把 expression 从 candidate 升 active；自动执行带副作用的外部操作。

---

## 8. 参考链接

- Character Card V2 规范：[spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)、[spec_v1.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v1.md)
- SillyTavern 角色设计：[Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)
- SillyTavern Prompt 结构：[Prompts](https://docs.sillytavern.app/usage/prompts/)
- Character Card V1/V2/V3 对比：[Character Card Converter](https://charactercardconverter.com/guides/character-card-v1-v2-v3-differences.html)、[LoreWeaver](https://www.loreweaverai.com/guides/character-cards-explained)
- MaiBot 文档：[人设库与导入](https://docs.maibot.chat/manual/personality)、[Bot 配置](https://docs.maibot.chat/manual/configuration/bot-config)
- MaiBot 源码：[expression_learner.py](https://github.com/Mai-with-u/MaiBot/blob/main/src/learners/expression_learner.py)、[expression_data_model.py](https://github.com/Mai-with-u/MaiBot/blob/main/src/common/data_models/expression_data_model.py)、[maisaka_expression_selector.py](https://github.com/Mai-with-u/MaiBot/blob/main/src/chat/replyer/maisaka_expression_selector.py)、[reply_likelihood.py](https://github.com/Mai-with-u/MaiBot/blob/main/src/maisaka/turn_trigger/reply_likelihood.py)、[dynamic_gate.py](https://github.com/Mai-with-u/MaiBot/blob/main/src/maisaka/turn_trigger/dynamic_gate.py)
- MaiBot 人设导入：[docs/personality-import.md](https://github.com/Mai-with-u/MaiBot/blob/main/docs/personality-import.md)
- QQ bot 可控记忆参考文章：[掘金](https://juejin.cn/post/7655701939900694568)
- 中文风格量化博客：[CSDN](https://tushouhao.blog.csdn.net/article/details/168448570)
- 文体风格指纹工具：[TATOOLS](https://tatools.cn/tools/style-fingerprint)
- 中文作者识别：[AushorShipAnalysis](https://github.com/Asuraqi/AushorShipAnalysis)
- 中文计算文体学：[qh · china Stylometry](https://www.qhchina.org/docs/stylometry/)、[vierth/chinese_stylometry](https://github.com/vierth/chinese_stylometry)
- 中文虚词作者识别：[Function Words for Chinese Authorship Attribution](https://lacuna.tiptreesystems.com/work/function-words-for-chinese-authorship-attribution)
- 中文角色扮演评测：[CharacterEval (ACL 2024)](https://aclanthology.org/2024.acl-long.638/)、[GitHub](https://github.com/morecry/CharacterEval)、[arXiv](https://arxiv.org/abs/2401.01275)
- 人格漂移论文：[Measuring and Controlling Persona Drift in Language Model Dialogs](https://arxiv.org/abs/2402.10962)
- OpenHanako：[角色卡打包格式](https://github.com/liliMozi/openhanako/blob/main/skills2set/character-creator/references/card-format.md)、[人格模板](https://github.com/liliMozi/openhanako/blob/main/lib/agents-templates/hanako.md)
- Personal OS：[GitHub](https://github.com/waynevianzhang-bit/personal-os)、[中文 README](https://github.com/waynevianzhang-bit/personal-os/blob/master/README.zh-CN.md)、[personality_engine.py](https://github.com/waynevianzhang-bit/personal-os/blob/master/backend/services/personality_engine.py)
- 千雪 Qianxue：[GitHub](https://github.com/Stevehim0/Qianxue)、[identity.md](https://github.com/Stevehim0/Qianxue/blob/feat/streaming-architecture/backend/services/core/identity.md)、[loader.py](https://github.com/Stevehim0/Qianxue/blob/feat/streaming-architecture/backend/services/core/loader.py)
