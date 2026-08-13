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
mkdir -p "$DATA_DIR/tutorial" "$DATA_DIR/mei-link" "$DATA_DIR/shell" "$DATA_DIR/mediago/logs" "$DATA_DIR/mediago/downloads" "$DATA_DIR/mediago"

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

# ---- mediago 端口修正 + 自动 setup ----
if [ -f "$DATA_DIR/mediago/config.json" ]; then
  sed -i 's/"port":[[:space:]]*[0-9]*/"port": 3007/' "$DATA_DIR/mediago/config.json" 2>/dev/null || true
fi

# mediago 首次 setup（后台等待启动后自动设置密码）
(
  for i in $(seq 1 30); do
    sleep 2
    STATUS=$(curl -s http://127.0.0.1:3000/api/auth/status 2>/dev/null)
    if echo "$STATUS" | grep -q '"setuped":false'; then
      curl -s -X POST http://127.0.0.1:3000/api/auth/setup \
        -H 'Content-Type: application/json' \
        -d "{\"password\":\"${MEI_ADMIN_PASSWORD}\"}" >/dev/null 2>&1
      echo "[mei-allin] mediago setup 完成"
      break
    elif echo "$STATUS" | grep -q '"setuped":true'; then
      echo "[mei-allin] mediago 已 setup"
      break
    fi
  done
) &

# sun-panel 自动登录获取 token，注入 nginx header（后台）
(
  for i in $(seq 1 30); do
    sleep 2
    SP_RESP=$(curl -s -X POST http://127.0.0.1:3006/panel/api/login \
      -H 'Content-Type: application/json' \
      -d '{"username":"admin@sun.cc","password":"12345678"}' 2>/dev/null)
    SP_TOKEN=$(echo "$SP_RESP" | grep -oE '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
    if [ -n "$SP_TOKEN" ]; then
      # 生成 nginx 配置给 sun-panel API 注入 token header
      cat > /etc/nginx/conf.d/01-sunpanel-token.conf <<EOF
# sun-panel token 注入（自动生成，请勿手改）
EOF
      # 在 sun-panel 的 location /panel/api/ 块里注入 proxy_set_header token
      sed -i '/location \/panel\/api\//,/}/ s/proxy_pass http:\/\/mei_sunpanel;/proxy_pass http:\/\/mei_sunpanel;\n        proxy_set_header token "'"$SP_TOKEN"'";/' /etc/nginx/conf.d/00-main.conf 2>/dev/null
      nginx -s reload 2>/dev/null
      echo "[mei-allin] sun-panel token 注入完成: ${SP_TOKEN:0:8}..."
      break
    fi
  done
) &

# ---- sun-panel 初始化 conf + 改端口 ----
SUNPANEL_DIR="/app/apps/sun-panel"
if [ -d "$SUNPANEL_DIR" ]; then
  cd "$SUNPANEL_DIR"
  if [ ! -f conf/conf.ini ]; then
    ./sun-panel -config >/dev/null 2>&1 || true
  fi
  # 设置端口为 3006（避免与 mei-link 的 3002 冲突）
  if [ -f conf/conf.ini ]; then
    sed -i 's/^http_port=.*/http_port=3006/' conf/conf.ini 2>/dev/null || true
  fi
  cd /
fi

# ---- 启动 ----
echo "[mei-allin] 启动 supervisord（nginx + shell + 各应用）"
exec "$@"
