#!/bin/bash
# mei-allin 单镜像入口
# 职责：1) 初始化数据目录  2) 生成配置  3) 首次初始化各应用账户  4) 启动 supervisor
set -e

export DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# 统一管理员凭据（各应用共用，单用户模式）
# 首次启动用默认值，可通过环境变量覆盖
export MEI_ADMIN_USER="${MEI_ADMIN_USER:-admin}"
export MEI_ADMIN_PASSWORD="${MEI_ADMIN_PASSWORD:-mei-allin}"

# 单镜像模式标记（Shell 据此返回子路径 url）
export MEI_MODE="single"

# 用单镜像专属插件清单覆盖（只含已接入应用）
if [ -f /etc/mei-plugins.json ]; then
  mkdir -p /app/public/__theme
  cp /etc/mei-plugins.json /app/public/__theme/plugins.json 2>/dev/null || echo "[mei-allin] plugins.json 拷贝跳过"
fi

echo "[mei-allin] 数据目录: $DATA_DIR  管理员: $MEI_ADMIN_USER  模式: single"

# ---- 初始化各应用数据目录 ----
mkdir -p "$DATA_DIR/tutorial" "$DATA_DIR/mei-link" "$DATA_DIR/shell"

# ---- Shell 配置 ----
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

# 单一用户凭据（未初始化则用默认值，首次进入门户时设置）
if [ ! -f "$DATA_DIR/shell/user.json" ]; then
  echo "[mei-allin] 首次启动，初始化默认账户 admin（请在门户修改密码）"
fi

# ---- tutorial 字体（首启预下载，后台进行不阻塞）----
if [ ! -d "$DATA_DIR/tutorial/fonts/css" ] && [ -f /app/apps/tutorial/scripts/download-fonts.mjs ]; then
  echo "[mei-allin] tutorial 字体首次下载（后台）..."
  (cd /app/apps/tutorial && DATA_DIR="$DATA_DIR/tutorial" node scripts/download-fonts.mjs || echo "[mei-allin] 字体下载完成/跳过") &
fi

# ---- 启动 ----
echo "[mei-allin] 启动 supervisord（nginx + shell + 各应用）"
exec "$@"
