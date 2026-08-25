# mei-allin 单镜像（全源码本地构建版）
# 所有应用源码 vendored 在 third_party/ 引用项目目录，构建期不依赖官方镜像/git clone
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

# ---- tutorial（Next.js，basePath=/novels，vendored）----
FROM node:22-bookworm-slim AS tutorial-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY third_party/tutorial/ ./
# 字体下载脚本首次启动会跑，构建时跳过
ENV SKIP_FONT_DOWNLOAD=1
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- mei-link（Node + 原生 JS，vendored，frpc 外部工具 Release 下载）----
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
COPY third_party/mei-link/client/docker/ ./

# ---- lunatv（Next.js 14，basePath=/tv，单密码模式，vendored）----
FROM node:22-bookworm-slim AS lunatv-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY third_party/lunatv/ ./
# localstorage 单密码模式（零外部依赖），密码由运行时 env 设
ENV NEXT_PUBLIC_STORAGE_TYPE=localstorage
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
RUN pnpm install --no-frozen-lockfile
RUN pnpm run build

# ---- omni-tools（Vite + React + MUI，纯静态，basePath=/tools，vendored）----
FROM node:22-bookworm-slim AS omni-tools-builder
WORKDIR /build
COPY third_party/omni-tools/ ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- ai-draw（Vite + React + Express，basePath=/draw，sqlite3，vendored）----
FROM node:22-bookworm-slim AS ai-draw-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY third_party/ai-draw/ ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- solara（Node + 原生 JS 音乐播放，vendored）----
FROM node:22-bookworm-slim AS solara-builder
WORKDIR /build
COPY third_party/solara/ ./
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

# ---- pansou 网盘搜索（Go 后端 + Vue 前端，vendored 本地编译）----
FROM golang:1.25-bookworm AS pansou-builder
WORKDIR /build
ENV GOPROXY=https://goproxy.cn,direct
COPY third_party/pansou/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pansou .
FROM node:22-bookworm-slim AS pansou-web-builder
WORKDIR /build
COPY third_party/pansou-web/ ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build

# ---- mediago 流媒体下载（Go core + React UI + 外部下载工具，vendored 本地编译）----
# 参考官方 Dockerfile 结构，全部从 vendored 源码构建
FROM node:22-bookworm-slim AS mediago-node-builder
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
COPY third_party/mediago/ ./
RUN pnpm install --frozen-lockfile || pnpm install
# 构建 player-ui（嵌入 Go core）
RUN pnpm --filter @mediago/player-ui run build
# 构建 web UI（server 模式静态产物）
ENV APP_TARGET=server
ENV NODE_ENV=production
RUN pnpm build:web
# 下载第三方下载工具（yt-dlp/ffmpeg/N_m3u8DL-RE/BBDown/aria2 等，GitHub Release + in-tree 本地源）
RUN pnpm deps:download --platform $(cat /tmp/deps-platform)
FROM golang:1.25-bookworm AS mediago-go-builder
WORKDIR /src
ENV GOPROXY=https://goproxy.cn,direct
COPY third_party/mediago/apps/core/go.mod third_party/mediago/apps/core/go.sum apps/core/
RUN cd apps/core && go mod download
COPY third_party/mediago/apps/core/ apps/core/
COPY --from=mediago-node-builder /src/apps/player-ui/dist apps/core/assets/player/
RUN cd apps/core && go mod download
RUN cd apps/core && CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/mediago-core ./cmd/server


# ---- 运行时（必须最后一个 FROM）----
# =============================================================================
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y \
        nginx gettext-base ca-certificates curl python3 python3-pip python3-venv \
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
COPY --from=bgutil-builder /build/build ./apps/bgutil/build
COPY --from=bgutil-builder /build/node_modules ./apps/bgutil/node_modules
COPY --from=bgutil-builder /build/package.json ./apps/bgutil/package.json

# ---- pansou（本地编译 Go 二进制 + Vue 前端 dist）----
COPY --from=pansou-builder /out/pansou ./apps/pansou/pansou
COPY --from=pansou-web-builder /build/dist ./apps/pansou/frontend/dist

# ---- mediago（本地编译 core + 前端静态 + 下载工具）----
COPY --from=mediago-go-builder /out/mediago-core ./apps/mediago/mediago-core
COPY --from=mediago-node-builder /src/apps/ui/build/server ./apps/mediago/static
ARG TARGETARCH
COPY --from=mediago-node-builder /src/.deps/linux-* /app/deps-tmp/
RUN mkdir -p /app/apps/mediago/deps && \
    find /app/deps-tmp -type f -exec cp {} /app/apps/mediago/deps/ \; && \
    chmod +x /app/apps/mediago/deps/* && \
    rm -rf /app/deps-tmp

# ---- 配置 ----
# 覆盖 debian nginx 默认配置：nginx.conf + conf.d/
COPY image/nginx/nginx.conf /etc/nginx/nginx.conf
COPY image/nginx/conf.d/ /etc/nginx/conf.d/
COPY image/nginx/snippets/ /etc/nginx/snippets/
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
