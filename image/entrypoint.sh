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
# 全局导出会覆盖 media 的 --port=7801。Shell 的端口（7808）由 supervisord 的
# [program:shell] environment 显式设置，无需入口导出。

# 单一用户凭据（未初始化则用默认值，首次进入门户时设置）
if [ ! -f "$DATA_DIR/shell/user.json" ]; then
  echo "[mei-portal] 首次启动，初始化默认账户 admin（请在门户修改密码）"
fi

# ---- novels 字体（镜像种子本地拷贝，零外网；联网下载仅为种子缺失时的回退）----
# 种子由 Dockerfile 构建期下载烙进镜像（/app/fonts-seed）。首启把种子拷进
# /data/novels/fonts（卷持久，升级不重做）；种子比卷里多出的家族（新版本
# 增补的字体）增量补拷。全部就绪后无任何外网动作。
if [ -d /app/fonts-seed/fonts/css ]; then
  seed_incomplete=0
  for f in /app/fonts-seed/fonts/css/*.css; do
    [ -f "$DATA_DIR/novels/fonts/css/$(basename "$f")" ] || { seed_incomplete=1; break; }
  done
  if [ "$seed_incomplete" = "1" ]; then
    echo "[mei-portal] novels 字体从镜像种子本地拷贝..."
    mkdir -p "$DATA_DIR/novels/fonts"
    cp -r /app/fonts-seed/fonts/. "$DATA_DIR/novels/fonts/"
  fi
elif [ ! -d "$DATA_DIR/novels/fonts/css" ] && [ -f /app/apps/novels/scripts/download-fonts.mjs ]; then
  # 回退：无种子（源码运行/构建期下载失败）时才联网，后台进行不阻塞
  echo "[mei-portal] novels 字体联网下载（后台，仅首次）..."
  (cd /app/apps/novels && DATA_DIR="$DATA_DIR/novels" node scripts/download-fonts.mjs || echo "[mei-portal] 字体下载完成/跳过") &
fi

# ---- media config 修正 ----
# 历史遗留已清除：曾有 sed 把 config.json 的 "port" 统一重写（旧意图是修正
# media http 端口），但现 config.json 里唯一的 port 字段是 aria2Rpc 的 6800，
# 该 sed 每次启动都会把它污染成 core 端口值（当年的 3000 污染事故源头），
# 一直靠 server.ts 的「RPC 端口与 core HTTP 端口同值回落 6800」防御掩盖。
# media 的 HTTP 端口由 supervisord --port=7801 固定，不再需要入口修正。

# ---- FluxDown 下载引擎（下载中心统一执行器）初始化 ----
# 数据目录 /data/fluxdown（SQLite 任务库 + DHT 路由表 + 日志，卷持久）。
# 访问密钥首启生成并持久（/data/fluxdown/token）：core 连接、宿主 aria2 兼容
# RPC 接入与引擎控制台共用同一 token；export 给 supervisord 的
# [program:fluxdown]（%(ENV_FLUXDOWN_TOKEN)s）。
FD_DATA="/data/fluxdown"
mkdir -p "$FD_DATA"
if [ ! -s "$FD_DATA/token" ]; then
  # 8-128 位 ASCII 可见字符且同时含字母与数字（FluxDown 密钥规则）
  FD_TOKEN="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 20)0a"
  echo -n "$FD_TOKEN" > "$FD_DATA/token"
  chmod 600 "$FD_DATA/token"
  echo "[mei-portal] FluxDown 引擎访问密钥已生成（/data/fluxdown/token）"
else
  FD_TOKEN="$(cat "$FD_DATA/token")"
fi
export FLUXDOWN_TOKEN="$FD_TOKEN"

# ---- 启动 ----
echo "[mei-portal] 启动 supervisord（nginx + shell + 各应用）"
exec "$@"
