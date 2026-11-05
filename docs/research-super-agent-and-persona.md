# Super-agent、人格与"自我学习"研究

> 记录：2026-11-05
> 起因：一张群聊截图——有人称 AI「调用电脑上的深度学习软件，给自己做了个模型，鼠标会锁头」，账号被封 3 天。
> 问题：这种自我学习是真的吗？能不能把插件做成「能自我行动、有长期记忆、有性格」？还有哪些 super-agent 项目可参考？

---

## 一、先拆聊天记录：哪部分是真的

### 1.1 技术链路是真的，而且官方已经点名

腾讯游戏安全中心 2026-05-25 发布《三角洲行动》「AI 视觉吸附」类外挂专项打击公告，
描述的正是同一条链路：

> 通过直播推流软件采集游戏画面 → 利用 AI 模型识别目标位置 → 将识别结果转化为鼠标移动指令 → 实现自动吸附瞄准。

公告还强调：**无论是否读取游戏内存、是否修改游戏文件，均属于作弊行为**。
处罚是封号 10 年 + 永久拉黑；对制作、传播、销售者已联合执法部门启动刑事诉讼。

开源侧也有同类实现（仅作机制参考，不用于作弊）：
- `hashk014/Universal-AI-aimbot`（教育/实验用途声明）
- `arrozet/AImbot`（CV-based aimbot for FPS games）
- `yan77-h/Aimbot`（C++/Python，屏幕采集 + 模型推理 + 鼠标控制）

### 1.2 "自我学习"是叙事，不是机制

把聊天记录里的步骤还原成工程流水线：

```
1. 截游戏画面          → 屏幕采集 / 推流软件
2. 截干员图片做标注     → 人工或半自动标注（bounding box）
3. 训练检测模型        → YOLO / CNN 一类的小视觉模型
4. 实时推理           → 每帧输出目标框
5. 鼠标锁头           → 把框中心转成鼠标位移（PID / 插值）
6. 被封号             → 反作弊检测异常瞄准曲线 + 进程特征
```

**关键点：被训练的是那个小视觉模型，不是 LLM。**
LLM 做的是「写训练脚本 / 写标注脚本 / 写鼠标控制代码」——
这是**工具自造（self-extension）**，不是**自我学习（self-learning）**。

「她调用我电脑上的 AI 深度学习软件，给自己做了个模型」这句话里，
「她」是拟人化的说法；实际是**人下指令 → agent 写代码 → 脚本训练模型**。
模型不会自己决定「我要去学打游戏」。

### 1.3 四层"学习"必须分清

| 层级 | 机制 | 改模型权重吗 | 典型例子 | 我们能不能做 |
|---|---|---|---|---|
| **L1 上下文学习** | prompt 里的示例 | 否 | few-shot | 能，但不持久 |
| **L2 记忆学习** | 外部记忆 + 检索 + 反馈 | 否 | 认知引擎 | ✅ 已做 |
| **L3 工具自造** | agent 写代码训练**另一个**模型 | 否（训练的是新模型） | 聊天记录里的外挂 | 能，但需要工具链和算力 |
| **L4 权重更新** | 微调 / RL（GRPO 等） | **是** | SEAgent | ❌ 零依赖插件做不到 |

聊天记录是 **L3 被说成了 L4**。这个区别很重要：

- L3 只证明「AI 会写训练代码」，不证明「AI 自己变强了」
- L4 才是「能力真的提升」，但需要训练基础设施 + 数据 + 算力

---

## 二、你想要的「自我行动 + 长期记忆 + 性格」

拆成三件独立的事，难度完全不同：

| 能力 | 现状 | 难度 | 关键设计 |
|---|---|---|---|
| 长期记忆 | ✅ 已有（双时态 + 主题 + 准则 + 缺口） | 已解决 | — |
| 性格 | ⚠️ 没有 | **低** | persona block + human block |
| 自我行动 | ⚠️ 有闸门没接火 | **高** | 触发源 + Ticket + 授权 |

### 2.1 性格：不是改模型，是「稳定的偏好 + 表达方式」

Letta（MemGPT）的做法是两个内存块：

| 块 | 存什么 |
|---|---|
| **persona** | agent 的自我概念、性格、行为准则 |
| **human** | 用户的偏好、事实、上下文 |

特点：有字符上限（限制上下文占用）、持久化、agent 可编辑（我们可以改成「只能提议」）。

**对我们的落地：`cognition-persona.json`**

```json
{
  "version": 1,
  "blocks": [
    {
      "id": "persona",
      "label": "人格",
      "value": "说话直接，不铺垫；先给结论再给理由；不确定时明说；不用感叹号。",
      "limit": 400,
      "readOnly": false,
      "history": [{ "at": 1793790459061, "by": "user", "value": "..." }]
    },
    {
      "id": "human",
      "label": "用户",
      "value": "做文档整理；要求先查证再动手；讨厌空话和总结性废话。",
      "limit": 600,
      "readOnly": false
    }
  ]
}
```

规则：
- **注入在最前面**（在准则本之前），每轮都带
- **pinned**：不衰减、不淘汰、不受证据链影响
- **agent 只能提议**：模型改人格 → 进候选队列，用户确认才生效
- **漂移控制**：单次改动超过 30% 需要二次确认；保留 diff 历史
- **预算**：两块合计 ≤ 1000 字符（约 500 tokens）

**诚实边界**：性格是「稳定的表达倾向」，不是「有自己的欲望」。
它不会自己想要什么，只是说话和取舍更一致。

### 2.2 自我行动：成熟做法是「有边界的主动」

dsh-superagent 的核心哲学：

> **Take as little human attention as possible, and give as much value as possible.**
> 每个消息、通知、问题、设置、面板元素都要「值回它花掉的注意力」，否则删掉。

具体规则（来自 `docs/000-philosophy.md`）：

- **只在被要求时行动，或书面规则允许时行动**
- 没人要求的工作，**先只记录「本来会做什么」**，不发言
- 白名单授权（哪些人/哪些群可以指挥它）
- **Ticket 分阶段**：queued / working / awaiting review / blocked / failed
- 每次交接触发人，不刷屏

架构：
```
Source（GitHub / 飞书）
  → Trigger（Issue 评论 / CI 结果 / 消息）
  → Ticket（工单）
  → Router（主会话，分派）
  → Worker（独立会话 + 独立目录）
  → 报告 / PR / 消息
```

实测：任务完成 **P50 12.4 分钟 / P95 15.7 分钟**（单 Session 方案 P95 29.5 分钟）。

**我们已有 `proactive.ts`**（ProactiveGate，默认 `recordOnly`，与官方姿态一致），
但**没接火**：没有触发源、没有调度、没有执行器。

要真「自我行动」，需要五件东西：

1. **触发源**（定时 / 事件）
2. **目标存储**（我们已有 tasks）
3. **执行器**（能调工具、读写文件）
4. **预算与审批**（每次行动的成本上限）
5. **急停开关**

这不是一个插件 feature，是一套运行时。

### 2.3 建议路线：分三步，不要一次做「完全自主」

| 阶段 | 内容 | 成本 | 验收 |
|---|---|---|---|
| **Phase 1** | 人格块（persona + human），注入在最前，pinned，只能提议 | 2–3 天 | 改人格后连续 5 轮说话风格可测量地变化 |
| **Phase 2** | `cognition_tick`：到期任务 / 未解决缺口 / 证据链断裂 / 过期准则 → 面板「本来会做什么」，默认不发消息 | 3–5 天 | 面板能看到，但零主动消息 |
| **Phase 3** | Ticket 化：queued / working / awaiting review / blocked + 工作日志 + 人工交接 | 1–2 周 | 一个任务从创建到交付全程可追溯 |

**明确不做**：

- ❌ 权重训练（零依赖 + 没有训练数据）
- ❌ 自我修改代码（风险远大于收益）
- ❌ 无审批的自动执行
- ❌ 人格自由演化（必然漂移）

---

## 三、同类 super-agent 项目（2026-11 现状）

### A. 常驻 / 主动型

| 项目 | 是什么 | 借什么 |
|---|---|---|
| **[DeepSeek Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype)**（MIT 原型） | Router + Worker 常驻 agent，Ticket / 授权 / 主动观察 / Watchdog 自愈 | **最值得抄**：Ticket 分阶段、record-only 默认、白名单、面板优先 |
| **[OpenHands](https://www.openhands.dev/)**（92.7k★） | 开源 agentic SDLC 平台，GitHub/Slack/Jira/Linear/定时触发 | 自动化模板 + 触发源目录 |
| **[Agent Zero](https://agent-zero.ai)** | 自主 agent 框架，computer use、A2A、状态回滚（"time travel"） | 状态快照 / 回滚 |
| **AutoGPT / BabyAGI** | 第一代自主循环 | 历史参考，不建议照抄 |

### B. 记忆 + 人格型

| 项目 | 是什么 | 借什么 |
|---|---|---|
| **[Letta（MemGPT）](https://www.letta.com/blog/memory-blocks/)** | 有状态 agent 平台，memory blocks | **persona block + human block**，最直接 |
| **[OpenHanako](https://github.com/liliMozi/openhanako)**（6.9k★，TS/Apache-2.0） | 开源个人 agent：记忆 + 人格 + 自主任务 + 本地优先 | 人格系统、任务提醒 |
| **[MaiBot](https://github.com/Mai-with-u/MaiBot)**（6.9k★） | 数字生命体，长期记忆 + 个性化对话 | 长期陪伴的对话风格 |
| **Personal OS** | 本地数字分身：长期记忆 + RAG + 性格引擎 + 语音 | 性格引擎的分层 |
| **千雪 Qianxue** | 记忆 + 人格 + 情绪，跨平台陪伴 | 情绪状态（可选） |
| **Memori / OpenMemory** | 记忆基础设施 | 不建议换，我们的 JSON 够用 |

### C. 自进化型

| 项目 | 是什么 | 借什么 |
|---|---|---|
| **[SEAgent](https://icml.cc/virtual/2026/poster/65711)**（ICML 2026） | 自进化 computer-use agent：World State Model + Curriculum Generator + GRPO；specialist→generalist | **「世界状态模型」逐步评估**——可映射到我们的 `appliedGood/appliedBad`；训练部分不适用 |
| **Voyager / ExpeL / Reflexion / ReasoningBank / ACE** | 记忆式学习 | 已在用 |
| **PATH-Bench / Oblivion** | 遗忘度量 | 已在用 |

### D. 方法论

- **Generative Agents**：记忆 → 反思 → 计划；recency / importance / relevance
- **dsh-superagent 的注意力经济学**：每个消息/通知/设置都要值回注意力

---

## 四、最该抄的三件事

1. **Letta 的 persona / human blocks** → 性格（最低成本、最高感知）
2. **dsh-superagent 的 record-only + 白名单 + Ticket** → 自我行动的「刹车」
3. **SEAgent 的「每步评估」** → 把 `appliedGood/appliedBad` 变成真正的学习信号（我们已经有一半）

## 五、最不该做的三件事

1. **为了「像人」去堆情绪/人格参数**——容易变成表演，而且不可验证
2. **为了「自主」放开自动执行**——dsh-superagent 自己的安全模型都被标为「弱」（本地管理 API 无认证、Worker 以 danger-full-access 运行）
3. **把「工具自造」说成「自我学习」**——这是聊天记录里最大的认知陷阱，也是我们做产品时最容易夸大的地方

## 六、一句话总结

> 你想要的不是「让 AI 自己变强」，而是「让 AI 自己记得、自己判断、自己动手，但每一步都有刹车」。
> 前者需要训练，后者是工程。**后者才是我们该做的。**

---

## 参考

- 腾讯游戏安全中心公告（《三角洲行动》AI 视觉吸附专项打击），2026-05-25
- [DeepSeek Super-agent 架构介绍](https://ai-bot.cn/super-agent)
- [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
- [SEAgent (ICML 2026)](https://icml.cc/virtual/2026/poster/65711)
- [Letta: Memory Blocks](https://www.letta.com/blog/memory-blocks/)
- [OpenHands](https://www.openhands.dev/)
- [Agent Zero](https://agent-zero.ai)
- [OpenHanako](https://github.com/liliMozi/openhanako)
- [MaiBot](https://github.com/Mai-with-u/MaiBot)
- 本仓库 `_research/superagent-philosophy.md` / `superagent-execution.md` / `superagent-architecture.md`
