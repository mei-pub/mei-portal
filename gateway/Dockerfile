# mei-portal 网关 —— nginx + envsubst
FROM nginx:1.27-alpine

# gettext 提供 envsubst
RUN apk add --no-cache gettext

# 证书挂载点（由 setup-certs.sh 生成后通过 volume 挂载）
RUN mkdir -p /etc/nginx/certs

# 主配置
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# 应用 server 配置（由 scripts/gen-nginx.mjs 生成）
COPY nginx/conf.d/ /etc/nginx/conf.d/

# 入口脚本：envsubst 替换 + 可选 TLS 注入后启动
COPY docker-entrypoint.sh /docker-entrypoint.d/40-mei-portal.sh
RUN chmod +x /docker-entrypoint.d/40-mei-portal.sh

# 注意：不覆盖官方 ENTRYPOINT，借助官方 docker-entrypoint.d 机制
