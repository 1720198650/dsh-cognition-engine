# 零依赖记忆插件：NegEx/中文否定 + 多信号排序 研究报告

> 调研日期：2026-11-04  
> 对象：`cognition-engine`（零依赖 TypeScript、纯 JSON、几十~几百条记忆、中文为主）  
> 要求：A 部分能直接写进代码；B 部分能下判断。查不到的明确写「未找到」，不补全、不推测成事实。

---

## 0. 开工自查（本次适用哪几条）

| 准则 | 是否适用 | 说明 |
|---|---|---|
| `ctxt-00001` 功能发版前六步 | **不适用** | 本任务只出调研报告，没有发版动作。 |
| `ctxt-00002` 纯文档只推 commit、不动版本 | **不适用** | 不涉及提交/版本。 |
| `ctxt-00005` npm 发布加官方 registry | **不适用** | 不发布 npm 包。 |
| `ctxt-00003` 插件零外部依赖、纯 JSON、不上 SQLite | **适用** | 这是 B 部分方案的硬约束：不引入 embedding、向量库、训练框架；只比较纯 TS/JSON 可实现的排序。 |
| `gap-1` DSH client slot | **不适用** | 与本任务无关。 |

---

## 1. 结论先行

### A. NegEx / 中文否定

1. **NegEx 的作用域不是「固定 6 个词」这么简单**：原论文/ConText 论文描述为「trigger 后 6 个 token（后置 trigger 为前 6 个 token），遇到终止词或句末就停」；但 NegEx 作者后来维护的实现把**前置作用域放宽到句末/终止词**，只保留**后置作用域 5 words / 6 tokens**。工程上应「前置用终止词+句界，后置用 5–6 token/分句起点」，不要死守 12 字。
2. **伪否定必须最先处理**：官方 NegEx 词表有 16 个伪否定短语（+ `without contrast`）。实现顺序必须是「最长匹配 → 伪否定优先 → 跳过其内部 trigger」，否则 `no change` 会把 `tumor` 误判为否定。
3. **中文没有成熟的「NegEx + 作用域」开源实现**。最接近的是 `@isdk/zh-negation`（零依赖 TS、`Intl.Segmenter` 词边界、按否定标记奇偶判双重否定），但它**不建模作用域**；中文临床可用的触发词/断言体系在 WILAB-HIT 的标注规范里（常见否定词 8 个 + 7 类断言）。
4. **中文双重否定不是边角**：8,639 句中文双重否定数据集里，`不+助动词+不` 3,611 句、`无不` 1,237 句、`非…不可/不行` 776 句；83.2% 是「加强肯定」。必须在冲突检测前归一化，否则 `不得不` 会被当成否定。
5. **ConText 对「准则冲突检测」很有借鉴**：把「否定/时间/经验者」三轴（再加 certainty/condition）作为**冲突前置过滤**；时间不同叫「版本取代」，条件不同叫「条件例外」，经验者不同叫「来源冲突」，都不应报「矛盾」。

### B. 多信号排序

1. **Generative Agents 的公式是「归一化后加权和」**：论文正文/公开解读通常按三项等权（α=1）理解，官方参考实现却是 `gw=[0.5, 3, 2]`、`recency_decay=0.99`，且 recency 用「按 last_accessed 排序后的 `0.99^i`」再 min-max。**论文权重和代码权重不一致，说明这些权重是手调的，不是验证过的定律。**
2. **MemGPT / A-MEM / MemoryBank 都没有多信号排序**：MemGPT 是纯向量检索；A-MEM 是纯 cosine top-k；MemoryBank 是 dual-tower + FAISS，Ebbinghaus 只用于「记忆强度/遗忘」，不参与检索打分。
3. **RRF 公式**：`score(d)=Σ_r 1/(k+rank_r(d))`，原论文 `k=60` 是 pilot 定的；它**不需要训练、不需要分数归一化**，但**丢掉了分数幅度**，且 `k` 本身是参数。小规模（几十~几百条）下 `k=60` 会把名次差压得很扁，容易「和稀泥」，不适合作为主排序。
4. **现有公式不是「明显错误」，但有四个硬伤**：`legacy = helpful − harmful×2` 无界、`mark` 与 `markUsage` 可能双重计数、冷启动 `n=0 → 0`、`orphaned=-100` 在注入路径已被硬过滤（只影响淘汰排序）。另外 `harmful×2` 只施加在 legacy，新 usage 路径的 `appliedBad` 只算 1 倍，**同一事件两条路径权重不一致**。
5. **判断**：**不要换成 RRF 主排序，也不要照搬 Generative Agents 的公式**。换成「有界归一化加权和 + Beta 收缩反馈 + 硬过滤」，权重显式化、可解释、可小样本标定；RRF 只保留作辅助融合（如果确实有两个独立排名）。

---

# A. NegEx 完整规范与中文落地

## A1. NegEx 原始算法（Chapman et al. 2001）

**出处**：Chapman WW, Bridewell W, Hanbury P, Cooper GF, Buchanan BG. *A simple algorithm for identifying negated findings and diseases in discharge summaries.* J Biomed Inform. 2001;34(5):301–310. DOI: [10.1006/jbin.2001.1029](https://doi.org/10.1006/jbin.2001.1029)；摘要：[Europe PMC 12123149](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:12123149&format=json&resultType=core)。

### A1.1 算法步骤

作者维护的算法说明（[NegExAlgorithmDescription.wiki](https://code.google.com/archive/p/negex/wikis/NegExAlgorithmDescription.wiki)）把规则拆成三类词 + 两条正则：

1. **分句**：以句子为处理单位。
2. **找触发词**：从左到右找第一个否定词 `Neg1`。
3. **伪否定**：如果 `Neg1` 是 pseudo-negation，跳到下一个否定词。
4. **前置否定（pre-condition）**：作用域从 trigger **向后**，直到：
   - 遇到终止词（termination term），或
   - 遇到另一个否定/伪否定词，或
   - 句子结束。
5. **后置否定（post-condition）**：作用域从 trigger **向前**，取 5 words / 6 tokens（多词概念算 1 个 token）。
6. 对句中所有否定词重复。

> 关键细节：**另一个否定词也会截断前一个否定的作用域**。例如 `denies chest pain and has no shortness of breath`，第一个 `denies` 的作用域到 `no` 前为止。

### A1.2 作用域窗口：6 token 还是 5 words？

这里有两套说法，必须分清：

| 来源 | 说法 | 适用 |
|---|---|---|
| ConText 论文（Harkema et al. 2009）§3.1.4 | NegEx 的作用域「a priori restricted to a window of **six tokens**（多词概念算一个 token）following the trigger term（post-trigger 为 preceding six tokens）；遇到终止词或句末就结束」 | 描述 **NegEx 原算法** |
| NegEx 作者 wiki | 「Historically, NegEx set `$` to **five words**（a word 可以是单词或短语）；加入终止词后，RE1 的 `$1` 改为任意长度；当前版本 **RE1 任意长度，RE2 仍是 five words / medical phrases**」 | 描述 **作者后续实现** |
| GeneralNegEx.java | 注释写「Sentence boundaries serve as WINDOW for negation」；代码按句子传入，前置作用域到句界/下一个 trigger | 描述 **Java 参考实现** |

**结论（工程上可直接采用）**：

- **前置 trigger**：不设硬窗口；从 trigger 后到第一个终止词/另一个 trigger/句末，**建议再加一个 40 字安全上限**（防止极端长句）。
- **后置 trigger**：从 trigger 前到第一个终止词/分句起点/句首，**最多 5–6 个 token**；中文可按 12–24 字。
- **不要**把「6 token」当成所有方向的硬窗口；ConText 的实验证明放宽前置作用域能提升效果（见 A5）。

### A1.3 三类否定词 + 伪否定

| 类型 | 作用 | 例子 | 处理 |
|---|---|---|---|
| Pseudo-negation | 看起来像否定，其实不否定 | `no change`, `not only`, `gram negative` | **跳过**，继续找下一个 trigger |
| Pre-condition negation | trigger 在目标之前 | `no`, `denies`, `without` | 向后取作用域 |
| Post-condition negation | trigger 在目标之后 | `free`, `was ruled out`, `negative` | 向前取作用域 |
| Possibility phrase | 表示「可能/待排除」，不是否定 | `rule out`, `r/o`, `should be ruled out` | 标 `possible/hypothetical`，**不要标 negated** |

> `rule out pneumonia` 在临床文本里是「考虑肺炎、待排除」，不是「没有肺炎」。只有 `pneumonia was ruled out` 才是否定。这个区分对冲突检测很重要：`rule out A` vs `A` 不是矛盾，是假设。

### A1.4 终止词（termination terms）

官方核心 13 个（negspacy 的 `en` termset，[termsets.py](https://github.com/jenojp/negspacy/blob/master/src/negspacy/termsets.py)）：

```
although, apart from, as there are, aside from, but, except, however,
involving, nevertheless, still, though, which, yet
```

官方 wiki 另有一大批**病因/来源**终止词（[NegExTerms.wiki](https://code.google.com/archive/p/negex/wikis/NegExTerms.wiki)）：

```
secondary to,
as the cause/source/reason/etiology/origin of/for,
as a cause/source/reason/etiology/origin of/for,
as a secondary cause/source/reason/etiology/origin of/for,
cause of/for, causes of/for,
source of/for, sources of/for,
reason of/for, reasons of/for,
etiology of/for,
origin of/for, origins of/for,
other possibilities of, trigger event for
```

**为什么这些是终止词**：`no evidence of pneumonia secondary to COPD` 里，`secondary to` 之后是病因，不属于「no evidence of」的作用域。

### A1.5 后向作用域（trigger 在目标之后）

官方后置否定（post-condition）列表：

```
unlikely, free,
was ruled out, is ruled out, are ruled out,
have been ruled out, has been ruled out,
negative, resolved, ruled out,
not seen, is absent, is not seen, are not seen,
can be ruled out
```

处理规则：

1. 从 trigger **向左**找；
2. 遇到终止词/分句起点/句首停止；
3. 最多 5 words / 6 tokens（中文 12–24 字）；
4. 把作用域内的目标标 negated。

**例**：
- `She is tumor free.` → `free` 向左作用到 `tumor`。
- `The chest x-ray was negative.` → `negative` 向左作用到 `chest x-ray`。
- `Pneumonia was ruled out.` → negated。
- `Rule out pneumonia.` → **possible**，不是 negated。

### A1.6 原始论文的性能（用于判断「值不值得抄」）

在 1,000 句出院小结、1,235 个 findings/diseases 上（[Europe PMC 摘要](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:12123149&format=json&resultType=core)）：

| 指标 | NegEx | 基线 |
|---|---:|---:|
| Specificity | **94.5%** | 85.3% |
| Positive predictive value | **84.5%** | 68.4% |
| Sensitivity | **77.8%** | 88.3% |

结论：**规则法精度高、召回中等、可审计、零训练**，和本插件的约束高度匹配；但它的召回短板也说明「只靠否定词表」不够，需要作用域和上下文轴。

---

## A2. 英文词表（可直接写进代码）

> 说明：2001 年论文全文的「原始 50 词」未在公开摘要中给出；下面是**作者官方 NegEx 词表**（Google Code）按语义去重后的核心 50 个，以及官方完整变体的生成方式。ConText 论文称其否定 trigger 已扩展到 **143 个**（含变体）。

### A2.1 伪否定（官方 16 + 1）

```ts
const EN_PSEUDO_NEGATIONS = [
  'no increase',
  'no suspicious change',
  'no significant change',
  'no change',
  'no interval change',
  'no definite change',
  'no significant interval change',
  'not extend',
  'not cause',
  'not drain',
  'not certain if',
  'not certain whether',
  'gram negative',
  'without difficulty',
  'not necessarily',
  'not only',
  // ConText 2009 增加的放射科伪触发词
  'without contrast',
] as const;
```

注意：

- 这些短语**内部含 `no/not/without`**，但语义不是否定目标。必须**最长匹配优先**，命中后跳过整个短语，不能再去匹配里面的 `no`。
- `negspacy` 还加了 `no further`、`not able to be`、`without any further`、`might not` 等（[termsets.py](https://github.com/jenojp/negspacy/blob/master/src/negspacy/termsets.py)），属于工程扩展，不是原论文核心。

### A2.2 前置否定：核心 50 个（按语义去重）

| # | 词/短语 | 族 |
|---:|---|---|
| 1 | absence of | absence |
| 2 | cannot | modal |
| 3 | checked for | test/evaluate |
| 4 | declined | patient report |
| 5 | denies | patient report |
| 6 | evaluate for | test/evaluate |
| 7 | fails to reveal | test result |
| 8 | free of | absence |
| 9 | negative for | test result |
| 10 | never | temporal |
| 11 | no | core |
| 12 | no abnormal | no + adjective |
| 13 | no cause of | no + etiology |
| 14 | no complaints of | no + symptom |
| 15 | no evidence | no + evidence |
| 16 | no findings | no + evidence |
| 17 | no mammographic evidence | no + imaging |
| 18 | no new | no + change |
| 19 | no radiographic evidence | no + imaging |
| 20 | no sign of | no + sign |
| 21 | no significant | no + degree |
| 22 | no suggestion of | no + suggestion |
| 23 | no suspicious | no + suspicion |
| 24 | not | core |
| 25 | not appear | not + appearance |
| 26 | not appreciate | not + perception |
| 27 | not associated with | not + association |
| 28 | not complain of | not + symptom |
| 29 | not demonstrate | not + evidence |
| 30 | not exhibit | not + evidence |
| 31 | not feel | not + perception |
| 32 | not had | not + history |
| 33 | not have | not + possession |
| 34 | not know of | not + knowledge |
| 35 | not known to have | not + knowledge |
| 36 | not reveal | not + evidence |
| 37 | not see | not + perception |
| 38 | not to be | not + copula |
| 39 | patient was not | patient + not |
| 40 | rather than | contrast |
| 41 | resolved | change |
| 42 | test for | test/evaluate |
| 43 | to exclude | test/evaluate |
| 44 | unremarkable for | test result |
| 45 | with no | with + no |
| 46 | without | core |
| 47 | without evidence | without + evidence |
| 48 | without indication | without + indication |
| 49 | without sign | without + sign |
| 50 | rules out / ruled out | rule-out family |

**rule-out 变体不要手抄**，用模板生成：

```
{rule|rules|ruled|did rule|can rule|adequate to rule|sufficient to rule}
  [him|her|the patient]
  out
  [for|against]
```

这样能覆盖官方词表里 ~90 个 `rule out` 变体，而代码只维护 6 个模板。

### A2.3 后置否定（15 个）

```ts
const EN_POST_NEGATIONS = [
  'unlikely',
  'free',
  'was ruled out',
  'is ruled out',
  'are ruled out',
  'have been ruled out',
  'has been ruled out',
  'negative',
  'resolved',
  'ruled out',
  'not seen',
  'is absent',
  'is not seen',
  'are not seen',
  'can be ruled out',
] as const;
```

### A2.4 可能/假设（不是否定）

```ts
const EN_POSSIBILITY = [
  'rule out',
  'r/o',
  'ro',
  'rule him out',
  'rule her out',
  'rule the patient out',
  'rule out for',
  'be ruled out',
  'should be ruled out',
  'ought to be ruled out',
  'may be ruled out',
  'might be ruled out',
  'could be ruled out',
  'will be ruled out',
  'can be ruled out',
  'must be ruled out',
  'is to be ruled out',
  'what must be ruled out is',
] as const;
```

**分类要点**：

- `rule out X` / `r/o X` → `hypothetical` / `possible`；
- `X was ruled out` / `X is ruled out` → `negated`；
- `did not rule out X` → `possible`（没有排除，不是否定）；
- `not ruled out` → `possible`；
- `can be ruled out` 语境依赖：`X can be ruled out`（后置）通常是否定；`can be ruled out X`（前置）是可能。实现时按**方向**区分，不要只按短语。

### A2.5 终止词（核心 13 + 临床扩展）

```ts
const EN_TERMINATORS = [
  // 官方核心 13
  'although', 'apart from', 'as there are', 'aside from', 'but',
  'except', 'however', 'involving', 'nevertheless', 'still',
  'though', 'which', 'yet',
  // 临床/病因扩展（官方 wiki）
  'secondary to',
  'cause of', 'cause for', 'causes of', 'causes for',
  'source of', 'source for', 'sources of', 'sources for',
  'reason of', 'reason for', 'reasons of', 'reasons for',
  'etiology of', 'etiology for',
  'origin of', 'origin for', 'origins of', 'origins for',
  'other possibilities of', 'trigger event for',
] as const;
```

> `unless`、`except if` 不是 NegEx 官方终止词；它们是**条件/例外标记**，建议单独归到 `CONDITIONAL_MARKERS`，不要混进终止词。

### A2.6 实现顺序（英文）

```text
1. 归一化：小写、压空格、保留标点。
2. 按句切分（. ! ? 换行）。
3. 最长匹配所有 trigger（含 pseudo/post/possibility），记录位置和类型。
4. 先剔除 pseudo：如果某个 trigger 落在 pseudo 短语的字符区间内，丢弃。
5. 对剩余 trigger：
   - pre：向后到 terminator/下一个 trigger/句末；
   - post：向前到 terminator/分句起点/句首，最多 6 token；
   - possibility：标 possible，不标 negated。
6. 同一个目标被多个 trigger 覆盖时：negated 优先于 possible；更靠近目标的 trigger 优先。
```

---

## A3. 中文否定检测

### A3.1 汉语否定的分类

汉语没有空格，且否定是**词汇+句法**现象。工程上建议分 6 类，而不是只分「否定词/副词/动词」：

| 类别 | 作用 | 例子 | 备注 |
|---|---|---|---|
| 否定副词 | 否定动作/性质 | 不、没、没有、别、甭、勿、莫、未、未曾、未必、不必、无须、绝不、从不、从未、毫不、并不、并非 | 最核心，需词边界 |
| 否定动词 | 否定存在/领有/认知 | 无、没有、缺乏、缺少、否认、排除、拒绝、避免、防止、禁止、忌、停止、取消 | 临床/规则文本高频 |
| 否定形容词/状态 | 否定性质/结果 | 阴性、(-)、不大、不明显、欠佳、不合格、不符合、不支持、不考虑 | 常后置 |
| 文言/正式 | 书面否定 | 非、否、无、未、莫、勿、毋、弗、靡、罔、休 | 规则/法律文本 |
| 双重否定 | 否定之否定=肯定/强调 | 不得不、不能不、未尝不、非…不可、无不、无非、不无、未必不、不是不、不否认、不排除 | 必须先归一化 |
| 道义否定 | 禁止/不允许 | 不得、禁止、严禁、切勿、不允许、不应、不能、不可、不要、不必 | 规则文本的「否定」不是事实否定，是**禁止** |

> 关键区分：`不得跳步` 不是「跳步这件事为假」，而是「禁止跳步」。它和 `必须跳步` 是**道义冲突**；和 `跳步了` 不是同一层面的否定。建议在 assertion 里加 `modality: 'prohibition' | 'obligation' | 'permission' | 'advice' | 'factual'`，不要把所有 `不/未/无` 都当同一种否定。

### A3.2 中文触发词表（建议内置）

> 来源：WILAB-HIT 中文临床标注规范（[Entity_Assertion_Relation.pdf](https://github.com/WILAB-HIT/Resources/blob/master/entity_assertion_relation/annotation_guidelines/Entity_Assertion_Relation.pdf)）给出临床常见否定词：`未及、未见、未触及、未诉、未闻及、否认、不伴、无`；其余为通用汉语/规则文本补充。**不是穷尽列表**，领域可扩展。

```ts
// 通用否定（词边界匹配；单字触发词要最小心）
const ZH_NEG_CORE = [
  '不', '没', '没有', '别', '甭', '勿', '莫', '未', '非', '否', '休',
] as const;

// 否定副词/否定动词（多字优先）
const ZH_NEG_MULTI = [
  '没有', '不是', '不能', '不会', '不要', '不必', '不该', '不应',
  '不可', '不得', '不准', '不许', '不需要', '无需', '无须',
  '未能', '尚未', '未曾', '未尝', '未必', '从未', '从不',
  '并非', '并不', '绝不', '决不', '毫不', '毫无', '无法',
  '否认', '排除', '除外', '缺乏', '缺少', '缺如',
  '避免', '防止', '禁止', '严禁', '切勿', '忌', '停止', '取消',
] as const;

// 中文临床高频（WILAB 规范 + 常见变体）
const ZH_CLINICAL_NEG = [
  '未及', '未见', '未触及', '未诉', '未闻及', '否认', '不伴', '无',
  '未发现', '未引出', '未显示', '未提示', '未支持', '未证实',
  '阴性', '(-)', '不大', '不明显', '未增高', '未降低',
  '未回升', '未恢复', '未使用', '未执行', '未通过',
  '不合格', '不符合', '不支持', '不考虑', '不再',
  '已停用', '已废弃',
] as const;

// 规则/指令文本的道义否定（建议单独 modality）
const ZH_DEONTIC_NEG = [
  '不得', '禁止', '严禁', '切勿', '不允许', '不应', '不能', '不可',
  '不要', '不必', '无需', '无须', '不准', '不许',
  '不得将', '不得在', '不得以', '不得对',
] as const;
```

**单字触发的坑**（必须用词边界/白名单）：

| 字 | 真否定 | 伪否定/实词 |
|---|---|---|
| 未 | 未能、尚未、未曾、未发现 | 未来、未免 |
| 无 | 无压痛、无浮肿、无效 | 无锡、无意、无关、无论、无穷、无限、无奈、无耻 |
| 非 | 非本院、非计划 | 非常、非洲、非法、是非、非议 |
| 不 | 不去、不得、不能 | 不仅、不但、不光、不只、不单、非但、不止、不啻、不管、不论、无论、不妨、不免、不由得、不禁、不料、不愧、差不多、差点、恨不得、巴不得 |
| 别 | 别去、别动 | 别人、别的、特别、区别、分别、类别、级别、差别、告别、送别 |
| 否 | 否认、否定 | 是否、否则、否定（作名词时） |

> 这张表与 `@isdk/zh-negation` 的 `CHINESE_NON_NEGATION_WORDS` 基本同构（[源码](https://github.com/isdk/excerpt-match.js/tree/main/packages/zh-negation)）。它的取舍是「多义词默认保守」：`未来` 默认按时间名词，不当否定；需要时用领域词表覆盖。这个策略适合本插件（误拒代价高于漏判）。

### A3.3 中文终止词/分句词表

```ts
const ZH_SCOPE_STOP = [
  // 强句界
  '。', '！', '？', '；', '\n',
  // 转折/对照
  '但', '但是', '然而', '不过', '只是', '却', '而', '反而', '相反',
  '否则', '不然',
  // 因果/推论
  '因此', '所以', '于是', '从而', '因为', '由于',
  // 条件/让步
  '如果', '若', '假如', '倘若', '一旦', '虽然', '尽管', '即使', '哪怕',
  '除非', '除了',
  // 并列/递进
  '以及', '并且', '而且', '或', '或者', '与', '和', '及', '同',
  // 时间/顺序
  '同时', '随后', '之后', '此前', '以前', '现在', '目前',
  '已', '已经', '不再', '尚未',
  // 补充/列举
  '另外', '此外', '其余', '其他',
] as const;
```

**不要用逗号做硬终止**。中文临床论文明确提醒：分句时不能把逗号当界限，否则会受标点录入错误影响（[中文电子病历否定术语检出方法研究](https://doi.org/10.7507/1001-5515.20150015)）。规则文本里 `不得将 A，B 一起执行` 的逗号也在作用域内。逗号只在「后面出现新主语/新分句」时作为软边界。

### A3.4 中文作用域：规则法 vs 统计法

| 方法 | 做法 | 优点 | 缺点 | 代表 |
|---|---|---|---|---|
| 规则法 | trigger + 终止词 + 句界/分句；可加依存句法 | 零训练、可审计、快 | 覆盖有限；中文后置否定/双重否定难 | NegEx 中文适配、2015 电子病历规则+共现 |
| 统计法 | BiLSTM / BiLSTM-CRF / BERT，序列标注 cue + scope | 召回高、可学习复杂结构 | 需要标注数据/模型；零依赖插件不可行 | 2019《汉语否定与不确定覆盖域检测》用 BiLSTM；2017 中文临床 character/word embedding；2018 BiLSTM-CRF |
| 混合 | 规则召回 + 统计重排/分类 | 平衡 | 仍需模型 | 临床 NLP 常见 |

**对本插件的结论**：只能走规则法；但可以借鉴统计法的**标注口径**（cue/scope 分开、scope 用字符区间），把规则输出成 `{trigger, start, end, polarity}`，以后要换模型也不用改上层。

### A3.5 开源中文实现核查（2026-11-04）

| 项目 | 类型 | 能力 | 可用性判断 |
|---|---|---|---|
| [`@isdk/zh-negation`](https://www.npmjs.com/package/@isdk/zh-negation)（[GitHub](https://github.com/isdk/excerpt-match.js/tree/main/packages/zh-negation)） | TypeScript，0 依赖，MIT | 词边界感知、伪否定白名单、双重否定按标记奇偶判、英文缩写 | **最接近需求**；但**不建模作用域**；README 自述「他没有说不去」会算成双重否定；年轻、下载量低，不能当成熟依赖，只能借鉴/自写 |
| [`pkucoli/NegationScopeAnnotation`](https://github.com/pkucoli/NegationScopeAnnotation) | 语料 | 8,000 句中文否定标注（非母语者原句 + 母语者改写） | 只能做评测/规则校验，不是实现 |
| [`LANGUAGE-UNDERSTANDING/Chinese_Double_Negation`](https://github.com/LANGUAGE-UNDERSTANDING/Chinese_Double_Negation) | 数据集 | 8,640 行双重否定结构 + 语气标注 | 只能做规则覆盖统计 |
| [`dahainongzhuang/Chinese-Medical-Negation-Detector`](https://github.com/dahainongzhuang/Chinese-Medical-Negation-Detector) | 仓库 | 只有 79 字节 README，无代码 | **不可用** |
| [`WILAB-HIT/Resources`](https://github.com/WILAB-HIT/Resources) | 标注规范 | 中文临床实体/断言/关系标注，含常见否定词 | 可当词表/标签体系来源，不是代码 |

**结论**：**未找到成熟、可直接复用的「中文 NegEx + 作用域」开源实现**。`@isdk/zh-negation` 是最接近的零依赖 TS 实现，但只做「是否否定」，不做「否定到哪」。本插件应自写作用域层，复用它的词边界/白名单/奇偶思想即可。

### A3.6 有没有专门讲「中文规则/指令文本」否定识别的论文？

**未找到**。公开检索（中英文）没有找到专门针对「中文规则/指令/规范文本」的否定识别论文。最接近的三类：

1. **中文法律文本否定**：《关于〈中华人民共和国民法典〉的显性否定表达研究》，研究《民法典》的显性否定表达（[期刊页](https://yyflyj.cupl.edu.cn/CN/abstract/abstract68.shtml)）。法律条文是「规则文本」，但研究重点是语言描写，不是可执行算法。
2. **中文临床文本否定**：见 A3.4/A3.5，有规则法和统计法，但领域是病历，不是指令。
3. **英文需求/规范文本**：有 conditional statements checking 等工作（如 [Automated Conditional Statements Checking for Complete Natural Language Requirements Specification](https://doi.org/10.3390/app11177892)），但中文没有对应论文。

**对本插件的含义**：没有现成论文可抄；只能把 NegEx/ConText 的框架 + 中文语法/词表 + 你自己的规则文本测试集结合起来。这是本插件可以做出的差异化，但要用测试集证明。

---

## A4. 中文伪否定/双重否定：可直接用的规则

### A4.1 数据证据：8,639 句双重否定

数据集：[`Chinese_Double_Negation_8640_With_Modality_Annotation.xlsx`](https://github.com/LANGUAGE-UNDERSTANDING/Chinese_Double_Negation)。我统计了 8,639 条（去表头）：

| 结构 | 数量 | 占比 |
|---|---:|---:|
| `不+助动词+不`（不得不/不能不/不会不/不敢不…） | 3,611 | 41.8% |
| `无不` | 1,237 | 14.3% |
| `非…不可/不行` | 776 | 9.0% |
| `不+是+…不` | 702 | 8.1% |
| `不无` | 565 | 6.5% |
| `不+助动词+没/没有` | 356 | 4.1% |
| `莫不` | 246 | 2.8% |
| `没有不` | 221 | 2.6% |
| `无…不` | 155 | 1.8% |
| `并非不/没/没有/无` | 149 | 1.7% |
| `没/没有…不` | 137 | 1.6% |
| `不…不行/不好` | 83 | 1.0% |
| 其他（非叙实动词、`非…莫属`、`没不`、`别没` 等） | 401 | 4.6% |

语气分布：

| 语气 | 数量 | 占比 |
|---|---:|---:|
| 语气强，加强肯定 | 7,186 | 83.2% |
| 语气弱，削弱肯定 | 1,432 | 16.6% |
| 语气较强，加强肯定 | 21 | 0.2% |

**结论**：中文双重否定**绝大多数是肯定/强调**，不是否定。冲突检测前必须把它归一化，否则 `不得不`、`不能不`、`无不` 会被当成否定，产生大量假冲突。

### A4.2 规则表（建议按顺序执行）

| 优先级 | 规则（正则示意） | 处理 | 例子 |
|---:|---|---|---|
| 1 | `不(?:得|能|会|敢|可|应|该|肯|愿|由|妨|禁|觉|免|惜|够)不` | **肯定** + 义务/强调 | 不得不去、不能不重视、不会不知道 |
| 2 | `不(?:是|为)[^，。；！？]{0,12}不` | **肯定**（弱/强调，视语境） | 不是不重要、并不是不想去 |
| 3 | `非[^，。；！？]{0,12}(?:不可|不行|莫属)` | **肯定** + 义务/唯一 | 非做不可、非他莫属 |
| 4 | `(?:未尝|未必|并非|并不是|不是|不无|无不|无非|莫不|没有不|无[^，。；]{0,8}不|没[^，。；]{0,8}不)` | **肯定/强调** | 未尝不可、未必不知道、无不称赞、无非是时间问题、没有不夸 |
| 5 | `不(?:得|能|会|敢|可|应|该|肯|愿)(?:没|没有)` | **肯定** + 义务/必须 | 不能不没有准备、不得不没有退路 |
| 6 | `不[^，。；！？]{0,8}(?:不行|不好|不可)` | **肯定** + 义务 | 不去不行、不休息不好 |
| 7 | `(?:不否认|不排除|未尝不可|不无可能|不无道理)` | **弱肯定/可能** | 不否认有风险、不排除失败 |
| 8 | `(?:不仅|不但|不光|不只|不单|非但|不止|不啻)` | **递进/补充**，不否定 | 不仅要做 A，还要做 B |
| 9 | `(?:不管|不论|无论|除非|除了|除…外|否则|是否|否定)` | **非否定/条件/例外** | 无论怎样、除非修好否则不发布 |
| 10 | `(?:未来|非常|无锡|非洲|别人|别的|非法|是非|非议|无意|无关|无穷|无限|无奈|无耻|特别|区别|分别|类别|级别|差别|告别|送别|休息|退休|未免|不免|不妨|不禁|不由得|不料|不愧|差不多|差点|恨不得|巴不得)` | **伪否定**，不否定 | 未来、非常高兴、无锡、别人 |
| 11 | `不(?:认为|觉得|相信|希望|知道|意识到|承认)[^，。；]{0,12}(?:不|没|没有)` | **嵌套/不确定**，不要硬判 | 不认为他不去、不觉得没问题 |
| 12 | 单字 `不/没/无/未/非/别/莫/勿/否/休` | **真否定**（仅在词边界、且不在 1–11 内） | 不去、没来、无压痛、未发现 |

**实现顺序**：

```text
1. 归一化（全角转半角、去多余空格、保留标点）。
2. 先匹配“最长”的双重否定/伪否定/例外短语（按长度降序）。
3. 命中 1–7：输出 polarity=affirmed（可带 emphasis/obligation），跳过整个短语。
4. 命中 8–10：输出 polarity=none/conditional，跳过整个短语。
5. 命中 11：输出 polarity=uncertain（嵌套否定），跳过整个短语，不做硬判。
6. 剩余位置再做真否定 trigger 匹配（词边界 + 最长匹配）。
7. 统计否定标记时，只统计“真否定”，不要用简单奇偶；奇偶只能作为双重否定的兜底。
```

> `@isdk/zh-negation` 用「标记个数奇偶」处理双重否定；这在 `不得不` 上有效，但在 `他没有说不去` 上会错（两个否定标记 → 判肯定，实际是「他没有说“不去”」）。**奇偶只能兜底，不能替代作用域/嵌套**。

### A4.3 「除非」怎么处理

`除非` 不是否定词，是**必要条件/例外标记**。三种常见结构：

| 结构 | 语义 | 处理 |
|---|---|---|
| `除非 X，否则不 Y` | 只有 X 才 Y；X 是例外条件 | `除非` 标 `condition`；`不 Y` 仍是否定，但作用域只在后分句；不要把它当成对 X 的否定 |
| `除非 X，才 Y` | 只有 X 才 Y | `除非` 标 `condition`；`Y` 是肯定 |
| `除了 X 以外，都 Y` | X 是例外；其余都 Y | `除了` 标 `exception`；`都 Y` 作用于其余集合，不是否定 X |

**冲突检测**：`除非 X 否则不发布` 与 `发布` 不是无条件矛盾；只有当前条件 `X` 未满足时才冲突。建议把 `condition` 作为 assertion 的一轴，而不是把 `除非` 当否定词。

### A4.4 中文测试用例（建议直接进 test.ts）

```ts
const ZH_NEGATION_CASES = [
  // [文本, 期望 polarity, 说明]
  ['不得跳步', 'negated', '道义否定'],
  ['不得不跳步', 'affirmed', '双重否定=必须'],
  ['不能不重视', 'affirmed', '双重否定=必须'],
  ['未尝不可以', 'affirmed', '双重否定=可以'],
  ['非修好不可', 'affirmed', '双重否定=必须'],
  ['无不称赞', 'affirmed', '双重否定=全都'],
  ['不无道理', 'affirmed', '弱肯定'],
  ['未必不知道', 'affirmed', '双重否定=可能知道'],
  ['不是不重要', 'affirmed', '弱肯定'],
  ['不否认有风险', 'affirmed', '弱肯定/承认'],
  ['不排除失败', 'possible', '可能，不是否定'],
  ['不仅要做 A，还要做 B', 'affirmed', '递进，不否定'],
  ['除非修好，否则不发布', 'conditional+negated', '条件+后分句否定'],
  ['除了 A 以外都不行', 'exception+negated', '例外+其余否定'],
  ['未来要支持', 'affirmed', '未来=时间名词'],
  ['非常高兴', 'affirmed', '非常=实词'],
  ['无锡站', 'affirmed', '地名'],
  ['别人说的', 'affirmed', '别人=实词'],
  ['他没有说不去', 'nested/uncertain', '矩阵否定 + 宾语内否定；奇偶会错，规则引擎应保守标 uncertain'],
  ['压痛阴性', 'negated', '后置否定'],
  ['病理征未引出', 'negated', '后置否定'],
  ['双肺未闻及干湿性啰音', 'negated', '前置否定'],
  ['腹壁静脉曲张：无', 'negated', '后置“无”'],
  ['无明显诱因出现头痛', '头痛=affirmed, 诱因=negated', '否定的是“诱因”，不是“头痛”；scope 必须只覆盖“明显诱因”'],
];
```

最后一条尤其重要：`无明显诱因出现头痛` 的 `无` 只否定「明显诱因」，不否定「头痛」。如果实现把整句当 scope，就会把「头痛」误判为 negated。**作用域必须细到短语/分句，不能整句一刀切。**

---

## A5. ConText：三维度与对「准则冲突检测」的借鉴

**出处**：Harkema H, Dowling JN, Thornblade T, Chapman WW. *ConText: An algorithm for determining negation, experiencer, and temporal status from clinical reports.* J Biomed Inform. 2009;42(5):839–851. DOI: [10.1016/j.jbi.2009.05.002](https://doi.org/10.1016/j.jbi.2009.05.002)；开放全文：[PMC2757457](https://pmc.ncbi.nlm.nih.gov/articles/PMC2757457/)。

### A5.1 三个维度

| 维度 | 取值 | 默认 | trigger 数 | pseudo 数 | 例子 |
|---|---|---|---:|---:|---|
| Negation | affirmed / negated | affirmed | 143 | 17 | no, denies, ruled out |
| Temporality | recent / historical / hypothetical | recent | 10 historical + 11 hypothetical | 17 + 4 | history, status post, if, should |
| Experiencer | patient / other | patient | 26 | 18 | family history, mother's |
| Termination | 12 类 | — | — | — | presenting, patient, because, diagnosis, ED, etiology, recent, remains, consistent, which, and, but |

> 数字来自 ConText 论文 §3.1.2；`historical` 定义为「>2 周前起病」，`hypothetical` 为「既非 recent 也非 historical」；`experiencer=other` 是「患者以外的人」。

### A5.2 作用域规则（比 NegEx 更宽）

1. **默认**：trigger 向右到句末，遇到 termination term 停止。
2. **历史 one-condition trigger**：`pre-existing`、`status post`、`s/p` 只作用到右边一个 condition。
3. **后置 trigger（14 个 left-looking）**：从 trigger 向左到句首，可被 termination term 截断；例：`is ruled out`、`are not seen`、`negative`。
4. **section 标题**：如果 historical trigger 在 section 标题里，作用域覆盖整个 section（需要先识别 section）。

**与 NegEx 的差别**：ConText 取消了 6-token 窗口，作用域到终止词/句末；论文说这样效果更好。这对本插件的启示：**规则文本里不要用 12 字硬截断；用终止词+分句，再加一个安全上限即可。**

### A5.3 对「准则冲突检测」的借鉴（核心）

当前插件只做「否定作用域 + 二元组覆盖率」，把「时间/条件/经验者」差异都当成潜在矛盾。ConText 的思路可以把它拆成 **5 轴 assertion**：

```ts
type Polarity = 'affirmed' | 'negated';
type Temporality = 'current' | 'historical' | 'hypothetical';
type Experiencer = 'user' | 'project' | 'other';
type Certainty = 'confirmed' | 'probable' | 'possible';
type Condition = 'unconditional' | 'conditional';

interface Assertion {
  polarity: Polarity;
  temporality: Temporality;
  experiencer: Experiencer;
  certainty: Certainty;
  condition: Condition;
  modality?: 'factual' | 'prohibition' | 'obligation' | 'permission' | 'advice';
  scope?: { start: number; end: number; text: string };
  trigger?: string;
}
```

**冲突判定矩阵**（建议）：

| 条件 | 判定 | 动作 |
|---|---|---|
| subject 不同 / predicate 不同 | 不冲突 | 不做任何标记 |
| polarity 相同 | 不冲突 | 可做「重复/强化」合并 |
| polarity 相反，且 temporality/experiencer/condition 相同 | **矛盾** | 标 conflict，交人裁决 |
| temporality 不同（如「以前用 A」vs「现在用 B」） | **时序取代**，不是矛盾 | 标 supersession；旧条目设 validTo 或降权 |
| condition 不同（「如果 X 则 A」vs「一般 B」） | **条件例外**，不是矛盾 | 标 conditional_exception；不要合并 |
| experiencer 不同（用户说 A vs 项目文档说 B） | **来源冲突**，不是事实矛盾 | 标 source_conflict；保留两条，标来源 |
| certainty 不同（confirmed vs possible） | **确定性差距** | 标 certainty_gap；不要当矛盾 |
| modality 不同（禁止 vs 必须） | **道义冲突** | 标 deontic_conflict；这是规则文本最该抓的 |

**例子**：

- 「发版前要跑测试」vs「发版前不必跑测试」→ polarity 相反、其余同 → 矛盾。
- 「以前用 A」vs「现在用 B」→ temporality 不同 → 时序取代，不是矛盾。
- 「如果离线则用 A」vs「一般用 B」→ condition 不同 → 条件例外。
- 「用户要求 A」vs「项目文档要求 B」→ experiencer 不同 → 来源冲突。
- 「不得跳步」vs「必须跳步」→ modality 不同 → 道义冲突。

### A5.4 中文临床的对应标签（可直接借用）

WILAB-HIT 的中文临床规范定义了 7 类断言（[PDF](https://github.com/WILAB-HIT/Resources/blob/master/entity_assertion_relation/annotation_guidelines/Entity_Assertion_Relation.pdf)）：

| 中文标签 | 含义 | 映射到 ConText/扩展 |
|---|---|---|
| 当前的 | 默认，当前确定发生 | temporality=current, certainty=confirmed |
| 否认 | 患者否认/肯定不发生 | polarity=negated |
| 非患者本人 | 家属/他人 | experiencer=other |
| 有条件的 | 特定条件下才发生 | condition=conditional |
| 可能的 | 不确定当前是否发生 | certainty=possible |
| 假设的/待证实的 | 当前不发生，文本假设 | temporality=hypothetical |
| 偶有的 | 当前发生但频率低 | frequency=occasional（ConText 没有，可加） |

这张表说明：**中文临床已经有一套和 ConText 同构的轴**；本插件不需要从零发明，只要把「临床」换成「准则/任务」即可。

### A5.5 对现有 `negationSpans` 的具体诊断

当前实现（[playbook.ts:310-402](cognition-engine/src/playbook.ts#L310-L402)）是「够用版」，但有 6 个会直接导致误判的点：

1. **只做前向作用域**：`低分条目在预算紧张时会被静默丢弃` 这类「X 被排除/已废弃」的后置否定抓不到；中文 EMR 里 `压痛阴性`、`病理征未引出`、`腹壁静脉曲张：无` 都是后置。
2. **12 字硬截断 + 逗号硬停**：`不得将 A，B 一起执行` 会在逗号处断，`B` 逃出作用域；长句的否定范围也会被截短。
3. **没有伪否定/双重否定**：`不得不`、`不能不`、`不仅`、`未来`、`非常` 都会命中单字 `不/未/非`。
4. **`hasNegation` 是子串正则**：`/(不|没|无|非|未|别|...)/` 会把 `非常`、`未来`、`无锡`、`别人` 判成否定。
5. **二元组覆盖率在整段文本上算**：`mentions(b, scope) >= 0.6` 不要求「同一个主语/谓语」，也不要求 scope 对齐；短文本里 0.6 很容易被常见二元组凑到。
6. **没有时间/条件/经验者轴**：`以前用 A` vs `现在用 B`、`如果 X 则 A` vs `一般 B` 都会被当成潜在矛盾。

这 6 点不需要一次全改；优先级建议：**先加伪否定/双重否定 → 再加后置作用域 → 再把逗号改软边界 → 最后加 ConText 轴**。

---

## A6. A 部分落地建议

### A6.1 数据结构

```ts
interface NegationSpan {
  trigger: string;
  triggerStart: number;
  triggerEnd: number;
  direction: 'forward' | 'backward';
  scopeStart: number;
  scopeEnd: number;
  scopeText: string;
  polarity: 'negated' | 'possible';
  kind: 'factual' | 'prohibition' | 'double' | 'exception';
}
```

### A6.2 伪代码

```ts
function analyzeNegation(text: string): NegationSpan[] {
  const normalized = normalize(text);
  const clauses = splitClauses(normalized); // 句号/分号/换行 + 转折/条件连词；逗号只做软边界
  const spans: NegationSpan[] = [];

  for (const clause of clauses) {
    const masked = maskPseudoAndDouble(clause); // 返回 mask 区间 + 归一化后的肯定/条件标记
    const triggers = findTriggers(clause, masked); // 最长匹配、词边界
    for (const t of triggers) {
      if (isInsideMasked(t, masked)) continue;
      const scope = t.direction === 'forward'
        ? forwardScope(clause, t.end, ZH_SCOPE_STOP, 40)
        : backwardScope(clause, t.start, ZH_SCOPE_STOP, 24);
      if (scope.text.length === 0) continue;
      spans.push({ ...t, ...scope, polarity: t.kind === 'possible' ? 'possible' : 'negated' });
    }
  }
  return spans;
}
```

### A6.3 测试集

至少覆盖：

- 前置/后置/无作用域；
- 伪否定（`no change`、`不仅`、`未来`、`非常`）；
- 双重否定（`不得不`、`不能不`、`未尝不`、`非…不可`）；
- 条件/例外（`除非`、`除了`）；
- 嵌套否定（`没有说不去`）；
- 多目标共享作用域（`无发热、咳嗽` → 两个都 negated）；
- 作用域截断（`无明显诱因出现头痛` → 只否定「明显诱因」）；
- 英文混排（`no fever`、`don't`）。

### A6.4 局限（必须写进代码注释）

- 规则法召回有限；`没有说不去` 这类嵌套否定需要句法/语义，纯规则只能保守处理。
- `差点没`、`好不`、`难免不` 等口语结构有歧义，建议标 `uncertain`，不要自动判 polarity。
- 中文分词边界不稳定；`Intl.Segmenter` 也有领域词切错。用「词起点 + 最长匹配 + 白名单」比「整词匹配」稳。
- 单字触发词误报率高；能不用单字就不用，必须用时加白名单/上下文。

---

# B. 多信号排序融合

## B1. Generative Agents 的检索公式

**出处**：Park JS, O'Brien JC, Cai CJ, Morris MR, Liang P, Bernstein MS. *Generative Agents: Interactive Simulacra of Human Behavior.* UIST 2023. [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)；官方代码：[generative_agents](https://github.com/joonspk-research/generative_agents)。

### B1.1 论文公式

```
score = α_recency · recency + α_importance · importance + α_relevance · relevance
```

- `recency`：指数衰减，论文描述为 `0.995^(hours since last access)`；
- `importance`：LLM 对记忆的 poignancy 打分 1–10，归一化；
- `relevance`：query 与 memory 的 embedding cosine 相似度；
- 三项 **min-max 归一化到 [0,1]**，再相加；
- 论文正文的解读通常是 **α=1（等权）**；二手资料也明确写「the paper weights all three equally (α = 1)」（[MemX 术语页](https://memx.app/glossary/generative-agents)）。

### B1.2 官方代码的实际实现（重要差异）

官方 `retrieve.py`（[源码](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py)）并不是论文的等权：

```python
# scratch.py
self.recency_w = 1
self.relevance_w = 1
self.importance_w = 1
self.recency_decay = 0.99   # 不是论文的 0.995

# retrieve.py
nodes = sorted(nodes, key=lambda x: x[0])          # 按 last_accessed 升序
recency_vals = [recency_decay ** i for i in range(1, len(nodes)+1)]
...
recency_out = normalize_dict_floats(recency_out, 0, 1)
importance_out = normalize_dict_floats(importance_out, 0, 1)
relevance_out = normalize_dict_floats(relevance_out, 0, 1)

gw = [0.5, 3, 2]   # 实际权重：recency 0.5，relevance 3，importance 2
master_out[key] = (recency_w * recency_out[key] * gw[0]
                 + relevance_w * relevance_out[key] * gw[1]
                 + importance_w * importance_out[key] * gw[2])
```

更细的差异：

- **recency 不是按小时**，而是「按 `last_accessed` 排序后的 `0.99^i`」再 min-max。代码把 `0.99^1` 给最旧的节点、`0.99^N` 给最新的节点，方向看起来和论文相反（最旧反而拿最高 recency）。这是一处需要警惕的实现差异，**不要照抄**。
- **importance 不是 /10**，而是对 `poignancy` 做 min-max。
- **relevance 是 cosine 后 min-max**。
- 默认取 top 30（`n_count=30`）。

**结论**：Generative Agents 的「归一化加权和」结构值得借；**具体权重/衰减/方向不能照抄**。连官方代码都和论文不一致，说明这些数字是手调的。

### B1.3 对插件可借/不可借

| 可借 | 不可借 |
|---|---|
| 每个信号先归一化到 [0,1] | 需要 embedding 的 relevance |
| 有界加权和，权重显式 | LLM 打 importance（需要模型调用） |
| recency 只做「注意力」信号 | 把 recency 当「真实性」 |
| top-k 取 5–15，别只取 1 | 照抄 0.5/3/2 |

---

## B2. MemGPT / A-MEM / MemoryBank 的检索排序

| 系统 | 检索信号 | 公式/实现 | 是否多信号 | 备注 |
|---|---|---|---|---|
| **MemGPT**（[arXiv:2310.08560](https://arxiv.org/abs/2310.08560)） | 纯向量 | archival memory 用 PostgreSQL + pgvector/HNSW，query 与文档 embedding 做 cosine 相似度；recall storage 按消息时间/FIFO 管理 | **否** | FIFO queue 是上下文管理，不是检索排序；没有 recency/importance 加权 |
| **A-MEM**（[arXiv:2502.12110](https://arxiv.org/abs/2502.12110)） | 纯 cosine | 每个 note 有 `{content, timestamp, keywords, tags, context, embedding, links}`；query embedding 与 note embedding 做 cosine，取 top-k（实验 k=10） | **否** | timestamp 存了，但不参与打分；links 用于组织/演化，不用于排序 |
| **MemoryBank**（[arXiv:2305.10250](https://arxiv.org/abs/2305.10250)） | 纯 dense | dual-tower dense retrieval + FAISS；Ebbinghaus `R=e^{-t/S}` 只用于「记忆强度/遗忘」，召回时 S+1、t 归零 | **否** | 检索是纯 embedding；遗忘曲线不改变检索分数 |
| **Generative Agents** | recency + importance + relevance | 归一化加权和 | **是** | 论文等权，代码 0.5/3/2 |

**结论**：这四家里只有 Generative Agents 做多信号融合；其余三家都是「向量相似度 + 存储层策略」。所以「MemGPT/A-MEM/MemoryBank 的检索排序」这个问法本身要修正：**它们没有多信号排序**，不要把它们当成加权融合的先例。

---

## B3. 多信号融合：加权和 / RRF / 学习排序

### B3.1 RRF 公式与原始结论

**出处**：Cormack GV, Clarke CLA, Büttcher S. *Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods.* SIGIR 2009. DOI: [10.1145/1571941.1572114](https://doi.org/10.1145/1571941.1572114)；PDF：[uwaterloo](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)。

```
RRFscore(d) = Σ_{r∈R} 1 / (k + rank_r(d))
```

- `k=60`：论文说「fixed during a pilot investigation and not altered during subsequent validation」；pilot 表显示 `k=60` 附近 MAP 最高，但「the choice was not critical」。
- **不需要训练**：论文明确说 unsupervised methods「require no training examples」。
- **不需要分数归一化**：只读 rank，不读 score，所以对 BM25/embedding 的不同量纲免疫。
- **代价**：丢掉分数幅度；`k` 本身是参数；RRF 分数不是相关性分数，不能做阈值/弃答。

### B3.2 RRF 在小规模上的问题（本报告分析）

设 N=50，两个排名列表，k=60：

- 第 1 名：`1/61 = 0.01639`
- 第 50 名：`1/110 = 0.00909`
- 相邻名次差：约 `0.00008–0.00026`（越靠后越小）
- 两个列表总分上限：`2/61 = 0.0328`

也就是说，**前 50 名的分数被压在 0.009–0.016 的窄带里**；第 1 名和第 2 名只差约 0.00026。小规模下，一次噪声就可能让名次翻转，而 RRF 的分数无法告诉你「第 1 名比第 2 名强多少」。这不是 RRF 的错——它是为大规模 metasearch 设计的；但**不适合几十~几百条、需要可解释排序的记忆插件**。

### B3.3 加权和（凸组合）与学习排序

**Bruch et al. 2023**（[arXiv:2210.11934](https://arxiv.org/abs/2210.11934)，ACM TOIS）的结论：

- RRF **对参数敏感**（k 不是免费的）；
- 学习一个凸组合（convex combination, CC）的权重，**在 in-domain 和 out-of-domain 都优于 RRF**；
- CC 对分数归一化的选择不敏感；
- CC **样本效率高**，少量标注样本就够（摘要说「a small set of training examples」）。

**学习排序（learning-to-rank）**：需要标注的 relevance 标签/点击数据；本插件没有。Cormack 2009 也把「unsupervised, no training examples」作为 RRF 的卖点。对几十~几百条记忆，标注 30–50 对就够调一个权重，但从零开始没有标签时，**不要上学习排序**。

### B3.4 三种融合的适用性

| 方法 | 需要训练 | 保留幅度 | 小规模 | 可解释 | 适合本插件？ |
|---|---|---|---|---|---|
| 加权和（归一化） | 否（权重可手设/少量标定） | 是 | 好 | 高 | **推荐** |
| RRF | 否 | 否 | 一般（k=60 太钝） | 中 | 只作辅助 |
| 学习排序 | 是 | 是 | 需要标签 | 低 | 不适合 |
| 当前公式 | 否 | 是（但无界） | 冷启动差 | 中 | 需修 |

---

## B4. 对现有权重的诊断

### B4.1 代码事实

`effectiveScore`（[playbook.ts:1015-1030](cognition-engine/src/playbook.ts#L1015-L1030)）：

```ts
const good = u.appliedGood;
const bad = u.appliedBad + u.userCorrected;
const ratio = (good + 1) / (good + bad + 2);       // Beta(1,1) 后验均值
const confidence = 1 - Math.exp(-(good + bad) / 2); // 样本量饱和
const base = 10 * ratio * confidence;
const legacy = entry.helpful - entry.harmful * 2;   // 无界
const evidencePenalty =
  entry.evidence?.status === 'orphaned' ? -100
  : entry.evidence?.status === 'weakened' ? -5 : 0;
return base + legacy + evidencePenalty;
```

`renderDetailed` 已经硬过滤 `orphaned`（[playbook.ts:1233-1234](cognition-engine/src/playbook.ts#L1233-L1234)），所以 `-100` 在注入排序里**不会出现**；它只在 `worstEntry()` 的淘汰排序里起作用（[playbook.ts:1375-1380](cognition-engine/src/playbook.ts#L1375-L1380)）。

### B4.2 数值感受

| 场景 | ratio | confidence | base | legacy | 总分 |
|---|---:|---:|---:|---:|---:|
| 0 样本新条目 | 0.500 | 0.000 | 0.00 | 0 | **0.00** |
| 1 次好评 | 0.667 | 0.393 | 2.62 | 0 | **2.62** |
| 3 次好评 | 0.800 | 0.777 | 6.22 | 0 | **6.22** |
| 5 次好评 | 0.857 | 0.918 | 7.87 | 0 | **7.87** |
| 10 次好评 | 0.917 | 0.993 | 9.11 | 0 | **9.11** |
| 5 好评 + 5 差评 | 0.500 | 0.993 | 4.97 | 0 | **4.97** |
| 20 次 helpful（legacy） | 0.955 | ~1 | 9.55 | +20 | **29.55** |
| 5 好评 + 3 harmful（legacy） | 0.600 | 0.982 | 5.89 | −1 | **4.89** |
| orphaned 但 legacy=120 | — | — | 9.55 | +120 | **29.55**（−100 后仍 29.55） |

### B4.3 问题清单（按严重度）

| # | 问题 | 证据 | 后果 | 建议 |
|---:|---|---|---|---|
| 1 | `legacy` 无界 | 20 次 helpful 就能 +20，base 最大 10 | 老条目/高频条目长期霸榜，新条目无机会 | 删掉 legacy 或 clamp 到 ±3；用 Beta 统一 |
| 2 | 双重计数 | `mark()` 与 `markUsage()` 两个入口（[index.ts:1258](cognition-engine/src/index.ts#L1258)、[index.ts:1447](cognition-engine/src/index.ts#L1447)）都可能更新；公式同时读 `helpful/harmful` 和 `appliedGood/Bad` | 同一次反馈可能算两次 | 只保留一个事实源；legacy 只做展示/迁移 |
| 3 | 冷启动 0 分 | n=0 → ratio .5 × confidence 0 = 0 | 新条目排最后；容量满时 `worstEntry` 先淘汰新条目 | 用「向 0.5 收缩」的反馈分，或给探索 bonus |
| 4 | `harmful×2` 不一致 | legacy 是 ×2；`bad = appliedBad + userCorrected` 是 ×1 | 同一坏事件两条路径权重不同 | 统一 loss ratio，写进配置 |
| 5 | 硬惩罚混进分数 | `orphaned=-100` 在注入路径被过滤；legacy 可能 >100 | 语义不清；极端情况下「惩罚」失效 | 注入用硬过滤；淘汰用「orphan 优先」队列 |
| 6 | 无 relevance/importance | `effectiveScore` 只看反馈/证据 | 预算紧张时，高分但不相关的准则挤掉相关准则 | 加 lexical relevance + 显式 importance |
| 7 | 分组间无排序 | `for (const group of groups.values())` 按插入顺序分配预算（[playbook.ts:1254](cognition-engine/src/playbook.ts#L1254)） | 先出现的组占优，不是全局最优 | 按组内最高分/平均分排序后再分配 |
| 8 | `confidence` 非标准 | `1-exp(-n/2)` 是启发式，不是后验方差/下界 | 难解释、难标定 | 用 Beta 后验均值 + 向 0.5 收缩；或 Beta 下界 |
| 9 | `weakened=-5` 尺度任意 | 与 base 0–10 混用 | 无法解释 5 分意味着什么 | 归一化到 [0,1] 后给 0.05–0.1 惩罚 |
| 10 | 两套分数不统一 | `memory.ts` 召回是 `0.6 sim + 0.25 decay + 0.15 importance + 0.1 activation`，权重和 1.1；playbook 是另一套 | 难统一解释/调参 | 抽一个 `rankScore` 工具，统一归一化 |

> `memory.ts` 的召回公式（[memory.ts:658-665](cognition-engine/src/memory.ts#L658-L665)）本身已经是加权和，但权重和是 1.1，且 `similarity` 是 bigram 余弦；这不是「错」，但应该显式归一化/注释。

### B4.4 哪些是「拍脑袋」、哪些不是

- **不是拍脑袋**：Beta(1,1) 先验、`userCorrected` 算坏样本、`missed` 不算到准则头上、证据链断裂要沉底——这些方向都对。
- **是拍脑袋**：`10×`、`harmful×2`、`confidence=1-exp(-n/2)`、`-100/-5`、`helpful/harmful` 与 `appliedGood/Bad` 并存。它们不是「错」，但没有标定依据，且量纲不统一。
- **最该先修**：不是换公式，而是**去掉无界 legacy + 去掉双重计数 + 冷启动给先验 + 证据链硬过滤**。这四件事做完，现有公式已经能用；再谈 RRF/GenAgents 才有意义。

---

## B5. 建议的新公式

### B5.1 推荐：有界归一化加权和（主排序）

```
score = w_rel · relevance
      + w_fb  · feedback
      + w_imp · importance
      + w_rec · recency
      − w_pen · weakened
```

约束：

- 每个信号都归一化到 `[0,1]`；
- 正权重之和 = 1；
- `weakened` 是 0/1 或 0–0.1 的小惩罚；
- `orphaned` 不进排序（硬过滤）；
- 所有权重写进配置，并在注释里写「这是先验，不是验证过的定律」。

**建议初始权重**（有 query/topic 时）：

| 信号 | 权重 | 理由 |
|---|---:|---|
| relevance | 0.45 | 注入首先得跟当前任务/主题相关 |
| feedback | 0.30 | 历史使用效果是第二重要 |
| importance | 0.15 | 明确优先级/严重度/来源等级 |
| recency | 0.10 | 只做「注意力」和 tie-breaker，不当真实性 |
| weakened penalty | 0.10 | 部分证据失效，轻微降权 |

没有 query/topic 时：四项各 0.25（或 relevance 设 0.5 中性值），不要用「无 relevance」的旧公式。

### B5.2 各信号怎么算（零依赖）

#### feedback（Beta 收缩）

```ts
const n = good + bad;
const posterior = (good + 1) / (n + 2);          // Beta(1,1) 后验均值，0..1
const shrunk = 0.5 + (posterior - 0.5) * (n / (n + 2)); // 向 0.5 收缩
// n=0 → 0.5；1 好评 → 0.556；5 好评 → 0.755；5 差评 → 0.245
```

- 新条目不是 0 分，而是 0.5（中性）；
- 样本少时不会因为 1 次好评就冲到 0.9；
- 比 `ratio * (1-exp(-n/2))` 更好解释。
- 如果坚持「坏样本更贵」，用 `bad = appliedBad + 2*userCorrected` 或 `Beta(1+good, 1+2*bad)`，但**只在一个地方施加**，不要 legacy 再 ×2。

#### relevance（无 embedding 的 lexical relevance）

```ts
function lexicalRelevance(query: string, entry: PlaybookEntry): number {
  const q = tokenize(query);
  const t = tokenize(`${entry.when} ${entry.content} ${entry.tags.join(' ')}`);
  const cos = cosine(q, t);                       // 已有 bigram 余弦
  const lcs = lcsSimilarity(query, entry.content); // 已有 LCS，中文改写更稳
  const tag = jaccard(queryTags, entry.tags);      // 可选
  return clamp01(0.5 * cos + 0.3 * lcs + 0.2 * tag);
}
```

- 没有 query 时，用当前 topic / section / 最近任务关键词做 query；
- `lcsSimilarity` 已经在本项目里标定过：真实准则两两最高 0.173，改否定词的冲突对 0.769/0.933/0.875（[memory.ts:285-318](cognition-engine/src/memory.ts#L285-L318)）。这说明 0.6 左右是合理阈值。

#### importance（显式，不让模型自报）

```ts
function importance(entry: PlaybookEntry): number {
  const origin = entry.origin === 'human' ? 1.0
               : entry.origin === 'agent' ? 0.7 : 0.4;
  const strength = entry.guard ? 1.0 : entry.enforce ? 0.9 : 0.7;
  return clamp01(0.6 * origin + 0.4 * strength);
}
```

或者新增 `priority: 0..1` 字段，由用户/蒸馏器显式设置；不要用 LLM 自报一个 float 当 importance（LeAP 的教训：层级/置信要由代码算，不让模型自报）。

#### recency（只做 tie-breaker）

```ts
const recency = Math.exp(-(now - entry.lastConfirmedAt) / (30 * 864e5));
```

- 用 `lastConfirmedAt`/`updatedAt`，不要用 `createdAt`；
- 对稳定准则，recency 权重 0.10 足够；不要因为「很久没提」就把它判假（这是调研里已经指出的类别错误）；
- 如果没有 `lastConfirmedAt`，recency 设 0.5 中性，不要用 0。

#### 证据链

- `orphaned`：硬过滤，不进注入，也不参与冲突检测；
- `weakened`：`penalty=0.1` 或 `0.05`，不要 -5；
- 淘汰时：`orphaned` 优先，其次最低分；不要把 -100 混进正常分数。

### B5.3 组间排序

当前 `renderDetailed` 按 `groups.values()` 插入顺序分配预算；建议：

```ts
const groupList = [...groups.values()]
  .map(g => ({ ...g, maxScore: Math.max(...g.list.map(score)) }))
  .sort((a, b) => b.maxScore - a.maxScore);
```

这样预算先给「最相关/最高分」的组，而不是先出现的组。

### B5.4 最小改动版（如果不想大改）

如果只想改 3 行：

1. `legacy` 改为 `clamp(helpful - harmful * 2, -3, 3)`；
2. `base` 改为 `10 * (0.5 + (ratio - 0.5) * (n/(n+2)))`，其中 `n = good + bad`（冷启动 5 分，而不是 0）；
3. `renderDetailed` 已经过滤 orphaned，把 `evidencePenalty` 的 `-100` 删掉，`worstEntry` 里单独把 orphaned 排最前。

这三步能解决最严重的「老条目霸榜 / 新条目 0 分 / 硬惩罚语义不清」。然后再加 relevance/importance。

### B5.5 标定与验证（无训练也能做）

- 先用手工规则定权重（如 B5.1），跑 30–50 个「应该先注入哪条」的成对判断；
- 指标：`NDCG@5`、`precision@3`、冲突检测的 `false positive rate`；
- 如果只能标一个权重，优先标 `w_rel`（相关性）和 `w_fb`（反馈）的比例；Bruch et al. 说小样本足够；
- 不要用「模型自评」当唯一标签；用用户实际纠正/任务结果做外部信号。

---

## B6. 明确回答：该不该换 RRF / Generative Agents 的归一化加权？

### B6.1 判断表

| 问题 | 回答 | 依据 |
|---|---|---|
| 该不该把主排序换成 RRF？ | **不该** | RRF 需要多个独立排名；我们只有一套候选 + 几个异质信号；k=60 在小 N 下太钝；RRF 分数不能做阈值/弃答 |
| 该不该用 RRF 做辅助？ | **可以，但只在有两个可信独立排名时** | 如「lexical relevance 排名」+「feedback 排名」；k 建议 10 而不是 60；且保留绝对分数门控 |
| 该不该照搬 Generative Agents 公式？ | **不该照搬** | 需要 embedding relevance + LLM importance；论文等权和代码 0.5/3/2 不一致；min-max 在小 N 下受极值影响 |
| 该不该借 Generative Agents 的归一化？ | **该借** | 每个信号先归一化、有界加权、权重显式；这是最稳的结构 |
| 该不该上学习排序？ | **不该** | 没有标注数据；零依赖插件不应带训练管线 |
| 现有公式要不要全推翻？ | **不用** | Beta + confidence 的方向是对的；先修无界 legacy、双重计数、冷启动、硬惩罚，再加 relevance/importance |

### B6.2 最终建议（一句话）

> **保留 Beta 反馈的思想，换成「有界归一化加权和」；RRF 只作辅助融合；Generative Agents 只借归一化结构，不借权重和 embedding 依赖。**

具体落地顺序：

1. **先修数据**：统一 `mark`/`markUsage` 的事实源；`legacy` 只做展示或 clamp；`orphaned` 硬过滤。
2. **再修分数**：`feedback` 用向 0.5 收缩的 Beta 后验；`base` 改成 0–1；加 `relevance`（lexical）、`importance`（显式）、`recency`（tie-breaker）。
3. **再修分组**：按组最高分排序后分配预算。
4. **最后才考虑 RRF**：如果发现「lexical relevance」和「feedback」两个排名都可信且互补，再用 RRF 融合；否则不要引入额外复杂度。
5. **验证**：30–50 对人工判断，比较旧公式 / 新公式 / RRF 的 NDCG@5 和冲突误报率；没有提升就不换。

---

# C. 参考链接（按证据等级）

| 等级 | 资料 | 用途 |
|---|---|---|
| A（同行评审） | [Chapman et al. 2001, NegEx](https://doi.org/10.1006/jbin.2001.1029)；[Europe PMC 摘要](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:12123149&format=json&resultType=core) | NegEx 算法、性能 |
| A | [Harkema et al. 2009, ConText](https://pmc.ncbi.nlm.nih.gov/articles/PMC2757457/) | 三维度、6-token 窗口、终止词 |
| A | [Cormack et al. 2009, RRF](https://doi.org/10.1145/1571941.1572114)；[PDF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) | RRF 公式、k=60、无训练 |
| A | [Bruch et al. 2023, Fusion Functions](https://arxiv.org/abs/2210.11934) | RRF vs 凸组合、参数敏感性 |
| A | [Park et al. 2023, Generative Agents](https://arxiv.org/abs/2304.03442) | recency/importance/relevance |
| A | [Packer et al. 2023, MemGPT](https://arxiv.org/abs/2310.08560) | 纯向量检索 |
| A | [Xu et al. 2025, A-MEM](https://arxiv.org/abs/2502.12110) | 纯 cosine top-k |
| A | [Zhong et al. 2023, MemoryBank](https://arxiv.org/abs/2305.10250) | dense retrieval + Ebbinghaus |
| B（官方代码/数据） | [NegEx Google Code](https://code.google.com/archive/p/negex/)；[NegExTerms.wiki](https://code.google.com/archive/p/negex/wikis/NegExTerms.wiki) | 官方词表/算法说明 |
| B | [negspacy termsets.py](https://github.com/jenojp/negspacy/blob/master/src/negspacy/termsets.py) | 可运行的英文 termset |
| B | [Generative Agents retrieve.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py) | 实际权重/归一化 |
| B | [WILAB-HIT 标注规范](https://github.com/WILAB-HIT/Resources/blob/master/entity_assertion_relation/annotation_guidelines/Entity_Assertion_Relation.pdf) | 中文临床否定词/断言标签 |
| B | [Chinese Double Negation 数据集](https://github.com/LANGUAGE-UNDERSTANDING/Chinese_Double_Negation) | 8,639 句双重否定统计 |
| B | [NegationScopeAnnotation](https://github.com/pkucoli/NegationScopeAnnotation) | 中文否定作用域语料 |
| C（开源实现/README） | [@isdk/zh-negation](https://www.npmjs.com/package/@isdk/zh-negation) | 零依赖中文否定检测（无作用域） |
| B | [中文电子病历否定术语检出方法研究](https://doi.org/10.7507/1001-5515.20150015) | 规则+词共现 |
| B | [汉语否定与不确定覆盖域检测](https://crad.ict.ac.cn/cn/article/id/3969) | BiLSTM 中文作用域 |
| B | [基于BiLSTM-CRF的汉语否定信息识别](https://doi.org/10.3969/j.issn.1003-0077.2018.11.008) | 中文否定识别统计法 |
| B | [基于规则的双重否定识别](http://jcip.cipsc.org.cn/en/article/id/zwxxxb_3297) | 双重否定结构 |
| C | [民法典显性否定表达研究](https://yyflyj.cupl.edu.cn/CN/abstract/abstract68.shtml) | 中文法律规则文本否定（最近邻） |

---

## D. 未找到 / 需要诚实标注的点

1. **2001 年 NegEx 论文的「原始 50 词」精确列表**：公开摘要不含词表；本报告用作者官方维护词表按语义去重成核心 50，并标注了官方变体。未找到公开全文逐字表。
2. **中文「规则/指令文本」否定识别论文**：未找到；最接近的是民法典否定表达研究、临床否定检测、英文需求规范条件检查。
3. **成熟的中文 NegEx + 作用域开源实现**：未找到；`@isdk/zh-negation` 只做「是否否定」，不做作用域；其余是数据集或空壳仓库。
4. **MemGPT / A-MEM / MemoryBank 的多信号排序**：不存在；它们是纯向量/纯 dense 检索，别把它们当融合先例。
5. **Generative Agents 论文权重与官方代码一致**：不一致；论文/二手解读是等权，代码是 0.5/3/2、0.99、rank-based recency。不要把「等权」当已验证结论。
6. **`unless` 是 NegEx 官方终止词**：不是；官方核心 13 不含 `unless`，它是条件/例外标记，建议单独归类。
7. **`no change` 等伪否定的「完整列表」**：官方 NegEx wiki 是 16 个 + `without contrast`；negspacy 还有工程扩展。若要求「2001 年原始论文的逐字列表」，未找到公开全文核对。

---

## E. 给实现的最后一张清单

### A 部分（否定）

- [ ] 先做伪否定/双重否定/例外短语的**最长匹配**，再做真否定。
- [ ] 前置作用域：trigger → 终止词/下一 trigger/句末，安全上限 40 字。
- [ ] 后置作用域：trigger ← 终止词/分句起点/句首，12–24 字。
- [ ] 中文单字 trigger 必须词边界 + 白名单；能不用单字就不用。
- [ ] `rule out`/`r/o` 标 possible，不标 negated。
- [ ] `除非/除了` 标 condition/exception，不当否定词。
- [ ] `不得不/不能不/未尝不/非…不可/无不/不无` 归一化为 affirmed/强调。
- [ ] 冲突判定加 temporality/experiencer/condition/certainty 过滤。
- [ ] 测试 `无明显诱因出现头痛`：只否定「明显诱因」，不否定「头痛」。
- [ ] 测试 `他没有说不去`：保守标 uncertain，不要用奇偶硬判。

### B 部分（排序）

- [ ] 统一 `mark`/`markUsage` 事实源，去掉双重计数。
- [ ] `legacy` clamp 或删除；不要让 +20 压倒 base 10。
- [ ] feedback 改为向 0.5 收缩的 Beta 后验；新条目 0.5，不是 0。
- [ ] `orphaned` 硬过滤；`weakened` 小惩罚。
- [ ] 加 lexical relevance + 显式 importance；recency 只做 tie-breaker。
- [ ] 组间按最高分排序后再分配预算。
- [ ] 权重写配置，注释「先验，未验证」；30–50 对人工判断做标定。
- [ ] 先比较「旧公式 / 新公式」，再决定要不要 RRF；不要直接上 RRF。

---

*报告完。所有外部数字均来自上述链接；本地统计（8,639 句双重否定分布、代码数值例子）已在文中标注为「我统计/本报告分析」。*
