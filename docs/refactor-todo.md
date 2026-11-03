# 主题模块重构：剩余工作交接单

> 状态：**中间态，不可发版**（后端完整可用，UI 缺挂主题入口）
> 更新时间：2026-11-04
> 前置调研：`docs/topic-research.md`（论文）、`docs/topic-research-oss.md`（开源项目）、`docs/future-knowledge-base.md`（暂缓方案）

---

## 一、为什么做这次重构

**调研结论**：自动聚类/图结构在「几十~几百条记忆」规模下**没有任何论文证据支持**。

- SubtleMemory（EMNLP 2026 Findings）：结构化记忆最好 70.0%，**原文直灌 85.4%**
- Mem0 自己的消融：图记忆只比「向量+更新语义」高 **约 2%**
- 业界只有 Graphiti 做真社区，且是内部结构、不可编辑、重建会删旧社区
- 生产产品（Claude Code / Codex / Gemini）**连 RAG 都没有**

**更严重的是我们的实现从未产出过数据**：9 条记忆、0 个主题，因为
`cognition_remember` 主写入路径从不调用 `graph.ingest`，且 graph 不持久化。

**方向**：删掉自动聚类，把「主题」做成**人定的适用范围键**：

```
记忆 —— 发生过什么
准则 —— 应该怎么做
主题 —— 这条记忆/这条准则适用于哪类任务   ← 缺的这一层
```

---

## 二、已完成（A–D）

### A. `topicIds` 字段（✅）

**`src/memory.ts`**
- `TemporalFact.topicIds: readonly string[]`（空数组 = 未归类）
- `IngestInput.topicIds?`
- `setTopics(id, topicIds)`
- `restore()` 向后兼容（老文件无字段 → 空数组）

**`src/playbook.ts`**
- `PlaybookEntry.topicIds: string[]`
- `setTopics(id, topicIds)`
- `restore()` / `submit()` 默认值已补

### B. 删除 `graph.ts` + `edges.ts`（✅）

- 删除 **753 行**（graph 703 + edges 50）
- 清理 `index.ts` / `tools.ts` / `views.ts` / `cards.ts` / `test.ts` / `eval.ts` / `cases.json`
- 测试 73 → 56，评测 20 → 16（删掉图式用例）

### C. 主题注册表接线（✅ 后端完成）

**`src/topics.ts`**（305 行）
- `TopicStore`：`cognition-topics.json` + 快照 + 原子写
- `Topic { id, name, description, aliases[], parentId, status, createdBy, createdAt, updatedAt }`
- `add` / `update` / `archive` / `remove` / `all` / `active` / `get` / `stats`
- `match(text)`：名字 → 别名 → 描述，**只给候选，不自动归类**
- 最多两层；`INBOX_TOPIC = 't_inbox'`

**`src/index.ts`**
- `topicsFile` 配置项（**CognitionConfig / ResolvedConfig / normalizeConfig 三处都改了**）
- `TopicStore` 实例 + `loadSync()`
- snapshot 加 `topics: topics.stats()`
- detail 加 `topics: { list, stats, unclassified }`

**HTTP 路由**

| 路由 | 参数 |
|---|---|
| `GET /topics` | — |
| `POST /topics/add` | `name` `description` `aliases` `parentId` |
| `POST /topics/update` | `id` + 同上 |
| `POST /topics/archive` | `id` |
| `POST /topics/assign` | `targetType`(memory\|rule) `id` `topicIds`(逗号) |
| `POST /topics/suggest` | `text`（只给候选，不落库） |

**`client.js`**
- 主题页签重建：卡片列表（名称/说明/别名/归档）+ 新建表单（名称/说明/别名）+ 未归类计数

### D. 按主题注入（✅ 完成）

**`playbook.render()` 改为按主题分组**：

```markdown
## 发布流程
- [ctxt-00001] helpful=2 harmful=0 :: 功能发版前依次执行五步…
- [ctxt-00005] helpful=0 harmful=0 :: npm 发布必须显式加 --registry…

## 未归类
- [ctxt-00003] helpful=0 harmful=0 :: 插件保持零外部依赖…
```

- `renderSection(now, topicName?)` 透传主题解析器
- `index.ts` 注入段传 `(id) => topics.get(id)?.name`
- 无主题时退化为 `## 未归类`，不报错
- 预算仍是**整段 600 字符**（含自查块/标题/尾注）

**重实现的两个原图功能**

| 功能 | 新实现 |
|---|---|
| `expand`（顺藤摸瓜） | 按 `topicIds` 扩展：召回命中后带出同主题其他记忆 |
| `tensions`（主题间矛盾） | `topicTensions`：`memory.conflicts()` 结果按 `topicIds` 分组，输出到 `cognition_state` |

### 真实端到端验证（✅）

```
1) POST /topics/add?name=发布流程&aliases=发版,release  → t_001
2) POST /topics/assign targetType=rule  → 3 条准则挂上
3) GET  /injected  → 出现 "## 发布流程" 分组，546 字符
```

---

## 三、剩余工作

### 1. UI 挂主题入口（**最优先**）

现在只能走 API。要让人在页面上能把记忆/准则挂到主题。

**记忆页签**：每行加主题 chips + 「挂主题」按钮
**准则页签**：每行加主题 chips + 「挂主题」按钮

实现方式建议（最简）：
```js
h('button', { onClick: () => {
  const ids = window.prompt('主题 id（逗号分隔，如 t_001,t_002）', entry.topicIds.join(','));
  if (ids === null) return;
  post('/cognition-engine/topics/assign?targetType=rule&id=' + entry.id +
       '&topicIds=' + encodeURIComponent(ids));
  setTick(v => v + 1);
}}, '挂主题')
```

更好的做法：下拉多选（从 `/topics` 拉列表做成 chips）。先做 prompt 版能用即可。

**验收**：页面上挂主题 → 注入文本立刻出现对应 `## 主题名` 分组。

### 2. `topics` 单测

`src/test.ts` 新增：

- `TopicStore.add`：正常添加 / 重名拒绝 / 空名拒绝 / 超上限
- 最多两层：父主题已是二级 → 拒绝
- `update` / `archive`：归档后 `active()` 不含它、`get()` 仍能查到
- `match()`：名字命中（score 3）/ 别名命中（2）/ 描述命中（1）/ 无命中
- `assign` 只接受 active 主题（`index.ts` 路由里已过滤）
- `memory.setTopics` / `playbook.setTopics`：设置、清空、向后兼容
- 渲染：`renderSection` 有主题时出现 `## 主题名`、无主题时 `## 未归类`
- `expand`：同主题扩展
- `topicTensions`：分组正确

### 3. E. 迁移现有数据

当前真实数据：**9 条记忆、5 条准则、1 个主题（发布流程）已挂 3 条准则**。

剩余：
- 把 9 条记忆按 `subject` 挂到主题（`发布流程` / `接口规范` / `数据库选型` / `文档格式规范` / `工作区结构` / `npm 发布`）
- 准则 `ctxt-00003`（零依赖）、`ctxt-00004`（相片文档）还没主题
  - 建议再建两个主题：`插件架构`、`相片文档`
- **不要自动创建**：先 `/topics/suggest` 出候选，人工确认后用 `/topics/add`

### 4. 卸载脚本

`scripts/uninstall-cleanup.ps1` 的 `$dataFiles` 加：

```
cognition-topics.json
cognition-topics.json.tmp
```

以及 `.snapshots/topics` 目录（现有脚本删 `.snapshots` 整个目录，已覆盖）。

### 5. README / 文档更新

- 特性列表里「主题」描述要改：**不再是自动聚类**，而是「人定的适用范围键」
- 「参考与致谢」里 CAM 那行要标注：**借鉴了同化/顺应概念，但已移除实现**（调研显示是长文档场景，不适用）
- 新增主题层的用法说明

### 6. 走六步流程发版

按 `PUBLISH.md`：

① 卸载验证（**含新增的 `cognition-topics.json`**）
② 兼容性检查
③ 代码优化（`--noUnusedLocals` 要过）
④ README 覆盖检查
⑤ **在真实入口点一遍**（主题页签新建/归档、挂主题、注入分组）
⑥ 发布

版本号建议 **0.10.0**（有用户可感知的功能变更：主题层重构 + 删除图式）。

---

## 四、当前代码状态速查

| 文件 | 状态 |
|---|---|
| `src/topics.ts` | ✅ 已接线，305 行 |
| `src/memory.ts` | ✅ `topicIds` + `setTopics` |
| `src/playbook.ts` | ✅ `topicIds` + `setTopics` + 按主题分组渲染 |
| `src/index.ts` | ✅ TopicStore + 6 路由 + 注入传解析器 |
| `src/tools.ts` | ✅ `expand` 按主题、`topicTensions` |
| `src/graph.ts` / `edges.ts` | ❌ 已删除 |
| `client.js` | ⚠️ 主题页签可 CRUD，**记忆/准则行无挂主题入口** |
| `test.ts` | ✅ 57 通过（主题单测待补） |
| `eval.ts` + `cases.json` | ✅ 16 通过 |

**编译 / 测试 / 评测三者当前都是绿的，但 UI 功能不完整。**

---

## 五、写在最后

1. **一个模块四个月零产出，说明它从来没被真正接入**。`injectSource` 显示"正在注入准则本"而实际注入记忆摘要，是同一类问题：**显示与实际不一致**。排查方法：看 `/injected` 这种直接反映实际输出的接口，不看派生统计。
2. **调研比实现重要**：如果先做完自动聚类再调研，这 753 行就白写了。
3. **"留着以后用"是陷阱**：把设计写进 `docs/future-knowledge-base.md`，把代码删干净。
4. **脚本替换要逐条验证**：今天出现三次"报告成功但替换没匹配"（`maxTokens`、注入段、`playbookFile`、`topicsFile` 差点第四次）。
