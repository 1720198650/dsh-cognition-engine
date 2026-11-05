# 学习预算设计（纯 JSON 本地记忆插件）

规模：几十到几百条准则。约束：纯 JSON、零外部服务、无 SQLite。
原则：预算是**硬上限不是目标**（超了即停）；一次学习只动一个条目；拒绝也要记账（reason code）。

## 1. 每周学习预算

默认 **W = 8 条**（准则总数 N 的 1%，夹在 4~12 之间：`W = clamp(ceil(N*0.01),4,12)`）。
分配：**修旧 5 / 学新 2 / 预留 1**（预留不自动用，攒满 3 周即可清一次 orphaned 合并）。
- 修旧优先：`helpful+harmful >= 3` 或 `evidence=weakened` 的旧准则先修，修旧不消耗「学新」额度。
- 学新门槛：同一纠正重复出现才可学，`occurrences >= 2` 且跨 ≥2 天；新准则首周只能进 shadow。
- 硬上限：任何一周总写入（含 shadow 转正）≤ W；孤立任务超额时先欠账，下周不补超发。

```json
// budget.json
{ "week": "2026-W45", "quota": {"total": 8, "revise": 5, "new": 2, "reserve": 1},
  "used": {"total": 0, "revise": 0, "new": 0},
  "debt": 0, "paused": false, "pauseReason": null }
```

## 2. 边际收益停止规则

命中任一即停学，直到下一个窗口（下一周或用户显式表态）：

| 信号 | 判据 | 动作 |
|---|---|---|
| 学而无用 | 近 3 周新准则 `helpful+harmful == 0`（从未被检索命中） | 暂停学新 1 周 |
| 学了还错 | 近 2 周有 negative 反馈却未被修正 | 暂停学新 1 周 |
| 越学越挤 | `N > 400` 或 orphaned 占比 > 20% | 只许修旧，禁止学新 |
| 反复翻烙饼 | 同一 subject 30 天内被 supersede ≥ 3 次 | 该 subject 冻结学习 |
| 预算空转 | 连续 2 周学新额 ≤ 25% 且无悔意 | 降 W 至 4 |

```json
// metrics.json
{ "window": "2026-W45", "newRulesHits": 0, "rulesTotal": 62, "orphanedRatio": 0.11,
  "learnedYetWrong": 0, "flipCount": {"release-flow": 1}, "stopUntil": null }
```

## 3. shadow 模式（试运行）

新准则先写 `status: "shadow"`，**进入检索但降权**（排序分 ×0.5，且不进系统提示的准则区，只在 recalled 附带展示）。
转正条件：**命中 ≥ 3 次且 helpful ≥ harmful**（无命中则 21 天后自动 orphaned 淘汰）。
纯 JSON 记录：单文件 `shadow.json`，每条一个 entry，带 `expiresAt`；转正时只 move 到 rules.json + 写 `promotedFrom`。

```json
// shadow.json
{ "entries": [{
   "id": "sh-0007", "subject": "npm发布", "text": "npm 发布必须显式加 --registry=https://registry.npmjs.org",
   "source": "user-correction", "createdAt": "2026-11-03T10:00:00Z", "expiresAt": "2026-11-24T10:00:00Z",
   "occurrences": 2, "hits": 1, "helpful": 1, "harmful": 0,
   "verdict": null }] }      // verdict: promoted | discarded | expired
```

## 4. 不学清单（命中即拒，记入 `rejected.jsonl` 便于审计，不进入预算）

1. **一次性事实**：带具体日期/编号/单次文件路径的（"这次 docx 是 34 行"），应进 session 记忆不学成准则。
2. **与环境绑定**：路径、机器、账号、版本号等易变配置（`D:\minmaxgz` 这种迁移过的尤其）。
3. **与已存准则矛盾但证据平手**：新旧 alike 强度，`harmful < 2` 时不学，挂 pending 等用户裁决。
4. **用户口误/自我更正**：同一轮内先纠正又收回的，丢弃。
5. **超过粒度**：一条纠正拆出的内容 > 60 字或多于 1 个动作 → 抽象后仍超限则不学。
6. **无 source**：不是 user 明确指正，只是 agent 自己推测的，不学。
7. **已被 supersede 的主题**：30 天内翻烙饼 ≥3 次的 subject（见第 2 节）。
8. **命令/密钥**：含 token、密码、内网地址的原文一律不落 JSON。

```json
// rules.json（每条准则）
{ "id": "r-012", "subject": "发布流程", "text": "……", "helpful": 2, "harmful": 0,
  "evidence": "intact", "validFrom": "...", "validTo": null,
  "status": "canonical", "promotedFrom": "sh-0005", "occurrences": 3 }
```

## 5. 伪代码流程

```text
on_correction(evt):                      # 用户纠正事件
  if paused or debt>0 and quota exhausted: return
  if hits_denylist(evt):                 # 第 4 节
      append rejected.jsonl; return
  key = normalize(subject)
  if flipCount[key] >= 3: return         # 冻结
  cand = find_shadow(key) or find_rule(key)
  if cand and contradictions(evt, cand):
      cand.occurrences += 1
      if cand.occurrences >= 2 and budget.new > 0:
          add_shadow(evt); budget.new -= 1
      return
  if cand and strengthens(evt, cand):    # 修旧
      cand.helpful += 1; cand.evidence="intact"; budget.revise -= 1; return
  if occurrences(evt) >= 2 and days_span >= 2 and budget.new > 0:
      add_shadow(evt); budget.new -= 1

weekly_tick(week):
  expire_shadow(now); merge_orphaned()
  for s in shadow where hits>=3 and helpful>=harmful: promote(s); budget.total -= 1
  for s in shadow where helpful<harmful: discard(s)
  recompute_metrics(); if stop_rule(): paused = true, stopUntil = next_window
  budget = reset_quota(clamp(ceil(N*0.01),4,12))
```

## 6. 验收标准

1. **预算硬约束**：注入 50 条跨周纠正，任一周 `used.total <= quota.total`，脚本可断言。
2. **学新不越线**：新准则 7 天内 `status=shadow`；21 天未转正者必为 `expired`，rules.json 无残留。
3. **停止规则可达**：构造"新准则 3 周零命中"，下次 weekly_tick 后 `paused=true`；恢复条件可验证。
4. **不学清单零漏**：对 8 类各造 2 例，`rejected.jsonl` 命中率 100%，且没有进入 shadow/rules。
5. **幂等**：连续两次 weekly_tick 结果 JSON 完全一致（除时间戳），无重复 promote。
6. **规模**：N=50 与 N=400 两档，单次 tick 读写在 200ms 内（纯 JSON 同步读写，文件 < 1MB）。
7. **可回滚**：promote 只追加 `promotedFrom`，可凭 rules.json 反查到 shadow 原文；删 shadow.json 不影响 rules。
8. **人工接管**：`paused=true` 或 flip 冻结时，所有学习路径静默 return，不写任何文件（日志除外）。
