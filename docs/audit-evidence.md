# 发版前：文献 / 项目支撑核查

核查对象：`dsh-cognition-engine`（TypeScript DSH 插件，零依赖、纯 JSON 存储、本地运行）。
核查日期：2026-11-19。只核「这个做法有没有论文或成熟项目在用、强度如何」，不核实现代码对错。
口径：每条链接都实际检索确认可达；论文号、项目名均来自真实结果。查不到的写「未找到可靠来源」，不编标题/作者/编号。
强度：强＝同一做法有直接论文或主流项目在用；中＝相近做法需类比；弱＝只有通用原理；无＝查不到。

| # | 功能 | 支撑来源（论文 arXiv / 项目） | 强度 | 判断 |
|---|---|---|---|---|
| 1 | 双时态记忆 + BM25 检索（validFrom/validTo + recordedAt/supersededAt；hash 排除 validTo；BM25 k1=1.2 b=0.5） | 双时态：同一字段设计的 [LongMemory](https://github.com/CaviraOSS/LongMemory)、时序边建模 [Zep 2501.13956](https://arxiv.org/abs/2501.13956)，底层是双时态数据库模型（Snodgrass 有效时间/事务时间，经典理论）。BM25：[Robertson & Zaragoza 2009](https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf)，k1/b 调参是工业标准做法；中文 bigram 见 [Lucene CJKBigramFilter](https://lucene.apache.org/core/9_0_0/analysis/common/org/apache/lucene/analysis/cjk/CJKBigramFilter.html) | 强 | 可发 |
| 2 | 注入两档（索引/全文）+ 渲染缓存（按指纹缓存，11ms→1.5ms） | 两档＝渐进式披露（progressive disclosure，索引→按需加载全文）：[Anthropic 上下文工程指南](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)、Claude Code / Agent Skills 的同一模式。渲染缓存属 memoization / prompt caching 工程优化，无专门论文 | 中（缓存部分弱） | 可发；缓存不需要论文，但别写成「有研究支撑」 |
| 3 | 准则本 playbook（一句话规矩 + boundaryEnvs + 置信度 + 修订历史 diagnosis/evidence/outcome + 冲突合并 1.2×） | 直接对应 [ACE 2510.04618](https://arxiv.org/abs/2510.04618)：一条式条目 + helpful/harmful 双向计数 + 确定性合并，正是此做法。辅：[Dynamic Cheatsheet 2504.07952](https://arxiv.org/abs/2504.07952)（分节+计数+长度预算）、[ExpeL 2308.10144](https://arxiv.org/abs/2308.10144)（洞察带计数）、forge_dc（祈使规则带触发点）。boundaryEnvs 与 1.2× 冲突系数无对应来源 | 强（1.2× 无来源） | 可发；1.2× 改成可配置或补依据 |
| 4 | CPE 回归（准则做成测试用例集，改动后跑回归看该命中的有没有被挤掉） | 软件回归测试是成熟工程实践（[metamorphic testing 2108.07584](https://ar5iv.labs.arxiv.org/html/2108.07584)）；把每个确认缺陷固化成永久回归用例、面向真实 LLM 管线的持续回归（[switchboard 2026](https://zenodo.org/records/20789935)） | 中（方法论为类比） | 可发 |
| 5 | 沉积层（四维 retention/caution/openness/attachment + 哈希链 + 五分类 LLM 判定） | 哈希链防篡改审计日志有支撑（[LogProof 2026](https://ieeexplore.ieee.org/abstract/document/11491924)、区块链审计日志通例）；「记忆→反思→回写」可类比 [Generative Agents 2304.03442](https://arxiv.org/abs/2304.03442)。四维划分与五分类为自定，未找到对应论文 | 弱 | 需补依据（建议默认关） |
| 6 | 资料层（长文切块：空行分段+长段按句切、目标 600 字 + 自动提炼：摘要/结论/逐字引文 + bigram/整词检索） | RAG 切块+摘要回灌 [Lewis 2020 (2005.11401)](https://arxiv.org/abs/2005.11401)，LlamaIndex / LangChain 同类管线；中文 bigram 见 Lucene CJKBigramFilter。目标 600 字为工程经验值，无来源 | 中 | 可发 |
| 7 | 白名单抓取（robots RFC 9309 + 限速 + 封内网） | [RFC 9309 Robots Exclusion Protocol](https://datatracker.ietf.org/doc/rfc9309/)；封内网/回环/链路本地＝[OWASP SSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)；限速为通例 | 强 | 可发 |
| 8 | 学习候选（三层锚：逐字子串 / LCS≥0.9 / 0.6~0.9 灰区 + world/user 分层 + tentative 不注入） | 逐字引用接地、原子事实核验 [FActScore 2305.14251](https://arxiv.org/abs/2305.14251)；propose vs verified 分层 [SCL 2510.05107](https://arxiv.org/abs/2510.05107)、记忆分四层 [LeAP](https://zenodo.org/records/21029662)；LCS 作相似度有近重复检测先例（[ACM CIKM 2008](https://dl.acm.org/doi/10.1145/1458082.1458094)），但 0.9 / 0.6 阈值为自定 | 弱 | 需补依据 |
| 9 | 自动修订（先存档再改 + 24h 冷却 + 每天 5 次 + 无用户纠正不自改） | 「无外部反馈的自我纠错会让结果变差」有强证据 [Huang 2310.01798](https://arxiv.org/abs/2310.01798)，支撑「无用户纠正不自改」；冷却时间与每日次数为工程限额，无来源 | 中（参数无） | 需补依据 |
| 10 | 深研（多源→逐源作答→token-F1 两档 + 数字/极性硬规则→单源不算数） | token-F1 为问答标准指标 [SQuAD 1606.05250](https://arxiv.org/abs/1606.05250)；RAG 自动评测 [RAGAS 2309.15217](https://arxiv.org/abs/2309.15217)；多源交叉验证为通例。「单源不算数」无直接论文 | 中 | 可发 |
| 11 | 立场层（goal/prefer/forbid，明确词命中拦截，不打分） | 原则/宪法式约束 [Constitutional AI 2212.08073](https://arxiv.org/abs/2212.08073)；指令优先级分层 [Instruction Hierarchy 2404.13208](https://arxiv.org/abs/2404.13208)；关键词命中即定、不进打分的双阈值兜底 [Rasa FallbackClassifier](https://github.com/RasaHQ/rasa/issues/6244) | 中 | 可发 |
| 12 | 任务简报 brief（确定性选材 relevance>0.15 + 主题加权 + 800 字上限） | 上下文预算/按需加载 [Anthropic 上下文工程](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)、提示压缩 [LongLLMLingua 2310.06839](https://arxiv.org/abs/2310.06839)、分页记忆 [MemGPT/Letta](https://github.com/letta-ai/letta)。relevance>0.15 阈值为自定，无来源 | 弱 | 需补依据 |
| 13 | 主题 wiki（四节：现行口径/该避开/完成判定/未决问题 + 增量维护） | 「LLM wiki 作为可增补的活语义记忆」[Beyond RAG: LLM Wikis as Living Semantic Memory, 2026](https://zenodo.org/records/20078453)；四节结构为自定 | 中 | 可发 |
| 14 | dreaming（离线整理记忆） | sleep-time compute 用离线预算降低测试时计算 [2504.13171](https://arxiv.org/abs/2504.13171)；生成式代理的反思-回写 [Generative Agents 2304.03442](https://arxiv.org/abs/2304.03442) | 中 | 可发 |

## 统计

- 强 3 条：1 双时态+BM25、3 准则本结构、7 白名单抓取。
- 中 7 条：2 注入两档、4 CPE 回归、6 资料层、10 深研、11 立场层、13 主题 wiki、14 dreaming。
- 弱 4 条：5 沉积层、8 学习候选、9 自动修订、12 任务简报。
- 无 0 条：整条功能都查不到来源的是 0 条；但下面这些**子机制/常数**确实查不到，发版说明里不能声称「有依据」。

## 没有支撑的功能 / 子项

**A. 沉积层四维 + 五分类 LLM 判定（功能 5）**
- 为什么没找到：retention/caution/openness/attachment 这套划分和五分类标签是自造概念，检索不到同构工作。
- 最接近的工作：记忆「巩固/反思」闭环（Generative Agents 2304.03442）；把状态做成可衰减的读写分控（Oblivion 2604.00131）。都不是这四维。
- 建议：整层默认关；对外只说「自研探索」，补一版对照实验（开/关对任务质量的影响）再谈价值，否则删掉四维、只留哈希链审计。

**B. 学习候选的 LCS≥0.9 / 0.6~0.9 灰区阈值（功能 8）**
- 为什么没找到：LCS 作相似度有先例，但 0.9 高置信 / 0.6~0.9 灰区这两个切点是拍的，无实验来源。
- 最接近的工作：引用接地与原子事实核验（FActScore 2305.14251）、propose/verified 分离（SCL 2510.05107）。
- 建议：把阈值标为「经验值」，并在真实样本上标一版精确率/召回率；未标定前灰区一律走人工确认（现在也基本如此）。

**C. 自动修订的 24h 冷却 + 每天 5 次（功能 9）**
- 为什么没找到：冷却时长、频次上限是工程拍定，无研究支撑。
- 最接近的工作：Huang 2310.01798 只支撑「无外部反馈别自改」这一条原则，没给数值。
- 建议：保留「无用户纠正不自改」（有支撑）；24h/5 次标注为「防抖限额，非研究结论」，并做成可配置。

**D. 任务简报的 relevance>0.15 阈值（功能 12）**
- 为什么没找到：0.15 这个相关性门槛无来源，属经验取值。
- 最接近的工作：上下文预算与压缩（Anthropic 上下文工程、LongLLMLingua 2310.06839）只讲「要选、要压」，不给固定阈值。
- 建议：阈值可配置并记录命中率；README 里别写成「经研究确定」。

**E. 渲染缓存按指纹缓存（功能 2 子项）**
- 为什么没找到：就是缓存/memoization，属通用工程优化，没有也不需要有专门论文。
- 最接近的工作：prompt caching / KV cache（厂商特性），与本项目的「渲染结果缓存」不同层。
- 建议：可发，但性能数字（11ms→1.5ms）必须标「本机实测、环境相关」，不要当普适结论。

**F. 准则冲突合并 1.2× 强度裁决（功能 3 子项）**
- 为什么没找到：1.2 倍强度系数无来源；冲突/去重的先后顺序有道理，但系数是拍的。
- 最接近的工作：AGM 信念修正（expansion / revision / contraction 与确信度排序）只给框架，不给倍数。
- 建议：系数提成可配置项，默认值注明「启发式」；补一组冲突样本看 1.2× 是否真优于「新覆盖旧」。

## 备注

- 项目 README「参考与致谢」里列的 arXiv 号本次抽查均可打开（含 2026 年的 2603/2604/2608），未见伪造编号。
- 本文只回答「有没有支撑」，不等于「实现无 bug」；功能 1/3/7 的强度高，也只说明做法有出处。
