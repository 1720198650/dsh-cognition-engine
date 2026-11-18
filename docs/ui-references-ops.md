# LLM 运维/管理面板 UI 事实参考（窄面板 <500px 优先）

> 采集：2026-11-19。来源以官方文档/更新日志为主；截图只实际看了 Langfuse 过滤器侧栏那一张。
> 每节第 6 条是"最值得抄的一点"。标「未找到可靠来源」= 公开资料查不到，不脑补。

## 1. Langfuse（开源 LLM 观测）

来源：[filter sidebar 更新日志](https://langfuse.com/changelog/2025-11-03-filter-sidebar-for-tables)、[列可见性更新日志](https://langfuse.com/changelog/2023-12-04-column-visbility)、[示例项目（左侧导航说明，中文站）](https://langfuse.com.cn/docs/demo)、[v3.205.0 release](https://github.com/langfuse/langfuse/releases/tag/v3.205.0)、[session view 改版](https://langfuse.com/changelog/2026-10-13-redesigned-session-view)、[读访问审计日志](https://langfuse.com/changelog/2026-11-17-read-access-audit-logs)

1. 分工：左侧导航按功能区切（Tracing / Sessions / Prompts / Scores / Datasets），右侧内容区是表格或详情。窄面板降级：过滤器侧栏可折叠成 rail（细条），日期选择器从侧栏挪到页头（v3.205.0 release note 里的 `feat(tables)`，LFE-10663）。
2. 列表密度：官方原话"所有表都有一堆列"，做法是给列可见性开关，自己隐藏不需要的列；后续版本给列选择器加了全选/取消全选。
3. 筛选：右侧过滤器侧栏，按列折叠成手风琴；每列一个 Mode 二选一——SELECT（勾选具体值，按出现次数排序且**显示计数**）/ TEXT（contains / does not contain）；点 "Only" 一键把某个值变成条件；已生效条件在侧栏底部显示成带 `contains` 前缀的可删 chip；支持 Saved Views。截图里一屏可见"Environment / Trace Name / Trace ID / User ID"四组。
4. 状态表达：未找到可靠来源（没查到状态色点/标签的官方说明）。
5. 危险操作：未找到可靠来源。
6. 最值得抄：**列可见性 + "Only" 一键筛选**——候选值来自数据本身并带计数，用户不用记字段名。

## 2. LangSmith

来源：[Filter traces 文档](https://docs.langchain.com/langsmith/filter-traces)

1. 分工：左 Shortcuts 面板 / 中 runs 表 / 右 Stats 面板三段式；两侧面板都能 **Hide / Show**，把宽度还给表格。窄面板：没有 <500px 的官方说明，但"侧栏可隐藏"这个开关本身就是降级手段。
2. 列表密度：表头有 Threads / Traces / Runs 三个切换，决定"一行代表线程、trace 还是单次 run"；视图（Save View）把整套筛选存下来复用。
3. 筛选：单个搜索栏写 `field:value`，每段自动变成 chip；多条件用多行，每行自带 scope（Thread / Root run / Single run / Any run），行间 AND；换个表选择后失效的行**保留但标 "Not applied"**，不静默丢弃。
4. 状态表达：`status` 字段取值 pending / success / error / interrupted；Shortcuts 面板按 Status 分组，勾值即筛。颜色未在文档中说明。
5. 危险操作：未找到可靠来源。
6. 最值得抄：**Not applied 徽章**——条件不适用时保留并明示，比悄悄清空强。

## 3. Dify（知识库/工作流管理台）

来源：[管理知识库](https://docs.dify.ai/en/cloud/use-dify/knowledge/manage-knowledge-base)、[管理知识内容](https://docs.dify.ai/en/cloud/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents)、[编排知识流水线](https://docs.dify.ai/en/cloud/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration)

1. 分工：知识库详情里**点顶部知识库名切换**，列表和详情同页；编排页是画布 + 节点参数面板 + 底部 Variable Inspector。窄面板降级：未找到明确说明。
2. 列表密度：文档级操作为 改分块设置 / 重命名 / 启用禁用 / 归档 / 删除；列的具体字段未找到可靠来源。
3. 筛选与搜索：未找到可靠来源。
4. 状态表达：用**文字动作**不是色点——启用/禁用（可一键恢复）、归档（只读、可解档）、长期未更新或未召回会被自动禁用；chunk 编辑过会标 "Edited"。
5. 危险操作：删除明确写 "**Deletion cannot be undone**"，且删除与禁用/归档是三个独立动作，不共用一个开关。
6. 最值得抄：**按可逆性拆动作**（禁用 ⊂ 归档 ⊂ 删除），别只给一个"启用"开关。

## 4. Coze / 扣子（bot 管理）

来源：[Agent 设置与删除](https://docs.coze.cn/cozespace_agent_management.md)、[查看智能体列表（草稿/已发布）](https://docs.coze.cn/developer_guides_bots_list_draft_published.md)、[暂停或停止部署](https://docs.coze.cn/guides_take_offline.md)

1. 分工：设置入口在对话窗口**右侧导航栏** ··· → Agent 设置；设置页按身份信息/渠道/插件/技能/MCP 分区，每区一个 `>` 展开成列表。窄面板友好：分区+折叠，不需要左侧二级导航。
2. 列表密度：Agent 列表每行右侧 `···` 出操作菜单；API 把草稿版和已发布版拆成两个列表 → 列表天然按发布态组织。列字段未找到。
3. 筛选与搜索：未找到可靠来源。
4. 状态表达：文字为主——"在线 / 掉线了"；渠道显示"连接状态"；草稿与已发布分开列。
5. 危险操作：删除要**输入 Agent 名称**再确认，且删除前先列影响清单（对话终止、历史/文件/技能/日程/邮箱一起删、默认 Agent 不可删）；部署侧把"暂停（保留、可恢复）"与"停止（不可逆）"分开。
6. 最值得抄：**type-to-confirm + 影响清单**。

## 5. AnythingLLM（本地知识库）

来源：[v1.6.8 changelog（批量选择）](https://docs.anythingllm.com/changelog/v1.6.8)、[v1.16/1.19 changelog（文件夹拖拽）](https://docs.anythingllm.com/changelog/v1.16.0)、[移动端文档选择器 PR #7125](https://github.com/Mintplex-Labs/anything-llm/pull/7125)

1. 分工：左 workspace 列表 + 右文档面板两栏；移动端换成 document picker，动作收进底部动作条。具体断点未找到。
2. 列表密度：文档行 + 行右勾选框批量选；文件夹树可展开、可"加载更多"；有加入时间与 chunk 数（这条来自第三方教程，非官方文档）。
3. 筛选与搜索：未找到可靠来源（导航靠文件夹树）。
4. 状态表达：staged 文档与嵌入进度显示在已有文档上方 → 表现为"进度"，不是状态色点。
5. 危险操作：批量删除走勾选 + 底部动作条（移动 / 删除）；v1.6.8 起目录面板右键可全选/取消全选。确认弹窗细节未找到。
6. 最值得抄：**选中后把动作收进一条底部 bar**，避免每行塞三个图标。

## 6. Supabase（表编辑器）

来源：[表管理文档](https://supabase.com/docs/guides/database/tables)、[表格编辑器组件分析](https://deepwiki.com/supabase/supabase/2.1.3-authentication-and-provider-settings)、[行编辑器 JSON/文本编辑器与 Cmd+Enter commit](https://github.com/supabase/supabase/commit/27ca9ee64dc551cedb7296aa05fe98bf138ef878)、[过滤器键盘交互 commit（镜像）](https://git.gay/root/supabase.supabase/commit/e1f37312d23c08e3f759b7f0742d95aa6bb06ec0)

1. 分工：项目侧栏 + 表编辑器（SupabaseGrid，电子表格式）。窄屏降级：未找到可靠来源。
2. 列表密度：单元格内联编辑；外键格子点开就是 ForeignKeySelector；JSON 格展开成 Monaco 编辑器；整行编辑走右侧 SidePanelEditor（RowEditor 侧滑），**不把行撑开**。
3. 筛选：Filter 按钮开条件行，column / operator / value 三段；运算符同时显示符号和文字（"Equals (=)"）；Backspace 删一条条件，Tab/Enter 在控件间走；排序是独立控件。
4. 状态表达：未找到可靠来源（表数据本身无状态语义）。
5. 危险操作：未找到可靠来源（删行确认流程没查到）。
6. 最值得抄：**值即控件**——外键格点开是选择器、JSON 格点开是编辑器。

## 7. Vercel（部署/项目表）

来源：[Deployments API 状态枚举](https://vercel.com/docs/agent-resources/vercel-mcp/tools/deployments/list_deployments)、[vercel list CLI](https://vercel.com/docs/cli/list)

1. 分工：项目内左侧导航 + 部署列表。窄屏：改版说明只写"改善移动端可用性"，无 <500px 细节。
2. 列表密度：改版后更密、一屏更多行；branch 与 commit 直接上主列表，不再藏进子菜单；环境按状态分组（**这条来自第三方对官方 changelog 的转述**，未拿到原页）。
3. 筛选：接口/MCP 支持按 state、target、branch、sha、rollbackCandidate 过滤。
4. 状态表达：固定 7 个状态词 BUILDING / ERROR / INITIALIZING / QUEUED / READY / CANCELED / BLOCKED，没有更细的自由文本。
5. 危险操作：只有 rollbackCandidate 过滤标志；回滚二次确认流程未找到。
6. 最值得抄：**状态词表固定且少**，列表能按状态分组，不必给每个状态配颜色。

## 可迁移模式

| 模式 | 出处 | 窄面板可用吗 | 实现成本 |
|---|---|---|---|
| 列可见性开关（记住用户选过的列） | Langfuse | 可用，替代横向滚动 | 低：本地存 JSON + 渲染前过滤数组 |
| "Only" 一键筛选（值带计数） | Langfuse | 可用，落在全宽 sheet 里 | 中：需先统计每个值的出现次数 |
| 侧栏折叠成 rail / Hide 开关 | Langfuse、LangSmith | 关键：<500px 直接默认折叠 | 中：宽度状态 + 过渡 |
| 条件行筛选（字段/运算符/值 + 行间 AND） | LangSmith、Supabase | 可用，一次只显示一行 | 中：条件数组模型 + 空值兜底 |
| Not applied 徽章（条件失效但保留） | LangSmith | 可用 | 低：条件挂 scope 字段，判不匹配就标灰 |
| 行点开侧滑面板 / peek，不撑开行 | Langfuse、Supabase | 强烈推荐：窄面板里内联展开会挤爆 | 中：详情用抽屉或第二屏 |
| 值的控件化（点值即编辑：选择器/JSON 编辑器） | Supabase | 可用，单列堆叠 | 中：按类型分发编辑器 |
| 状态词表固定 + 按状态分组 | Vercel | 可用，用文字标签不用色点 | 低：枚举 + 分组排序 |
| 按可逆性拆动作（禁用/归档/删除） | Dify | 可用 | 低：三个不同按钮和文案 |
| type-to-confirm + 影响清单 | Coze | 可用 | 低：模态输入名称比对 |
| 选中后底部动作条 | AnythingLLM | 可用，比行内图标省宽 | 低：选中集 + 固定底栏 |
| 分区 + `>` 折叠列表替代二级导航 | Coze | 可用 | 低：折叠面板 |
