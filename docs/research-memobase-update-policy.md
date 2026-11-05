# Memobase：slot 的更新策略怎么控制

来源（官方文档，2026-11-05 读取）：
- https://docs.memobase.io/features/profile/profile —— Profile Fundamentals
- https://docs.memobase.io/features/event/event —— Event Fundamentals
- https://docs.memobase.io/features/profile/profile_desc —— Configuring Profile Slots（update_description 出处）
- https://docs.memobase.io/features/profile/profile_config —— Profile Validation and Strictness

## 一句话结论
更新策略**不是代码里的枚举开关**，而是写在每个 slot 的 `update_description` 里的一段**自然语言指令**，
由 LLM 在写入时按这段指令决定覆盖 / 保留最早 / 累加。

## 1. update_description 的语义
- 位置：`overwrite_user_profiles` / `additional_user_profiles` → `sub_topics[]` 下的字段，与 `description` 同级。
- `description`：告诉模型这个 slot 该抽什么、什么格式（只管"抽什么"）。
- `update_description`：告诉模型**已有值和新值冲突时怎么办**（管"怎么合并"）。
- 默认行为（不写 update_description）：**直接替换为新值**。
  官方例子：`work/start_date` 旧值 `2020-01-01`，用户说 2021 换了新工作 → 默认变成 `2021-01-01`。
- Event 侧只记录结果：每个 event 的 `profile_delta` 列出"本次创建/更新了哪些 slot"，
  它不参与策略决策——策略在 slot 配置里，结果是 event 的 delta。

## 2. 三种典型策略的写法（配置示例）

### 示例 A：覆盖（最新优先，默认语义，写出来更明确）
```yaml
overwrite_user_profiles:
  - topic: "work"
    sub_topics:
      - name: "company"
        description: "The company the user currently works for."
        update_description: "Always replace with the most recent company. Overwrite the old value."
```

### 示例 B：保留最早（首次即定）
```yaml
overwrite_user_profiles:
  - topic: "work"
    sub_topics:
      - name: "start_date"
        description: "The user's start date at their current job, in YYYY-MM-DD format."
        update_description: "Always keep the oldest start date. Do not update if a date already exists."
```
（这段是官方原文示例，`update_description` 的语义就靠它说明。）

### 示例 C：累加（多次信息并存/去重追加）
官方文档**没有**给出累加类的 `update_description` 原文示例，下面按同一"自然语言指令"机制推断写法：
```yaml
overwrite_user_profiles:
  - topic: "interest"
    sub_topics:
      - name: "hobbies"
        description: "A comma-separated list of the user's hobbies."
        update_description: "Append new hobbies to the existing list, keep old ones, avoid duplicates."
```
> 标注：**示例 C 为推断，未找到官方原文的累加示例**（官方只演示了覆盖与保留最早两种）。

## 3. profile_validate_mode vs profile_strict_mode
两者作用在不同阶段，互相独立：

| 项 | 管什么 | 默认 | 关/开的效果 |
|---|---|---|---|
| `profile_validate_mode` | **写前的内容校验**：过滤低质量/无关信息（如"User has a job"、"User did not state their name"），并检查是否符合 slot 的 `description` | `true`（默认开启） | 设为 `false` 关掉校验 → 存得更多，但准确度/相关性下降 |
| `profile_strict_mode` | **schema 边界**：能否扩展你没定义过的子项 | `false`（宽松，AI 可自行扩展新 sub_topic） | 设为 `true` → 只保存 config.yaml 里显式定义的 slot，其他一律丢弃 |

- validate_mode：管"这条信息够不够格入库"（质量闸）。
- strict_mode：管"这条信息能不能超出我定义的结构"（结构闸）。
- 官方例子：只配了 `work.company`，宽松模式下会多出 `position`、`department`；strict 模式下这两个不会被保存。

## 未找到 / 未确认
- 官方文档未列出 `update_description` 的枚举取值（它是一段自由文本，不是给固定枚举的）。
- 官方没给"累加"的 `update_description` 原文示例（见示例 C 标注）。
- `profile_validate_mode` 官方只演示了 `false`；文档称"默认开启"，按布尔理解（默认 true）属推断。
- https://docs.memobase.io/features/event/event 页面本身**未提及** slot 更新策略，只定义了 event 结构（summary / tags / profile_delta / created time）。
