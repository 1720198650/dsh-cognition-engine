# L0：候选收件箱（不联网）

> 2026-11-16。模块：`src/inbox.ts`；路由 `/inbox/*`；面板「收件」页签。
> **L0 的意义不是采集，而是先证明"你会审"。** 你一周审不完 10 条，就别做自动抓取（L2）。

## 一、为什么这样设计（参考了谁）

| 来源 | 借的是什么 |
|---|---|
| **Zettelkasten / Ahrens《How to Take Smart Notes》**（三类笔记） | **fleeting（收件箱）→ literature → permanent**。收件箱里的东西是"候选"，不是知识；处理完才成为永久笔记 |
| **Mem0**（[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)） | 写入是显式操作 **ADD / UPDATE / DELETE / NOOP**。所以"采用"前必须先判重——重复就是 NOOP，别写第二遍 |
| **Hermes issue #56817「tiered write-approval」** | 全量审批会把队列灌满、还阻塞整合。所以**只有外部材料进收件箱**；平时的记忆写入不受影响 |
| **GraphRAG SDK ingestion / 文本去重综述** | 去重是收益最高的一步；质量过滤 → 剪枝 → 归并，顺序不能反 |
| **Generative Agents（Park 2023）** | importance 用于排序；我们只借"要排序"，不借它的分数口径 |

## 二、状态机

```
add → pending ──accept──→ accepted（写入事实，记 acceptedFactId）
  │        └────reject──→ rejected（只留记录，不写事实）
  └── 判重命中 ─────────→ duplicate（保留记录 + duplicateOf）
```

判重三级：

1. **精确**：归一化（去空白/标点/大小写）后哈希相同
2. **近似**：与已有候选相似度 ≥ 0.9
3. **与现有事实重复**：相似度 ≥ 0.9 → 采用也只会是 NOOP，直接标 duplicate

## 三、重要度（便宜估计，不调模型）

`0.4` 起步，加项：长度 ≥80 字 `+0.1`、含数字 `+0.1`、含「必须/不要/结论/改用/原因」`+0.15`、含英文术语 `+0.05`，上限 1。
**用途只有排序**——让你先看更可能有用的，不是给内容打分。

## 四、接口

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/inbox/list?status=pending` | 列表 + 统计 |
| POST | `/inbox/add?content=&title=&url=&subject=&summary=` | 加候选（自动判重） |
| POST | `/inbox/accept?id=` | **唯一会写事实的入口**，写入 source=`imported`，tags 带 `inbox` + 原始链接 |
| POST | `/inbox/reject?id=&reason=` | 只改状态 |

## 五、红线

1. **不自动采用**：没有任何"全选"按钮。
2. **采用必须是人点的**：接口有，但没有批量接受。
3. **上限 500 条**，超了先丢最旧的 rejected/duplicate。
4. 采来的事实默认低重要度、带来源标签；**不因采集而改四维**（沉积层与采集无关）。

## 六、实测

```
add    → id=cand-1 status=pending importance=0.4
stats  → {"total":1,"pending":1,...}
reject → status=rejected note=已丢弃：测试用
pending → 0
detail.inbox.pending → 0
```

213 条测试全绿（含判重三级、采用只写一次、丢弃不写事实、重要度排序）。

## 七、下一步（L1/L2 门槛）

- **L1**：注入回归样本集（10 条畸形网页），证明抽取器只当数据不当指令；
- **L2**：白名单抓取 + 限速 + robots，需要你明确同意开网络权限；
- **门槛**：L0 用一周，你能稳定每天审几条，才值得做 L2。
