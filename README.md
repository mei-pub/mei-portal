# Mei-Portal

> 多应用聚合门户·单镜像交付：影视、音乐、网盘搜索、流媒体下载、AI 绘图、工具箱、内网穿透、小说阅读——一个容器全带走。
> 前身 mei-allin，2026-09 更名 mei-portal（GitHub 旧地址自动重定向）。

[![apps](https://img.shields.io/badge/apps-8-blue)](#整合的应用) [![deploy](https://img.shields.io/badge/deploy-单镜像-9cf)](#快速开始) [![status](https://img.shields.io/badge/status-生产可用-brightgreen)](#核心特性) [![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey)](LICENSE)

## 核心特性

- **单镜像单端口**：nginx + 门户外壳 + 8 个应用全部本地源码构建，打进一个镜像，只暴露 `7777`，`docker run` 即用，零外部镜像依赖。
- **统一登录**：单账户门禁，登录一次全应用通行；子应用不再各自维护登录（音乐、下载、搜索等内部应用共用门户会话）。
- **应用秒切**：访问过的应用 iframe 保活驻留、顶栏悬停即预热、静态资源长缓存——切应用不重载，音乐跨应用不断播。
- **网盘搜索**：内置 pansou 聚合引擎，50+ 网页插件（剧透社/盘搜/小酷盘等）+ 113 个 TG 资源频道 + 19 个磁力/电驴引擎（电影天堂/磁力狗/磁力帝/磁力猫等 DHT 引擎），夸克/阿里/百度/迅雷/UC/115 等网盘链接与 magnet/ed2k 聚合检索、跨源去重、按类型筛选。
- **音乐常驻**：MusicDock 悬浮播放条跨应用常驻，切到影视/工具页背景不断播；音乐应用内有完整播放页。
- **内网穿透**：mei-link（frp 客户端）Web 管理，故障引导弹层 + 自动重连/重启两段式策略。
- **视觉统一**：悬浮玻璃顶栏与应用内标准左侧导航面板由门户统一注入，各应用（React/Vue/原生 JS/静态页）保持一套观感。

## 整合的应用

| 应用 | 子路径 | 说明 |
|---|---|---|
| 🏠 Shell 门户 | `/` | 统一入口：登录、应用导航、综合搜索中心、音乐 Dock |
| 📺 影视门户 MeiTV | `/tv` | 豆瓣式影视聚合与在线播放 |
| 🎵 音乐播放 Mei Music | `/music` | 沉浸式音乐播放器，完整播控 + 歌词，跨应用不断播 |
| 🔍 网盘搜索 | `/disks` | 聚合网盘/磁力搜索：多网盘分享链接与 magnet/ed2k 一键检索，跨源去重、按网盘/磁力类型筛选 |
| ⬇️ 媒体下载 | `/media` | m3u8 / 视频流批量嗅探下载 |
| 🖼 AI 绘图 Mei Draw | `/draw` | Excalidraw / Mermaid / Drawio 三种画板 |
| 🧰 工具箱 | `/tools` | 隐私优先的本地工具集合（图片 / PDF / 文本处理） |
| 🔗 内网穿透 | `/link` | frp 隧道客户端管理：故障引导弹层 + 自动重连 |
| 📚 小说阅读 | `/novels` | 个人小说站：公开书架 + 纸牌伪装的隐秘书架 |

## 快速开始

### 直接用发布镜像（推荐）

```bash
docker run -d --name mei-portal --restart unless-stopped \
  -p 7777:7777 -v mei-portal-data:/data \
  ghcr.io/mei-pub/mei-portal:latest

# 国内走阿里云 ACR 镜像（内容同 GHCR）：
# crpi-s6cwk4b9c6s5zn5q.cn-hangzhou.personal.cr.aliyuncs.com/meilink/mei-portal:latest
```

浏览器打开 `http://<服务器IP>:7777`，默认账户：

| 用户名 | 密码 |
|---|---|
| `admin` | `mei-allin` |

### 从源码构建（docker compose）

```bash
git clone https://github.com/mei-pub/mei-portal.git
cd mei-portal
docker compose up -d --build    # 国内构建自动走 goproxy.cn
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MEI_ADMIN_USER` | `admin` | 管理员用户名（仅首次初始化生效） |
| `MEI_ADMIN_PASSWORD` | `mei-allin` | 管理员密码（仅首次初始化生效） |
| `YOUTUBE_PO_TOKEN` | 空 | bgutil PO Token 服务异常时手工覆盖（音乐 YouTube 源） |
| `YOUTUBE_VISITOR_DATA` | 空 | 同上 |
| `TZ` | `Asia/Shanghai` | 时区 |

> **账户机制**：凭据只在 `$DATA_DIR/shell/user.json` 不存在时初始化一次，之后请登录门户在设置里修改密码（改环境变量不会再生效）。忘记密码时：`docker exec <容器> rm /data/shell/user.json && docker restart <容器>`，账户回到当时的默认值/环境变量重新初始化（注意：账户级数据按 uid 归档，重置后旧 uid 关联的数据如音乐进度会失联）。

### 数据持久化

全部状态落在 `/data`（`shell/` 账户与音乐状态、`pansou/` 搜索缓存、`mediago/` 下载与配置、`tutorial/` 书架、`mei-link/` 穿透配置、各应用自有数据）。**备份该卷即备份一切。**

## 架构

```
浏览器
  │  http://host:7777
  ▼
nginx（唯一入口，sub_filter 注入顶栏脚本）
  │  Sec-Fetch-Dest 判别：document 请求 → Shell 壳渲染；iframe 请求 → 直进应用
  ├─ /            Shell 门户（Next.js，:3010）── 统一登录 / iframe 承载页 / 搜索中心
  ├─ /tv         LunaTV        (:3003)   ┐
  ├─ /music      Solara        (:3005)   │
  ├─ /disks      pansou Go API (:3008)   │ 各应用独立进程，supervisord 守护
  ├─ /media      mediago-core  (:3000)   │ 顶栏/左面板由门户注入
  ├─ /draw       ai-draw       (:3004)   │
  ├─ /tools      omni-tools    （静态）  │
  ├─ /link       mei-link      (:3002)   │
  ├─ /novels     tutorial      (:3001)   ┘
  └─ bgutil PO Token 服务（:4416，音乐 YouTube 源加速）
```

- **单镜像**：`image/Dockerfile` 多阶段构建，8 个应用全部本地源码编译，运行时 supervisord 编排（`image/supervisord.conf`）。
- **路由分发**：同一 URL 下 nginx 用 `Sec-Fetch-Dest`（含头缺失时的 Accept 兜底）区分「顶级文档」与「iframe 内嵌」：前者跳 Shell 壳（有顶栏、可导航），后者直进应用原生页面——应用既可独立访问又无缝嵌入门户。
- **应用切换**：承载页客户端路由（`packages/shall/src/components/AppFrame.tsx`），iframe 保活 + LRU 淘汰 + 顶栏预热 + nginx 静态缓存策略，切换已访问应用零重载。
- **顶栏避让**：悬浮玻璃胶囊设计，应用在自身文档内部用 `--mei-topbar-space` 让位，背景自然延伸到胶囊下方（详见 `AGENTS.md` 顶部空间契约）。

## 目录结构

```
mei-portal/
├── packages/
│   └── shall/              # 门户外壳（Next.js）：登录、顶栏、iframe 宿主、
│                           #   综合搜索（含网盘/磁力源注册表 disk-sources.ts）、
│                           #   MusicDock 音乐引擎 music-engine.ts
├── apps/                   # 各应用——全部为一等公民本地代码（目录名 = URL 子路径）
│   ├── tv/                 #   影视门户（Next.js，原 LunaTV 魔改演进）
│   ├── music/              #   音乐播放（原生 JS + Node 服务，原 Solara）
│   ├── disks/              #   网盘搜索：web/（Vue 前端）+ pansou/（Go 引擎，过渡期，
│   │                       #   将被本仓库 Node/TS 复刻引擎替换；含定制磁力插件）
│   ├── media/              #   流媒体下载（Go core + React UI，原 MediaGo；Go 为过渡期）
│   ├── draw/               #   AI 绘图（Vite + React + Express，原 ai-draw）
│   ├── tools/              #   工具箱（Vite + React + MUI，纯静态，原 omni-tools）
│   ├── link/               #   内网穿透（Node + TS + frp 客户端管理）
│   └── novels/             #   小说阅读（Next.js + SQLite，自研）
├── image/                  # 单镜像定义
│   ├── Dockerfile          #   多阶段构建（10+ 构建器 → 单运行时）
│   ├── supervisord.conf    #   进程编排（nginx/shell/各应用，含插件与频道清单）
│   ├── nginx/              #   路由与缓存策略（conf.d/00-main.conf 为核心）
│   ├── entrypoint.sh       #   首启初始化（数据目录、默认账户、mediago 自动 setup）
│   └── plugins.json        #   应用清单（门户首页卡片）
├── docs/                   # 架构/排障/主题文档
├── scripts/                # 构建辅助
├── AGENTS.md               # AI 智能体协作强约束（顶栏/左面板/搜索源/穿透/缓存等架构契约）
└── docker-compose.yml      # 源码构建 + 运行
```

## 发布流程

push `v*` tag（或 workflow_dispatch）触发 `.github/workflows/release.yml`：

1. 多架构镜像 `linux/amd64 + linux/arm64` 构建并推送 GHCR（`:版本号` + `:latest`）与阿里云 ACR；
2. 导出多架构 OCI 离线包挂 Release 附件（离线环境 `docker load` 即用）；
3. Release 说明自动附 `docker run` 用法。

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## 开发

- **本地验证**：`docker compose up -d --build` 后访问 `http://127.0.0.1:7777`；单服务调试可 `docker exec mei-allin supervisorctl status`。
- **Go 插件**（pansou）：`apps/disks/pansou/plugin/`，遵循上游开发规范（`docs/pansou-plugin-developer-SKILL.md` 模式）；注意本仓库需用 Go 1.25 构建（sonic 依赖与更新版 Go 不兼容）。
- **智能体协作**：任何 AI 辅助改动请先读 `AGENTS.md`——顶栏/左侧面板组件化、顶部空间契约、播放组件与播放页职责分离、mei-link 故障引导、iframe 保活与缓存策略、nginx 路由判别等强约束均在其中，违规判定标准也写明。

## 许可

整合层代码 Apache-2.0。`apps/` 下 tv / music / media / draw / tools / disks 等应用源自开源项目并经大量魔改演进为本地一等公民代码，仓库内仍保留其原始许可文件，使用时请一并遵守，勿用于盈利目的。
