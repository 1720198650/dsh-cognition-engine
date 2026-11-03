# 主题模块调研（第二部分）：开源项目怎么做

调研时间：2026-11-03
方法：GitHub 仓库 + 官方文档逐一核对；star 数为 Shields 徽章四舍五入值

---

## 一、结论先行

1. **真正有「社区/聚类」层的只有 Graphiti**（GraphRAG 同路线）
2. **Mem0 / Cognee / Letta / Zep / Memobase 都没有社区发现** —— 它们靠「实体图 + 摘要/画像 + 向量检索」也能工作
3. **主题层的产品化程度极低**：多数是内部检索结构，不是用户可编辑对象
4. **一条关键规律**：
   > **自动发现的主题几乎都不可编辑；可编辑的主题几乎都是人定的容器。**
   
   这不是巧合——自动聚类结果不稳定（Graphiti 重建社区会**先删旧社区**），
   没有稳定 ID，没法做重命名/合并/归档/按主题注入。
5. **主流用法是「主题路由 + 主题摘要注入」的组合**，单独可视化、单独去重的都是少数

---

## 二、各项目对比

| 项目 | 有主题/社区层？叫什么 | 做什么 | 自动 or 人工 | 注入模型？ | 用户可编辑？ |
|---|---|---|---|---|---|
| **Graphiti** (32k) | ✅ `CommunityNode` | 标签传播聚类 + LLM 社区摘要，作为**第四条检索通道** | **自动**（重建先删旧社区） | 会（低层 search 返回） | ❌ 内部结构，无 CRUD |
| **Mem0** (68k) | ❌ 无社区；有实体图 + custom categories + Profiles | 实体图只影响排序；categories 打标；Profiles 进 prompt | LLM 自动 | Profiles 会 | categories 可配，无社区编辑 |
| **Cognee** (33k) | ❌ 无社区；有 NodeSets（人工标签）+ Global Context Index | NodeSets 做检索过滤；Global Context Index 做预置上下文 | NodeSets **人工** | 会（prelude 注入） | NodeSets 是显式标签 |
| **Letta/MemGPT** (25k) | ❌ 无自动主题；有 **memory blocks** | blocks 是常驻上下文的结构化区段 | **人/agent 创建** | ✅ 始终注入 XML | ✅ blocks 可编辑（核心抽象） |
| **MemoryOS** (1.6k) | ✅「主题段 segment」 | 同主题对话聚成段，先选段再选页 | 自动（cosine + Jaccard） | 会 | 内部结构 |
| **Memobase** (2.9k) | ✅ profile slots: topic → sub_topic | 结构化画像，按 topic 过滤注入 | **半人工**（schema 人配，值 LLM 抽） | ✅ `context()` 进 prompt | ✅ **最接近一等公民** |
| **Zep 商业版** (5k) | ❌ 无社区；六类上下文含 observations + user summary | observations 自动去重合并，只读 | 自动 | ✅ Context Block | ❌ 只读（可 steering） |

### 增补

| 项目 | 主题层 | 关键点 |
|---|---|---|
| **Basic Memory** (4.5k) | 每篇 Markdown 一条 entity | 人和 AI 读写同一份文件，**无自动聚类** |
| **Hindsight** (58k) | banks + observations + **knowledge pages** | 用户定义问题，系统自动维护页面，可导出 Markdown |
| **MemOS** (12k) | MemCube（人工容器） | 图可检查可编辑，无自动主题层 |
| **Supermemory** (32k) | projects/container tags（人工） | profile 自动，容器人工 |
| **GraphRAG** (37k) | ✅ 层次社区 | Leiden + LLM 报告，**已进入维护模式** |
| **LightRAG** (41k) | ❌ 不做社区报告 | 明确为了省 LLM 调用而放弃 |

---

## 三、业界「主题层」的六种用法

| 用法 | 代表 | 本质 |
|---|---|---|
| **1. 检索扩展 / 路由**（最常见） | Graphiti 第四通道、MemoryOS 先选段、Cognee 路由、Memobase `prefer_topics` | 主题先缩小候选，再在主题内细检索 |
| **2. 摘要压缩 / 上下文预载** | Graphiti 社区 summary、Cognee prelude、Zep user summary、Mem0 Profiles | 把多条记忆压成一段可注入的高层上下文 |
| **3. 可视化 / 调试** | Mem0 Graph view、Zep dashboard、Cognee 图、MemoryOS Playground | 帮助人理解，不一定参与推理 |
| **4. 维护 / 去重 / 演化** | A-MEM evolution、Zep observations 合并退休、MemoryOS heat 淘汰 | 主题作为合并/淘汰/分裂的边界 |
| **5. 人工容器 / 分类** | Memobase slots、Letta blocks、Cognee NodeSets、Mem0 categories | 人定主题，LLM 填充，用于过滤/注入/UI |
| **6. 干脆没有** | Letta、Supermemory、Basic Memory、Mem0、Cognee、Zep 产品层 | 靠实体图 + 摘要 + 向量也能工作 |

**最主流组合 = 1 + 2**（主题路由 + 主题摘要注入）。

---

## 四、对小插件意味着什么

### 4.1 不要抄的

| 不要 | 原因 |
|---|---|
| Graphiti 的在线社区发现 | 零依赖做不到；重建删旧社区，没有稳定 ID；纯字面相似度聚类质量不可控 |
| 每次写入跑聚类 | 成本高，收益无证据 |
| LLM 静默创建/重命名主题 | 主题会漂移，用户失去信任 |
| 把所有主题摘要都注入 | 等于又堆上下文 |
| 强制一条记忆只属于一个主题 | 现实中一条记忆常跨主题 |

### 4.2 值得抄的：**主题 = 记忆与准则之间的「适用范围键」**

这是调研里最有用的一条。

我们现在的结构：
```
记忆  ——  回答「发生过什么」
准则  ——  回答「应该怎么做」
```

**缺一层**：`这条记忆/这条准则适用于哪类任务`

这一层直接解决我们自己发现的一个真问题：

> **准则本现在是 12 条每轮全注入，不区分当前在做什么。**
> 「发版六步」和「相片文档一格一照」会同时出现在任何任务里。

有了主题，就能：
```
当前任务匹配主题「发布流程」
  → 只注入：发版六步 + npm --registry + 历次发版事故记忆
而不是把相片文档的准则也塞进来
```

**这比"自动聚类"有用得多，而且可以零依赖实现。**

### 4.3 推荐模式：人定 + LLM 建议 + 用户确认

抄三家的组合：

| 抄谁 | 抄什么 |
|---|---|
| **Memobase** | 人定 topic schema，LLM 填值，strict mode 防扩写 |
| **Letta** | `label + description + value`，主题是一个「有说明的块」 |
| **Mem0 custom categories** | 受控词表 + LLM 分类器，新分类进待审 |

### 4.4 最小数据模型（纯 JSON，零依赖）

```json
// topics.json
{
  "topics": [
    {
      "id": "t_release",
      "name": "发布流程",
      "description": "版本发布、验收、回滚、npm 发布相关",
      "aliases": ["发版", "release", "publish"],
      "parentId": null,
      "status": "active",
      "createdBy": "user",
      "createdAt": 1790000000000
    }
  ]
}
```

记忆与准则各加一个 `topicIds` 字段（多对多），LLM 只允许「从现有主题选」或「提出新主题（进待审）」。

### 4.5 MVP 三步

1. **主题注册表 + 手动增删改 + chips + 过滤**（无 LLM）
2. **写入时 LLM 建议主题 + 按主题范围注入准则**
3. **主题卫生批处理**（合并重复、归档无更新、孤儿记忆）

---

## 五、来源

- Graphiti 社区：[help.getzep.com/v4/graphiti/core-concepts/communities](https://help.getzep.com/v4/graphiti/core-concepts/communities)
- Graphiti 重建源码：[community_operations.py](https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/community_operations.py)
- Mem0 Graph Memory：[docs.mem0.ai/platform/features/graph-memory](https://docs.mem0.ai/platform/features/graph-memory)
- Mem0 Custom Categories：[docs.mem0.ai/platform/features/custom-categories](https://docs.mem0.ai/platform/features/custom-categories)
- Letta Memory Blocks：[docs.letta.com/v1-sdk/memory/memory-blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)
- Memobase Profile：[docs.memobase.io/features/profile/profile](https://docs.memobase.io/features/profile/profile)
- Memobase Filtering：[docs.memobase.io/features/profile/profile_filter](https://docs.memobase.io/features/profile/profile_filter)
- Zep Context Types：[help.getzep.com/v4/context-types](https://help.getzep.com/v4/context-types)
- Cognee NodeSets：[docs.cognee.ai/core-concepts/further-concepts/node-sets](https://docs.cognee.ai/core-concepts/further-concepts/node-sets)
- MemoryOS 论文：[arXiv:2506.06326](https://arxiv.org/html/2506.06326v1)
- Hindsight：[github.com/vectorize-io/hindsight](https://github.com/vectorize-io/hindsight)
