# 认知引擎升级方案 v3.0 — 从「记忆插件」到「可审计的长期搭档」

> 2026-11-05
> 基于今晚 34 份研究文档（8701 行）综合而成。
> 现状：v0.11.0，记忆 11 条 / 主题 3 个 / 准则 5 条 / 待办 2 条。
> 本方案是**执行文档**：每一阶段都有明确的输入、输出、验收标准，可以按顺序单步推进。

---

## 〇、一页纸总览

### 我们最终要做成的样子

> **一个记得住、说得像、不添乱、能自证的长期搭档。**
>
> 关键不是「更会学」，是**学得可审计**——在 2026 年自我进化普遍会「能力侵蚀」的背景下，**稳本身就是差异化**。

### 四个支柱

| 支柱 | 对应研究 | 现状 |
|---|---|---|
| **记得准** | 双时态 + BM25 + NegEx + 证据链 | ✅ 已有，缺真实反馈 |
| **说得像** | Persona 三层 + 风格指纹 + 语域分桶 | ❌ 没有 |
| **不添乱** | 主动闸门 + 学习预算 + shadow | ⚠️ 有闸门没接火 |
| **能自证** | 事件日志 + CPE 回归 + 分维度审计 | ⚠️ 有审计但太薄 |

### 十个阶段（建议顺序）

| 阶段 | 内容 | 成本 | 累计 |
|---|---|---|---|
| **S1** | 真实反馈回路 | 0.5 天 | 0.5 |
| **S2** | 准则事件日志（轻量事件溯源） | 1 天 | 1.5 |
| **S3** | Persona 块（人格 + 用户画像） | 2–3 天 | 4.5 |
| **S4** | 风格指纹 + 语域分桶 | 1–2 天 | 6.5 |
| **S5** | CPE 回归闸门 | 1–2 天 | 8.5 |
| **S6** | 学习预算 + shadow | 1–2 天 | 10.5 |
| **S7** | 主动闸门接火（record-only） | 3–5 天 | 15 |
| **S8** | 检索度量 + 真实标注 | 3–5 天 | 20 |
| **S9** | 分维度审计报告 | 3–5 天 | 25 |
| **S10** | Ticket 化任务 | 1–2 周 | 32+ |

**前六个阶段（约 10 天）是核心，做完就能「用起来」。**

---

## 一、为什么是这十个阶段

### 1.1 三个约束决定路径

| 约束 | 影响 |
|---|---|
| **零依赖 / 纯 JSON** | 排除 Letta / Mem0 / Zep / 向量库 / 图数据库；排除 GRPO / 微调 |
| **单机个人使用** | 排除多 Agent 编排、A2A、分布式共识；CRDT 只做 LWW 级别 |
| **还在 0.11.0** | 排除完整事件溯源（MS 明确说原型不适合）；排除大规模重构 |

### 1.2 一个核心判断

> **2026 年自我进化领域最大的发现是「能力侵蚀」（CPE，arXiv 2605.09315）：**
> 适应新任务会**逐步侵蚀旧能力**，workflow / skill / model / memory 四条通道都会。
>
> 别人追求「越学越强」，**我们追求「越学越稳」**——这是唯一在零依赖前提下能做到、且有论文支撑的差异化。

### 1.3 研究结论如何映射到阶段

| 研究 | 关键结论 | 落在哪 |
|---|---|---|
| **CPE** | 保留风险 `L_<t(R_t) > L_<t(R_{t-1})` 即侵蚀 | **S5 回归闸门** |
| **学习预算** | W=clamp(ceil(N×1%),4,12)，5 条停止信号 | **S6** |
| **Anchor** | 问卷与行为不一致；用户状态回忆接近随机 | **S9 分维度审计** |
| **Persona 三层** | core/mutable 分离；语域分桶 | **S3 + S4** |
| **事件溯源** | 先写事件别改存储 | **S2** |
| **SEAgent** | 逐步评估（正/负）而非总分 | **S1** |
| **PATH-Bench** | 加了记忆可能变差（负 FGT） | **S5 + S9** |
| **MaiBot turn_trigger** | 逻辑回归 + 1 小时滑窗 | **S7** |
| **Memobase** | profile_delta 必填 | **S3** |
| **Agent Skills** | SKILL.md 三级披露 | **S10**（可选） |

---

## 二、S1：真实反馈回路（0.5 天）

### 2.1 为什么先做这个

**现在整个「学习」链条是断的**：

```
模型使用准则 → 没人记录用得对不对 → 蒸馏时模型自己评自己
```

`appliedGood` / `appliedBad` 字段早就有了，但**没有自动来源**，我手动打的那两个值是假的。

> **这是「自我学习」从 0 到 1 的开关。不做这个，后面所有阶段都是空转。**

### 2.2 具体做法

**记录每轮注入了哪些准则**（注入时已经知道，只需存一份快照）：

```json
// cognition-injection.jsonl（追加型，一轮一行）
{"at":1793790459061,"sessionId":"s1","turn":3,"ruleIds":["ctxt-00001","ctxt-00005"],"chars":563}
```

**用户反应 → 归因 → 打标**：

| 用户反应 | 判定 | 动作 |
|---|---|---|
| 明确纠正（「不对」「错了」「不是这样」） | 上一轮注入的准则可能错 | 全部 `appliedBad +1` |
| 明确确认（「对」「就是这样」「没错」） | 上一轮注入的准则有效 | 全部 `appliedGood +1` |
| 没反应 / 继续新话题 | 中性 | 不动作 |

**关键：单次纠正不降级**（ReasoningBank 的噪声结论：判官只有 72.7% 准确）。
累计 `appliedBad ≥ 3` 且 `> appliedGood` 才进入 disputed。

### 2.3 要实现什么

| 项 | 内容 |
|---|---|
| `src/injection_log.ts` | 注入快照的追加写入 + 读取 |
| `src/feedback.ts` | 从用户消息判断「纠正/确认」（规则版，不用 LLM） |
| `playbook.markUsage` 调用点 | 在检测到纠正/确认时批量打标 |
| 路由 | `/injection/recent` 查看最近注入 |

**纠正/确认的规则判定**（纯正则，零成本）：

```ts
const CORRECTION = /^(不对|错了|不是这样|你搞错|重新|重来|不是这个意思)/;
const CONFIRMATION = /^(对|是的|没错|就是这样|可以|好的|继续)/;
```

**为什么不用 LLM 判断**：每轮都调 LLM 成本太高；正则覆盖 80% 场景足够，剩下的靠「用户没说但结果明显错」的其他信号。

### 2.4 验收

- 连续 3 次模拟「用户纠正」，`appliedBad` 正确 +3
- 连续 3 次模拟「用户确认」，`appliedGood` 正确 +3
- 单次纠正后准则**不**降级
- `/injection/recent` 能查到最近 10 轮注入记录

### 2.5 实现复盘（2026-11-05 实测，v0.12.0 修正）

**v1 实现是错的，而且错得很隐蔽。**

第一版把 `injectionLog.record()` 放在 `buildInjectedContext()` 里。这个函数有三个调用点：

1. 系统提示段的 `text()` —— **每个 step** 都拼一次
2. `/cognition-engine/state` 快照 —— **页面面板每 2 秒轮询一次**
3. `/cognition-engine/injected` 路由

实测结果：88 分钟写了 **2432 行**，其中真正的用户轮次只有几十个，其余全是面板轮询。
轮次号因此变成「轮询计数器」（真实轮次 13 → 2444），
「这一轮注入了什么 → 用户怎么反应」的归因链彻底断掉。
只靠单元测试和静态检查发现不了这类问题——它们全都测「函数返回对不对」，
不测「这个函数被调用了多少次」。

**教训**：日志的写入点不能放在「会被 UI 或每个 step 调用」的渲染函数里。
**「算」和「记」必须分开**：渲染保持纯的，记录只发生在有语义的事件边界上。

**v2 的做法**：

| 项 | v1（错） | v2（对） |
|---|---|---|
| 记录触发 | 每次渲染（含面板轮询） | `session/event` 的 `turn/start` / `turn/end` |
| 轮次号 | 自增计数器 | 宿主给的 `turn` |
| 会话 id | 进程启动时间戳（其实是实例 id） | 事件的 `session.id` |
| 用户消息 | 没有来源，只能手动 POST | `user/message` 事件（自动） |
| 子代理 | 无法区分 | `session.header.origin === 'subagent'` + `subagent/start` 名单 |
| 旧数据 | —— | 行内 `v: 2`；没有 `v` 的行读取时跳过，**不删文件** |

**关键事实（实测自 session 日志）**：

```
turn/start → step/start → system/message → user/message ×N → … → turn/end
```

一条用户消息可能被拆成**多个** `user/message` 事件，所以要按轮次累加文本。

**打分方向**：第 T 轮的用户文本，打的是第 **T-1** 轮注入的准则——
「用户纠正」这个动作总是出现在被纠正那一轮之后的下一轮。

**回归护栏**：面板轮询 8 秒后 `feedback.total` 仍为 0（v1 会涨 4 行）。
这个数字现在进了 `/state`，观察期第一件事就是看它是不是 0。

### 2.6 已知边界

- **跨会话没有内建信号**：不重启就只有一个进程，重启后内存槽清空，
  所以每个进程的第一个轮次不参与打分（没有上一轮可比）。
- **同一轮内的中途插话（steering）** 会算到上一轮头上。桌面单人使用下误差可接受。
- **子代理不参与打分**：它们的「用户消息」是父代理的任务说明，不是人的反馈。
- **一个轮次只有一行**：一轮里注入内容若因工具调用而变化，只记最后一次渲染。

---

## 三、S2：准则事件日志（1 天）

### 3.1 定位：**轻量事件溯源，不是完整事件溯源**

研究结论（[research-event-sourcing.md](research-event-sourcing.md)）：
MS 明确说完整事件溯源「原型不适合」「迁移成本高」。所以我们**只写事件，不改存储**。

### 3.2 文件

```
cognition-playbook-events.jsonl   ← 追加型，带意图的审计日志
cognition-playbook.json           ← 主存储（不变）
```

**JSON 还是主存储**，事件流是「更完整的日志」。将来真需要时间旅行，事件已经在了，只差把 JSON 改成派生态。

### 3.3 八种事件

```jsonl
{"seq":1,"v":1,"at":1793790459061,"type":"RuleProposed","ruleId":"ctxt-00001","content":"...","when":"发布版本时","sourceIds":["mem-7"],"origin":"auto","by":"distiller"}
{"seq":2,"v":1,"at":...,"type":"RuleAccepted","ruleId":"ctxt-00001","by":"user"}
{"seq":3,"v":1,"at":...,"type":"RuleUpdated","ruleId":"ctxt-00001","field":"content","before":"...","after":"...","reason":"补充第六步","by":"user"}
{"seq":4,"v":1,"at":...,"type":"RuleEvidenceChanged","ruleId":"ctxt-00001","before":"intact","after":"weakened","staleBecause":["mem-9"],"by":"system"}
{"seq":5,"v":1,"at":...,"type":"RuleUsageRecorded","ruleId":"ctxt-00001","usage":"appliedGood","trace":"用户确认"}
{"seq":6,"v":1,"at":...,"type":"RuleRetired","ruleId":"ctxt-00001","reason":"证据链断裂","by":"system"}
{"seq":7,"v":1,"at":...,"type":"RuleRevived","ruleId":"ctxt-00001","reason":"前提恢复","by":"system"}
{"seq":8,"v":1,"at":...,"type":"RuleRevoked","ruleId":"ctxt-00001","reason":"这条规则本身是错的","by":"user"}
```

### 3.4 六条设计规则（来自 MS 文档的六个坑）

| 规则 | 做法 |
|---|---|
| **捕获意图，不是状态** | `RuleRetired{reason:"证据链断裂"}` 而不是 `StatusChanged{to:"retired"}` |
| **不可变** | 改内容用 `RuleUpdated` 带 before/after，不原地改 |
| **版本演进** | 每条带 `v:1`；将来用 upcasting 转新版 |
| **排序** | `seq` 单调递增 + `at` 双保险 |
| **幂等** | 消费端记 `lastSeq`，重复跳过 |
| **个人数据外置** | 事件只存 `ruleId` + 摘要，**不存记忆原文** |

### 3.5 高频事件的特殊处理

`RuleUsageRecorded` 是高频的（每次使用一条）。对策：

- **不单独写事件**，改成按天聚合：`{"type":"RuleUsageAggregated","date":"2026-11-05","ruleId":"ctxt-00001","appliedGood":2,"appliedBad":0}`
- 每天凌晨（或首次访问）生成一次

### 3.6 验收

- 所有准则变更都产生事件，`seq` 连续无洞
- `replay(events)` 的结果与 `playbook.json` **完全一致**
- 删除 `playbook.json` 后能从事件重建
- `/playbook/history?ruleId=ctxt-00001` 返回完整生命史

---

## 四、S3：Persona 块（2–3 天）

### 4.1 定位：**轻人格，不是角色扮演**

研究结论（[persona-research.md](persona-research.md)）：

- **Assistant Axis**：远离默认助手会漂向戏剧化 → **要轻人格**
- **Anchor 倒 U 形**（Rahman & Desai 2025, N=150）：中等强度的人格表达在 Trust / Likeability / Intention to Adopt 六个维度**优于两端**

### 4.2 文件结构

`~/.dsh/cognition-engine/cognition-persona.json`

```json
{
  "schema": "cognition.persona",
  "version": 1,
  "revision": 1,
  "updatedAt": 1793790459061,
  "budget": { "persona": 600, "human": 500, "total": 1100 },
  "blocks": {
    "persona": {
      "label": "persona",
      "displayName": "小认",
      "limit": 600,
      "readOnly": false,
      "value": "我是小认，一个直接、务实的长期协作助手。\n风格：处理任务时先给结论再给理由；闲聊时短句、少铺垫；不确定时直接说「没把握」。\n价值观：准确优先于讨好；透明优先于拟人；用户自主优先于陪伴感。\n边界：不编造事实；不替用户做不可逆决定；不模拟排他性亲密。",
      "examples": [
        "这件事我查过了，结论是 A。理由有两条：……",
        "这个我没把握，先确认一下再回你。"
      ],
      "traits": { "directness": 0.8, "warmth": 0.5, "verbosity": 0.2, "humor": 0.2, "formality": 0.5 },
      "lockedPhrases": ["不编造事实", "不替用户做不可逆决定", "不模拟排他性亲密"],
      "narrative": {
        "origin": "为长期协作而做的本地认知助手",
        "chapter": "正在把记忆插件做成可审计的长期搭档",
        "continuity": "直接、准确、不替用户做不可逆决定"
      },
      "history": []
    },
    "human": {
      "label": "human",
      "limit": 500,
      "readOnly": false,
      "value": "做文档整理，中文为主；要求先查证再动手；讨厌空话和总结性废话。",
      "slots": {
        "basic_info": { "language": "中文", "timezone": "Asia/Shanghai" },
        "preferences": { "verbosity": "简短", "format": "先结论后理由", "avoid": ["总结性废话"] },
        "work": { "domain": "文档整理", "tools": ["Node", "Word COM"] }
      },
      "history": []
    }
  }
}
```

### 4.3 四条硬规则

| 规则 | 来源 |
|---|---|
| **`traits` 只做审计，不注入**；值用 0.2/0.5/0.8 三档，不写伪精度 | BFI-2 不是文本分类器 |
| **`lockedPhrases` 删除或改写即拒绝保存** | 边界不能被悄悄改 |
| **agent 只能 `propose`，用户 `confirm`**；`human` 块 agent 永远不能直接改 | 防人格被悄悄重写 |
| **`persona.value` 四段式**：身份 1 句 / 风格 3 条 if-then / 价值观 3 条 trade-off / 边界 3 条，总规则 ≤5 | Trait Activation：光写 trait 没用，要写「当 X 时做 Y」 |

### 4.4 注入位置

`systemPrompt.section({ name: 'cognition-engine-persona', order: 100 })`（现有 memory 是 900，所以人格在最前）。

```text
## 人格（稳定，不要违背）
<persona chars="420/600">
...
</persona>
<human chars="180/500">
...
</human>
```

### 4.5 验收

- 注入在最前，字符数不超预算
- `lockedPhrases` 被删 → 保存被拒
- agent 调 `propose` 后，用户没 `confirm` → 不生效
- 改动历史可查（`revision` 自增 + `history`）

### 4.6 实现状态（2026-11-06）

已实现 `src/persona.ts` + 4 个路由 + 4 条测试组（总测试 110 条全绿）。**默认关闭**：
`cognition-persona.json` 不存在时 `render()` 返回空串，注入段不占一个 token。

| 项 | 状态 |
|---|---|
| 文件读取/容错（坏 JSON、缺块都当「无人格」） | ✅ |
| `render()` 注入在最前（order 100 vs 记忆段 900） | ✅ 真机验证：本人系统提示最前面出现过该段 |
| `traits` / `slots` 只做审计、不注入 | ✅ 测试断言「directness」「0.8」不出现在渲染结果里 |
| `lockedPhrases` 被删 → `confirm` 拒绝 | ✅ 真机验证：拒绝并指出缺了哪三条 |
| agent 不能改 `human` 块 | ✅ 真机验证 |
| propose 未 confirm 不生效 | ✅ revision 停在 1，confirm 后 → 2 |
| revision + history 落盘 | ✅ |
| 超预算截断（块 limit + 总量兜底） | ✅ |
| `lint()` 给写作体检警告（不是硬拦） | ✅ 真机验证：报「缺边界段 / 缺 if-then」 |

**未做（留给后续）**：给模型侧注册 `cognition_persona` 工具（现在只有 HTTP 路由），
所以 agent 目前要提人格修改，得由用户手动调 `/persona/propose`。
这是故意的——人格修改本来就该是低频、有人在场的事。

### 4.7 深读后修掉的四处（2026-11-06）

对照 Letta memory blocks / PersonaAgent / Generative Agents 的实现细节复盘
（详见 [persona-memory-deep-read.md](persona-memory-deep-read.md)），
自己实现里查出四个真缺陷：

| 缺陷 | 后果 | 修法 |
|---|---|---|
| schema 里写的是 `facts`/`interactionStyle`，代码读的是 `slots`/`narrative` | 按 schema 写的人格文件，审计信息全部读不到 | 两套都读（都只审计不注入），schema 补齐 `slots`/`narrative`/`parentHash` |
| `history` 只存 hash | **回滚不了**——用户说「刚才那次改坏了」时无从恢复 | 增加 `before` 原文快照 + `undo(hash?)`，可连续回退 |
| `#saveDocument` 用 `catch {}` 静默吞错 | 界面显示改好了、重启发现没了，**最难查的一类失败** | 返回布尔 + `lastSaveError`；落盘失败就回退内存并报错，提案退回待确认 |
| `clip()` 直接按字符截断 | 正文一超预算，尾巴上的「边界：不编造事实…」被整段切掉，**最硬的约束悄悄失效** | 截断后检查 `lockedPhrases`，缺了就压成一行「边界：a；b；c。」补回，正文让位 |

另外补了 `parentHash`（每次改动记上一版内容 hash，串成可回溯的修订链）。

**验证**：测试 110 → 114 条；真机点了一遍
`propose → confirm（revision 2）→ undo（revision 3，内容回到原文）`，
并确认 `traits` / `interactionStyle` / `slots` / `facts` 的 key 全都**没有**出现在注入段里。

**启用方式**：把 `docs/persona/cognition-persona.example.json` 拷到
`~/.dsh/cognition-engine/cognition-persona.json` 即可，无需改配置；
`personaEnabled: false` 可临时关掉注入但保留文件。

---

## 五、S4：风格指纹 + 语域分桶（1–2 天）

### 5.1 定位：**纯代码，0 token，每天可跑**

研究结论（[persona-format-and-style-metrics.md](persona-format-and-style-metrics.md)）：
26 项指标，**核心 8 项**足够。

### 5.2 核心 8 项

| 指标 | 算法 | 目标（示例） |
|---|---|---|
| `meanSentLen` | 按 `。！？` 切分后的平均实字数 | 20–40 |
| `sentLenCv` | 句长变异系数（std/mean） | 0.45–0.85 |
| `shortRatio` | ≤8 字的句子 / 总句数 | 0.1–0.4 |
| `tonePerK` | 语气词（吧呢啊嘛呀啦…）每千字 | 0–30 |
| `firstPersonPerK` | 我/我们/咱 每千字 | 5–25 |
| `punctPer100` | 标点每百字 | 5–15 |
| `emojiPerK` | emoji 每千字 | 0–5 |
| `catchphrasePerK` | 自定义 3–5 个口头禅每千字 | 按人配 |

### 5.3 语域分桶（关键）

**Halliday / Biber 的教训：同一个人在不同语域说话不同，不能跨桶比较。**

| 桶 | 判定 |
|---|---|
| `technical` | 有代码块 / 有文件路径 / 有命令 |
| `emotional` | 有情绪词 / 短句多 / 第一人称多 |
| `casual` | 其余 |

`styleBaseline` 按桶存中位数指纹；**漂移判断只在同桶内做**。

### 5.4 相似度算法（不要用裸欧氏距离）

```ts
// 有界加权距离：语气词 200 vs 0 不会淹没其他维度
d = Σ w_i · min(1, |a_i − b_i| / (scale_i × 3)) / Σ w_i
similarity = 1 − d
```

### 5.5 阈值

| 相似度 | 解释 | 动作 |
|---|---|---|
| ≥0.85 | 同一个人同一天 | 正常 |
| 0.75–0.85 | 同风格轻微波动 | 记录 |
| 0.65–0.75 | 可感知偏移 | 观察；连续 3 个窗口才提示 |
| <0.65 | 明显漂移 | 提示 + 列出差异最大的 3 维 |

### 5.6 验收

- 对 10 条历史回复算出指纹，同桶内相似度 ≥0.75
- 人为把回复改成「正式报告体」，相似度 <0.65 且触发提示
- 技术回答与闲聊**不互相比较**（跨桶不报警）

### 5.7 实现状态（2026-11-06）

已实现 `src/style.ts` + `/style` 与 `/style/baseline` 路由 + 5 组测试（总测试 119 条全绿）。

**一个关键取舍：不落原文，只落统计量。**
风格审计要样本，最直接的做法是把每轮回复原文写盘——但那等于把你的对话内容落到磁盘。
这里选保守路线：原文只在内存里过一遍，写盘的只有 `chars / meanSentLen / sentLenCv /
shortRatio / tonePerK / firstPersonPerK / punctPer100 / emojiPerK / catchphrasePerK` 九个数字。
事后能答「风格变没变」，翻不出「当时说了什么」。要复现原文只能去 session 日志（宿主自己的存储）。
`/style` 返回里显式带 `storesRawText: false`，把这个边界写在接口上而不是只写在文档里。

| 项 | 状态 |
|---|---|
| 核心 9 项指标（纯函数，可单测） | ✅ |
| 语域分桶（technical > emotional > casual） | ✅ 技术信号优先：一句「报错很难受，`ENOENT`」算技术不算情绪 |
| 有界加权距离 + 单项爆炸只影响有限幅度 | ✅ 语气词 5→200 仍落在 0.5–0.95，不会归零 |
| 样本不足一律 `insufficient`，不给假分数 | ✅ 默认门槛 60 轮 / 6000 字，可配 |
| 冻结基线（`POST /style/baseline`） | ✅ 冻结后 `compare.baseline.source = 'frozen'` |
| 跨桶不比较 | ✅ `compare({bucket})` 分桶算 |
| 每轮按 `assistant/message` 累加、`turn/end` 一次性结算 | ✅ 单轮上限 12000 字符，防止超长轮拖歪统计 |

**验证**：真机 `GET /style` 返回
`enabled=true, storesRawText=false, sample.turns=0, comparison.status=insufficient`，
`note` 明确写「样本不足（0 轮 / 0 字，门槛 60 轮 / 6000 字），不做判断」——
**宁可报不知道，也不给一个看起来很像的假分数**。

**还没做**：L2 月度 LLM 审计（20 题四轴 + 10 题轨迹）需要喂真实回复原文，
按上面的取舍它必须显式开启「允许把样本交给模型」才做，留到 S5 之后单独决定。

---

## 六、S5：CPE 回归闸门（1–2 天）⭐核心差异化

### 6.1 为什么这是核心

研究结论（[research-cpe-mechanism.md](research-cpe-mechanism.md)）：

> 论文：`L_<t(R_t) > L_<t(R_{t-1})` 即能力侵蚀，四通道都会发生。
> 解法：`R_t = argmin L_t(R) + λ·Ω(R, R_{t-1})`（软正则）。

**我们的版本：硬闸门**——变更过不了回归集就不许改。

**实证数字**（严格六源核验版，见 [research-self-evolving-papers-6src.md](research-self-evolving-papers-6src.md)；
扩展版见 [research-self-evolving-papers.md](research-self-evolving-papers.md)）：

| 通道 | 论文报告的变化 | 对我们的含义 |
|---|---|---|
| workflow（保留能力） | 简单任务 41.8% → 52.8%（GPT-5.1） | 「保留」是可以量化的，不是玄学 |
| memory（记忆通道） | 83.9 → 81.6 → 83.3 | 记忆类改动**会先掉分再回升**，单点检查必然误判 |
| 四通道 | 均存在能力侵蚀（无免费午餐） | 任何「提升当前任务」的改动都要先过回归集 |

这三条直接决定闸门的形状：

1. **阈值按连续窗口判**，不能只看一次——memory 通道那种 83.9→81.6→83.3 的轨迹，
   单点比会在 81.6 误判成能力侵蚀，把一次正常调整回滚掉。
2. **回归集必须冻结**且永不参与候选生成（`neverUsedForGeneration: true`），
   否则测的是「它记住了测试集」，不是「它没变差」。
3. **阈值不能卡在噪声里**：记忆通道自然波动约 ±2.3pp，`maxDrop` 若设 0.02 就是纯噪声报警；
   当前设 0.10，等回归集扩到 50 条且有真实 baseline 后再收紧。

### 6.2 实现

```json
// cognition-cpe.json
{
  "holdout": {
    "caseIds": ["case-001", "...", "case-050"],
    "frozenAt": 1793790459061,
    "neverUsedForGeneration": true
  },
  "baseline": { "passRate": 0.92, "measuredAt": 1793790459061, "revision": 12 },
  "thresholds": { "maxDrop": 0.10, "minCases": 50 },
  "lastCheck": { "at": 0, "passRate": 0.0, "delta": 0.0, "action": "none" }
}
```

**回归集从哪来**：

- 从历史注入 + 用户确认的对话里抽 50 条「当时判断正确」的案例
- 格式：`{question, expectedRuleIds, note}`
- **冻结，永不用于生成候选**（防污染）

### 6.3 流程

```
任何准则/记忆变更前：
  1. 快照当前状态
  2. 应用变更
  3. 跑 50 条回归
  4. passRate 相对 baseline 下降 > 10%？
     YES → 回滚，记 incident，拒绝变更
     NO  → 接受，用 EMA 更新 baseline
```

### 6.4 与 skill/memory 通道对应的两条规则

| 通道 | 规则 |
|---|---|
| **skill（准则）** | **不允许硬删除**，只能 `retired`；退役前查最近 90 天是否 `appliedGood` 过，有则需人工确认 |
| **memory** | `validTo` 一旦设置，**不能被自动提前**；衰减只影响排序，不影响真值 |

### 6.5 验收

- 人为让一条准则失效（改错内容）→ 回归集通过率下降 → **变更被拒绝并回滚**
- 正常变更（改进措辞）→ 回归集通过 → 接受
- 回归集覆盖率：所有 `topicIds` 都有至少 3 条案例

---

## 七、S6：学习预算 + shadow（1–2 天）

### 7.1 预算

```
W = clamp(ceil(N × 1%), 4, 12)     N = 当前 active 准则数
默认 8 = 修旧 5 + 学新 2 + 预留 1
```

```json
// cognition-budget.json
{
  "week": "2026-W45",
  "quota": { "total": 8, "revise": 5, "new": 2, "reserve": 1 },
  "used": { "total": 0, "revise": 0, "new": 0 },
  "debt": 0,
  "paused": false,
  "pauseReason": null
}
```

### 7.2 五条停止信号

| 信号 | 判据 | 动作 |
|---|---|---|
| 学而无用 | 近 3 周新准则零命中 | 暂停学新 1 周 |
| 学了还错 | 近 2 周有负反馈却未修正 | 暂停学新 1 周 |
| 越学越挤 | `N > 400` 或 `orphaned > 20%` | 只许修旧 |
| 反复翻烙饼 | 同 subject 30 天 supersede ≥ 3 | 该 subject 冻结学习 |
| 预算空转 | 连续 2 周学新额 ≤ 25% | 降到 4 |

### 7.3 shadow 试运行

```json
// cognition-shadow.json
{
  "entries": [{
    "id": "sh-0007",
    "subject": "npm发布",
    "text": "...",
    "source": "user-correction",
    "createdAt": 1793790459061,
    "expiresAt": 1795604859061,
    "occurrences": 2, "hits": 1, "helpful": 1, "harmful": 0,
    "verdict": null
  }]
}
```

- 新准则先进 `shadow`，**进检索但降权 ×0.5**，不进系统提示
- 转正：命中 ≥3 且 `helpful ≥ harmful`
- 21 天零命中 → `expired`

### 7.4 八类不学清单

| # | 不学 | 理由 |
|---|---|---|
| 1 | 一次性事实（带具体日期/编号/单次路径） | 属于会话记忆，不是准则 |
| 2 | 与环境绑定（路径/机器/账号/版本号） | 易变 |
| 3 | 与已有准则矛盾但证据平手 | 挂 pending 等裁决 |
| 4 | 同一轮内先纠正又收回 | 用户口误 |
| 5 | 超过粒度（>60 字或多动作） | 无法执行 |
| 6 | 无 user 来源（agent 自己推测） | 无依据 |
| 7 | 已被 supersede 的主题（30 天 ≥3 次） | 翻烙饼 |
| 8 | 含 token / 密码 / 内网地址 | 安全 |

### 7.5 验收

- 注入 50 条跨周纠正，任一周 `used.total ≤ quota.total`
- 新准则 7 天内必为 `shadow`
- 构造「3 周零命中」→ `paused = true`
- 8 类不学各造 2 例，`rejected.jsonl` 命中率 100%

---

## 八、S7：主动闸门接火（3–5 天）

### 8.1 现状

`src/proactive.ts` 已有 `ProactiveGate`，默认 `recordOnly = true`，但**没接火**——没有触发源、没有调度。

### 8.2 借 MaiBot 的 `turn_trigger`（逻辑回归）

```text
logit = -1.2005
      + 1.5852 × mention_bot
      - 1.1157 × at_other
      + 0.4807 × has_question_mark
      - 1.0281 × placeholder_only
      + 2.6525 × recent_self_ratio
      - 0.0367 × recent_message_count
      + 0.0571 × log1p(seconds_since_bot_message)
      + 0.1012 × min(20, pending_count)
```

**但我们的场景不是群聊**，需要重新设计信号：

| 信号 | 含义 |
|---|---|
| `pendingTasks` | 有待办到期 |
| `unresolvedGaps` | 有未解决缺口 |
| `brokenEvidence` | 有证据链断裂 |
| `expiredRules` | 有过期准则 |
| `silenceMs` | 距离上次交互时间 |

### 8.3 三阶段

| 阶段 | 行为 |
|---|---|
| **P1 record-only** | 只记录「本来会做什么」到面板，**零主动消息** |
| **P2 用户规则** | 用户写了「每天 9 点提醒」才发 |
| **P3 学习后放开** | 采纳率 ≥70% 后才允许自主判断 |

### 8.4 验收

- 面板能看到 `wouldDo` 列表
- 一周内零主动消息（除非有规则）
- 每条 `wouldDo` 能回答「用户需要做什么/能得到什么」

---

## 九、S8：检索度量（3–5 天）

### 9.1 为什么

BM25 研究的最后一条建议：

> **先用最近 100 次真实召回日志人工标 top-3——这一步比报告里所有建议都值钱。**

我们三轮基准全是合成的。

### 9.2 做法

1. 记录每次 `cognition_recall` 的：查询、返回的 top-3、用户是否采纳
2. 人工标 50–100 条「应该命中什么」
3. 产出：Top-1 / Top-3 准确率基线、误召回 Top-10

### 9.3 验收

- 有一张真实的「查询 → 应该命中什么」的表
- 基线数据：Top-1 ≥80%、Top-3 ≥95%（Anchor 的轨迹准确率才 44.4%，我们目标已经很高）

---

## 十、S9：分维度审计（3–5 天）

### 10.1 借 Anchor 的三轴

| 轴 | 问什么 | 怎么做 |
|---|---|---|
| **Persona enactment** | 还是那个「我」吗？ | 20 题场景 + 三级评分 |
| **Trajectory recall** | 记得共同经历吗？ | 10 题反事实（4 用户状态 + 3 承诺 + 3 时间顺序） |
| **Style drift** | 说话风格变了吗？ | 8 维指纹（S4） |

**不要合成单一总分**（Anchor 明确反对）。

### 10.2 频率

| 项 | 频率 | 成本 |
|---|---|---|
| 风格指纹 | 每天 | 0 token |
| 月度审计 | 每月 1 次 | 1 次 LLM 调用（20 题） |
| 能力回归 | 每次变更 | 0 token（S5 已覆盖） |

### 10.3 验收

- 月报能回答「这个月它有没有变傻/变漂」
- 每个维度独立报告，标注 evaluator

---

## 十一、S10：Ticket 化任务（1–2 周，可选）

### 11.1 借 Super-agent 的 Ticket 状态机

现在 `tasks.json` 是「待办列表」，升级成「工单」：

```json
{
  "id": "task-1",
  "stage": "working",
  "waitingFor": null,
  "lastReport": "...",
  "mandate": "user-named",
  "source": "user",
  "stageHistory": [...]
}
```

**五个新字段解释「为什么这条任务停在这里」**。

### 11.2 注意

Super-agent 的 P50 12.4 分钟 / P95 15.7 分钟**不是 SLA**——官方实验基于约 300 条合成消息，原文明确「不衡量单个任务的实际执行能力」。

**我们不抄 Worker 无审批执行**——它自己承认「目录/命令包装不是安全边界」。

---

## 十二、数据布局（最终形态）

```
~/.dsh/cognition-engine/
  cognition-state.json              记忆（双时态）
  cognition-playbook.json           准则（主存储）
  cognition-playbook-events.jsonl   准则事件（S2 新增）
  cognition-topics.json             主题
  cognition-persona.json            Persona（S3 新增）
  cognition-profile.json            用户画像（S3 新增）
  cognition-profile-events.jsonl    画像变更（S3 新增）
  cognition-injection.jsonl         注入快照（S1 新增）
  cognition-shadow.json             shadow 候选（S6 新增）
  cognition-budget.json             学习预算（S6 新增）
  cognition-cpe.json                回归集（S5 新增）
  cognition-gaps.json               缺口
  cognition-audit.jsonl             审计（现有）
  tasks.json                        待办
```

**全部 UTF-8 JSON/JSONL，零外部依赖。**

---

## 十三、风险与对策

| 风险 | 对策 |
|---|---|
| **学得太多太杂** | S6 学习预算 + 8 类不学清单 |
| **越学越傻（能力侵蚀）** | S5 回归闸门（核心） |
| **人格漂移** | S4 风格指纹 + 锁短语 + 只能 propose |
| **过度拟人 / 情感依赖** | 轻人格 + 诚实边界 + 不模拟排他性亲密 |
| **事件日志泄露隐私** | 事件只存 ruleId，不存记忆原文 |
| **主动消息刷屏** | S7 三阶段（record-only 起步） |
| **研究过度、迟迟不落地** | 本方案：**每阶段独立可验收，做完就能用** |

---

## 十四、里程碑

| 里程碑 | 包含 | 能做什么 |
|---|---|---|
| **M1 反馈闭环** | S1 + S2 | 准则有真实数据 + 完整生命史 |
| **M2 有人格** | S3 + S4 | 说话像一个人，且能测漂移 |
| **M3 学得稳** | S5 + S6 | 学习不会变傻，有预算控制 |
| **M4 能主动** | S7 | 能提醒，但不刷屏 |
| **M5 能自证** | S8 + S9 | 能用数据回答「它变好没有」 |

**M1–M3（约 8 天）是核心。**

---

## 十五、不做清单（重要）

| 不做 | 理由 |
|---|---|
| **GRPO / RL 训练 / 微调** | 需要 GPU + 训练管线；零依赖插件做不到 |
| **完整事件溯源** | MS 明确说原型不适合；我们只做事件日志 |
| **多 Agent 编排框架** | LangGraph / CrewAI / AutoGen 都是「编排」不是「学习」 |
| **外部记忆服务 / 向量库 / 图数据库** | 破坏零依赖和可审计性 |
| **无审批自主执行** | Super-agent 自己承认安全模型弱 |
| **自动造工具 / 自动改代码** | L3 风险 > 收益 |
| **完整 BFI-2 / PVQ 问卷** | 60 题 / 57 题太重 |
| **OCC 22 情绪 / PAD 连续状态** | 表演成分大，收益不明 |
| **NPC 戏剧冲突设计** | 与「可靠」目标冲突 |
| **全自动人格演化** | Layered Mutability 的 hysteresis 0.68：回退 prompt ≠ 回退行为 |

---

## 十六、研究支撑一览

| 结论 | 来源 | 文档 |
|---|---|---|
| 能力侵蚀 + CPE | arXiv 2605.09315 | research-cpe-mechanism.md |
| 学习预算 | 子代理设计 + 理论 | research-learning-budget.md |
| Persona 三层 | Anchor / Letta / McAdams | persona-research.md |
| 风格指纹 26 项 | 文体计量学 | persona-format-and-style-metrics.md |
| 语域分桶 | Halliday / Biber | persona-cross-disciplinary.md |
| 事件溯源 | Fowler 2005 + MS | research-event-sourcing.md |
| 逐步评估 | SEAgent | research-self-evolving-papers.md |
| 主动闸门 | MaiBot turn_trigger | research-humanlike-agents-and-autonomy.md |
| 分维度审计 | Anchor | research-persona-memory-landscape.md |
| 19 项目选型 | 项目组精读 | research-agent-projects-deep-read.md |
| 7 条设计准则 | 28 条理论 | research-learning-theory-deep-read.md |

---

## 十七、一句话

> **研究阶段的结论：2026 年所有人都在追「越学越强」，但论文自己承认它会「越学越忘」。**
>
> **我们的位置：零依赖、可审计、越学越稳。**
>
> 十个阶段，前六个约 10 天，每个都能独立验收。
> **从 S1 开始——接上反馈回路，让「学习」第一次有真实数据。**
