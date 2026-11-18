# 记忆面板 UI 参考（同类产品实查）

核查日期：2026-11-19。只写官方文档/帮助中心里读得到的界面事实；没查到的一律标"未找到"。
截图为原页面链接，不转述像素级细节。

## Letta（原 MemGPT）ADE

来源：[ADE 文档](https://docs.letta.com/v1-sdk/ade)、[memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)、[Memory & dreaming](https://docs.letta.com/configuration/memory)

1. **列表**：不是"一行一条事实"，而是"块"：`label` + `description` + `value` + `limit`（字符上限），块内是多行自由文本。旧 ADE 右栏 Agent State 面板分三块：Core Memory Blocks（查看/编辑）、Archival Memory（监控+搜索）、Context Window Viewer。没有"当前/已取代"状态——块是整块覆盖写（"last write wins"）。"谁写的"靠块名区分（`persona`=AI 自述，`human`=用户信息），不逐条标注。
2. **待审**：旧 ADE 未找到待审队列。新版 Dream settings 有 "Agent reviews before applying"（后台子代理先审再写，**不问你**），不是人工队列。
3. **编辑与回滚**：ADE 右栏就地改块 value（整块替换，非追加）；版本历史在底层——新架构记忆是 git-backed 的 MemFS 仓库，可查提交；旧 ADE 无版本 UI（未找到）。
4. **量多**：块按 `label` 过滤、按 label 文本搜索；Archival Memory 有搜索。分页未找到。
5. **最值得抄**：把记忆当**带描述和容量上限的命名分区**，上下文里直接暴露 `chars_current / chars_limit`，让"快满了"这件事看得见。

## Mem0 控制台 / dashboard

来源：[Copilot](https://docs.mem0.ai/platform/copilot)、[Update](https://docs.mem0.ai/core-concepts/memory-operations/update)、[Memory History API](https://docs.mem0.ai/api-reference/memory/history-memory)

1. **列表**：记忆列表分页；每条有正文、categories、时间戳；按 User / Agent / App / Run 四种 scope 过滤。是否逐条标"AI 写的/用户说的"未在文档里列出——但历史记录里有 `event`（ADD/UPDATE/DELETE）、`old_memory` → `new_memory`、以及**触发它的对话 input（role: user / assistant）**，作者可追。逐行具体列名：未找到。
2. **待审**：Copilot 的 **Review changes** 模式给审批卡片：`Apply change` / `Apply with edits` / `Discard edits` / `Decline` / `Ask for something else`；旁边有 **Auto-apply** 开关。批量在 API 层：`batch_update` 最多 1000 条。
3. **编辑**：就地改 text + metadata（覆盖写），无侧滑；历史只能通过 history API 取，UI 是否展示未找到。
4. **量多**：分页（文档明确"列表分页、建议基于采样"）、scope 过滤、语义搜索。
5. **最值得抄**：每条记忆挂**变更记录**（旧值→新值 + 来源对话），等于免费审计记录。

## Zep Cloud console

来源：[Facts](https://help.getzep.com/v4/facts)、[Graph visualizer assistant](https://help.getzep.com/v4/graph-visualizer-assistant)、[Skills 准入](https://help.getzep.com/v4/agent-skills/learning-and-admission)

1. **列表**：事实挂在实体之间的边上，渲染成 `[EDGE_NAME] fact`；四个时间戳 `created_at / valid_at / invalid_at / expired_at`，Context Block 里写成 `FACT (Date range: from - to)`，`- present` 表示仍在用。"已取代"用 `invalid_at` 表达，不用状态标签。谁写的：来源 episode 可点回去（source traceability），可视化器里能"看某条事实背后的 episodes"。
2. **待审**：这里是真有队列——Agent → Skills → 候选，`Approve candidates` / `Reject candidates`；审批模式 `auto` / `manual`；准入门槛包括最少证据数、命中高危工具必须人工、临时技能数量上限、必须通过的评估；learning run 列出 `decision` / `rejection_class`（如 `corroboration_insufficient`）和一句 `next_step` 给人看。
3. **编辑与回滚**：Skill 有版本，可比对、可 restore 旧版本；图里能手改节点/三元组；graph visualizer 明确只读。
4. **量多**：图搜索 + 列表分页（`items a-b, more on page cN`）+ 按实体/事实/邻居分类读；dashboard 有 Fast/Deep 两档检索助手。
5. **最值得抄**：候选**不是通过/拒绝两个按钮**，而是配"准入门槛 + 拒绝理由 + 下一步提示"。

## ChatGPT（Saved memories）

来源：[Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt)（页面内含截图）

1. **列表**：Settings → Personalization → Memory → Manage / Saved memories。截图展示的是 **Memory summary** 视图：一段汇总文本，可选中任意句子给修正；条目本身只有正文 + 操作，没有作者/状态列。来源靠回复下方的 **Sources**（过去的聊天 / saved memory / custom instruction / 文件），可点开纠正或删除。单条 saved memory 的列表列名：未找到。
2. **待审**：没有待审队列。纠错内联在汇总里（输入修正、划词修正、"Don't mention this again"、"Delete and turn off memory"）。开关拆成三档：Memory / Reference saved memories / Reference chat history。
3. **编辑**：就地改（汇总或单条）；文档称部分套餐有 **search、sorting、automatic prioritization、version history**，具体版本界面未找到。
4. **量多**：搜索、排序、自动优先（按套餐）。
5. **最值得抄**：**在"会被用到的地方"给纠正入口**（回复下面的 Sources），而不是让人回设置页里找。

## Claude（Projects / memory）

来源：[Chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)（含截图）

1. **列表**：Settings → Your Claude → Your memory → Manage，所有记忆列在 **Topics** 下；点开一条读全文，铅笔图标编辑、Delete 删除，改一处对所有会话生效。列表不标"AI 写的/用户说的"（用户可说 remember this，但界面上不区分）。项目记忆单独一份，项目页 Memory 下有 **Use account memory** 开关。
2. **待审**：没有队列。敏感话题第一次拒存时弹一次性提示（可去设置打开）；每次保存时在输入框上方出现提示条供复查。
3. **编辑**：点开 topic → 就地编辑 / 删除。版本历史未找到。
4. **量多**：Topics 列表（分页/搜索未找到）；项目天然做分区。
5. **最值得抄**：**分层开关**——账户级、单次会话级（"+"菜单里关记忆，标题旁显示划掉的记忆图标）、项目级，三处口径一致。

## Rewind / Limitless（回溯类，只取信息密度）

来源：[Rewind 搜索技巧](https://help.rewind.ai/en/articles/7231302-tips-tricks-for-using-rewind-search)、[Limitless 帮助](https://help.limitless.ai/en/articles/10546658-interacting-with-the-pendant-search-ask-ai-summaries)

- **Rewind**：底部时间轴拖动回溯、关键词搜索（OCR 全文）、Meetings 筛选、日期选择器。原文页面抓取失败，细节仅取自搜索摘要——**未找到可靠来源**证实其有"记忆条目列表/待审/版本"这套结构，它本身不是这个模型。
- **Limitless**（文档可读）：左侧 **Lifelog** 按天分组，顶部日期条上有记录的日子标黑，点日期跳转；每条摘要带展开箭头看 transcript；顶部搜索框；"Ask" 单独一个 tab 且有历史面板；多选 checkbox 后**底部工具条**统一做复制/导出/播放；长按可就地改 transcript 与说话人（可 replace all）。
- **最值得抄**：**日期条 + 列表的密度**，以及把批量操作收进底部工具条，而不是每行塞按钮。

## 可迁移模式

| 模式 | 出处 | 我们能不能用 | 成本 |
|---|---|---|---|
| 命名分区 + 容量条（label / 描述 / 已用字符） | Letta memory blocks | 能，主题区加 chars 计数 | 低 |
| 每条记忆的变更链：旧值→新值 + 来源 | Mem0 history | 能，JSON 已有 supersedes，补 UI | 中 |
| 双时态取代（validFrom / invalidAt，`- 至今`） | Zep facts | 能，字段已在，只差渲染 | 中 |
| 候选队列 + 准入门槛 + 拒绝理由 + 下一步 | Zep Agent Skills | 能，待审候选区照抄 | 中 |
| 审批卡片：应用 / 改后应用 / 忽略 | Mem0 Copilot | 能，准则候选审批 | 低 |
| Review changes ↔ Auto-apply 模式开关 | Mem0 Copilot | 能，放学习开关旁边 | 低 |
| 在用到的地方给纠正入口（Sources 式回链） | ChatGPT | 部分，审计记录点回事实 | 中 |
| 分层开关：账户 / 会话 / 主题 | Claude | 能，全局开关下挂主题级 | 低 |
| 多选 + 底部批量工具条 | Limitless | 部分，侧栏窄，只做多选批量 | 中 |

**未找到可靠来源**（不要照着想象做）：Letta ADE 记忆编辑的具体截图与版本 UI；Mem0 dashboard 记忆列表的逐列字段；ChatGPT saved memories 单条列表的界面；Claude 记忆的版本历史；Rewind 的记忆类界面。
