# Memobase 的 Profile slot 与 Event 数据模型

> 来源：[Memobase Docs - Profile](https://docs.memobase.io/features/profile/profile) / [Event](https://docs.memobase.io/features/event/event)
> 目的：给纯 JSON 插件设计「用户画像」部分

---

## 一、Profile：固定槽位，不是一堆记忆

Memobase 把用户画像拆成 **slot（槽位）**，每个 slot 有固定的 topic / sub_topics，内容由事件自动更新。

### 1.1 默认 slot（按官方文档）

| slot | 内容 |
|---|---|
| `basic_info` | `name`（姓名）、`gender`（性别）等基础信息 |
| `education` | `school`（学校）、`major`（专业）等 |
| `work` | 职业、项目、工具链（可扩展） |
| `preferences` | 输出偏好、禁忌、喜好 |
| `relationships` | 与家人/同事/朋友的关系（可选） |
| `health` | 用户主动提供的健康信息（可选） |

**关键设计**：slot 是**白名单**——只允许在这些槽位里更新，不能凭空长出一堆分类。

### 1.2 扩展方式

通过 `additional_user_profiles` 配置自定义 slot：每个 slot 定义 `topic` 与 `sub_topics`。

---

## 二、Event：每次事件必须说清「改了什么」

### 2.1 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `summary` | 否 | 事件摘要 |
| `tags` | 否 | 标签，如 `emotion::happy`、`preference::concise`（`类别::值` 格式） |
| **`profile_delta`** | **是** | **这次事件把哪个 slot 从什么改成了什么** |
| **`created_time`** | **是** | 事件时间 |

### 2.2 关键洞察

> **`profile_delta` 是必填的。**
> 也就是说：**每一次更新画像，都必须说明「改了哪个槽位、从什么变成什么」。**
> 这就是审计的最小单位。

---

## 三、我们的纯 JSON 版本

### 3.1 `profile.json`

```json
{
  "schema": "cognition.profile",
  "version": 1,
  "revision": 7,
  "updatedAt": 1793790459061,
  "slots": {
    "basic_info": {
      "limit": 200,
      "readOnly": false,
      "value": { "name": "（可空）", "language": "中文", "timezone": "Asia/Shanghai" }
    },
    "preferences": {
      "limit": 300,
      "readOnly": false,
      "value": { "verbosity": "简短", "format": "先结论后理由", "avoid": ["总结性废话", "空话"] }
    },
    "work": {
      "limit": 400,
      "readOnly": false,
      "value": { "domain": "变电站相片文档", "tools": ["Node", "Word COM"], "projects": ["认知引擎"] }
    },
    "health": { "limit": 200, "readOnly": true, "value": {} },
    "relationships": { "limit": 200, "readOnly": true, "value": {} }
  }
}
```

**三条规则**：

1. `readOnly: true` 的 slot（`health` / `relationships`）：**只有用户能写**，agent 只能提议
2. 每个 slot 有 `limit`，超了拒绝写入
3. 只允许在白名单 slot 内更新

### 3.2 `profile-events.jsonl`（追加型）

```jsonl
{"id":"ev-001","at":1793790459061,"summary":"用户说讨厌总结性废话","tags":["preference::concise"],"profileDelta":{"slot":"preferences","path":"avoid","before":[],"after":["总结性废话"]},"source":"memory:mem-22-e97d48"}
```

**`profileDelta` 是必填的**——每次改画像都留一条「改了什么」的记录。

### 3.3 与现有系统的分工

| 文件 | 存什么 | 特点 |
|---|---|---|
| `cognition-persona.json` | agent 自己（persona + human 块） | 注入用，字符预算 |
| `cognition-profile.json` | 用户画像（分区 slot） | 结构化，不含注入正文 |
| `cognition-profile-events.jsonl` | 画像变更历史 | 追加型，可审计 |
| `cognition-state.json` | 事实记忆（双时态） | 大量、可检索 |

**关键**：`human` 块（500 字）是 `profile` 的**摘要视图**——从 slots 渲染出来，不是独立存储。

---

## 四、落地成本

| 项 | 成本 |
|---|---|
| `ProfileStore`（load/flush/get/update/delta 历史） | 半天 |
| slot 白名单校验 + limit | 半小时 |
| `profileDelta` 强制校验 | 半小时 |
| `human` 块从 slots 渲染 | 1 小时 |
| UI（分区编辑 + 历史 diff） | 半天 |

**合计约 1.5 天**，全部纯 JSON。

---

## 五、一句话

> **用户画像不是「一堆记忆」，是「几个固定槽位 + 每次改动都有记录」。**
> Memobase 最值得抄的一条：**`profile_delta` 必填**——这让我们能回答「用户画像为什么变成现在这样」。

---

## 参考

- [Memobase Profile](https://docs.memobase.io/features/profile/profile)
- [Memobase Event](https://docs.memobase.io/features/event/event)
- [Memobase GitHub](https://github.com/memodb-io/memobase)
