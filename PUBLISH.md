# 发布清单

本机当前**没有安装 Git**，也没有 GitHub 凭证，所以推送这一步需要你自己执行。
下面是从零到仓库上线的完整步骤。

> **本机实测补充（2026-11-01）**：Git 2.56 已安装到 `C:\Program Files\Git\cmd`（未进 DSH 进程的 PATH，用绝对路径调用）。
> 但 `github.com:443` 在本网络被阻断，`git push` 会报 `Connection was reset` / `Could not connect`。
> 本次是通过 **GitHub Git Data API**（`api.github.com`，未被阻断）把文件直接写成提交的。
> 如果你也遇到同样问题：挂代理，或复用 `_research/api-push.mjs` 这套脚本。

## 1. 安装 Git

```powershell
winget install --id Git.Git -e --source winget
```

装完重开一个终端，确认：

```powershell
git --version
```

## 2. 初始化仓库

```powershell
cd <插件目录>
git init
git add .
git commit -m "feat: dsh-cognition-engine v0.1.0"
git branch -M main
```

`.gitignore` 已经排除了 `node_modules`、`lib`、运行期数据（`cognition-state.json`、`tasks.json`）和研究资料（`_research/`）。

## 3. 建 GitHub 仓库并推送

先在 <https://github.com/new> 建一个空仓库（不要勾选 README / .gitignore），然后把地址替换到下面：

```powershell
git remote add origin https://github.com/<你的用户名>/dsh-cognition-engine.git
git push -u origin main
```

首次推送会要求登录。推荐用 GitHub 的 Personal Access Token 当密码，或先装 GitHub CLI 登录：

```powershell
winget install --id GitHub.cli
gh auth login
gh repo create dsh-cognition-engine --public --source . --push
```

## 4. 发布到 npm（可选）

当前包名是 `@local/cognition-engine`，是本地占位名。发布前改两处：

1. `package.json` 的 `name` 改成你自己的作用域，例如 `@yourname/dsh-cognition-engine`；
2. `cordis.patch.yml` 里的 `name` 同步修改。

然后：

```powershell
npm login
npm publish --access public
```

`files` 字段已经写好了要发布的文件：`lib/**`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`。
`README.md` 和 `LICENSE` 会被 npm 自动带上。

> 发布前记得 `npm run build`，因为 `lib/` 不入库、由构建生成。

## 5. 发布前自检（六步，不可跳步）

按顺序全过一遍再推。前三步是静态检查，第 ⑤ 步才是真正能拦住「发了个用不了的东西」的那一步。

### ① 卸载验证

```powershell
# 沙箱验证清理脚本本身
# 真实流程：plugin_manager remove_bundle → 确认工具消失 → 重新 install_bundle → 确认数据完好
```

清理脚本要覆盖**全部**落盘文件：`cognition-state.json`、`tasks.json`、`cognition-playbook.json`、
`cognition-audit.jsonl`、`.sha256`、`.lock`、`.snapshots/`、以及 `AGENTS.md` 里的第九节。

### ② 兼容性检查

```powershell
npm run eval
```

评测里的「兼容性」5 项：单个工具重名、缺 webServer、缺事件能力、落盘文件损坏、系统提示段注册失败——
都不该拖垮插件。

### ③ 代码优化

```powershell
npm run build
npm test
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
node --check client.js
```

无未使用项、无类型错误、客户端语法通过。

### ④ README 覆盖检查

逐条核对**新功能是否在 README 的功能列表与引用里有位置**。

- 能力清单：把本轮新增的每项能力列出来，逐条在 README 里搜关键词
- 引用：新借用的论文/项目必须进「参考与致谢」，并写清借了什么
- **CHANGELOG 不算数**——CHANGELOG 是给「从上一版升上来的人」看的，README 是给「第一次来的人」看的

### ⑤ 在真实入口点一遍 ⭐

**测试全绿 ≠ 功能能用。** 这一步专门抓「接口写了、按钮没做」这类问题。

- 打开面板，把本轮改动涉及的页签逐个点开
- 每个新按钮都要**真的点下去**，看有没有反应、有没有报错
- 新工具要**真的调一次**（不是看代码，是发起调用）
- 涉及多个步骤的流程（如蒸馏 → 审核 → 生效）要**走完整链路**
- 看状态条/页签上的数字对不对

> 这条是 0.9.0 的教训：准则本的「重新蒸馏」「手动新增」只写了 HTTP 接口没做按钮，
> 单元测试 67 条全绿、评测 20/20 全过，但页面上根本点不到，40 分钟后被迫补发 0.9.1。

### ⑥ 发布

前面五步全过才 push / 打 tag / 建 Release / `npm publish`。

发版频率：**每天最多一次**，小改动攒着合并发。
门槛是「有用户可感知的改动」；纯内部修正、文案微调、UI 对齐不单独发。
例外：编译失败、数据损坏、安全问题可随时发。

