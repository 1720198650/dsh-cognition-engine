# 存档：2026-11-05 状态与下一步

> 这是一份「今天结束时的快照」：做了什么、定下了什么、还差什么。
> 下次接着做时，从这里开始。

---

## 一、今天完成的事

### 1. 插件本体（v0.11.0 已发布）

| 项 | 状态 |
|---|---|
| 版本 | **0.11.0**（2026-11-04 发布） |
| GitHub | commit `11835aec` / tag `v0.11.0` / [Release](https://github.com/1720198650/dsh-cognition-engine/releases/tag/v0.11.0) |
| npm | `dsh-cognition-engine@0.11.0`，`latest` |
| 核心能力 | 双时态记忆 / 主题 / 准则本（证据链、来源分级、冲突裁决、分项计数）/ 任务 / 缺口 / 触发条件 |
| 测试 | 98 个单元测试；评测 16/16 |
| 数据 | 记忆 11 · 主题 3 · 准则 5 · 待办 2 · 缺口若干 |
| 数据目录 | `~/.dsh/cognition-engine/`（已从代码目录迁出） |

### 2. dsh-go-market 上架

| 项 | 状态 |
|---|---|
| `dsh-package.json`（Manifest V2） | ✅ 已推送（repo 根目录） |
| 仓库描述 | ✅ 已更新为「可信度治理」定位 |
| 搜索索引 | ✅ 已被发现（`plugin:1720198650/dsh-cognition-engine`） |
| **可安装状态** | ❌ 仍是 `installable: false`，`quarantine_reason: manifest-v2-required` |
| 包详情 API | ❌ 404（说明 registry 还没有 release 记录） |

**下一步（关键技术发现）**：
dsh-go 的可安装包需要一个 **release 描述符**，不是只放 `dsh-package.json`。官方脚本 `scripts/package-release-pack.mjs` 会生成：

- `dsh-package-<id>-<version>.tgz`
- `dsh-package-release.json`（含 `commit`、`tag`、`manifest`、`artifact.digest`）
- SBOM + `SHA256SUMS`

然后把这三个文件作为 **GitHub Release 资产**上传到 `v0.11.0`，registry 才会认。

> 这个脚本在 `coeasy/dsh-go` 仓库里，不在我们仓库。需要把它复制过来或按它的格式手写一份 release descriptor。

### 3. 研究文档（全部已归档并推送）

| 文档 | 内容 | 大小 |
|---|---|---|
| [vision-and-roadmap.md](vision-and-roadmap.md) | 愿景、五个张力、四层能力、六阶段、北极星指标 | 16 KB |
| [research-humanlike-agents-and-autonomy.md](research-humanlike-agents-and-autonomy.md) | 拟人化五机制、B 站自动化流水线、QQ bot 四层记忆、LLM 自主行动谱系 | 13 KB |
| [research-super-agent-and-persona.md](research-super-agent-and-persona.md) | Super-agent / OpenHands / Agent Zero / Letta / OpenHanako / SEAgent 清单 | 12 KB |
| [persona-research.md](persona-research.md) | Anchor 人格卡、四轴审计、7 类轨迹题、Letta block、Assistant Axis | 20 KB |
| [persona-format-and-style-metrics.md](persona-format-and-style-metrics.md) | CCv2 全字段表、MaiBot 源码拆解、26 项中文风格指纹、竞品对比 | 42 KB |
| [research-bm25-retrieval.md](research-bm25-retrieval.md) | BM25 中文小语料实测、显著性检验、参数网格 | 29 KB |
| [research-negex-and-ranking.md](research-negex-and-ranking.md) | NegEx 完整规则表、中文双重否定统计、多信号排序 | 66 KB |
| [research-philosophy-engineering.md](research-philosophy-engineering.md) | 哲学工程化项目核实（含两个被证伪的引用） | 33 KB |
| [research-frozen-weight-learning.md](research-frozen-weight-learning.md) | 冻结权重下的学习：ExpeL / Voyager / AWM / Reflexion / ReasoningBank / ACE / PATH-Bench / Oblivion | 31 KB |

**配套可运行文件**：
- `docs/persona/cognition-persona.schema.json`
- `docs/persona/cognition-persona.example.json`
- `docs/persona/cognition-expressions.schema.json`
- `docs/persona/cognition-expressions.example.json`
- `docs/persona/style-fingerprint.cjs`（零依赖，实测同风格 0.92 / 助手 vs 群聊 0.63）

---

## 二、今天定下的设计决策

| # | 决策 | 依据 |
|---|---|---|
| 1 | **Persona 用「轻人格」**：默认助手 + 3–5 条风格/价值观/边界，不写虚构角色 | Assistant Axis：远离默认助手会漂向戏剧化；Anchor：强人格 85–130 轮会崩 |
| 2 | **两个块**：`persona` 600 字符 + `human` 500 字符，总计 1100 | Letta block 结构 + 我们的上下文预算 |
| 3 | **`value` 是唯一注入源**；`traits`/`history`/`lockedPhrases` 只做审计 | 避免「人设文本」和「审计字段」互相污染 |
| 4 | **agent 只能 propose，用户 confirm**；`human` 块 agent 永远不能直接改 | 防止人格被悄悄重写 |
| 5 | **审计两层**：每周风格指纹（0 token）+ 每月 20 题 LLM 审计（1 次调用） | Anchor 四轴 + 中文风格指纹 |
| 6 | **表达学习只从用户消息学**，candidate → active 需 `hits≥3` + 跨 2 天 | MaiBot 的保守做法 + 防自我强化 |
| 7 | **数据文件放 `~/.dsh/cognition-engine/`** | 两次发版误删的教训 |

---

## 三、还差什么

### Phase 1：Persona（下一步）

| 任务 | 状态 |
|---|---|
| `src/persona.ts`（PersonaStore：load/flush/get/update/propose/confirm/history/render） | 未开始 |
| `src/persona_render.ts`（`<persona>` / `<human>` 注入） | 未开始 |
| `src/style_fingerprint.ts`（26 项 TS 移植） | 未开始 |
| `src/index.ts`（`systemPrompt.section(order:100)` + `/persona/*` 路由） | 未开始 |
| `src/tools.ts`（`cognition_persona` read/propose） | 未开始 |
| `client.js`（设置页两个编辑框 + 字符计数 + 历史 diff + 重置） | 未开始 |
| 测试（schema、limit、边界只读、history、diff、LCS 保护） | 未开始 |

### Phase 0：检索度量（可与 Phase 1 并行）

| 任务 | 状态 |
|---|---|
| 记录每次 `cognition_recall` 的查询/命中/采纳 | 未开始 |
| 人工标 50–100 条 top-3 | 未开始 |
| 产出检索准确率基线 | 未开始 |

### dsh-go-market 可安装化

| 任务 | 状态 |
|---|---|
| 生成 `dsh-package-release.json` + tgz + SBOM | 未开始 |
| 上传到 GitHub Release `v0.11.0` 资产 | 未开始 |
| 等 registry 下次同步验证 `installable: true` | 未开始 |

---

## 四、今天关于「自我学习」的研究结论

（详见 [research-frozen-weight-learning.md](research-frozen-weight-learning.md) 与 [research-humanlike-agents-and-autonomy.md](research-humanlike-agents-and-autonomy.md)）

### 四层学习

| 层级 | 机制 | 改权重 | 代表 | 我们 |
|---|---|---|---|---|
| **L1 上下文学习** | prompt 示例 | 否 | few-shot | 能，但不持久 |
| **L2 记忆学习** | 外部记忆 + 检索 + 反馈 | 否 | ExpeL / ReasoningBank / ACE | ✅ 已做 |
| **L3 工具自造** | agent 写代码训练另一个模型 | 否 | 聊天记录里的外挂 | 能，但不是插件 |
| **L4 权重更新** | 微调 / GRPO | **是** | SEAgent | ❌ 做不到 |

### L2 的三条路线

1. **经验提炼**：ExpeL（成功/失败对比 → insight，初始计数 2，UPVOTE/EDIT +1，DOWNVOTE −1，到 0 删）
2. **技能库**：Voyager（代码技能，验证后才入库，top-5 检索 96.5%）
3. **上下文工程**：ACE（bullet + 计数 + delta，+10.6%/+8.6%，无标注 +17.1%）

### 最重要的三个警告

1. **加了记忆可能变差**：PATH-Bench 实测多个系统 FGT 为负（用了记忆反而比基线差）。
2. **「知道」不等于「做到」**：Anchor 里 Gemini 问卷人格保持度最高 0.810，但逐轮行为最差 79.0%。
3. **用户状态变化最难记**：Anchor 里接近随机（0.214–0.250）——这正好是我们的双时态 + supersedes 该发挥的地方。

### 我们现在的「学习」处在哪

- ✅ 有 L2 的基础设施：`usage` 分项计数、证据链、缺口、蒸馏候选
- ⚠️ 缺**真实反馈信号**：`appliedGood/appliedBad` 还没有自动来源
- ❌ 没有 L4：不训练、不微调、不改权重

> **一句话：我们能做「记住并淘汰」，做不到「变聪明」。**
> 但「记住并淘汰」已经能让组合更靠谱——前提是反馈回路接通。

---

## 五、下次开始时的第一件事

1. 如果做 Persona：从 `src/persona.ts` 开始，先写 schema + store + render，再接 UI。
2. 如果做上架：先生成 release descriptor + tgz，再传 GitHub Release 资产。
3. 如果做度量：先加 recall 日志，跑一周再标 50 条。

**建议顺序**：Persona（感知最强）→ 上架（让用户能安装）→ 度量（为后续优化提供尺子）。

---

## 六、当前数据快照

```
记忆    11 条（current）
主题    3 个（发布流程 / 插件架构 / 文档整理）
准则    5 条（全部 human 来源，证据链 intact）
待办    2 条（文档整理）
缺口    若干（含 gap-1：client slot）
版本    0.11.0
npm     latest = 0.11.0
市场    discovered, not installable
```
