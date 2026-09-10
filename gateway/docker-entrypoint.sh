#!/bin/sh
# 网关初始化脚本（由官方 nginx entrypoint 在启动前自动执行）
# 职责：
#   1. 用 envsubst 替换 conf.d 中的白名单环境变量
#   2. 若 USE_TLS=true 且证书存在，注入 SSL 全局参数并把所有 server 改为监听 443
# 注意：不要 exec nginx，交给官方 entrypoint 统一启动

: "${ROOT_DOMAIN:=allin.local}"
: "${SHELL_INTERNAL:=http://shall:3000}"
: "${SHELL_ORIGIN:=http://${ROOT_DOMAIN}}"
: "${USE_TLS:=false}"

: "${SUBDOMAIN_PANEL:=panel}"
: "${SUBDOMAIN_DRAW:=draw}"
: "${SUBDOMAIN_MEDIA:=media}"
: "${SUBDOMAIN_TV:=tv}"
: "${SUBDOMAIN_MUSIC:=music}"
: "${SUBDOMAIN_TOOLS:=tools}"
: "${SUBDOMAIN_LINK:=link}"
: "${SUBDOMAIN_NOVELS:=novels}"

echo "[mei-portal] ROOT_DOMAIN=$ROOT_DOMAIN  SHELL_ORIGIN=$SHELL_ORIGIN  SHELL_INTERNAL=$SHELL_INTERNAL  USE_TLS=$USE_TLS"

# 0. 等待 Shell 就绪（用内部地址探测；避免网关先起来反代到未就绪的 Shell）
#    仅在真正启动时执行；nginx -t / -T 等检测模式跳过（官方 entrypoint 不向脚本
#    传 $@，故从 PID 1 的 cmdline 判断）。
IS_TEST=0
CMDLINE=$(tr '\0' ' ' < /proc/1/cmdline 2>/dev/null || echo "")
case "$CMDLINE" in
  *"-t "*|*" -t"|*" -T "*|*" -T"|*" --test"*) IS_TEST=1;;
esac
if [ "$IS_TEST" = "0" ] && [ -n "$SHELL_INTERNAL" ]; then
  SHELL_HOST=$(echo "$SHELL_INTERNAL" | sed -E 's|^https?://||; s|[:/].*$||')
  SHELL_PORT=$(echo "$SHELL_INTERNAL" | sed -E 's|^https?://||; s|^[^:/]+:||; s|/.*$||')
  SHELL_PORT="${SHELL_PORT:-80}"
  echo "[mei-portal] 等待 Shell 就绪：$SHELL_HOST:$SHELL_PORT"
  for i in $(seq 1 60); do
    if wget -qO- "http://$SHELL_HOST:$SHELL_PORT/" >/dev/null 2>&1; then
      echo "[mei-portal] Shell 已就绪（${i}s）"
      break
    fi
    sleep 1
    [ "$i" = "60" ] && echo "[mei-portal] ⚠ Shell 60s 未就绪，网关仍将启动（反代可能暂时 502）"
  done
fi

# 1. envsubst 替换白名单变量
for f in /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  envsubst '${ROOT_DOMAIN} ${SHELL_ORIGIN} ${SUBDOMAIN_PANEL} ${SUBDOMAIN_DRAW} ${SUBDOMAIN_MEDIA} ${SUBDOMAIN_TV} ${SUBDOMAIN_MUSIC} ${SUBDOMAIN_TOOLS} ${SUBDOMAIN_LINK} ${SUBDOMAIN_NOVELS}' \
    < "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
done

# 2. TLS：若启用且证书就绪，把 listen 80 改为同时监听 80 + 443 ssl，并注入证书
if [ "$USE_TLS" = "true" ] && [ -f /etc/nginx/certs/cert.pem ] && [ -f /etc/nginx/certs/key.pem ]; then
  echo "[mei-portal] 启用 HTTPS（443）"
  # 在 http 块注入 ssl 参数（通过独立 conf 文件，nginx.conf 的 http 块会 include conf.d）
  cat > /etc/nginx/conf.d/01-ssl.conf <<'EOF'
ssl_certificate     /etc/nginx/certs/cert.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_session_cache shared:SSL:5m;
# HTTP→HTTPS 跳转
EOF
  # 给每个 server 增加 ssl listen + 80 跳转。用 sed 把 listen 80 替换为含 ssl 的版本。
  for f in /etc/nginx/conf.d/00-apps.conf; do
    [ -f "$f" ] || continue
    sed -i 's/listen 80;/listen 80;\n    listen 443 ssl;/g' "$f"
  done
  # 新增一个 80→443 跳转 server（覆盖根域）
  cat >> /etc/nginx/conf.d/01-ssl.conf <<EOF
server {
    listen 80;
    server_name *.${ROOT_DOMAIN} ${ROOT_DOMAIN};
    return 301 https://\$host\$request_uri;
}
EOF
else
  echo "[mei-portal] HTTP 模式（80）"
fi

echo "[mei-portal] 网关配置就绪"
