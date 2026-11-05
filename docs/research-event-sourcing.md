# 事件溯源（Event Sourcing）深挖

> 2026-11-05
> 目的：判断这个结构值不值得用进认知引擎，怎么用，风险在哪。
> 结论前置：**值得，但只能用在「准则本」一条线上，不能全盘改造。**

---

## 一、它到底是什么

### 1.1 一句话

> **不存「当前状态」，只存「发生了什么」；当前状态 = 重放事件。**

Martin Fowler（2005）的原始定义：

> Event Sourcing ensures that all changes to application state are stored as a sequence of events.
> Not just can we query these events, we can also use the event log to **reconstruct past states**,
> and as a foundation to **automatically adjust the state to cope with retroactive changes**.

### 1.2 与 CRUD 的根本差别

| | CRUD | Event Sourcing |
|---|---|---|
| 存什么 | 最新状态 | 全部事件 |
| 历史 | 丢了（除非另写日志） | **天然存在** |
| 改错 | 直接改 | **追加补偿事件**（原事件保留） |
| 时间点查询 | 做不到 | **可以回到任意时刻** |
| 写冲突 | 行锁 | **乐观并发（版本号）+ 追加** |

### 1.3 三个关键能力（Fowler 原文点名）

| 能力 | 含义 |
|---|---|
| **Complete Rebuild** | 丢掉应用状态，从事件日志重跑，重建全部 |
| **Temporal Query** | 确定「任意时间点」的应用状态；甚至可以有多条时间线（类似版本控制的分支） |
| **Event Replay** | 发现某个历史事件是错的 → 反转它和它之后的事件 → 重放新事件 |

### 1.4 核心概念

| 概念 | 含义 |
|---|---|
| **Event** | 不可变的、描述「发生了什么」的对象，带**业务意图** |
| **Event Stream** | 每个实体一条有序事件流 |
| **Rehydration** | 从空白状态重放事件流，恢复当前状态 |
| **Snapshot** | 定期保存的状态快照，加速 rehydration（**不是**事件流的替代） |
| **Projection / Materialized View** | 为查询优化的只读视图 |
| **Compensating Event** | 补偿事件：反转某个事件，**原事件永不修改** |
| **Upcasting** | 反序列化时把旧 schema 转成新 schema |

---

## 二、Microsoft 官方文档的警告（非常重要）

Azure Architecture Center 在 `event-sourcing` 页开头就写：

> **Event sourcing is a complex pattern that introduces significant trade-offs.**
> It changes how you store data, handle concurrency, evolve schemas, and query state.
> **It's costly to migrate to or from an event sourcing solution**, and after you adopt the pattern,
> it constrains future design decisions.
> **For most systems and most parts of a system, traditional data management is sufficient.**

**不该用的场景**（原文）：

- 简单的 CRUD，不需要审计、重放、历史重建
- 原型 / MVP / 短生命周期系统
- 需要**强一致性和实时视图**
- 数据基本静态（查找表、目录）
- 团队没有事件驱动架构经验

**该用的场景**（原文第一条）：

> You want to **capture intent, purpose, or reason** in the data.

---

## 三、我们的具体分析

### 3.1 我们现在是什么

```
cognition-state.json      记忆（双时态，带 supersedes）
cognition-playbook.json   准则（带 history 字段，但只存了部分变更）
cognition-topics.json     主题
tasks.json                待办
audit.jsonl               审计（追加型，但只记操作名，不记完整状态变化）
```

**混合模式**：
- 记忆和准则：**近似 CRUD + 部分历史**
- audit：**近似事件日志**，但内容太薄（只记 op 名，不记 before/after 全量）

### 3.2 对照 MS 的「该用」标准

| 标准 | 我们符合吗 |
|---|---|
| **想捕获意图、目的、原因** | ✅ **强烈符合** —— 准则本最需要回答「这条为什么存在、为什么改了」 |
| 最小化/避免冲突更新 | ⚠️ 单机为主，冲突不严重 |
| 需要重放、回滚、审计 | ✅ **符合** —— 已经有 audit，但太薄 |
| 应用本身就以事件为核心 | ✅ 准则变更、记忆写入本来都是事件 |
| 需要解耦写入与应用 | ❌ 不需要 |

### 3.3 对照 MS 的「不该用」标准

| 标准 | 我们符合吗 |
|---|---|
| 简单 CRUD 不需要审计 | ❌ 不符合（我们恰恰需要审计） |
| 原型/MVP/短命 | ⚠️ **部分符合** —— 插件还在早期 |
| 需要强一致实时视图 | ⚠️ 面板每 2 秒轮询，**最终一致可接受** |
| 数据基本静态 | ❌ 不符合 |
| 团队没经验 | ⚠️ **符合** —— 这是真实风险 |

---

## 四、结论：**只对准则本用，不全盘改造**

### 4.1 为什么不全盘

三个理由：

1. **工程成本**：MS 说「migrate to 或 from 都很贵」。我们现在 5 个 JSON 文件都能跑，全改成事件源要重写存储层 + 所有读取路径。
2. **规模不匹配**：事件溯源解决的是「高并发写 + 完整审计 + 时间旅行」，我们只有 11 条记忆、5 条准则。
3. **收益递减**：记忆本身已经是双时态，**历史已经保住了**；真正缺历史的是**准则**和**用户画像**。

### 4.2 为什么准则本该用

准则本有四个特征，正好是事件溯源的主场：

| 特征 | 说明 |
|---|---|
| **需要回答「为什么」** | 这条准则从哪条记忆蒸馏来的？为什么改过三次？ |
| **变更是低频但重要的** | 5 条准则，几个月才改几次——事件量极小 |
| **需要回滚** | 改错了要能退回去 |
| **需要审计** | 谁改的、什么时候、依据是什么 |

而记忆不需要：双时态已经给了「什么时候为真」，再加事件流是重复。

### 4.3 最小可行设计

#### 文件

```
cognition-playbook-events.jsonl    ← 追加型，唯一真相
cognition-playbook.json           ← 派生的当前状态（可随时重建，也可删）
cognition-playbook.snapshot.json  ← 快照（每 N 条事件）
```

#### 事件类型（只设 8 种）

```jsonl
{"seq":1,"at":1793790459061,"type":"RuleProposed","ruleId":"ctxt-00001","content":"...","when":"发布版本时","sourceIds":["mem-7"],"origin":"auto","by":"distiller"}
{"seq":2,"at":...,"type":"RuleAccepted","ruleId":"ctxt-00001","by":"user"}
{"seq":3,"at":...,"type":"RuleUpdated","ruleId":"ctxt-00001","field":"content","before":"...","after":"...","reason":"补充第六步","by":"user"}
{"seq":4,"at":...,"type":"RuleEvidenceChanged","ruleId":"ctxt-00001","before":"intact","after":"weakened","staleBecause":["mem-9"],"by":"system"}
{"seq":5,"at":...,"type":"RuleUsageRecorded","ruleId":"ctxt-00001","usage":"appliedGood","trace":"用户确认"}
{"seq":6,"at":...,"type":"RuleRetired","ruleId":"ctxt-00001","reason":"证据链断裂","by":"system"}
{"seq":7,"at":...,"type":"RuleRevived","ruleId":"ctxt-00001","reason":"前提恢复","by":"system"}
{"seq":8,"at":...,"type":"RuleRevoked","ruleId":"ctxt-00001","reason":"这条规则本身是错的","by":"user"}
```

**注意**：
- 每个事件带 `seq`（单调递增）和 `at`（时间戳）
- **改内容不直接改**，而是追加 `RuleUpdated` 带 before/after
- **删除不删**，而是 `RuleRetired` 或 `RuleRevoked`
- `RuleUsageRecorded` 高频（每次使用一条）——**这个要考虑量**

#### 重放

```ts
function replay(events: Event[], upToSeq = Infinity): PlaybookState {
  const state = new Map<string, Rule>();
  for (const e of events) {
    if (e.seq > upToSeq) break;
    switch (e.type) {
      case 'RuleProposed':  state.set(e.ruleId, { ...e, status: 'pending' }); break;
      case 'RuleAccepted':  state.get(e.ruleId)!.status = 'active'; break;
      case 'RuleUpdated':   if (e.field === 'content') state.get(e.ruleId)!.content = e.after; break;
      case 'RuleEvidenceChanged': state.get(e.ruleId)!.evidence = e.after; break;
      case 'RuleUsageRecorded': state.get(e.ruleId)!.usage[e.usage]++; break;
      case 'RuleRetired':   state.get(e.ruleId)!.status = 'retired'; break;
      case 'RuleRevived':   state.get(e.ruleId)!.status = 'active'; break;
      case 'RuleRevoked':   state.get(e.ruleId)!.status = 'retired'; state.get(e.ruleId)!.tombstone = e; break;
    }
  }
  return state;
}
```

#### 时间旅行

```ts
// 「2026-10-31 那天，准则本是什么样的？」
const asOf = replay(events, seqAt(events, Date.parse('2026-10-31')));
```

#### 快照

```ts
// 每 50 条事件存一次快照
function rehydrate(events: Event[]) {
  const snap = loadSnapshot();
  if (snap) return replay(events.filter(e => e.seq > snap.seq), snap);
  return replay(events);
}
```

---

## 五、必须处理的六个坑（MS 文档点名）

| 坑 | 我们的对策 |
|---|---|
| **1. 事件设计要捕获意图，不是状态** | `RuleRetired{reason}` 而不是 `RuleStatusChanged{to:'retired'}` —— **写清楚为什么** |
| **2. 事件不可变，改错只能加补偿事件** | 用 `RuleUpdated`（带 before/after）而不是原地改；删除用 `RuleRetired` 而不是删行 |
| **3. 版本演进** | 每条事件带 `v` 字段；用 upcasting（旧版本 → 新版本）而不是改历史 |
| **4. 事件排序** | `seq` 单调递增 + `at` 时间戳双保险 |
| **5. 幂等** | 每个消费者记 `lastProcessedSeq`，重复事件跳过 |
| **6. 个人数据删除（right to be forgotten）** | ⚠️ **我们的真实问题**：用户要求删除某条记忆时，事件流里可能还留着它的内容 |

### 第 6 条的专门设计

这是**事件溯源与隐私法规的根本冲突**（MS 文档明确承认）。三个方案：

| 方案 | 做法 | 适用 |
|---|---|---|
| **A. 个人数据外置** | 事件只存 `memoryId`，内容存别处；删内容不影响事件 | ✅ **推荐**：我们的准则事件只存 `ruleId` + 摘要 |
| **B. 加密粉碎** | 事件内容加密，删密钥即不可读 | ❌ 过度（增加密钥管理） |
| **C. 原地改写** | 直接改历史事件 | ❌ 破坏不可变性，MS 说「最后手段」 |

**我们选 A**：准则事件只存「发生了什么」，不存记忆原文；记忆原文在 `cognition-state.json` 里正常删除。

---

## 六、成本与收益

### 6.1 成本估算

| 项 | 工作量 |
|---|---|
| `EventStore`（append + read + seq 分配） | 半天 |
| `replay()` + 8 种事件处理器 | 半天 |
| `PlaybookStore` 改成「派生态」（读走 replay，写走 append） | 1 天 |
| 快照 | 2 小时 |
| 迁移（现有 5 条准则 → 初始事件） | 2 小时 |
| 时间旅行 API（`/playbook/asOf?date=...`） | 2 小时 |
| 测试（重放一致性、快照等价、幂等） | 半天 |
| **合计** | **约 3 天** |

### 6.2 收益

| 收益 | 价值 |
|---|---|
| **时间旅行** | 能回答「上个月我的准则本是什么样的」——**这是双时态做不到的** |
| **完整审计** | 每一条准则的完整生命史 |
| **可回滚** | 改错了能退 |
| **可重建** | 派生文件坏了，从事件流重建 |
| **调试能力** | 复现「当时为什么会这样」 |

### 6.3 与双时态的关系

> **双时态管「这条什么时候为真」（valid time），事件溯源管「它为什么会变成这样」（causal history）。**
>
> 一个回答「当时事实是什么」，一个回答「当时发生了什么」。
> **互补，不重叠。**

---

## 七、该不该做的最终判断

### 7.1 支持做

- **准则本正好是「低频、高价值、需要审计」的典型**——完全符合 Fowler 的「accounting system」类比
- 成本 3 天，收益是**时间旅行 + 完整审计**
- 我们已经有 `audit.jsonl`，只是太薄；改造是「加强」不是「重写」

### 7.2 反对做

- **MS 明确警告「原型/MVP 不适合」**——我们还在 0.11.0
- **团队没经验**（就我一个人写）
- **当前痛点不在这**：现在的痛点是「反馈回路没接」「检索不准」，不是「缺历史」

### 7.3 我的判断：**等一等，但先做「轻量版」**

**不做完整事件溯源**，做**「事件日志 + 重放」的最小版**：

| 做 | 不做 |
|---|---|
| ✅ `playbook-events.jsonl` 追加型 | ❌ 不改 `playbook.json` 的存储方式 |
| ✅ 每次变更同时写事件 + 更新 JSON | ❌ 不让 JSON 变成纯派生态 |
| ✅ 提供 `replay()` 用于重建和审计 | ❌ 不做快照（事件还少） |
| ✅ 提供 `/playbook/history?ruleId=xxx` | ❌ 不做时间旅行 API（先不做） |

**这样做的理由**：
- **零风险**：JSON 还是主存储，事件只是「更完整的日志」
- **可升级**：将来如果真需要，事件流已经在了，只差把 JSON 改成派生态
- **成本 1 天**，不是 3 天
- **不违反 MS 的警告**——它不是事件溯源，是「带意图的审计日志」

---

## 八、一句话

> **事件溯源的核心价值不是「存得更细」，是「能回答为什么、能回到过去」。**
>
> 对我们的判断是：**先写事件，别急着改存储。**
> 事件日志是**零风险的投资**——今天只当审计用，明天如果要时间旅行，数据已经在了。

---

## 参考

- [Martin Fowler, Event Sourcing (2005)](https://martinfowler.com/eaaDev/EventSourcing.html) —— 原始定义、三大能力、外部系统/gateway、事件反转、代码演进、会计系统类比
- [Azure Architecture Center, Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) —— 复杂性与权衡警告、不该用的场景、六个坑、快照、幂等、个人数据删除
- [CQRS Documents (Greg Young)](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf)
- [Event Streaming is not Event Sourcing (Event-Driven.io)](https://event-driven.io/en/event_streaming_is_not_event_sourcing/) —— 概念区分
