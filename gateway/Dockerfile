# mei-allin 网关 —— nginx + envsubst
FROM nginx:1.27-alpine

# gettext 提供 envsubst
RUN apk add --no-cache gettext

# 主配置
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# 应用 server 配置（由 scripts/gen-nginx.mjs 生成）
COPY nginx/conf.d/ /etc/nginx/conf.d/

# 入口脚本：envsubst 替换后启动
COPY docker-entrypoint.sh /docker-entrypoint.d/40-mei-allin.sh
RUN chmod +x /docker-entrypoint.d/40-mei-allin.sh

# 注意：不覆盖官方 ENTRYPOINT，借助官方 docker-entrypoint.d 机制
