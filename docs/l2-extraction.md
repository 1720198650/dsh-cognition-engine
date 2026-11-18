# L2 白名单抓取：robots 合规性 & 正文抽取调研

查证日期 2026-11-18。依据：[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)（2022-09 标准）、各算法源码/官方文档。仓库只读，本文件是唯一改动；行号对应当前 `src/`。

## 一、robots.txt 结论

### 1.1 规范原文怎么说

1. **组选择**：MUST 大小写不敏感匹配 product token；**多个组匹配同一个 UA 时，必须把这些组的规则合并成一个组**再按 2.2.2 解析；只有在没有任何组匹配时才用 `*` 组；都没有 → 无规则 = 全允许。（[§2.2.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1)，含图 2 合并示例）
2. **Allow / Disallow 优先级**：MUST 取"最具体匹配"，具体性 = **规则路径 octets 最多**；两条完全等价时 **Allow SHOULD 优先**；无匹配 → 允许；`/robots.txt` 隐式允许；匹配 SHOULD 大小写敏感。（[§2.2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.2)；[§5.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-5.2) 示例）
3. **`*` 和 `$` 是规范的一部分，MUST 支持**：`*` = 0 个或多个任意字符（含 `/`），`$` = 匹配模式结尾。§5.1 的示例 robots.txt 里就有 `Disallow: *.gif$`。（[§2.2.3](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.3)）
4. **Crawl-delay 不在 RFC 里**。ABNF 的 `rule` 只有 `allow` / `disallow`；§2.2.4 允许解析 Sitemaps 之类的其他记录，但 MUST NOT 干扰已定义记录。所以是事实扩展，不是标准。（[§2.2.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.4)）
5. **抓不到 robots.txt**：4xx（unavailable）→ **MAY 访问任何资源（= 允许）**；5xx / 网络错误（unreachable）→ **MUST 假定完全禁止**；超过 5 次连续重定向 MAY 视为 unavailable；缓存 SHOULD NOT 超过 24 小时；解析上限 MUST ≥ 500 KiB。（[§2.3.1.2–§2.5](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1)）

### 1.2 不一致点清单

| # | 位置 | 现状 | 规范要求 / 后果 |
|---|---|---|---|
| 1 | `web_fetch.ts:164` | `rule.path.replace(/\*.*$/, '')` 把 `*` 之后全截掉当前缀 | `*`/`$` 是 MUST 支持项。`Disallow: *.gif$` → 空前缀 → `startsWith('')` 恒真 → 除更长的 Allow 外**全站被禁**；`Allow: /x$` 会把 `/xy` 也放行 |
| 2 | `web_fetch.ts:163` | 注释明说 `$` 只做前缀匹配 | 同上，`$` 未被忽略就等于没实现 |
| 3 | `web_fetch.ts:166` | 用截断后的 `pattern.length` 当"具体性" | 规范按规则路径 octets 比；截断会低估长通配规则，优先级颠倒（等长 Allow 优先这点方向是对的） |
| 4 | `web_fetch.ts:145-153` | 只挑一组（score 最高） | 规范：所有匹配组**合并**。同名 UA 分两块写的时候会丢规则（§2.2.1 图 2 就是这种情形） |
| 5 | `web_fetch.ts:134-143` | UA 按分隔符切词精确匹配 | 规范是 product token 子串匹配；robots 写 `dsh-cognition-engine/0.13` 时匹配不上，掉到 `*` 组 |
| 6 | `index.ts:1029` | robots 只读 256 KiB | MUST ≥ 500 KiB，大文件会被截断丢规则 |
| 7 | `index.ts:1031` | 4xx 和 5xx/超时一律当"允许" | 4xx 允许合规；**5xx/网络错误按 §2.3.1.4 必须假定全禁** |
| 8 | `index.ts:1018` | 进程级永久缓存，不刷新 | 规范 SHOULD NOT 用超过 24h 的缓存 |

一致性说明（这几条是对的，别改）：等长 Allow 优先、空 `Disallow:` = 全允许、`#` 注释、`*` 组仅作兜底、组由 UA 行 / EOF 终止、crawl-delay 不从 `*` 组借用。

附带（不算 robots，但同一段代码）：`fetchOnce` 用 `redirect:'follow'`，`maxRedirects` 字段根本没生效；跨站重定向后抓的是不在白名单的 host——白名单只校验了初始 URL（`web_fetch.ts:217-220`）。

### 1.3 最小改法（伪代码）

```
// (a) 组选择：合并所有匹配组（改 web_fetch.ts:134-156）
matched = groups.filter(g => g.agents.some(a => a !== '*' && uaLower.includes(a)))
if (matched.length === 0) matched = groups.filter(g => g.agents.includes('*'))
rules = matched.flatMap(g => g.rules)
crawlDelayMs = matched.length ? Math.max(...matched.map(g => g.crawlDelayMs)) : 0

// (b) 路径 → 锚定正则（替换 web_fetch.ts:164）
function pathToRegExp(p) {
  let out = '^'
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') out += '.*'
    else if (c === '$' && i === p.length - 1) out += '$'
    else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(out)          // 按 path 缓存，别每条规则重编译
}

// (c) 定优先级：长度用规则原路径，等长 Allow 胜（替换 web_fetch.ts:160-173）
best = undefined
for (const r of rules) {
  if (!pathToRegExp(r.path).test(pathname)) continue
  const len = r.path.length
  if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow }
}
return best ? best.allow : true
```

```
// (d) 按状态码分流（改 index.ts:1029-1031；规则对象加 disallowAll 字段）
status 400-499        → 允许（限速照旧）
status 0 或 500-599   → disallowAll = true，报错文案写清"robots 抓不到，按规范不抓"
// (e) robots 读取上限 256 KiB → 512 KiB；缓存加 24h 过期
```

测试要跟着改 `src/test.ts:4445` 那个用例，并补：`Disallow: *.gif$` 只拒 `.gif` 结尾；`Allow: /x$` 不放行 `/xy`；两个同名 UA 组规则合并；500 → 全禁、404 → 全允许。

## 二、正文抽取

### 2.1 算法判据对比

| 算法 | 核心判据 | 来源 |
|---|---|---|
| Mozilla Readability（Arc90） | 段落（≥25 字符）打分 = `1 + 逗号数 + min(len/100, 3)`，按祖先层级折减 1 / 2 / (level×3) 上卷；节点初始分按标签（DIV +5、PRE/TD/BLOCKQUOTE +3、LI/OL/UL/FORM −3、H1–H6/TH −5）；class/id 词表权重 +25 / −25；候选分 = 内容分 ×(1 − 链接密度)；条件清洗阈值：权重<25 且链接密度>0.2、或权重≥25 且 >0.5 → 删 | [Readability.js](https://github.com/mozilla/readability/blob/main/Readability.js)（`_initializeNode` / `_getLinkDensity` / `_getClassWeight` / `_grabArticle` / `_cleanConditionally`） |
| trafilatura | 先清洗（script/style/nav/footer/评论），规则式抽取器按**文本长度、链接密度、位置**给文本节点打分选主块；量不够级联回退 readability → jusText → baseline → 放宽阈值重跑 | [官方文档](https://trafilatura.readthedocs.io/en/latest/extraction-overview.html)、[ACL 2021 demo](https://aclanthology.org/2021.acl-demo.15/) |
| boilerpipe | 切文本块后用**浅层文本特征**分类：text density、link density、块内词数；规则由 C4.8 学出，再靠 BlockProximityFusion 合并相邻同类块保证正文连续 | [DensityRulesClassifier 注释](https://eclipse.googlesource.com/smila/org.eclipse.smila.core/+/6cedd7956c6bdf4566a2c7592ae9f9a2c2a97e73/core/de.l3s.boilerpipe/OSGI-OPT/src/de/l3s/boilerpipe/filters/english/DensityRulesClassifier.java)、[Chromium 移植版](https://chromium.googlesource.com/chromium/dom-distiller/+/2a180397710719913340a12804affc65b789275e/java/org/chromium/distiller/filters/english/NumWordsRulesClassifier.java)、原论文 [Kohlschütter 2010](https://doi.org/10.1145/1718487.1718542) |
| 你的实现 | `<article>`/`<main>` 语义先验（HTML 长度 >2000 才用）+ 剥标签；无块级打分、无链接密度 | `src/extract.ts:46-54` |

### 2.2 可引用的评测：差距量级

- **trafilatura 自家评测**（990 文档，2026-10-02）：baseline（按 p/code/quote 取原文）F1 **0.814**；boilerpy3 0.807；readability-lxml 0.853；trafilatura 0.926。→ 从"取标记文本"到成熟算法差约 **0.11 F1**。（[evaluation.html](https://trafilatura.readthedocs.io/en/latest/evaluation.html)）
- **CleanEval 2007**（Web2Text 表 1，原始测试集 676 页）：BTE 0.83；boilerpipe default-ext 0.81、article-ext 0.71、largest-ext **0.52**；unfluff 0.70；CRF 0.84；Web2Text 0.88。→ 浅层特征算法 0.81–0.84，"取最大块"只有 0.52，结构化模型 0.88。（[arXiv:1801.02607](https://arxiv.org/abs/1801.02607)，表 1 在 [HTML 版](https://arxiv.org/html/1801.02607v3)）
- **Bevendorff et al. 2023**（SIGIR，8 个数据集合并、14 个系统 + 5 个 baseline）：性能**强依赖页面类型，没有哪个抽取器在所有类型上最好**。（[doi:10.1145/3539618.3591920](https://doi.org/10.1145/3539618.3591920)）
- 更正一处记忆：**Vogels 等人的工作是 Web2Text 论文**（ECIR 2018，HMM + CNN，不是综述）；大规模横向对比看 Bevendorff 2023。**未找到**名为"Vogels 等人的 boilerplate 综述"的可靠文献。

### 2.3 单一最值得移植的判据：链接密度

三家都用它做准入/剔除（Readability 的 0.2 / 0.5 阈值、boilerpipe 的 link density 特征、trafilatura 的规则打分），而且它是唯一**不需要 DOM 树**就能算的强判据：正则抠 `<a>…</a>` 文字长度 ÷ 块文字长度。

```
function linkDensity(html) {                       // ≈10 行
  const total = textOf(html).length                // 复用现有剥标签逻辑
  if (total === 0) return 0
  const link = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)]
    .reduce((n, m) => n + textOf(m[1]).length, 0)
  return link / total
}
// 采用 <article>/<main> 的条件加一条：textOf(best).length > 2000 && linkDensity(best) <= 0.35
// 全文回退时：linkDensity(text) > 0.5 → flags.add('link-heavy')
```

顺带修一个现成 bug：`extract.ts:50` 的 `best.length > 2000` 量的是 **HTML 源码长度**（标签也算），class 一多就虚高；应量剥完标签的文本长度。

## 三、建议（每条一句，可执行）

1. **robots 真实现 `*` 和 `$`**：改 `web_fetch.ts:160-173`，否则 `Disallow: *.gif$` 会封掉整站（现在就是错的）。
2. **匹配长度改用规则原路径 octets**：删掉 `web_fetch.ts:166` 里的截断长度。
3. **UA 组按规范合并**：改 `web_fetch.ts:145-156`，把所有匹配组合并而不是挑一个。
4. **robots 拉取失败按状态码分流**：`index.ts:1029-1031`，4xx 放行 / 5xx 与超时按全禁处理。
5. **robots 上限提到 ≥500 KiB、缓存 24h 过期**：改 `index.ts:1029` 与 `1018` 附近的缓存。
6. **不移植 Readability / trafilatura 那套**：增益主要来自 DOM 块打分 + 级联回退，两者都要真 DOM，与零依赖冲突；`<article>/<main>` 先验已经吃掉了大部分语义收益。
7. **只加链接密度闸门（≈30 行）**：`extract.ts:46-54` 采用 scope 时校验 `linkDensity<=0.35`，全文回退时 `linkDensity>0.5` 打 `link-heavy` 标记。
8. **2000 字门限改成按纯文本长度算**：同上位置，一行改动。
9. **crawl-delay 注释里写清"非 RFC 扩展"**：`web_fetch.ts:97-101` 的注释与 `parseRobots` 文档串。
