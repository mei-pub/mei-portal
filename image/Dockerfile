# syntax=docker/dockerfile:1
# =============================================================================
# mei-allin 单镜像
# 渐进式：先 Shell + nginx + 已有 submodule 应用，架构预留扩展点
# 新增应用 = 加一个 builder stage + COPY 产物 + nginx location + supervisor 服务
# =============================================================================

# ---- Shell 门户 builder ----
FROM node:20-bookworm-slim AS shell-builder
WORKDIR /build
COPY packages/shall/package.json packages/shall/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY packages/shall/ ./
ENV NEXT_PUBLIC_MEI_MODE=single
RUN npm run build

# ---- tutorial（Next.js，basePath=/novels）从 submodule ----
FROM node:22-bookworm-slim AS tutorial-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY packages/tutorial/ ./
COPY image/patches/tutorial.mjs ./patch.mjs
RUN node patch.mjs
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
# 字体下载脚本首次启动会跑，构建时跳过
ENV SKIP_FONT_DOWNLOAD=1
RUN npm run build

# ---- mei-link（Node + 原生 JS，从 submodule docker client）----
# 用 alpine 基础（su-exec 在 alpine 有），只下载 frpc 二进制
FROM node:22-alpine AS meilink-builder
WORKDIR /build
ARG TARGETARCH
ARG FRP_VERSION=0.70.0
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) SHA=281cb31e6b915113179c6ebb65b5977a5d9d7fb96f9a70867be83dee3b657721 ;; \
      arm64) SHA=9dd282fd8d1b90a8ee760702ac5b876748b519c6bdfac7c68418f62a05d805c6 ;; \
    esac; \
    apk add --no-cache curl tar; \
    curl -fsSL -o /tmp/frp.tgz "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    echo "${SHA}  /tmp/frp.tgz" | sha256sum -c -; \
    tar -xzf /tmp/frp.tgz --strip-components=1 -C /usr/local/bin "frp_${FRP_VERSION}_linux_${TARGETARCH}/frpc"; \
    rm /tmp/frp.tgz; \
    frpc --version
COPY packages/mei-link/client/docker/ ./

# ---- lunatv（Next.js 14，basePath=/tv，单密码模式）----
FROM node:22-bookworm-slim AS lunatv-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/MoonTechLab/LunaTV.git .
COPY image/patches/lunatv.mjs ./patch.mjs
# localstorage 单密码模式（零外部依赖），密码由运行时 env 设
ENV NEXT_PUBLIC_STORAGE_TYPE=localstorage
RUN node patch.mjs
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
RUN pnpm install --no-frozen-lockfile
RUN pnpm run build

# ---- omni-tools（Vite + React + MUI，纯静态，basePath=/tools）----
FROM node:22-bookworm-slim AS omni-tools-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/iib0011/omni-tools.git .
COPY image/patches/omni-tools.mjs ./patch.mjs
RUN node patch.mjs
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- ai-draw（Vite + React + Express，basePath=/draw，sqlite3）----
FROM node:22-bookworm-slim AS ai-draw-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/stone-yu/ai-draw.git .
COPY image/patches/ai-draw.mjs ./patch.mjs
RUN node patch.mjs
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- solara（Node + 原生 JS 音乐播放）----
FROM node:22-bookworm-slim AS solara-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/akudamatata/Solara.git .
COPY image/patches/solara.mjs ./patch.mjs
RUN node patch.mjs
# solara 的 package.json 在 server/ 子目录
WORKDIR /build/server
RUN npm install --no-audit --no-fund --legacy-peer-deps
WORKDIR /build

# =============================================================================
# ---- 运行时 ----
# =============================================================================
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y \
        nginx gettext-base ca-certificates curl python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default \
    && python3 -m pip install --no-cache-dir --break-system-packages supervisor \
    && which supervisord

WORKDIR /app

# ---- Shell ----
COPY --from=shell-builder /build/.next/standalone ./
COPY --from=shell-builder /build/.next/static ./.next/static
COPY --from=shell-builder /build/public ./public
COPY --from=shell-builder /build/node_modules ./node_modules

# ---- tutorial ----
COPY --from=tutorial-builder /build/.next/standalone ./apps/tutorial/
COPY --from=tutorial-builder /build/.next/static ./apps/tutorial/.next/static
COPY --from=tutorial-builder /build/public ./apps/tutorial/public
COPY --from=tutorial-builder /build/scripts ./apps/tutorial/scripts

# ---- mei-link ----
COPY --from=meilink-builder /usr/local/bin/frpc /usr/local/bin/frpc
COPY --from=meilink-builder /build ./apps/mei-link

# ---- lunatv ----
COPY --from=lunatv-builder /build/.next/standalone ./apps/lunatv/
COPY --from=lunatv-builder /build/.next/static ./apps/lunatv/.next/static
COPY --from=lunatv-builder /build/public ./apps/lunatv/public

# ---- omni-tools（静态文件）----
COPY --from=omni-tools-builder /build/dist ./apps/omni-tools

# ---- ai-draw（Express + dist）----
COPY --from=ai-draw-builder /build/dist ./apps/ai-draw/dist
COPY --from=ai-draw-builder /build/server ./apps/ai-draw/server
COPY --from=ai-draw-builder /build/package.json ./apps/ai-draw/package.json
COPY --from=ai-draw-builder /build/node_modules ./apps/ai-draw/node_modules

# ---- solara ----
COPY --from=solara-builder /build ./apps/solara

# ---- 配置 ----
# 覆盖 debian nginx 默认配置：nginx.conf + conf.d/
COPY image/nginx/nginx.conf /etc/nginx/nginx.conf
COPY image/nginx/conf.d/ /etc/nginx/conf.d/
RUN rm -rf /etc/nginx/sites-enabled
COPY image/plugins.json /etc/mei-plugins.json
COPY image/supervisord.conf /etc/supervisor/conf.d/mei-allin.conf
RUN mkdir -p /etc/supervisor && ln -sf /etc/supervisor/conf.d/mei-allin.conf /etc/supervisor/supervisord.conf
COPY image/entrypoint.sh /entrypoint.sh
COPY image/services/ /etc/mei-services/
RUN chmod +x /entrypoint.sh
RUN find /etc/mei-services -name run -exec chmod +x {} \; 2>/dev/null || true

VOLUME ["/data"]
ENV NODE_ENV=production TZ=Asia/Shanghai
EXPOSE 7777
ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/mei-allin.conf"]
