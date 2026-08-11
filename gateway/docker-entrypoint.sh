#!/bin/sh
# 网关初始化脚本（由官方 nginx entrypoint 在启动前自动执行）
# 职责：用 envsubst 替换 conf.d 中的白名单环境变量
# 注意：不要 exec nginx，交给官方 entrypoint 统一启动

: "${ROOT_DOMAIN:=allin.local}"
: "${SHELL_ORIGIN:=http://shall:3000}"

: "${SUBDOMAIN_PANEL:=panel}"
: "${SUBDOMAIN_DRAW:=draw}"
: "${SUBDOMAIN_MEDIA:=media}"
: "${SUBDOMAIN_TV:=tv}"
: "${SUBDOMAIN_MUSIC:=music}"
: "${SUBDOMAIN_TOOLS:=tools}"
: "${SUBDOMAIN_LINK:=link}"
: "${SUBDOMAIN_NOVELS:=novels}"

echo "[mei-allin] ROOT_DOMAIN=$ROOT_DOMAIN  SHELL_ORIGIN=$SHELL_ORIGIN"

for f in /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  envsubst '${ROOT_DOMAIN} ${SHELL_ORIGIN} ${SUBDOMAIN_PANEL} ${SUBDOMAIN_DRAW} ${SUBDOMAIN_MEDIA} ${SUBDOMAIN_TV} ${SUBDOMAIN_MUSIC} ${SUBDOMAIN_TOOLS} ${SUBDOMAIN_LINK} ${SUBDOMAIN_NOVELS}' \
    < "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
done

echo "[mei-allin] 网关配置就绪"
