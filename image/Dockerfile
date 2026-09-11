# mei-portal 单镜像（全源码本地构建版）
# 所有应用为一等公民本地源码（apps/），构建期不依赖官方镜像/git clone
# 新增应用 = 加一个 builder stage + COPY 产物 + nginx location + supervisor 服务
# =============================================================================

# ---- Shell 门户 builder ----
# node:sqlite（数据备份/恢复）需要 Node 22，运行时也是 node:22-bookworm-slim
FROM node:22-bookworm-slim AS shell-builder
WORKDIR /build
COPY packages/shall/package.json packages/shall/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY packages/shall/ ./
RUN npm run build

# ---- novels 小说阅读（Next.js，basePath=/novels）----
FROM node:22-bookworm-slim AS novels-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY apps/novels/ ./
# 字体下载脚本首次启动会跑，构建时跳过
ENV SKIP_FONT_DOWNLOAD=1
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- link 内网穿透（Node + 原生 JS，frpc 外部工具经 GitHub Release 下载）----
# 用 alpine 基础（su-exec 在 alpine 有），只下载 frpc 二进制
FROM node:22-alpine AS link-builder
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
COPY apps/link/client/docker/ ./

# ---- tv 影视门户（Next.js 14，basePath=/tv，单密码模式）----
FROM node:22-bookworm-slim AS tv-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY apps/tv/ ./
# localstorage 单密码模式（零外部依赖），密码由运行时 env 设
ENV NEXT_PUBLIC_STORAGE_TYPE=localstorage
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
RUN pnpm install --no-frozen-lockfile
RUN pnpm run build

# ---- tools 工具箱（Vite + React + MUI，纯静态，basePath=/tools）----
FROM node:22-bookworm-slim AS tools-builder
WORKDIR /build
COPY apps/tools/ ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build
# 生成真实工具路径清单（locale 键是 camelCase，与 kebab-case 路由不一致，不能直接当 href 用）
RUN node scripts/generate-tool-manifest.mjs

# ---- draw AI 绘图（Vite + React + Express，basePath=/draw，sqlite3）----
FROM node:22-bookworm-slim AS draw-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY apps/draw/ ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- music 音乐播放（Node + 原生 JS）----
FROM node:22-bookworm-slim AS music-builder
WORKDIR /build
COPY apps/music/ ./
# solara 的 package.json 在 server/ 子目录
WORKDIR /build/server
RUN npm install --no-audit --no-fund --legacy-peer-deps
WORKDIR /build

# ---- YouTube PO Token Provider（实验性音乐源）----
FROM node:22-bookworm-slim AS bgutil-builder
WORKDIR /build
ADD https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/1.3.2.tar.gz /tmp/bgutil.tar.gz
RUN echo "3545ac7ffc0869498755cb3b4760a72fa2f176689d0890a6f5b898d163012ba2  /tmp/bgutil.tar.gz" \
      | sha256sum -c - \
    && tar -xzf /tmp/bgutil.tar.gz --strip-components=2 \
      -C /build bgutil-ytdlp-pot-provider-1.3.2/server \
    && npm ci --no-audit --no-fund \
    && npx tsc \
    && npm prune --omit=dev

# ---- disks 网盘搜索（Node/TS 复刻引擎 + Vue 前端；Go 引擎已退役）----
FROM node:22-bookworm-slim AS disks-engine-builder
WORKDIR /build
COPY apps/disks/engine/package.json apps/disks/engine/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY apps/disks/engine/ ./
FROM node:22-bookworm-slim AS disks-web-builder
WORKDIR /build
COPY apps/disks/web/ ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- media 下载中心（core-ts Node 引擎 + React UI + 外部下载工具；Go core 已退役）----
# 全部从本地源码构建
FROM node:22-bookworm-slim AS media-node-builder
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      echo "linux-x64" > /tmp/deps-platform; \
    else \
      echo "linux-${TARGETARCH}" > /tmp/deps-platform; \
    fi
COPY apps/media/ ./
RUN rm -rf core-ts
RUN pnpm install --frozen-lockfile || pnpm install
# 构建 player-ui（播放页，目录形式部署到 /app/apps/media/player）
RUN pnpm --filter @mediago/player-ui run build
# 构建 web UI（server 模式静态产物）
ENV APP_TARGET=server
ENV NODE_ENV=production
RUN pnpm build:web
# 下载第三方下载工具（yt-dlp/ffmpeg/N_m3u8DL-RE/BBDown/aria2 等，GitHub Release + in-tree 本地源）
RUN pnpm deps:download --platform $(cat /tmp/deps-platform)

# ---- media core（Node/TS 复刻版，Go core 已退役；better-sqlite3 原生依赖）----
FROM node:22-bookworm-slim AS media-engine-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY apps/media/core-ts/package.json apps/media/core-ts/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY apps/media/core-ts/ ./


# ---- 运行时（必须最后一个 FROM）----
# =============================================================================
FROM node:22-bookworm-slim AS runtime
# libicu72：N_m3u8DL-RE（.NET AOT，m3u8 下载主路径）运行时必需，
# 缺失时报 "Couldn't find a valid ICU package"，且 schema 的 --ui-language zh-CN
# 在 invariant 模式下也会被拒
RUN apt-get update && apt-get install -y \
        nginx gettext-base ca-certificates curl python3 python3-pip python3-venv \
        libicu72 \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default \
    && python3 -m pip install --no-cache-dir --break-system-packages \
        supervisor \
        yt-dlp==2026.8.19 \
        yt-dlp-ejs==0.8.0 \
        bgutil-ytdlp-pot-provider==1.3.2 \
    && which supervisord

WORKDIR /app

# ---- Shell ----
COPY --from=shell-builder /build/.next/standalone ./
COPY --from=shell-builder /build/.next/static ./.next/static
COPY --from=shell-builder /build/public ./public
COPY --from=shell-builder /build/node_modules ./node_modules

# ---- novels ----
COPY --from=novels-builder /build/.next/standalone ./apps/novels/
COPY --from=novels-builder /build/.next/static ./apps/novels/.next/static
COPY --from=novels-builder /build/public ./apps/novels/public
COPY --from=novels-builder /build/scripts ./apps/novels/scripts

# ---- link ----
COPY --from=link-builder /usr/local/bin/frpc /usr/local/bin/frpc
COPY --from=link-builder /build ./apps/link

# ---- tv ----
COPY --from=tv-builder /build/.next/standalone ./apps/tv/
COPY --from=tv-builder /build/.next/static ./apps/tv/.next/static
COPY --from=tv-builder /build/public ./apps/tv/public

# ---- tools（静态文件）----
COPY --from=tools-builder /build/dist ./apps/tools
COPY --from=tools-builder /build/tool-manifest.json ./apps/tools/tool-manifest.json

# ---- draw（Express + dist）----
COPY --from=draw-builder /build/dist ./apps/draw/dist
COPY --from=draw-builder /build/server ./apps/draw/server
COPY --from=draw-builder /build/package.json ./apps/draw/package.json
COPY --from=draw-builder /build/node_modules ./apps/draw/node_modules

# ---- music ----
COPY --from=music-builder /build ./apps/music
COPY --from=bgutil-builder /build/build ./apps/bgutil/build
COPY --from=bgutil-builder /build/node_modules ./apps/bgutil/node_modules
COPY --from=bgutil-builder /build/package.json ./apps/bgutil/package.json

# ---- disks（TS 引擎 + Vue 前端 dist）----
COPY --from=disks-engine-builder /build ./apps/disks/engine
COPY --from=disks-web-builder /build/dist ./apps/disks/frontend/dist

# ---- media（TS core + 前端静态 + 播放页 + 下载工具）----
COPY --from=media-engine-builder /build ./apps/media/core-ts
COPY --from=media-node-builder /src/apps/ui/build/server ./apps/media/static
COPY --from=media-node-builder /src/apps/player-ui/dist ./apps/media/player
ARG TARGETARCH
COPY --from=media-node-builder /src/.deps/linux-* /app/deps-tmp/
RUN mkdir -p /app/apps/media/deps && \
    find /app/deps-tmp -type f -exec cp {} /app/apps/media/deps/ \; && \
    chmod +x /app/apps/media/deps/* && \
    rm -rf /app/deps-tmp

# ---- 配置 ----
# 覆盖 debian nginx 默认配置：nginx.conf + conf.d/
COPY image/nginx/nginx.conf /etc/nginx/nginx.conf
COPY image/nginx/conf.d/ /etc/nginx/conf.d/
COPY image/nginx/snippets/ /etc/nginx/snippets/
RUN rm -rf /etc/nginx/sites-enabled
COPY image/plugins.json /etc/mei-plugins.json
COPY image/supervisord.conf /etc/supervisor/conf.d/mei-portal.conf
RUN mkdir -p /etc/supervisor && ln -sf /etc/supervisor/conf.d/mei-portal.conf /etc/supervisor/supervisord.conf
COPY image/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/data"]
ENV NODE_ENV=production TZ=Asia/Shanghai
EXPOSE 7777
ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/mei-portal.conf"]
