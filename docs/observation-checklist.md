# 观察期清单（2026-11-05 起）

> 状态：v0.11.0 是已发版最后一个版本；S1（反馈回路）+ S2（事件日志）已实现并**已在真实环境挂载**，
> 但**未发版**，等真实使用几天再发 0.12.0。
> 用途：用户使用期间按这份清单对齐；用户提意见时先查这里。
>
> **端口会变**：下面的命令示例写的是 3111，实际每次启动可能不同（2026-11-06 是 5799）。
> 以当前运行时给的主界面 URL 为准，替换 `http://127.0.0.1:<端口>` 即可。

---

## 一、当前已完成

| 阶段 | 内容 | 状态 |
|---|---|---|
| **S1** | 真实反馈回路（注入快照 + 纠正/确认识别 + 自动打标） | ✅ 已实现，**v2 重做**（见下） |
| **S2** | 准则事件日志（8 种事件，轻量事件溯源） | ✅ 已实现 |
| **S3** | 轻人格块（persona/human 两块 + propose→confirm 闸门 + 预算截断） | ✅ 已实现，**默认关闭**（无人格文件就不占 token）；**设置里有整页 UI** |
| **M1** | 反馈闭环里程碑 | ✅ 达成 |

### 2026-11-06 真实数据核对（S1/S2 冻结验证）

| 检查项 | 实测 | 结论 |
|---|---|---|
| `feedback.tracking` | true | `session/event` 挂载稳定（应用重启后仍在） |
| 注入快照行 | 7 行，`turn` = 7/8/9/10 | 真实轮次号 |
| 每轮行数 | 1–2 行 | 目标达成（v1 是 30 行/分钟） |
| `sessionId` | `session-16ecf9b6-…` | 真实会话 id |
| 面板轮询 | `total` 不涨 | 污染消除 |
| 反馈判定 | 3 轮全 `neutral` | 「继续 继续」不该算确认，**误判率 0** |
| 记忆 | 12 → 13（新增「单据照片排版」） | 有活干会记，不是空转 |

### 2026-11-05 的重要修正

v1 的注入快照写错了地方：记录点放在渲染函数里，而渲染函数被**面板每 2 秒轮询**调用一次，
88 分钟写了 2432 行，轮次号变成轮询计数器 —— 度量被污染，归因链断裂。

v2 改成只由宿主的 `session/event`（`turn/start` / `user/message` / `turn/end`）驱动：
**一轮 1 行**，带真实轮次号、真实会话 id，子代理排除在外。
细节见 `upgrade-plan-v3.md` §2.5。

**当前进程已挂载成功**（`feedback.tracking = true`），不需要重启应用。

---

## 二、使用期间要观察的四件事

### 1. 反馈闭环在不在跑（第一优先）

```powershell
Invoke-WebRequest "http://127.0.0.1:3111/cognition-engine/state" -UseBasicParsing |
  ForEach-Object { ($_.Content | ConvertFrom-Json).feedback }
```

| 字段 | 期望 | 异常含义 |
|---|---|---|
| `enabled` | `true` | 配置里被关了 |
| `tracking` | `true` | **false → `session/event` 没挂上**，自动反馈全哑 |
| `total` | 随轮次慢慢涨（一轮 1，有反馈 2） | **每 2 秒涨 → 污染回来了** |
| `legacyRows` | 固定 2574 不再变 | 变了说明还有旧代码在写 v1 行 |
| `corrected` / `confirmed` | 用户真实说「不对」「没错」时才涨 | 不涨 = 正则没匹配上 |

**判定**：`tracking=true` 且 `total` 只随真实轮次增长 → 闭环健康。

### 2. 反馈识别准不准（最重要）

```powershell
Invoke-WebRequest "http://127.0.0.1:3111/cognition-engine/playbook" -UseBasicParsing |
  ForEach-Object { ($_.Content | ConvertFrom-Json).entries } |
  Format-Table id, @{n='好';e={$_.usage.appliedGood}}, @{n='差';e={$_.usage.appliedBad}}
```

```powershell
# 看最近几轮到底判成了什么
Invoke-WebRequest "http://127.0.0.1:3111/cognition-engine/injection/recent?limit=10" -UseBasicParsing |
  ForEach-Object { ($_.Content | ConvertFrom-Json).recent } |
  Format-Table at, sessionId, turn, verdict, feedback
```

| 观察 | 正常 | 异常 |
|---|---|---|
| 计数增长 | 每天几次 | **全 0** → 正则没匹配上 / 事件没来 |
| 误判 | 偶尔 | 说「不对」没记 / 说「好」记成差 |
| 中性被算确认 | —— | 检查 `classifyFeedback` 的整句规则 |

**发版门槛**：`total ≥ 20` 且 `corrected + confirmed ≥ 3` 且人工抽查误判率 < 20%。

### 3. 记忆会不会自动增长

```powershell
Invoke-WebRequest "http://127.0.0.1:3111/cognition-engine/state" -UseBasicParsing |
  ForEach-Object { ($_.Content | ConvertFrom-Json).memory.current }
```

**启动基线：2026-11-05 清掉最后一条测试残留后是 13 行。**
**2026-11-06 复核：`current = 16`（17 行，1 行被取代）**——多出来的 3 条全是真实产出：
「单据照片排版」「11.06 期文档整理」「环境坑」，其中后两条是**另一个并行会话**写进来的。
所以别把「条数变了」直接当噪声：先看 `source` 和 `recordedAt`，agent 写的是真事。

> 已修（2026-11-06）：`conflicts` 原来把已删除条目也算进来（实测 3 条里 2 条是删掉的测试条目），
> 报出一个永远降不下来的数字。现在只统计「未删 / 未取代 / 未归档」的事实，实测 3 → 1。
>
> 未修（先记着，归 S9）：`mem-1-1ce2fa` 的 `supersededBy` 指向已删除的 `mem-4-fdc9fd` ——
> 「取代者没了，被取代者却永久不生效」。正确语义是删掉取代者时被取代者回到 current。

| 结果 | 含义 | 下一步 |
|---|---|---|
| **一直 13 条** | 记忆系统空转（只有 3 个写入入口，全靠主动调） | 做「会话摘要 → 候选提取」 |
| 缓慢增长 | 我会主动记 | 观察即可 |
| 暴涨 | 噪音多 | 先做过滤 |

**我的预判：会是第一种。** 这和「自动聚类四个月零产出」是同一个结构性问题。

### 4. 事件日志是否连续

```powershell
Invoke-WebRequest "http://127.0.0.1:3111/cognition-engine/events" -UseBasicParsing |
  ForEach-Object { ($_.Content | ConvertFrom-Json).stats }
```

`seq` 必须连续无洞；有洞说明写入丢了事件。

### 5. 有没有准则被误降级

`appliedBad ≥ 3 且 > appliedGood` 会退场。如果早期就有准则退场，
说明阈值太严或识别误判 —— 去 `/events?ruleId=xxx` 看是哪几轮判的。

---

## 三、用户提意见时的处理流程

| 用户说的 | 先查什么 |
|---|---|
| 「它没记住 X」 | `memory.current` 条数 + 有没有调过 `cognition_remember` |
| 「准则不对」 | `/events?ruleId=xxx` 看完整生命史 + `usage` 分项 |
| 「反馈没生效」 | 先看 `feedback.tracking` / `total`；再看 `/injection/recent` 的 `feedback` 字段 |
| 「它变啰嗦了/变了」 | S4 风格指纹（还没做，先靠主观） |
| 「面板数字不对」 | `legacyRows` 是否在解释差异（旧行是按设计不认的） |

---

## 四、下一步（按 upgrade-plan-v3.md）

| 顺序 | 阶段 | 状态 |
|---|---|---|
| 1 | **S3 Persona 块** | ✅ 已实现（默认关闭，等你要用时再开） |
| 2 | **S4 风格指纹** | ✅ 已实现（只落统计量、不落原文；样本不足会明说） |
| 3 | S5 CPE 回归闸门 | ✅ 设计已定（含 CPE 实证数字），待实现 |
| 4 | S6 学习预算 + shadow | 待做 |

**风格审计怎么用**：`GET /cognition-engine/style` 看 `sample.turns` 与 `comparison.status`。
样本没到 60 轮 / 6000 字之前它只会回 `insufficient` —— 这不是坏了，是拒绝给假分数。
等样本够了先 `POST /cognition-engine/style/baseline` 冻结基线，之后才谈「有没有漂」。

**要用人格块**：打开 **设置 → 人格**（`settings.section`，id `cognition-persona`）。
页面上能编辑人格与用户画像、创建/保存/撤销、确认 agent 提案、预览实际注入内容。
也可以走接口：
`POST /cognition-engine/persona/create?persona=...&human=...`（首次）、
`POST /persona/propose?label=persona&value=...` + `POST /persona/confirm?id=...`、
`POST /persona/undo`；`GET /persona` 看渲染结果，`GET /state` 的 `persona.chars` 是实际注入字符数。

**建议**：先观察 2–3 天。如果记忆条数确实不涨，**「会话摘要 → 候选提取」的优先级应该高于 S3**——
因为那是「记得住」的地基，而 S3 是「说得像」。

---

## 五、发版检查清单（等观察期结束）

按 `ctxt-00001` 六步：

1. 卸载验证（含新增的 `cognition-injection.jsonl` / `cognition-playbook-events.jsonl`；
   注意：这两个文件是**日志**，不是用户数据，可以安全删；`cognition-*.json` 绝不能删）
2. 兼容性检查（`feedback.tracking` 在不同宿主版本上是否都为 true）
3. 代码优化（`legacyRows` 长期存在时考虑给注入日志加轮转）
4. README 覆盖检查（S1/S2 的新能力要写进去）
5. 真实入口验证（面板点一遍 + 真调一次工具 + 看 `feedback.total` 涨）
6. 发布（`--registry=https://registry.npmjs.org`）

**版本**：0.12.0（新增功能 + 一个真实 bug 修复，不是纯文档）。
