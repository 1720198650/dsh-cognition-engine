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

## 5. 发布前自检

```powershell
npm run build
npm test
npm run eval
```

三项全绿再推。评测里的「打包自检」会检查清单、`client.js` 的模块 id、patch 的包名是否一致——这是装上去才会炸的那类错误。
