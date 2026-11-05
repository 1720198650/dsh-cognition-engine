# Agent Skills 规范核验（agentskills.io/specification）

> 抓取时间：2026-11-05。只收录与「纯 JSON 插件导出技能」相关的条目，其余略。
> 原文：https://agentskills.io/specification

## 1. 目录结构

```
skill-name/
├── SKILL.md          # 必需：frontmatter + 指令正文
├── scripts/          # 可选：可执行代码
├── references/       # 可选：文档（REFERENCE.md / FORMS.md / 领域文件）
├── assets/           # 可选：模板、图片、数据文件
└── ...               # 任意其它文件/目录
```

- 一个技能就是一个**目录**，最低要求只有 `SKILL.md` 一个文件。
- 引用其它文件用**相对技能根的路径**，且**只引用一层深度**，不要套娃式引用链。
- `SKILL.md` 正文无格式限制，推荐结构：步骤说明 / 输入输出示例 / 常见边界情况。

## 2. YAML frontmatter：必填字段

| 字段 | 约束 |
|---|---|
| `name` | 必填，**1–64 字符**（原表写 "Max 64"，细则写 1-64） |
| `description` | 必填，**1–1024 字符**，非空 |

### `name` 字符规则（六条，全部要满足）
1. 1–64 个字符。
2. **只允许 Unicode 小写字母数字**（`a-z`、`0-9`）和连字符 `-`。
3. **不能以 `-` 开头或结尾**。
4. **不能包含连续连字符 `--`**。
5. **必须与父目录名一致**（目录 `pdf-processing/` → `name: pdf-processing`）。
6. 合法：`pdf-processing`；不合法：`PDF-Processing`、`pdf--x`、`-pdf`、`pdf-`。

> 对纯 JSON 插件的影响：`name` 必须 ASCII 小写，**中文名只能放进 `description` 或 `metadata`**，
> 不能放 `name`。目录名也必须同步改成同样的小写短横线形式。

### `description` 规则
- 1–1024 字符；既要写**做什么**，也要写**什么时候用**；
- 应含能帮 agent 命中任务的关键词（中英文关键词都写进去更好）。
- 好例：`从 PDF 中提取文本与表格、填写表单、合并文件。当用户涉及 PDF、表单或文档抽取时使用。`
- 差例：`帮助处理 PDF。`

## 3. 可选字段

| 字段 | 约束 |
|---|---|
| `license` | 许可证名，或指向随包 license 文件，建议简短 |
| `compatibility` | 1–500 字符；只在有特定环境要求时写（目标产品、系统依赖、网络等），**大多数技能不需要** |
| `metadata` | 任意 key→value 映射，**键和值都必须是字符串**；客户端可存放规范外的属性，建议键名加前缀避免冲突 |
| `allowed-tools` | 空格分隔的预授权工具串（如 `Bash(git:*) Read`），**实验性**，各实现支持不一 |

> JSON 插件导出建议：只用 `name` + `description`（+ 可选 `metadata`，注意值要写成字符串，
> 如 `version: "1.0"` 而非数字 1.0）。

## 4. 三级渐进披露与 token 预算

| 层级 | 内容 | 预算 |
|---|---|---|
| L1 元数据 | 所有技能的 `name` + `description`，启动时全量载入 | **~100 tokens** |
| L2 指令 | 技能被激活时载入**整份 `SKILL.md` 正文** | **建议 < 5000 tokens**，且 **< 500 行** |
| L3 资源 | `scripts/`、`references/`、`assets/` 中的文件，**按需**读取 | 按需，无固定预算 |

- 结论：`description` 是唯一常驻的成本项，要精炼；长参考资料拆到 `references/`。

## 5. validate 工具用法

```
skills-ref validate ./my-skill
```

- 属于官方参考库 **`skills-ref`**；校验 `SKILL.md` frontmatter 是否合法、命名是否符合约定。
- 参数指向**技能目录**（不是文件）；纯 JSON 插件导出后可对导出目录跑一遍做验证门禁。
- 注意：校验针对文件系统目录，纯 JSON 存储需先导出成目录再校验。

## 6. 最小可用示例（中文场景）

```
skills/photo-pairing/
└── SKILL.md
```

`SKILL.md`：

```markdown
---
name: photo-pairing
description: 按拍摄时间与部位特征把施工照片配成"前/后"对，输出配对表。当用户提到相片配对、前后对比、文明生产相片、配对表时使用。
metadata:
  author: dshgz
  version: "1.0"
---

# 相片前后配对

## 步骤
1. 读施工说明，按时间与是否点亮/有无积灰分出"前批"和"后批"。
2. 逐张提取特征：设备名、柜号、门牌、有无锈痕。
3. 按特征配对；后批要重排以对齐前批顺序。
4. 配不上的单侧留空，标签照写。

## 输出
| 行号 | 标题 | 前 | 后 | 依据 |

## 边界情况
- 无水印的老照片：标题不写电压，列为待核对。
- 排查类无物理前后：按读数分列（越限为前，复测合格为后）。
```
