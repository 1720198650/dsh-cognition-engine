# 深研（L4）：多源核对流程、判据与产出

结论先行：失败根因不是阈值，是**抽取单位错了**。把「每篇各抽结论」换成「同一问题逐源作答」，再在答案层判同一性、在断言层判支持度。要改的是 `deepresearch.ts` 3 个函数 + `index.ts` 3 处调用（第四节）。

## 一、流程

### 1.1 推荐顺序

1. **问题定桩**：用户问题冻结成一句可回答问句，写进每次调用。STORM 用多视角提问扩覆盖面，但 5 篇预算下只保留 1 主问 + 1 限定子问，不铺开——[STORM](https://arxiv.org/abs/2402.14207)。
2. **检索质量门**：先判这 5 篇能不能答。CRAG 用轻量检索评估器把文档分 correct/incorrect/ambiguous 再触发不同动作；我们只做二值门——正文命中问题核心实体 <2 篇 → 换词重搜一次，仍不够直接判「检索失败」——[CRAG](https://arxiv.org/abs/2401.15884)。
3. **逐源作答（核心改动）**：同一问题、同一 JSON schema，一源一次调用，输出 `relevant / answer(≤120字) / quote(逐字)`。问的是「这篇怎么回答这个问题」，不是「这篇讲了什么」。
4. **引文锚定**：quote 必须在该源原文块里逐字命中（已有 `checkAnchor`）。锚不上当没答。
5. **答案归并**：判两条 answer 是否同一结论（第二节两档）。
6. **冲突标记**：同一问题出现互斥答案时不合并不取多数，单列 conflict。CAMS 在多文档摘要里把跨源冲突当一等输出——[CAMS](https://arxiv.org/abs/2606.23989)。
7. **断言级支持度**：把通过归并的答案拆成原子断言，逐条对簇内**全部**引文判是否被支持（FActScore 的 atomic fact 支持率、SAFE 的逐 fact 检索核查）——[FActScore](https://arxiv.org/abs/2305.14251)、[SAFE](https://arxiv.org/abs/2403.18802)。
8. **产出 + 计数**：结论表 + 未找到原因 + 模型调用数（`recordUsage` 已按 purpose 记账）。

补充两处可借的：RARR 是事后归因再改写原文，适合「先有答案再补引文」的兜底——[RARR](https://arxiv.org/abs/2210.08726)；FacTool 的 claim→工具查证→逐条判定框架与第 7 步同构——[FacTool](https://arxiv.org/abs/2307.13528)。

### 1.2 为什么「逐源作答再比答案」更可靠

- **同构才可比**：所有来源回答同一个问句，语义位置对齐。逐篇抽结论时，切分粒度由模型自由裁量，切出来的本就不是同一层东西。
- **claim 分解本身不稳**：同一段文本换一种分解方法，FActScore 就变，误差可能来自指标自己的分解步——[A Closer Look at Claim Decomposition](https://arxiv.org/abs/2403.11903)。
- **claim 等价聚类天然模糊**：CAMS 自己写明「claim equivalence is inherently fuzzy, so clustering can mis-merge or split evidence」——[CAMS](https://arxiv.org/abs/2606.23989)。
- **逐文档作答再合并有工程验证**：SPD-RAG 每篇文档一个 agent 只读自己那篇，协调者合并 partial answers，在 LOONG 多文档 QA 上 Avg 58.1，Normal RAG 33.0——[SPD-RAG](https://arxiv.org/abs/2603.08329)。
- **答案级投票是成熟范式**：self-consistency 在最终答案层多数投票，不在推理链中间投票——[Self-Consistency](https://arxiv.org/abs/2203.11171)。

**直接对比这两种做法的论文：未找到可靠来源。** 能查到的是两条路线各自的失败模式记录（上引三篇），没有头对头实验。文档里别假称有。

### 1.3 与失败实现的差异

| | 旧实现 | 新流程 |
|---|---|---|
| 抽取单位 | 每篇 4 条 conclusion（5 篇 13 条） | 每篇 1 条 answer（≤5 条） |
| 归并对象 | 各篇自产结论 | 对同一问题的回答 |
| 判据 | bigram ≥0.6 一次定 | 便宜档初筛 + 灰区 LLM 判 |
| 通过条件 | 同簇 ≥2 源 | ≥2 源 + 每条断言有引文支持 |
| 失败出口 | 无，0 条也返回空表 | `notFound` 带原因 |

### 1.4 伪代码

```ts
const answers: AnswerRecord[] = [];
for (const src of pickSources(...)) {                 // 封顶 5
  const page = await web.fetch(src);
  const raw  = await callRealModel(buildAnswerPrompt(question, page), 1000, 'deepresearch');
  const a    = parseAnswer(raw);
  a.source   = src.id;
  a.anchored = quoteAnchored(a.quote, src);
  if (a.anchored) answers.push(a);
}
const clusters = crossCheckAnswers(answers);          // 便宜档 + 灰区 LLM
for (const c of clusters) c.support = claimSupport(c); // 原子断言 × 簇内引文
const verified = clusters.filter((c) => c.sources.length >= 2 && c.support.length > 0);
```

## 二、答案比对判据与阈值

### 2.1 常用判据

| 判据 | 代表 | 零依赖 | 对改写 | 主要问题 |
|---|---|---|---|---|
| token F1 / ROUGE | 传统 QA 评测 | 是 | 差 | 词面重合，同义改写判不出 |
| bigram 覆盖率 | 现实现 | 是 | 更差 | 长短句不对称，0.6 无依据 |
| 语义相似度 | SAS（交叉编码器） | 否 | 好 | 要额外模型 |
| NLI 蕴含 | ALCE 用 TRUE 判 citation recall | 否 | 好 | 要本地 NLI 模型 |
| LLM 判定 | 本方案贵档 | 是（走已有 LLM） | 好 | 每对一次调用；有位置偏差 |

ALCE 的 citation recall 可直接借：一句有引文，且**全部引文拼起来蕴含这句**才算 recall=1；precision 再看单条引文是否冗余——[ALCE](https://arxiv.org/abs/2305.14627)。

### 2.2 两档方案

**便宜档（默认，0 次额外模型调用）**
- 归一化：去标点、全半角、数字统一（「五」→「5」）、去虚词。
- 判据：字符级 token-F1（unigram 0.6 + bigram 0.4），加两条硬规则：
  - 两边数字集合不一致 → 直接判「不同」（「5 篇」和「3 篇」永远不是同一结论）。
  - 否定/比较词存在性不一致（有/无、能/不能、≥/<）→ 直接判「矛盾」。
- 阈值：`same ≥ 0.55`，`0.40~0.55` 进灰区，`<0.40` 判不同。0.55 是待标定初值，不是终值。
- 预期错误：偏保守——同义改写被漏并，verified 变少；短答案共享高频词时偶发误并。

**贵一档（灰区才用，≤1 次调用/次深研）**
- 一次调用把灰区 ≤3 条答案连同簇代表给模型，只要三分类 `same|different|contradict` + 一句理由，**不要打分**（分数不可标定）。
- 送之前按来源 id 排序降位置偏差；对判 same 的对，交换顺序复判一次（只对最终 verified 的簇做，成本 ×2）。LLM 判官的点对比较本身能拉开一致性，但位置偏差是实测存在的——[LLM judge 可靠性](https://zenodo.org/records/24124753)。
- 预期错误：同实体不同谓词被判 same（「A 支持 B」vs「B 支持 A」）；理由可能是编的，但不影响三分类。

**成本上界**：逐源作答 5 次 + 归并灰区 1 次 + 复核 1 次 = 7 次模型调用/次深研。`callRealModel` 已写 `cognition-usage.jsonl`，记录里直接带 `usage`。

### 2.3 阈值标定

- 建 30~50 对跨源答案对，人工标 `same/different/contradict`（多人标取多数，有分歧的丢掉）。
- 扫 0.30~0.90（步长 0.05），算每点 precision/recall/F1，取 F1 最大点；同时报 Youden's J 与 bootstrap 95% CI。
- 小样本警告：数据驱动选最优切点会高估性能，样本越小越明显——[18258670](https://pubmed.ncbi.nlm.nih.gov/18258670/)；30 对以下改用留一交叉验证，结果只当方向，不当精确阈值。
- **未找到**专门针对「深研结论归并」的公开标定集或论文，只能自建。别引用不存在的 benchmark。

## 三、产出结构与「未找到」判据

### 3.1 最小字段

```ts
interface ResearchRecord {
  id: string; at: number; question: string;
  sources: { sourceId: string; url: string; title: string; chars: number; answered: boolean; reason?: string }[];
  answers: AnswerRecord[];                          // 逐源原始作答，保留可复核
  clusters: AnswerCluster[];
  conflicts: { a: string; b: string; note: string }[];
  notFound: null | { reason: 'retrieval' | 'no-answer' | 'no-agreement'; tried: string[]; gaps: string[] };
  usage: { modelCalls: number; promptChars: number; outputChars: number };
}
interface AnswerCluster {
  answer: string; sources: string[]; quotes: string[];
  support: { claim: string; quotes: string[]; sources: string[] }[];
  agreement: number; ratio: number; verified: boolean;
}
```

为什么是 claim 表不是长报告：STORM 产 Wikipedia 式长文、OpenScholar 产带内联引用的长答、GPT Researcher 产 2000+ 字报告，验证都落在「每句是否有引用支撑」（STORM 按 ALCE 口径测得 citation recall 84.83%）——[STORM](https://arxiv.org/abs/2402.14207)、[OpenScholar](https://arxiv.org/abs/2411.14199)、[GPT Researcher](https://github.com/assafelovic/gpt-researcher)。5 篇资料写长报告会把证据稀释成散文，claim 表一行一结论更可核对。

### 3.2 引文不流于形式的三条硬规则

1. 每条 verified 结论 ≥2 条引文，且来自 ≥2 个**不同站点**（同域名转载算 1 个源）。
2. 每条引文必须逐字命中原文块（`checkAnchor`），锚不上就删结论，不降级。
3. 每条原子断言至少 1 条引文直接支持；整体「沾边」不算。

### 3.3 什么时候说「未找到」

任一成立：
- **检索失败**：5 篇里正文命中问题核心实体的 <2 篇（先换词重搜一次）。
- **无人作答**：`answered` 的来源 <2。
- **无一致**：没有任何簇的独立来源 ≥2。
- **有冲突**：最佳簇存在 `contradict` 对手 → 报「来源冲突」，不报「未找到」。
- 单源结论可以输出，但必须标 `verified:false, sources:1`，不许混进已验证区。

## 四、最小落地清单

| 文件 | 位置 | 改什么 |
|---|---|---|
| `src/index.ts` | 1152 | `const claims: Claim[] = []` → `const answers: AnswerRecord[] = []`（现在 1189 往未声明变量 push，编译不过） |
| `src/index.ts` | 1199 | `crossCheck(claims)` → `crossCheckAnswers(answers)`（现在传空数组，必然 0 条） |
| `src/index.ts` | 1221-1225 | `cluster.conclusion` → `cluster.answer`；只把 `verified && support 非空` 写进 `learning.add` |
| `src/index.ts` | 1196 | `>=4` 提前停 → `>=5`，否则 5 篇封顶形同虚设 |
| `src/deepresearch.ts` | 26-33 | 新增 `answerSimilarity()`（token-F1 + 数字/否定硬规则），`conclusionSimilarity` 留给旧测试 |
| `src/deepresearch.ts` | 165-181 | `buildAnswerPrompt` 强调 answer 是「对问句的回答」不是摘要；schema 加 `confidence` |
| `src/deepresearch.ts` | 207-224 | `crossCheckAnswers` 接灰区 LLM 判定；簇里补 `support`、`conflicts` |
| `src/deepresearch.ts` | 新增 | `claimSupport(cluster)`：拆原子断言 → 逐条对簇内引文判支持 |
| `src/deepresearch.ts` | 123-135 | `ResearchRecord` 加 `notFound/usage/conflicts` |
| `src/test.ts` | 4797 段 | 改成「答案归并 + 断言支持」用例；加一个阈值扫描的标定用例 |

另：`AnswerRecord.source` 现在是空串，靠调用方补；补的时候顺手补 `anchored` 字段，别只改 source。
