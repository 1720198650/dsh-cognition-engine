# 中文小语料记忆检索：BM25 值不值得换

> 调研对象：零依赖 TypeScript 记忆插件（无 npm 包、无外部服务、无数据库），记忆几十~几百条，中文为主。
> 现状：中文 bigram + 虚词过滤 / 英文按词 → **TF 余弦** → 全量遍历取 top-k。
> 调研日期：2026-11-04。所有"实测"分为两类，文中严格区分：**文献数据**（给链接）和 **本次自建基准**（合成语料，见第 8 节局限）。

---

## 0. 结论先行

| 动作 | 成本 | 本次实测收益（MRR@10） | 判断 |
|---|---|---|---|
| 仅把 TF 余弦换成 BM25（分词不动） | 中（~40 行） | +1.0% ~ +1.6%，95% CI 跨 0，**不显著** | **不值**：改完用户感知不到 |
| 保留余弦，只给权重乘 IDF（~5 行） | 极低 | +1.1% ~ +1.2%，不显著 | 顺手可做，别当卖点 |
| **分词放宽到单字 + IDF/BM25** | 低（20~40 行） | **+5.5% ~ +7.1%，两类语料都显著** | **值得**：这是真正的杠杆 |
| 调整长度归一 b | 极低（改常数） | 视语料，最大 +8.2 点（显著） | **先看你的语料有没有"长短两版"问题** |
| 加字段加权 / 时间衰减 | 低 | 本次未测 | 建议做，但属于另一个维度 |

**一句话**：在你的规模上，**BM25 的公式不是瓶颈，分词粒度和长度归一才是**。BM25 里有用的成分是 IDF，而 IDF 单独加到你现有的余弦里就能拿到（几乎）全部收益——所以"要不要换 BM25"其实等价于"要不要加 IDF"，答案是"加，但别指望它一个人扛"。

判断依据展开在第 6 节；"未找到"的调研项在第 2.2 节和第 4.4 节明确标注。

---

## 1. 你现在的算法，等价于什么

设文档向量按词频 `tf(t,d)` 加权、L2 归一化，查询同理：

```
TF-cos(q,d) = Σ_t tf(t,d)·tf(t,q) / (‖d‖·‖q‖),   ‖d‖ = sqrt(Σ_t tf(t,d)²)
```

它包含**两个**隐含假设，都不是你显式选的：

1. **没有 IDF**：一个词只要出现，权重就是 1（乘 tf）。在记忆库里，"发布""流程""文档""插件"这类词几乎每条都出现，它们和"樵舍""4651"这种只出现一次的专名**同权**。
2. **长度惩罚是平方根级的**：若文档有 n 个不同词，`‖d‖≈sqrt(n)`，得分 ∝ 1/sqrt(n)。BM25 的 `b=0.75` 是**近似线性**惩罚（分母 `K = k1(1-b+b·dl/avgdl)` 随 dl 线性增长），对小文本更狠。

所以"TF 余弦 → BM25"这一步同时改了三件事：

| 成分 | TF 余弦 | BM25 | 你需不需要 |
|---|---|---|---|
| 词项区分度 | 无 | IDF | **需要**（见 §4） |
| 词频饱和 | 无（线性） | `k1` 饱和 | 短记忆里 tf 多是 1~2，**用不上**（§2.3） |
| 长度归一 | sqrt 惩罚 | 线性惩罚（b 控制） | **要小心**，方向可能是反的（§2.3、§6） |

**推论**：如果只想要 IDF，改 5 行就够，不需要重写成 BM25。

---

## 2. BM25 / BM25+ / BM25L

### 2.1 公式

**BM25**（Robertson & Walker 等，Okapi 系列；Lucene 与 Xapian 的实现式）：

```
score(q,d) = Σ_{t∈q} IDF(t) · tf(t,d)·(k1+1) / ( tf(t,d) + k1·(1 − b + b·|d|/avgdl) )

IDF(t)   = ln( 1 + (N − df(t) + 0.5) / (df(t) + 0.5) )      ← Lucene 的形式，恒正
```

- Lucene 默认 `k1=1.2, b=0.75`，IDF 明确写成上式：<https://lucene.apache.org/core/9_9_0/core/org/apache/lucene/search/similarities/BM25Similarity.html>
- Xapian 默认 `k1=1, k2=0, k3=1, b=0.5`，并且**对文档长度设了下限（默认 L≥0.5）**，"防止极短文档拿到离谱的高权重"：<https://xapian.org/docs/bm25.html>
- SQLite FTS5 的 `bm25()` 把 `k1=1.2, b=0.75` **写死**，另外支持按列加权：<https://www.sqlite.org/fts5.html#the_bm25_function>

> 三个成熟实现给了三组默认值（1.2/0.75、1/0.5、1.2/0.75），说明这组参数本来就不是"标准答案"，是经验值。

**BM25+**（Lv & Zhai, CIKM 2011，<https://doi.org/10.1145/2063576.2063584>）：给每个命中词加一个下界 δ，

```
term_score = IDF(t) · [ tf·(k1+1)/(tf + k1·(1−b+b·|d|/avgdl)) + δ ]
```

**BM25L**（同篇）：先把 tf 做长度归一再加 δ，

```
c = tf / (1 − b + b·|d|/avgdl)
term_score = IDF'(t) · (c+δ)(k1+1)/(k1+c+δ),   IDF'(t) = ln((N+1)/(df+0.5))
```

两者动机相同：BM25 的 tf 项随文档变长趋近于 0，长文档里的命中被过度惩罚；加下界保证"至少值 δ"。
实现参考：MiniSearch 默认 `k=1.2, b=0.7, d(δ)=0.5`，并注明"δ 推荐 0.5~1"：<https://lucaong.github.io/minisearch/types/MiniSearch.BM25Params.html>；Xapian 有独立的 `BM25PlusWeight`（带 delta 参数）：<https://xapian.org/docs/apidoc/html/classXapian_1_1BM25PlusWeight.html>

### 2.2 有没有实测数据？（分三层回答）

**第一层：大规模英文上，BM25 是公认强基线——但这不是"BM25 vs TF 余弦"的对照实验。**
Lucene 在 6.0（2016）把 `IndexSearcher` 的默认 similarity 从 `ClassicSimilarity`（TF-IDF 向量空间）换成了 BM25：<https://issues.apache.org/jira/browse/LUCENE-6789>。Xapian 文档直接写"Recent TREC tests have shown BM25 to be the best of the known probabilistic weighting schemes"（<https://xapian.org/docs/bm25.html>）。这是**工程共识**，不是针对你这种语料的测量。

**第二层：Zobel & Moffat 的经典对照实验说明"好的相似度函数之间很难分出高下"。**
他们把相似度函数拆成 8 个正交维度、在 TREC 集合上跑了一大片组合，结论是：*"We did not achieve this goal—indeed, we now suspect that it is unattainable… we not only failed to find any particular measure that really stood out"*（<https://people.eng.unimelb.edu.au/jzobel/fulltext/sigirforum98.pdf>，第 4 节 Conclusions）。
→ 换句话说：**换打分函数的收益，本来就常常落在噪声里**，这与你只有几十条文档无关。

**第三层：短文本 + 中文 + 几十~几百条语料上，"BM25 比 TF 余弦好多少"的直接研究——未找到。**
我检索了 TREC 中文轨、CLIR、小语料/个性化检索几个方向，没有找到以"中文短文本、N<500"为条件的 BM25 vs TF-IDF 对照实验。任何声称"提升 X%"的说法在这个规模上都缺依据——包括我下面自建基准的数字，只能当方向参考。

**关于 BM25+ / BM25L**：我没有拿到 Trotman et al. 2014《Improvements to BM25 and Language Models Examined》的全文（Otago 站点 DNS 故障、Wayback 不可达），**因此不引用它的结论**。可确认的只有：这两个变体的出发点是"长文档被过度惩罚"，而你的记忆条目普遍很短（本次语料均长 15 个 bigram），这个前提在你这里基本不成立——本次实测 BM25+ / BM25L 与 BM25 的 MRR **完全相同**（0.7512 vs 0.7512，两类语料都一样）。**结论：不需要 BM25+/BM25L。**

### 2.3 k1 / b 在这类语料上怎么设

**k1：不敏感，用 1.2 就行。**
理由：短记忆里 tf 基本是 1~2，饱和函数 `tf(k1+1)/(tf+k1)` 在 tf=1..3 区间的动态范围本来就小。实测 `k1=5` 相对 `k1=1.2`：干净语料 +0.003（≈0），干扰语料 −0.02。**调它没有意义。**

**b：唯一敏感的参数，而且方向取决于你的语料。**

| 配置 | 干净语料（81 条） | 干扰语料（112 条，含"短版旧记录"） |
|---|---|---|
| b=0.75（Lucene 默认） | 0.9071 | 0.7512 |
| b=0.5 | 0.9071 | 0.7585 |
| b=0.3 | 0.9071 | 0.7585 |
| b=0（关掉长度归一） | 0.8825 | **0.8291** |
| 配对 bootstrap，b=0 − b=0.75 | −0.022 [−0.053, 0.000]，不显著 | **+0.082 [+0.039, +0.133]，显著** |

机制很清楚：我的干扰语料里，每条记忆都有一个**更短的旧版本**（均长 11.3 vs 18.3 个 token）。b=0.75 会系统性奖励短文档，于是把"浓缩的旧记录"顶到前面；b=0 去掉了这个先验，更完整的新记录才排回来。

**这对你的插件是真问题**：记忆库天然会有"同一件事记过三次"的情况（旧版更短、新版更全）。BM25 的长度先验来自网页检索（短网页通常更精准），在记忆库里这个先验可能整个反过来。

**建议**：`k1=1.2`，`b` 从 **0.3~0.5** 起（比 0.75 温和），并且**做一次离线评估再定**——你的库里有没有长短两版共存，直接决定 b 该往哪边走。

---

## 3. 中文分词：bigram 是不是标准做法？

### 3.1 是标准做法之一，而且有实测支持

- **工程侧**：Lucene 的 `CJKBigramFilter` 就是专门干这个的——"Forms bigrams of CJK terms"，并且当某个 CJK 字符没有相邻字符时**退化为 unigram**；还提供 `outputUnigrams` 开关做"bigram + unigram 混合"：<https://lucene.apache.org/core/8_6_2/analyzers-common/org/apache/lucene/analysis/cjk/CJKBigramFilter.html>
- **学术侧（实测数字）**：BBN 的 TREC-9 中文单语实验（<https://trec.nist.gov/pubs/trec9/papers/bbn-trec9.pdf>，第 10 节 + Table 8/9）。同一套系统、同一批查询，只换索引单位：

  | 索引单位 | 平均精度（AP） | 相对词索引 |
  |---|---|---|
  | 词索引（其词典驱动，为跨语言优化） | 0.2888 | — |
  | **bigram + unigram** | **0.3362** | **+16.4%** |
  | bigram + unigram + 查询扩展 | 0.3779 | +30.9% |

  原文：*"Using bigrams and unigrams results in a huge improvement in monolingual performance."* 并引用 Kwok(1997)："monolingual retrieval in Chinese… the best strategy may be to use bigrams"。
  （注意边界：TREC-9 中文语料是粤语新闻，词索引那一路用的是为跨语言检索调过的词典法，不是最优分词器；所以 +16.4% 里混了"词典法本身吃亏"的成分，不能直接读成"bigram 比任何分词好 16%"。）

**支持 bigram 的理由**（工程上成立）：中文没有词边界；词典永远追不上新术语（型号、法规编号、人名）；bigram 对未登录词零成本覆盖。**反对的理由**：bigram 对"词边界错位"不鲁棒——"平方米"和"平米"、"变"和"变电站"在 bigram 空间里毫无交集。

### 3.2 纯 JS、零依赖的中文分词，可行吗？

可行，三档，按投入排序：

1. **不做分词，用字符 n-gram**（你现在的 bigram 就是这一档）。最简单，零词典。
2. **词典 + 逆向最大匹配（RMM）**：加载一个几百~几千词的 JSON 词典（虚词表你已经有了），从右往左最长匹配。**纯 JS 约 30 行**，不需要 npm 包。质量取决于词典覆盖率；对"发布流程""兼容性检查"这类你的领域词，准确率会不错，但**未登录词会整词漏召回**——这正是 bigram 的优势。
   参考实现（只读其算法，不作为依赖引入）：npm 上的 `segmentit`（"Chinese word segmentation 中文分词模块"，纯 JS，2.0.3）就是这档做法：<https://www.npmjs.com/package/segmentit>。我**没有**评测它在你的语料上的分词质量。
3. **统计分词（HMM/CRF）**：需要训练数据和模型文件，与"零依赖 + 小体积"冲突，不推荐。

**判断**：不值得自己写分词器。理由不是"写不出来"，而是**你的检索问题不在分词精度上**——§3.3 的实测显示，同一个 BM25 下换索引单位带来的差异（unigram vs bigram：+3~+4.5% MRR）远大于"分词 vs bigram"通常能带来的差异，而且方向还不一定是分词赢。**把力气花在 n-gram 粒度上，回报更确定。**

### 3.3 字符 n-gram + BM25 够不够？——本次实测

同一语料、同一套 BM25 参数（k1=1.2, b=0.75），只换索引单位：

| 索引单位 | 干净语料 MRR | 干扰语料 MRR |
|---|---|---|
| bigram（你现在的） | 0.9071 | 0.7512 |
| unigram | **0.9563** | **0.7823** |
| bigram + unigram | 0.9342 | 0.7597 |

- 干净语料上 unigram 相对 bigram：**+4.5%，95% CI [+0.007, +0.093]，显著**；干扰语料 +3.2%，CI 跨 0。
- **关键交互**：unigram 单独用在 TF 余弦上反而更差（干净语料 0.8887 vs 0.8962；干扰语料 0.7100 vs 0.7331）。**是 IDF 让 unigram 变得可用**——单字召回高但噪声大，IDF 正好压住"的/了/是"这类字的高频噪声。
  配对 bootstrap：`BM25(unigram) − TF余弦(unigram)` = **+6.6%**（干净）/ **+7.1%**（干扰），两个都显著。

**结论**：字符 n-gram + BM25 是够的，而且**bigram 不是最优粒度**。推荐 **bigram + unigram 混合**（Lucene 的 `outputUnigrams` 模式）：召回由 unigram 保证，精度由 bigram + IDF 兜底。索引体积大约翻倍——对几百条记忆完全无所谓。

### 3.4 一个中文特有的坑

bigram 对**中文数字/量词/版本号**很脆："0.9.1"、"171.68 平方米"、"4651" 这类，分词前要先做归一化（NFKC、全角转半角），并把 ASCII 数字串整体当一个 token（别让 "0.9.1" 碎成 "0"、"9"、"1"）。你的语料里这类编号很多，做对了收益比换打分函数大。

---

## 4. IDF 在小语料上会不会失效？

### 4.1 不会失效，但会"压缩"

用 Lucene 的平滑式 `ln(1 + (N−df+0.5)/(df+0.5))` 算（本次计算）：

| N | df=1 | df=2 | df=5 | df=10%N | df=20%N | df=50%N |
|---|---|---|---|---|---|---|
| 50 | 3.53 | 3.02 | 2.23 | 2.23 | 1.58 | 0.69 |
| 100 | 4.21 | 3.70 | 2.91 | 2.26 | 1.59 | 0.69 |
| 200 | 4.90 | 4.39 | 3.60 | 2.28 | 1.60 | 0.69 |
| 500 | 5.81 | 5.30 | 4.51 | 2.29 | 1.61 | 0.69 |

读法：**绝对尺度随 N 变，但"稀有 vs 常见"的比值大体稳定**。N=50 时，只在 1 条里出现的词权重 3.53，出现在一半条目里的词 0.69，比值 5.1；N=500 时比值 8.4。也就是说小语料上 IDF 的区分力被压缩了约 40%，但**方向是对的、量级是够用的**——它不是"失效"，是"变钝"。

### 4.2 真正的风险是抽样误差，不是公式

N=50 时观测到 df=5，真实比例的二项 95% 置信区间约 [4.3%, 21.4%]（Wilson 区间，本次计算），对应 IDF 在 **1.49 ~ 3.02** 之间浮动（点估计 2.23）。即：**具体数值不可信（±30%），但排序基本可信**（在 5 条里出现的词，几乎不可能是"比只在 1 条里出现的词更稀有"）。

结论：**别在小语料上追求 IDF 的精确值，只用它的序**。任何"固定 IDF 表"的方案都会把这个随机性固化成偏差，**不建议**（文献里也没找到这种做法的依据）。

### 4.3 该用的平滑

- **用 Lucene 的 `ln(1 + …)` 形式**，不要用教科书 `ln(N/df)`：后者在 `df > N/2` 时为负，在 `df = N` 时为 0。小语料 + 主题集中的记忆库里，"出现在一半以上条目"的词非常常见，负 IDF 会让"命中高频词"变成**扣分**。
- SQLite FTS5 就是经典式（`ln((N−n+0.5)/(n+0.5))`），所以它的分数可以是负的，文档里专门解释了要乘 −1 排序：<https://www.sqlite.org/fts5.html#the_bm25_function>。**别抄这个。**
- 不需要额外加平滑：`+1` 那层已经同时解决了"负值"和"df=0"两个边界。

### 4.4 小结

| 担心 | 结论 |
|---|---|
| 几十条时 IDF 会不会失效 | 不会，只是区分力压缩 ~40% |
| 会不会不稳定 | 数值 ±30%，排序稳定；只用来排序就没问题 |
| 要不要固定 IDF 表 | **不要**，没有依据，且会把抽样误差固化 |
| 用什么公式 | Lucene 的 `ln(1 + (N−df+0.5)/(df+0.5))` |

---

## 5. 其他不需要 embedding 的轻量信号

按"性价比"排序，前两个建议做，后两个不建议：

### 5.1 字段加权（最便宜，建议做）

记忆条目天然有 `subject`（主题）、`tags`、`content` 三个字段。命中的字段不同，相关性应该不同——标题命中通常比正文命中更有信息量。

- 理论版：**BM25F**（Robertson, Zaragoza & Taylor, CIKM 2004，<https://doi.org/10.1145/1031171.1031181>）——先把各字段的 tf 加权合并，再做饱和，而不是先算分再加权。
- 工程简化版（够用）：`score = w_subject·BM25(subject) + w_content·BM25(content)`，`w_subject ≈ 2`。
- 现成先例：SQLite FTS5 的 `bm25(ft, w1, w2, …)` 就是按列传权重：<https://www.sqlite.org/fts5.html#the_bm25_function>。

### 5.2 时间与重要度（记忆场景特有，建议做）

你的 state 文件里已经有 `importance`、`activation`、`lastAccessedAt`、`recordedAt` ——这些是现成的、零成本的排序信号，而且和"相关性"正交。

- **Generative Agents**（Park et al., UIST 2023，<https://arxiv.org/abs/2304.03442>）的检索分就是三项加权：`recency`（指数衰减）+ `importance`（LLM 打分）+ `relevance`（余弦），三者各归一化到 [0,1] 后相加。它说明"时间衰减 + 重要度"在**记忆检索**这个任务上是被实践验证过的排序信号（其 relevance 项用了 embedding，但 recency/importance 两项与向量无关，可单独借用）。
- **MemoryBank**（<https://arxiv.org/abs/2305.10250>）用艾宾浩斯遗忘曲线做记忆强度衰减。
- 落地：`final = bm25 · (1 + α·importance) · exp(−λ·age)`，α、λ 用你的历史数据校准；`activation` 字段本质就是"使用频次"，可以直接当热度先验。

⚠️ 注意别和时间过滤混为一谈：`validTo` 非空的旧事实应该在**候选集阶段**就被过滤掉（你已经在做），而不是靠排序分压低。

### 5.3 邻近 / 短语（不建议单独做）

- 理论版是 **SDM**（Metzler & Croft, SIGIR 2005，<https://doi.org/10.1145/1076034.1076115>）：在 unigram 之外再加 ordered/unordered 的二元短语特征，用马尔可夫随机场加权求和，TREC 上有稳定提升。
- 但**你的 bigram 本身就是一种邻近特征**——bigram 命中 = "这两个字相邻出现"。所以再做短语特征的边际收益很低，而且索引和打分复杂度都会涨。
- 如果一定要加，最便宜的做法：查询里相邻的 bigram 同时命中时给一个小加成（±10%），不值得上完整 SDM。

### 5.4 同义词 / 查询扩展（不建议）

- 经典方案：Rocchio 反馈、RM3（Lavrenko & Croft 2001）。
- **但在几十~几百条文档上，伪相关反馈会放大噪声**：feedback 集合只有 3~5 条，随便一条判错，扩展词就带偏整个查询。本次基准里我也不敢加这一项来测——它的方差会盖过所有其他差异。
- 折中：只做**手工同义词表**（几十对，如"发版↔发布↔上线"），在分词阶段替换，不引入反馈回路。成本低、可控、可回滚。这也解释了 TREC-9 那组数字里 query expansion 涨得多的原因：TREC 的反馈集合大得多。

### 5.5 近重复抑制（建议，常被忽略）

记忆库最大的体感问题往往不是"搜不到"，而是"top-5 全是同一件事的三个版本"。加一条简单规则即可：同一 `topic`/`subject` 下最多保留 1~2 条，或用 MMR 做一点多样性惩罚。这比调打分函数的收益更明显。

---

## 6. 在你们这个规模上，换 BM25 值不值？

### 6.1 直接回答

**只换打分函数：不值。**
理由是三条独立的证据叠在一起：

1. **文献层面**：Zobel & Moffat 的结论是"好的相似度函数之间分不出高下"；而我**没有找到**任何针对"中文短文本、N<500"的 BM25 vs TF 余弦对照实验。也就是说，没有证据支持"换了一定更好"。
2. **本次实测**：bigram 分词下，BM25 相对 TF 余弦只有 +1.0%~+1.6% MRR，**95% CI 跨 0**；连拆出 IDF 单独做 TF·IDF 余弦，也只有 +1.1%~+1.2%，同样不显著。
3. **成本收益**：为 1% 的、测不出来的差异，去重写打分、重跑回归、发一个版本——不划算。

**但要换个说法**：BM25 里真正起作用的是 **IDF**，而 IDF 在你的规模上是**有效**的（§4），只是它单独扛不动"打分函数"这一整块改造。所以：

> 加 IDF ≈ 值得（5 行代码，顺手做）；重写成 BM25 ≈ 不值得（除非你接下来要加字段加权/时间衰减，那时 BM25 的骨架更省事）。

### 6.2 什么时候"值"会翻转

满足任意一条，就值得把 BM25 正经实现：

- **你打算把分词放宽到 unigram / bigram+unigram**：这时 IDF 从"可选项"变成"必需品"（没有 IDF，unigram 会让效果变差——实测 0.7331→0.7100）。BM25 + unigram 是本次基准里唯一一个"两个语料上相对现状都显著提升"的组合（+6.6% / +7.1%）。
- **你的库里存在"长短两版同一事实"**：b 的影响会盖过一切（干扰语料里 b=0 vs b=0.75 = +8.2 点，显著），这时你必须掌握长度归一的控制权，余弦给不了。
- **你要加字段加权**：BM25F 的骨架比"余弦 + 字段权重"更自然。

### 6.3 优先级排序（如果只做一件事）

1. **看数据**：把最近 100 次真实召回日志拉出来，人工标 top-3 对不对。**这一步的收益高于本文所有建议**——本次基准是合成的，你的真实分布只有日志能告诉你。
2. 有"长短两版"问题 → 先调 `b`（0.3~0.5 或 0），改一个常数。
3. 没有 → 把分词改成 `bigram + unigram`，同时上 IDF（§7 的代码一次到位）。
4. 还有余力 → 字段加权 + 时间衰减。

---

## 7. 最小实现要点（如果你决定做）

### 7.1 参数

| 参数 | 取值 | 说明 |
|---|---|---|
| `k1` | 1.2 | 不敏感，别调 |
| `b` | **0.3~0.5**（不是 0.75） | 记忆条目长度方差小，且旧版往往更短；0.75 会系统性地偏向短文档 |
| `δ` | 不需要 | BM25+/BM25L 针对长文档，你不适用（实测无差异） |
| IDF | `ln(1 + (N−df+0.5)/(df+0.5))` | 必须带 `+1`，否则高频词会变成负分 |
| 分词 | bigram + unigram | Lucene 的 `outputUnigrams` 模式；单字要过虚词表 |
| 归一化 | NFKC + 小写 + 数字串整体成词 | "0.9.1" 别碎成三段 |

### 7.2 数据结构（关键是 df 要增量维护）

几百条记忆、每条约 20 个 token，全量倒排也就几千个 posting——**性能不是问题，别过度设计**。启动时全量重建（O(总 token 数)，<1ms），写入时增量更新，够用到几千条。

```ts
// 零依赖 BM25（bigram+unigram）。K1/B 建议 B=0.5 起。
const K1 = 1.2, B = 0.5;

type Posting = Map<string, number>; // docId -> tf

class MemIndex {
  private post = new Map<string, Posting>(); // term -> posting list
  private df = new Map<string, number>();    // term -> 文档频次
  private len = new Map<string, number>();   // docId -> 长度
  private totalLen = 0;

  /** 分词：NFKC → 小写 → 中文 bigram(+unigram) / 英文按词 → 虚词表过滤 */
  private tokens(text: string): string[] { /* 你现有的实现，加一步：中文 run 里额外 push 每个单字 */ }

  add(id: string, text: string) {
    const toks = this.tokens(text);
    this.len.set(id, toks.length);
    this.totalLen += toks.length;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, f] of tf) {
      let p = this.post.get(t);
      if (!p) this.post.set(t, (p = new Map()));
      p.set(id, f);
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
  }

  remove(id: string, text: string) {           // 记忆会删除/取代，必须支持
    const toks = this.tokens(text);
    this.len.delete(id);
    this.totalLen -= toks.length;
    for (const t of new Set(toks)) {
      const p = this.post.get(t);
      if (!p?.has(id)) continue;
      p.delete(id);
      this.df.set(t, this.df.get(t)! - 1);
      if (p.size === 0) { this.post.delete(t); this.df.delete(t); }
    }
  }

  private idf(t: string): number {
    const N = this.len.size, df = this.df.get(t) ?? 0;
    if (N === 0 || df === 0) return 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5)); // 恒正，别用 log(N/df)
  }

  search(query: string, k = 10): Array<{ id: string; score: number }> {
    const N = this.len.size;
    if (N === 0) return [];
    const avgdl = this.totalLen / N;
    const qToks = [...new Set(this.tokens(query))];
    const scores = new Map<string, number>();
    for (const t of qToks) {
      const p = this.post.get(t);
      if (!p) continue;
      const w = this.idf(t);
      for (const [id, tf] of p) {
        const dl = this.len.get(id)!;
        const norm = 1 - B + B * (dl / avgdl);
        const s = w * (tf * (K1 + 1)) / (tf + K1 * norm);
        scores.set(id, (scores.get(id) ?? 0) + s);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id, score]) => ({ id, score }));
  }
}
```

**改动力度**：如果你只要 IDF 不要 BM25，把 `search` 里的 `(tf*(K1+1))/(tf + K1*norm)` 换成 `tf * w` 再按 `sqrt(len)` 归一，就是 TF·IDF 余弦——**5 行**，实测差距 <0.5%。

### 7.3 三个必须注意的坑

1. **别用 `log(N/df)`**：`df > N/2` 时为负。小语料 + 主题集中的记忆库里这是常态，会出现"命中得越多分越低"。
2. **`b` 别照抄 0.75**：先统计你库里"同一事实的旧版/新版"的长度分布，再决定 b 往哪边调。
3. **删除/取代要维护 df**：记忆会被 supersede/delete，只增不减会让 df 虚高、IDF 全部漂移。JSON 存储不用改，重算索引即可（你 load 时本来就全量解析一遍）。

---

## 8. 我的实测：方法与局限（请按这个前提读数字）

**数据集**：本次自建，**不是真实记忆库**。
- 语料 A（干净）：81 条中文短记忆，平均 16.4 个 bigram，覆盖 6 个主题（发版/插件/相片文档/环境/杂项/测试）。
- 语料 B（干扰）：A + 31 条"旧版本/错误版本"近重复条目 = 112 条。目的：模拟记忆库里的版本堆积。
- 查询：69 条，模仿真实召回口吻（"发版前要不要在真入口点一遍"），每条标注 1~4 个相关条目。
- 指标：MRR@10 / P@1 / R@3 / nDCG@10；显著性用**配对 bootstrap**（10000 次重采样查询，95% CI）+ 符号检验。

**数字（完整表见 `bench/out_clean.txt`、`bench/out_hard.txt`）**：

| 系统 | A: MRR | B: MRR |
|---|---|---|
| TF 余弦（现状） | 0.8962 | 0.7331 |
| TF·IDF 余弦 | 0.9085 | 0.7452 |
| BM25 无 IDF | 0.8989 | 0.7428 |
| BM25 1.2/0.75 | 0.9071 | 0.7512 |
| BM25 1.2/0 | 0.8825 | **0.8291** |
| BM25+ δ=1 | 0.9071 | 0.7512 |
| BM25L δ=0.5 | 0.9071 | 0.7512 |
| BM25 unigram | **0.9563** | 0.7823 |
| BM25 bigram+unigram | 0.9342 | 0.7597 |

**它能说明什么**：在同一分词器下，不同打分函数之间的**相对差异很小**（1~2%），而**换分词粒度**的差异更大（3~7%）；IDF 与 unigram 有强交互。
**它不能说明什么**：绝对分数不可外推（MRR 0.9 是语料太"干净"造成的天花板效应）；查询是我写的，可能无意中偏向某种匹配方式；69 条查询的统计功效有限（CI 很宽）；中文真实记忆的用词重复度、噪声、错别字都比合成语料严重。
**所以**：请把本文的数字当作"方向"和"量级"，最终决策前用你自己的召回日志标 50~100 条测一次——那才是唯一可信的评估。

复现：`node bench.js corpus.json` / `node bench.js corpus_hard.json`（纯 Node，无依赖）。

---

## 9. 参考文献

1. Robertson, Walker, Jones, Hancock-Beaulieu, Gatford. *Okapi at TREC-3*. TREC 1994. — BM25 原始出处（经 Lucene 文档转引）。
2. Lucene `BM25Similarity`（IDF 公式、k1=1.2/b=0.75、默认相似度）：<https://lucene.apache.org/core/9_9_0/core/org/apache/lucene/search/similarities/BM25Similarity.html>
3. LUCENE-6789：Lucene 6.0 把默认 similarity 改为 BM25：<https://issues.apache.org/jira/browse/LUCENE-6789>
4. Xapian《The BM25 Weighting Scheme》（公式、默认 k1=1/b=0.5、文档长度下限）：<https://xapian.org/docs/bm25.html>
5. SQLite FTS5 `bm25()`（k1=1.2/b=0.75 写死、列权重、经典 IDF 可为负）：<https://www.sqlite.org/fts5.html#the_bm25_function>
6. Lv & Zhai. *Lower-Bounding Term Frequency Normalization*. CIKM 2011. BM25+/BM25L：<https://doi.org/10.1145/2063576.2063584>
7. Xapian `BM25PlusWeight`：<https://xapian.org/docs/apidoc/html/classXapian_1_1BM25PlusWeight.html>
8. MiniSearch `BM25Params`（BM25+，b 默认 0.7，δ 默认 0.5，推荐 0.5~1）：<https://lucaong.github.io/minisearch/types/MiniSearch.BM25Params.html>
9. Lucene `CJKBigramFilter`（CJK bigram、无邻字退化为 unigram、`outputUnigrams` 混合模式）：<https://lucene.apache.org/core/8_6_2/analyzers-common/org/apache/lucene/analysis/cjk/CJKBigramFilter.html>
10. Xu, Fraser, Weischedel. *TREC-9 Cross-lingual Retrieval at BBN*. TREC-9（中文单语 bigram+unigram vs 词索引，AP 0.3362 vs 0.2888）：<https://trec.nist.gov/pubs/trec9/papers/bbn-trec9.pdf>
11. Zobel & Moffat. *Exploring the Similarity Space*. SIGIR Forum 1998（"找不到单一最优相似度函数"）：<https://people.eng.unimelb.edu.au/jzobel/fulltext/sigirforum98.pdf>
12. Robertson, Zaragoza, Taylor. *Simple BM25 Extension to Multiple Weighted Fields*（BM25F）. CIKM 2004：<https://doi.org/10.1145/1031171.1031181>
13. Metzler & Croft. *A Markov Random Field Model for Term Dependencies*（SDM）. SIGIR 2005：<https://doi.org/10.1145/1076034.1076115>
14. Park et al. *Generative Agents: Interactive Simulacra of Human Behavior*. UIST 2023（记忆检索 = recency + importance + relevance）：<https://arxiv.org/abs/2304.03442>
15. Zhong et al. *MemoryBank: Enhancing Large Language Models with Long-Term Memory*（艾宾浩斯遗忘曲线）：<https://arxiv.org/abs/2305.10250>

**明确"未找到"的项**：
- 针对"中文短文本 + 几十~几百条语料"的 BM25 vs TF-IDF/余弦对照实验：未找到。
- Trotman et al. 2014《Improvements to BM25 and Language Models Examined》全文：未能获取（远端 DNS 故障、Wayback 不可达），故未引用其结论。
- "固定 IDF 表"在小语料上的有效性研究：未找到支持依据。
