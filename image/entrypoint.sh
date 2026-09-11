#!/bin/bash
# mei-portal 单镜像入口
# 职责：1) 初始化数据目录  2) 生成配置  3) 首次初始化各应用账户  4) 启动 supervisor
set -e

export DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# 统一管理员凭据（各应用共用，单用户模式）
# 首次启动用默认值，可通过环境变量覆盖
export MEI_ADMIN_USER="${MEI_ADMIN_USER:-admin}"
export MEI_ADMIN_PASSWORD="${MEI_ADMIN_PASSWORD:-mei-portal}"

# 用单镜像专属插件清单覆盖（只含已接入应用）
if [ -f /etc/mei-plugins.json ]; then
  mkdir -p /app/public/__theme
  cp /etc/mei-plugins.json /app/public/__theme/plugins.json 2>/dev/null || echo "[mei-portal] plugins.json 拷贝跳过"
fi

echo "[mei-portal] 数据目录: $DATA_DIR  管理员: $MEI_ADMIN_USER  模式: single"

# ---- 初始化各应用数据目录 ----
# tv/draw/music 应用自身启动时也会自建，这里预先创建保证卷属主正确
mkdir -p "$DATA_DIR/novels" "$DATA_DIR/link" "$DATA_DIR/shell" "$DATA_DIR/tv" "$DATA_DIR/draw" "$DATA_DIR/music" "$DATA_DIR/media" "$DATA_DIR/media/logs" "$DATA_DIR/disks" "$DATA_DIR/disks/cache" "$DATA_DIR/disks/logs"

# ---- 本地服务器下载库（强要求，宿主经 compose 卷映射到 /downloads）----
# music 服务器下载 → /downloads/music/<歌手>/；media（影视）下载 localDir → /downloads/movie/<分类>/<剧名>/
mkdir -p /downloads/music /downloads/movie

# ---- Shell 配置 ----
# 注意：不要在这里 export PORT——media core-ts 的 env PORT 优先级高于 --port 命令行参数，
# 全局导出会覆盖 media 的 --port=3000。Shell 的端口（3010）由 supervisord 的
# [program:shell] environment 显式设置，无需入口导出。

# 单一用户凭据（未初始化则用默认值，首次进入门户时设置）
if [ ! -f "$DATA_DIR/shell/user.json" ]; then
  echo "[mei-portal] 首次启动，初始化默认账户 admin（请在门户修改密码）"
fi

# ---- novels 字体（首启预下载，后台进行不阻塞）----
# 下载脚本写入 $DATA_DIR/novels/fonts（DATA_DIR 参数指向 novels 子目录），
# 幂等检查必须用同一路径——此前误查旧名 $DATA_DIR/tutorial，导致每次启动都重新下载
if [ ! -d "$DATA_DIR/novels/fonts/css" ] && [ -f /app/apps/novels/scripts/download-fonts.mjs ]; then
  echo "[mei-portal] novels 字体首次下载（后台）..."
  (cd /app/apps/novels && DATA_DIR="$DATA_DIR/novels" node scripts/download-fonts.mjs || echo "[mei-portal] 字体下载完成/跳过") &
fi

# ---- media 端口修正（TS core 统一鉴权，无独立 setup/signin 流程）----
if [ -f "$DATA_DIR/media/config.json" ]; then
  sed -i 's/"port":[[:space:]]*[0-9]*/"port": 3000/' "$DATA_DIR/media/config.json" 2>/dev/null || true
fi

# ---- 启动 ----
echo "[mei-portal] 启动 supervisord（nginx + shell + 各应用）"
exec "$@"
