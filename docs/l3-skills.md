# L3 技能候选：形态、晋升/淘汰、与准则的边界

> 约束：零运行时依赖、纯 JSON 落盘、只在三处调模型、用户手动审、**不执行任意代码**。
> 证据分级：论文给机制与数字；标「本插件口径」的阈值是工程取舍，不是我实测出来的。

## 一、形态：JSON 里存 Markdown 正文，字段对齐 SKILL.md

| 形态 | 表示法 | 出处 | 零依赖/纯 JSON | 能跑代码 |
|---|---|---|---|---|
| 纯文本条目 | ExpeL 的 insight：一句话最佳实践/失败模式，配计数；AWM 的 workflow：一句目标描述 + 有序步骤 | [2308.10144](https://arxiv.org/abs/2308.10144) §4.2、[2409.07429](https://arxiv.org/abs/2409.07429) §2.2 | 全占 | 否 |
| SKILL.md 目录 | 一个目录至少一个 `SKILL.md`：YAML frontmatter + Markdown 正文；`name`/`description` 必填，`license`/`compatibility`/`metadata`/`allowed-tools` 选填 | [agentskills.io/specification](https://agentskills.io/specification) | 要文件系统 + 手写 YAML 子集解析器（或引依赖），撞零依赖 | 否（但可带 `scripts/`） |
| 代码函数快照 | 每个技能是一个 JS 函数，存向量库，key = 程序描述的 embedding，value = 程序；按任务规划检索 top-5 | [Voyager](https://arxiv.org/abs/2305.16291) §2.2 | 要代码解释器 + 沙箱 | 是 |

**结论：存 JSON 对象 + Markdown 正文，字段名照抄 SKILL.md frontmatter 的语义；只有"导出给别人用"时才序列化成目录。** 依据三条：

1. AWM 实测文本表示与代码表示**没有实质差异**：文本版元素选择 +0.6、单步成功率 +0.3、任务成功率 −1.2（§4.2）。没有执行器时，代码形态拿不到收益。
2. Voyager 用代码是因为**代码就是它的动作空间**（Minecraft 控制），不是代码天生更适合存技能。
3. SKILL.md 真正值钱的是**渐进披露**：metadata 约 100 tokens 启动时全载，正文 <5000 tokens（<500 行）命中才载，`references/` 按需（同规范页）。这一条两个字段就能复刻，不必真建目录；真建就得解析 YAML，撞零依赖。

字段对齐：`name` 就是导出目录名（`^[a-z0-9]+(-[a-z0-9]+)*$`，≤64）；`description` ≤1024，必须写"做什么 + 什么时候用"——它是唯一常驻的成本项，也是触发与否的唯一闸门。正文建议 ≤120 行 / ≤3000 字（官方上界内再收紧，因为我们没有 `references/` 可外挂）。

## 二、凭什么留下

### 2.1 Voyager：入库闸是"自检通过"，不是"写得好"

- 生成代码 → 环境反馈 + 执行错误 + critique → 迭代，**直到 self-verification 模块确认任务完成才 commit 进技能库**（§2.3）。
- 消融：去掉 self-verification，发现物品数掉 **73%**；去掉技能库，后期明显平台化（§3.4）。验收决定质量，库决定能不能复用，两道闸都必要。
- 它的库是 ever-growing，**没有淘汰机制**，所以给不出"该扔什么"的依据。

### 2.2 ExpeL：唯一给出可编程淘汰规则的工作

- insight 上跑 ADD / EDIT / UPVOTE / DOWNVOTE；新增初始重要度 **2**，UPVOTE 或 EDIT +1，DOWNVOTE −1，**归零删除**（§4.2）。
- 这条能直接搬：存留不必每次问人，`score` 归零自动退役，历史留痕。
- 反例也要抄：把反思混进 insight 提炼反而变差（幻觉污染），手工写的 insight 不如自己学的（§5.6）。→ 技能只能从**发生过的成功流程**里长，别拿反思记录当素材。

### 2.3 AWM：只从成功轨迹归纳，"少而准"是显式指标

- workflow = 一句目标描述 + 有序步骤；归纳只取成功轨迹，示例专属值抽象成占位符（`{product-name}`）——通用性来自抽象，不来自写长。
- 质量指标第一条就是 **Number of workflows: fewer is better**（§A.3），另有 coverage、function overlap。→ 合并去重是设计目标，不是卫生工作。

### 2.4 SkillHone：给的是修订纪律，不是保留阈值

- 每次修订必须配对评估侧证据，记录 `诊断 → 修订 → 证据 → 结果`；候选技能先在 practice probes 上跑、报告脱敏；回归了做 scoped revert，不整份重来（[2606.08671](https://arxiv.org/abs/2606.08671) §2.2–2.3）。
- **未找到**它给出保留/丢弃的量化阈值（GAIA +15.8、WebWalkerQA-EN +3.2、内部场景 +18.8 是效果，不是判据）。能抄的是 `history[]` 四段化和"先试跑再采纳"。

### 2.5 库膨胀：两篇实证都指向"选错"，不是"上下文太长"

- *More Skills, Worse Agents?*：从一组已知有用的技能扩到 **202** 个的技能库，通过率最多掉 **21%**；拆解后主因是 **skill shadowing（选错技能）**且随库增长，上下文开销与 0 不可区分（[2605.24050](https://arxiv.org/abs/2605.24050)）。
- *The Scaling Laws of Skills*：15 个前沿模型、1,141 个真实技能、300 万+ 路由/执行决策；单步路由准确率随库大小**对数衰减**（R²>0.97），错误依次是局部语义拥挤 → 族内混淆 → 跨族漂移 → 被过泛的"黑洞技能"捕获；按规律优化后路由 71.3%→91.7%、被劫持 22.4%→4.1%（[2605.16508](https://arxiv.org/abs/2605.16508)）。
- 对我们的意思：**库上限与描述判别性，比单条质量更早成为瓶颈。**

### 2.6 落地判据（本插件口径）

| 阶段 | 条件 | 不满足 |
|---|---|---|
| 入队·锚 | 过 `docs/l3-anchor.md` R1–R8：source 块或用户原话，引文归一化 ≥12 字、覆盖率 ≥0.90；带 flags 的块必须再有一条独立锚 | REJECT，不入队 |
| 入队·结构 | `steps ≥3` 且每步有动作 + 可观察结果；`preconditions ≥1`；`boundaries ≥1`；`description` 含触发词 | 缺边界直接拒（同 playbook 的 boundaryEnvs 铁律） |
| 入队·判别性 | 与库内技能 `description` 相似度 <0.70（沿用 playbook 标定）；≥0.70 走合并 | 合并，不新增 |
| 晋升 | `human` 来源：用户点采纳即可；`auto`/`agent` 来源：至少 1 次真实任务按步骤跑通且结果被外部确认，且 `score ≥3` | 留候选池，不注入 |
| 保留 | `score` 初值 2；外部确认的成功使用 +1，失败 −1（模型自报不计，理由见 `src/playbook.ts` UsageStats 注释） | — |
| 淘汰 | `score` 归零 / `appliedBad ≥2 且 appliedGood=0` / 锚失效（源块删了或覆盖率 <0.60）/ 与另一技能 `description` 相似度 ≥0.85 且功能重叠 | 立墓碑，留 id 与理由，不再注入 |
| 库上限 | 活跃技能 ≤24，超了按（近 90 天使用次数，成功率）淘汰尾部 | — |

- **"至少被成功用过 N 次"这条我没找到实证**：Voyager 的闸是"任务自检通过"，ExpeL 的闸是"计数归零出局"，没有论文用使用次数当入库门槛。所以上面写"1 次真实跑通 + 计数维持"，不编 N。
- 能力替代：我们没有执行器，替代 self-verification 的是 `checks[]`（每步 `expect` + 收尾自检）+ 外部确认。这是工程替换，不是等价物。

## 三、准则 vs 技能

| 来源 | 说法 | 用处 |
|---|---|---|
| Agent Skills 最佳实践 | "A skill should teach the agent **how to approach** a class of problems, not what to produce for a specific instance"；`description` 决定会不会被触发 | 技能 = 过程；单句断言不是技能 |
| Agent Skills 规范 | metadata 约 100 tokens 常驻、正文命中才载、资源按需 | 技能正文**不该每轮注入** |
| AWM §2.2 | workflow = 描述 + 有序步骤，每步含状态/推理/动作 | 技能的最小结构 |
| ExpeL §4.2 | insight = 一句话的最佳实践，全量拼进 prompt（作者自认列表长了要靠检索） | 准则的形态 |
| CoALA [2309.02427](https://arxiv.org/abs/2309.02427) | 长期记忆分 procedural（规则/产生式）/ semantic（事实）/ episodic（行为序列） | **规则与技能同属 procedural**——界线不在知识类型，在结构与载入方式 |

CoALA 这条要摆明：按经典认知架构分法，规则和技能是同一类。本插件分两类，依据只能是**结构与载入策略**，不能声称它们本质不同。

```ts
// 判定该进准则还是技能（纯函数，可单测）
function classifySkillOrRule(cand: { steps: string[]; imperative: boolean }): 'rule' | 'skill' {
  if (cand.steps.length === 0) return 'rule';          // 无步骤：单句约束/偏好
  if (cand.imperative) return 'rule';                  // 必须/禁止/只要——行为边界，不是执行路径
  const acts = cand.steps.filter(hasActionAndObservable).length;
  if (acts < 3) return 'rule';                         // 少到一句话能说完，做准则更省
  if (!hasStateDependency(cand.steps)) return 'rule';  // 删任一步流程仍成立 = 并列提醒
  return 'skill';
}
```

两个 helper：`hasActionAndObservable` = 步骤含动作动词且有可核对产物（文件名 / 字段 / 行数）；`hasStateDependency` = 步骤引用了前一步的产物（不是并列提醒）。

三条硬规则：**一句话能完整表达且不改变行为** → 准则（每轮注入，700 字 / 12 条预算内）；**含参数化输入**（站名、日期、工序）→ 技能（准则里出现占位符，说明它其实是流程）；**含"先…再…"且每步有产物** → 技能，哪怕很短。

## 四、最小字段集

存 `data/skills.json`（`{version, revision, skills: []}`），不落目录、不解析 YAML；`anchor` 复用 `src/learning.ts` 的 `Anchor`。

```ts
export type SkillStatus = 'draft' | 'active' | 'retired' | 'tombstone';

export interface SkillStep {
  /** 祈使句，动词开头，如「按水印时间排序全部照片」 */
  do: string;
  /** 这一步做完能看到什么（自查用） */
  expect?: string;
  /** 依赖的工具（如 read_image / sheets.ps1） */
  tool?: string;
}

export interface SkillEntry {
  id: string;                  // skill-<n>
  name: string;                // ^[a-z0-9]+(-[a-z0-9]+)*$，≤64，导出目录名同此
  title: string;               // 中文名，给人看
  description: string;         // ≤1024：做什么 + 什么时候用，含中英文触发词
  when: string;                // 触发条件（自然语言）
  steps: SkillStep[];          // ≥3，有序，步骤间有状态依赖
  preconditions: string[];     // ≥1：前置文件/工具/权限
  boundaries: string[];        // ≥1：何时不适用
  params?: Array<{ name: string; example: string }>; // AWM 式占位符
  checks: string[];            // 收尾自检（替代 Voyager 的 self-verification）
  origin: 'human' | 'agent' | 'auto';
  anchor: Anchor;              // 外部锚；source=块 / turn=用户原话
  secondAnchor?: Anchor;       // 锚块带 flags 时必填
  score: number;               // ExpeL 式重要度，初始 2
  usage: { applied: number; appliedGood: number; appliedBad: number; lastUsedAt: number | null };
  history: Array<{ at: number; diagnosis: string; evidence: string; outcome?: string }>; // SkillHone 四段
  status: SkillStatus;
  createdAt: number;
  updatedAt: number;
}
```

写入前必拒：`anchor` 缺失或校验不过；`steps.length < 3`；`boundaries` 空；`description` 空或超 1024；`name` 不合规；`status='active'` 但 `origin≠'human'` 且 `usage.appliedGood=0`。

## 参考

- Agent Skills：规范 <https://agentskills.io/specification>｜最佳实践 <https://agentskills.io/skill-creation/best-practices>｜Anthropic 文档 <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>
- Voyager <https://arxiv.org/abs/2305.16291>｜ExpeL <https://arxiv.org/abs/2308.10144>｜AWM <https://arxiv.org/abs/2409.07429>｜CoALA <https://arxiv.org/abs/2309.02427>
- SkillHone <https://arxiv.org/abs/2606.08671>｜Skill Shadowing <https://arxiv.org/abs/2605.24050>｜Skill Scaling Laws <https://arxiv.org/abs/2605.16508>
- 本仓既有：[docs/l3-anchor.md](<D:/dshgz/cognition-engine/docs/l3-anchor.md>)（锚校验）、`src/learning.ts`（Anchor / 候选队列）、`src/playbook.ts`（边界与计数铁律）
