# docs 目录一致性检查（2026-11-05，离线，仅本地文件）

范围：`D:\dshgz\cognition-engine\docs\` 下所有 .md（30 个，不含子目录 bench-bm25/、persona/ 内的 js/json/cjs）。
链接校验口径：`[x](y.md)` 形式取文件名匹配；URL 链接不检；反引号 `` `xxx.md` `` 形式的路径引用也检。

## 1. 文件与行数
| # | 文件 | 行数 | # | 文件 | 行数 |
|---|---|---|---|---|---|
| 1 | checkpoint-2026-11-05.md | 135 | 16 | research-humanlike-agents-and-autonomy.md | 222 |
| 2 | evaluation-review-and-learning.md | 148 | 17 | research-learning-theory-deep-read.md | 197 |
| 3 | future-knowledge-base.md | 86 | 18 | research-memobase-profile-model.md | 116 |
| 4 | in-context-learning-research.md | 136 | 19 | research-negex-and-ranking.md | 899 |
| 5 | persona-cross-disciplinary-research.md | 343 | 20 | research-persona-hci-philosophy-npc.md | 355 |
| 6 | persona-cross-disciplinary.md | 470 | 21 | research-persona-memory-landscape.md | 306 |
| 7 | persona-format-and-style-metrics.md | 795 | 22 | research-philosophy-engineering.md | 304 |
| 8 | persona-research.md | 387 | 23 | research-self-evolving-papers.md | 139 |
| 9 | playbook-plan.md | 453 | 24 | research-super-agent-and-persona.md | 186 |
| 10 | refactor-todo.md | 165 | 25 | self-learning-agent-landscape.md | 329 |
| 11 | research-agent-projects-deep-read.md | 206 | 26 | topic-research-oss.md | 131 |
| 12 | research-agent-skills-spec.md | 75 | 27 | topic-research.md | 196 |
| 13 | research-bm25-retrieval.md | 326 | 28 | upgrade-plan-v2.1.md | 305 |
| 14 | research-cpe-mechanism.md | 152 | 29 | upgrade-plan-v2.2.md | 280 |
| 15 | research-frozen-weight-learning.md | 206 | 30 | vision-and-roadmap.md | 169 |

合计 30 个文件 8173 行。

## 2. 失效链接（1 个，结果=1）
- refactor-todo.md → 引用 `PUBLISH.md`（不存在；整目录与 cognition-engine 根目录均无此文件）

统计：纯 md 相对链接 47 处，全部命中；反引号路径引用 10 余处，仅上 1 处失效。

## 3. 全部通过的相关链接（抽查要点）
- checkpoint-2026-11-05.md 的 9 条索引 + 第 114 行 2 条 → 均存在
- persona-* 四件套互链（cross-disciplinary ↔ -research / persona-research / format-and-style-metrics / hci-philosophy-npc / memory-landscape）→ 均存在
- upgrade-plan-v2.1/v2.2、vision-and-roadmap、self-learning-agent-landscape、in-context-learning-research、topic-research*、future-knowledge-base 互链 → 均存在
- 反引号引用 `_research/` 下 superagent-*.md、learning-theory-deep-read.md、agent-projects-deep-read.md、`docs/persona/style-fingerprint.cjs` → 均存在
- 存疑（不计入失效）：persona-format-and-style-metrics.md:596 称 `_research/persona/style-fingerprint.js` 为原始文件，该路径不存在（只有 `_research/test-style.cjs`）

## 4. 重复/高度重叠
- 无「标题完全相同」的文档；行级逐条重合率最高仅 6.2%（persona-research ↔ format-and-style-metrics），无复制粘贴式重复。
- 主题重叠（建议合并或明确分工，不算错误）：
  1. persona-cross-disciplinary.md ∪ -research.md ∪ research-persona-hci-philosophy-npc.md
     三份都是「Persona 跨学科调研（心理/神经/语言/HCI/哲学/NPC）」，标题几乎同构；现靠
     「扫描版 ↔ 深挖版」分工，读者容易找错，建议统一入口。
  2. self-learning-agent-landscape.md ↔ research-learning-theory-deep-read.md、research-agent-projects-deep-read.md
     （landscape 自称「完整版见 _research/…」，但精读已搬进 docs，docs 内出现两套同主题）。
  3. upgrade-plan-v2.1.md ↔ upgrade-plan-v2.2.md、playbook-plan.md：三份「方案」类文档，v2.1 已被 v2.2 覆盖。
  4. research-frozen-weight-learning.md / research-humanlike-agents-and-autonomy.md / research-super-agent-and-persona.md
     三份「学习型 Agent」调研彼此重叠（AWM/Reflexion/Letta 等重复出现）。
- 结构性重复：`## 0. 开工前自查`、`## 〇、一句话结论`、`## 参考` 等固定小节在 3–8 份文档中同名列出现，属模板复用，非内容重复。

## 5. 处置建议
1. refactor-todo.md:184 的 `PUBLISH.md` 改为 `../PUBLISH.md`（文件在 cognition-engine 根）或删去反引号引用。
2. persona 三份跨学科文档加一句「本文 vs 另两份」的分工说明，或合并为一份 + 一个深挖附件。
3. upgrade-plan-v2.1 标注「已被 v2.2 取代」，playbook-plan 与 v2.2 对齐。
