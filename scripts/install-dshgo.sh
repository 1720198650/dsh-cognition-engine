#!/bin/sh
# 一条命令把 dsh-cognition-engine 装进 dsh-go 的本机引擎（Android）。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/1720198650/dsh-cognition-engine/main/scripts/install-dshgo.sh | sh
#
# 或带自定义目录：
#   sh install-dshgo.sh /root/.dsh/dsh-go/plugins/dsh-cognition-engine
#
# 说明：dsh-go 的插件就是一个 npm 包目录，按绝对路径装进 profile 即可，不需要发布到 npm。

set -eu

REPO="${COGNITION_REPO:-https://github.com/1720198650/dsh-cognition-engine.git}"
DEST="${1:-/root/.dsh/dsh-go/plugins/dsh-cognition-engine}"

command -v git >/dev/null 2>&1 || {
  echo "需要 git。请先在 dsh-go 的本机环境里安装：apt-get install -y git" >&2
  exit 1
}

if [ -d "$DEST/.git" ]; then
  echo "→ 更新已有安装：$DEST"
  git -C "$DEST" pull --ff-only
else
  echo "→ 克隆到：$DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --depth 1 "$REPO" "$DEST"
fi

echo
echo "✅ 已安装到 $DEST"
echo
echo "下一步（二选一）："
echo "  A. 在 dsh-go 的插件列表里打开 cognition-engine"
echo "  B. 手动在该主机的 profile 里加一行："
echo "       - insert:"
echo "           - id: cognition-engine"
echo "             name: dsh-cognition-engine"
echo
echo "首次启动会自动生成访问口令，位于：$DEST/.cognition-token"
echo "把它粘贴到页面「设置 → 访问口令」里，即可查看记忆详情。"
