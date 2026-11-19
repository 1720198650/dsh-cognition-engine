# 功能合并与精简计划（可执行版）

调研对象：dsh-cognition-engine 0.13.0（`package.json`、`src/`、`client.js`）。以下结论都带证据位置；凡我没在本机数据里验证过的，标注「未验证」。

**证据口径**：本机数据目录存在，只统计**当前生效**的事实（`supersededAt === null`，与 `src/memory.ts` 的 `isCurrent` 过滤一致）：91 条事实，其中「资料:」前缀的事实 **32 条**，被取代 12 条，零条 `mergedInto`；候选 35 条（32 采用 / 3 拒绝），其中 27 条带 `auto-accepted` 标签；准则 7 条（active 5）；沉积事件 5；立场 5；资料笔记 16；自动联网学习 5 次；深研 5 次；使用记录 49 条。

## 一、重复功能清单与合并建议

| 现有 A | 现有 B | 重叠点（代码证据） | 合并方案 | 用户操作变化 | 数据迁移 | 风险 |
|---|---|---|---|---|---|---|
| 资料库「提炼结论」（`source_note.ts` + `/sources/redistill`） | 学习候选「锚校验」→ 事实（`learning.ts` `candidatesFromPoints` / `checkAnchor` / `applyCandidate`） | **同一条链**：`ingestSource` 提炼完就 `learningPipelineRef`，候选生成唯一入口是 `library.notes()` 的 points；候选被采用的落点是 `memory.ingest`，事实只是换了主体和标签 | 合并成 **「资料库 = 唯一学习入口」**，学习页退役为资料库的「派生事实」折叠区；`learn/generate` 保留为内部函数 | 少 1 次「重新蒸馏/生成候选」点击（`client.js` 2071 那个按钮） | 无（候选本来就从笔记派生）；`alias:'learned'` 事实加标签 `via:library` 便于按来源撤回 | 来源被删后事实在库里找不到原文（`learned` 标签只有 32 条、`via` 证据从无到有，得先补可追溯字段） |
| 学习候选 | 收件箱 `CandidateInbox`（`inbox.ts`，粘贴/文件/上传 → 粘贴 → 收件） | 两者都是「先落待审、再采用」；`/inbox/accept` 与 `/learn/accept` 是两套接收动作 | 合并成 **「收件」一个入口**：统一队列，按来源分类（粘贴 / 文件 / 资料库派生），一个接收动作 | 少 1 次「先导入再重新蒸馏」的两段式 | `cognition-inbox.json` 迁入候选队列，保留 status（现快照：pending 2 / accepted 4 / duplicate 14 / rejected 19） | 两套去重算法不同（`normalizeForDup` vs `normalizeForAnchor`），合并后可能出现重复候选 |
| 自动联网学习 `importFromSearch`（`autolearn.ts` + `/autolearn/run`） | 深研 `runDeepResearch`（`deepresearch.ts` + `/research/run`） | 两者开头完全相同：`web.search` → `pickSources` → `web.fetch` → `extractText` → `sources.append` → `ingestSource`；深研只是多走「每篇一个回答 + 引文核验 + 交叉核对」 | 合并成 **一个「联网学习」**，用**按问题预判深度**替代两个开关：单点事实 → 快学（1 检索 2 篇）；跨源结论 → 深研（多检索 + claim 表） | 少 1 个开关（`autoLearn` 与 `deepResearch` 合成一个档位），少一次「该用哪个」的判断 | `cognition-autolearn.jsonl` 保留；`cognition-research.jsonl` 作为 claim 表来源保留 | 深研一次约 0.1 元（源码注释），自动预判会让人对花费失控；必须保留单次费用上限 |
| 自动采用 `autoAcceptPending`（/learn/auto-accept） | 记忆合并 `memory.consolidate`（/consolidate） | 都是「同主题多条并一条」：前者按**外部勾选开关**，后者按阈值 0.75 余弦合并（`memory.ts` 1071） | 合并成 **「一条入库管道」**：写入时先查重（`contentHash` + 余弦）→ 超阈自动并、不超阈进收件队列 → 采用即落库 | 少 1 个手动「合并/去重」动作 | 无需（`mergedInto` 已在库中，现为 0 条） | `consolidate` 打 `mergedInto` 后只被 strict 召回过滤，`all()` 仍全量返回，合并结果会污染面板计数 |
| 准则本 `playbook.ts` | 立场层 `stance.ts`（goal/prefer/forbid） | 两者都是「要有就遵守的规矩」；立场层已在注入最前（`index.ts` 1633）、并在 `applyCandidate` 里拦截（3886），**部分裁决权已经落在立场层** | 合并成 **「规则」一个库**：准则 = 带边界/置信度/历史的规则，立场 = 无边界、全局恒定、优先级最高的规则；只留一个规则页 | 少 1 个页面 + 少 1 个「去立场页改」的入口 | `cognition-stance.json` 5 条导入规则库，标 `scope:global, priority:high` | 立场层默认种子会在空库时自动写入（`index.ts` 673~680），迁移后必须停掉这段自播种，否则每次清库又冒出来 |
| 沉积层 `sediment.ts` / `sediment_judge.ts`（四维 + 哈希链） | 立场层 / 准则本 | 沉积层 5 条事件、产出是「perspective 倾向」；`sediment/log` 与 `sediment/perspective` 已在面板里（`client.js` 命中 1 次），但**当前注入路径里没看到 perspective 被使用**（`renderInjectedContext` 没引用，**未验证是否另有入口**） | 先**只读观察**：沉积层保留做哈希链校验（`/sediment/verify` 有面板入口），不再新增 UI；它的四维统计并入「观察」区 | 0（观察期，不给新按钮） | 不改 | 直接砍会丢 5 条链式证据；`sedimentShadow` 开关是配置项不是用户开关 |
| 任务 `manage_long_task` / `/task/*` | 工单 `proactiveStore` + `/tickets/*`（五阶段 + `/tickets/link`） | 都是「有状态、可流转的条目」；工单挂 `linkTicket`，任务有状态/到期/证据 | 合并成 **「待办」一个库**：任务 = 无阶段，工单 = 有阶段；`tickets/link` 改指向同一个 id 空间 | 少 1 个「先建任务再建工单」的两段式 | `cognition-proactive.json` + `tasks.json` 合成一张表，`blockedBy` 用同一 id 空间 | 证据字段不同（`completionNeedsEvidence` vs `deliverable/background`），需要统一成可选字段 |
| dreaming 离线整理（`dreaming.ts`） | 记忆合并 / 准则蒸馏 | dreaming 报告只扫 20 条事实 + 4 条准则 + 3 个主题，**本机产 0 条**（`cognition-dream.json` items 为空） | **合并进「诊断」一次跑**：`/consolidate` + dreaming + orphans + `memory/repair` 同一入口 | 少 2 个按钮（dreaming/repair 现无面板入口，`client.js` 命中 0） | 报告保留为 `/diagnose` 的一个字段 | 无（只读报告） |
| 用量看板 `usage.ts` | 注入日志 `injection_log.ts` + 检索度量 `/retrieval` + CPE `/cpe` | 四份都是「量」：token/字数/召回率/回归 | 合并成 **一个「度量」子页**：用量、注入、召回、回归四张卡 | 少 3 个入口 | 无（全部是现算） | CPE 有冻结/基线写动作，不能并成纯只读 |

**不建议合并**（看着像，其实不同）：资料库检索与记忆 BM25（一个查原文、一个查结论）；人格块与规则（人格是「我是谁」，规则是「怎么做」）；`cognition_clarify` 与 `register`（一个是开工前拦截，一个是事后记录，`register` 至今 `mode: 'record-only'`）。

## 二、业界收敛方法论与案例

以下出处我都实际打开过；打不开或没读到的写「未找到可靠来源」。

1. **复杂度守恒**：Tesler 定律——任何系统都有一块去不掉的复杂度，只能选择压给系统还是压给用户；Tesler 的原话是工程师多花一周降复杂度，好过让上百万用户多花一分钟 [lawsofux](https://lawsofux.com/teslers-law/)、[wiki 存档](https://web.archive.org/web/20200104041948/https://en.wikipedia.org/wiki/Law_of_conservation_of_complexity)。**Tognazzini 的反驳**也在同一页：一简化，用户就去干更复杂的事。对本插件的含义：不能靠「砍得越多越好」验收，只能靠「每次交互少一步」验收。
2. **Hick 定律**：决策时间随选项数量与复杂度上升 [lawsofux](https://lawsofux.com/hicks-law/)。落到本插件 = 页签和开关数量直接换成人的决策成本。
3. **渐进披露（Nielsen 2006）**：先只给少数最重要的选项，其余放到次级界面；判断「哪些进首屏」时，**已有系统可以用使用频率统计来排优先级** [nngroup](https://www.nngroup.com/articles/progressive-disclosure/)。——这给了我们一条硬依据：用 `/usage` 与 `/injection/recent` 的频次决定谁进首屏。
4. **Feature creep**：维基百科定义是「超出基本功能、带来臃肿与过度复杂」——但**我这边抓取 en.wikipedia.org 失败**（fetch failed），只拿到搜索摘要，故标为**未取得全文，仅定性**，不引用其任何数字。
5. **Linear「有主见的软件」**：官方 Method 页的原则里有「Say no to busy work——工具不该让你变成它的设计者和维护者」「Simple first, then powerful」「Aim for clarity：别造新词」「Keep a manageable backlog：不必无限期保留每个需求」[linear.app/method/introduction](https://linear.app/method/introduction)；项目要 scoped 到 1–3 周能做完（否则拆阶段）[scope-projects](https://linear.app/method/scope-projects)。**「opinionated software」的 Figma 访谈页正文被截断，未读到具体论述——未找到可靠来源细节**，只有搜索摘要。
6. **Notion / Obsidian / Things / Superhuman**：Notion 只找到第三方整理的 churn 分析（其中一条用户评论抱怨「选项太多、变臃肿」）[RetentionCheck](https://retentioncheck.com/blog/notion-churn-analysis)——**非官方，不作为方法论依据**。Obsidian 核心插件可关、配置留在明文文件里，见官方论坛讨论 [forum.obsidian.md](https://forum.obsidian.md/t/are-we-moving-away-from-portability-how-much-is-obsidian-locking-our-notes-in/19329/84)——同样是用户帖，非官方。Things 与 Superhuman 的「官方极简哲学」**未找到可靠来源**（只有 The Verge / MacStories 的评测，属观点非原则）。我不编。
7. **开关库存管理（Fowler / Hodgson 2017）**：开关分 release / experiment / ops / permission 四类，**寿命不同就要管理方式不同**；做法是「引入开关时同时建一条移除任务」「给开关设过期日期」「给系统设开关总数上限，超了就先删一个再加」[martinfowler.com](https://martinfowler.com/articles/feature-toggles.html)。本插件配置里有 50+ 个 `config.*` 开关，正缺这套库存管理。
8. **下线流程（工程侧）**：Google 对 GA 服务的承诺是**至少 12 个月通知**再下线，例外只限安全/法律/滥用 [Law Insider 收录的条款](https://www.lawinsider.com/clause/deprecation-policy)；Google Maps 的 Legacy 阶段规定「冻结新功能、保留完整支持、再下线」[Google Maps legacy](https://developers-dot-devsite-v2-prod.appspot.com/maps/legacy)。个人插件不需要 12 个月，但**「先冻结 + 保留支持 + 再下线」这个三段式**可以照搬。

**可执行收敛流程（七步，每步都要有产物）**
1. **列库存**：`grep -c "@cognition-engine/" client.js` 得到面板调用的端点（现 86 个），`grep -o "config\.[a-zA-Z]*" src/index.ts | sort -u` 得到开关（50+）。
2. **打使用数据**：每个端点/开关挂一条计数（`usage.ts` 的 `recordUsage` 已有位置），跑 2 周。
3. **分类**：按 Fowler 四类给每个开关定性（release / ops / 实验 / 权限），release 类超过 2 周即列清理。
4. **判定**：用第三节的判据逐条过，产出「合并/保留/冻结/下线」四栏表。
5. **冻结**：只隐藏入口、保留接口与数据，打 `@deprecated` 注释 + CHANGELOG 记一条（老用户数据不动）。
6. **迁移**：写一次性迁移脚本（本插件已有 `persist.ts`、`stateStore` 快照可用），迁移前先 `POST /cognition-engine/export` 留一份。
7. **下线**：删 UI → 删路由 → 最后才删模块与数据文件；每一步都要能单独回滚（`snapshot/restore`）。

## 三、合并判据（可编程）

每条都给出「查什么数 / 代码里怎么查 / 判定阈值」。阈值是我定的红线，可改但必须写进配置。

| # | 判据 | 怎么查 | 判定 |
|---|---|---|---|
| C1 | **共享同一份数据** | 两个模块是否读写同一数据文件：`grep -n "cognition-[a-z-]*\.json" src/*.ts`；再追是否同一函数链（`ingestSource → distillSourceNote → learningPipelineRef`） | 是 → 必须合并，否则同一份数据两套写入语义 |
| C2 | **入口相同、只差一个开关** | `grep -n "autoToggles()\|readFlag(" src/index.ts`，看两个开关是否只在同一函数里分支 | 同一函数里只差 `if (flag)` → 合并成一个档位 |
| C3 | **共享调用前缀** | 两函数前 N 行是否一致（`importFromSearch` vs `runDeepResearch`：search→pick→fetch→extract→append 五步同构） | 前缀 ≥ 3 步 → 抽公共函数，差异留参数 |
| C4 | **近零使用** | `summarizeUsage`（`/cognition-engine/usage`，49 条现成记录）+ `injection_log` + 端点计数；**注意：计数是 0 只能说明「没有自动入口」，不能直接断言人没用过**（dreaming / `agents-sync` / `correction` 在 `client.js` 里命中 0，属此类） | 30 天内端点调用 0 且无其他模块引用 → 冻结；再加一条「写动作 0」才敢下线 |
| C5 | **合并后少至少一个用户动作** | 数动作：打开页面数 + 点击次数 + 手填字段数。例：资料 → 事实现为「导入 → 等提炼 → 点生成候选 → 点采用」= 4 步，合并后 2 步 | 减少 < 1 → 不合并（Tesler：只降代码复杂度不降操作，是白忙） |
| C6 | **出处可追溯率** | `learned` 标签事实数 / 总数（现 32/91 = 35%），其中能回指原文块的比例 | 合并后「同一事多入口」的事实必须 100% 带 `anchor:` 标签，否则先补证据再合并 |
| C7 | **去重后仍自洽** | 跑 `POST /cognition-engine/consolidate` 看 `groups/merged`，再看 `all()` 与 strict 召回的条数差 | 两者差 > 0 说明合并结果在污染面板计数 → 先修过滤再合并 |
| C8 | **开关库存上限** | `grep -c "config\.[a-zA-Z]*" src/index.ts` | 开关总数不得增加；要加新的必须先删一个（照 Fowler 的库存上限做法） |

## 四、下线安全清单（照此顺序，任一步不过就停）

1. **导出全量**：`POST /cognition-engine/export?payload=...` 之前先 `GET` 一份，落到 `_backup/`，确认文件非空。
2. **打快照**：`POST /cognition-engine/snapshot`（或确认 `stateStore.listSnapshots()` 有当次快照），记下名字——这是唯一保证回得去的东西。
3. **列影响范围**：`grep -rn "<feature>" src/ client.js README.md CHANGELOG.md`，把引用点写进 CHANGELOG 条目。
4. **冻结而不是删**：入口从 `client.js` 的 `GROUPS` 移走，路由保留，加 `@deprecated` 注释与「已冻结，将在 X 版本移除」文案。
5. **数据只读化**：对应 `cognition-*.json` 停止写入；迁移脚本另存 `*.migrated-<ts>`，不覆盖原件。
6. **观察期 ≥ 1 个发布周期**：期间 `usage` 中该端点仍有写入 → 撤销下线。
7. **删 UI → 删路由 → 删模块 → 最后才归档数据文件**，四步各自一个 commit，任何一步能单独 revert。
8. **README 与 MANUAL.md 同步**：README 的「界面」页签表、工具表、配置表三处必须一起改（这三表是文档与代码唯一的对照点）。
9. **回归门禁**：`npm test` 里与该功能相关的用例改成「断言已冻结」而不是删掉，免得以后又长回来。
10. **回滚演练**：在副本数据目录上跑一次 `snapshot/restore`，确认能回到下线前状态才算完成。

## 五、分阶段执行计划

### P0 立即可做（不改数据结构，只合并入口，可单独回滚）

| 动作 | 具体做法 | 验收 |
|---|---|---|
| P0-1 学习链合一 | 资料库页删掉「生成候选」按钮，改由导入自动触发（`ingestSource → learningPipelineRef` 已有），候选改为资料行下的折叠区 | 导入一篇资料不动手，事实数 +N；`/learn/generate` 调用数归零 |
| P0-2 联网学习合一 | `autoLearn`/`deepResearch` 两个开关合为一个三档（关 / 快学 / 深研）；深研单次费用提示常显 | 开关从 2 个变 1 个；深研超一次仍弹费用确认 |
| P0-3 诊断合一 | dreaming + consolidate + orphans + repair 合成「设置 → 诊断」一个按钮 | 一次点击出四段报告；dreaming 的 items 为空时显示「本次无可整项」而不是空白页 |
| P0-4 度量合一 | 用量/注入/召回/CPE 四卡并入「观察 → 度量」 | 入口从 4 变 1；四张卡数值与 `/usage`、`/retrieval`、`/cpe` 单独调用一致 |
| P0-5 开关库存表 | 生成 `docs/toggle-inventory.md`：每个 `config.*` 一条，标四类与计划寿命 | 条目数 = `grep -c "config\.[a-zA-Z]*"` 去重数；无一条缺类 |

### P1 需要迁移

| 动作 | 具体做法 | 验收 |
|---|---|---|
| P1-1 收件与候选合一 | `cognition-inbox.json` 与 `cognition-learning.json` 合成一张队列，status 语义统一；`/inbox/accept` 与 `/learn/accept` 合成一个 | 合并后总条数 = 39 + 35 去重后数（diff 逐条可查）；前端只剩一个「接收」按钮 |
| P1-2 规则库合一 | 立场 5 条迁入规则库，标 `scope:global`；停掉 `index.ts` 673~680 的自播种 | 注入文本里 5 条判据仍在前 320 字内；清库后不再自动出现 |
| P1-3 待办库合一 | 任务与工单同 id 空间，阶段为可选字段 | 一条任务可升为工单且 `blockedBy` 不断链；`completionNeedsEvidence` 对两类都成立 |
| P1-4 合并结果修过滤 | `mergedInto` 的事实同时从 `all()` 的面板计数中排除 | `/consolidate` 后 `stats()` 与 strict 召回条数一致（现差 0，修完保持 0） |
| P1-5 可追溯补齐 | `learned` 事实补 `via`/`anchor` 字段 | 32 条全部可回指来源块 |

### P2 观察后决定

| 动作 | 具体做法 | 验收 / 决定点 |
|---|---|---|
| P2-1 沉积层去留 | 只保留 `/sediment/verify`，其余入口收起；统计两次发布内 `perspective` 是否被任何注入引用 | 连续 2 期未被注入引用 → 降为内部校验器；一旦被引用 → 升为「观察 → 倾向」一卡 |
| P2-2 自动修订与准则本 | `autorevise` 现有 4 处面板引用、`cognition-revisions.json` 本机**不存在**（从未写过修订） | 若下期仍无修订记录 → 把自动修订并进准则本的「修订历史」折叠，去掉独立页 |
| P2-3 wiki 增量 | `wiki_incremental` 在 `client.js` 命中 0，且阈值 `wikiIncrementalMinChanges` 未在面板暴露 | 决定：并入 wiki/rebuild 的默认行为，还是按 P0-5 的库存表冻结 |
| P2-4 面板九→五区的第二刀 | 五区里「观察」仍挂三页（沉积/人格/超级代理），按 C4 逐个算 | 任一页 30 天点击 0 且写动作 0 → 冻结入口，正文并入上一级 |

**验收总口径（三阶段共用）**：每次合并后必须同时满足——① 用户动作数（开页 + 点击 + 手填）严格减少；② `/injected` 输出内容不变或更短（防止合并把注入撑大）；③ `npm test` 全绿且涉及功能的用例改成新入口；④ 在 `CHANGELOG.md` 留一条可回滚记录。
