# 架构说明

## 设计目标

把多个**异构** Web 应用整合为统一门户，满足三个约束：

1. **应用全部本地化** —— 所有应用是一等公民本地代码（`apps/`），从源码构建进同一个镜像，不依赖外部镜像
2. **视觉协调统一** —— 跨 React / Vue / 原生 JS / 静态页多种技术栈呈现一致观感（统一顶栏 + 左侧面板 + 主题令牌）
3. **单镜像交付** —— nginx + 门户外壳 + 全部应用打进一个镜像，只暴露 7777 端口，`docker run` 即用

## 单镜像拓扑

```
浏览器
  │  http://host:7777
  ▼
nginx（唯一入口，监听 7777）
  │  sub_filter 向每个应用 HTML 注入 /__shell/topbar.js（统一顶栏 + 主题令牌）
  │  Sec-Fetch-Dest 判别：document 请求 → 418 内部跳 Shell 壳；iframe 请求 → 直进应用
  ├─ /            Shell 门户（Next.js，:3010）── 统一登录 / iframe 承载页 / 搜索中心 / MusicDock
  ├─ /tv         影视门户     (:3003)   ┐
  ├─ /music      音乐播放     (:3005)   │
  ├─ /disks      disks 引擎   (:3008)   │ 各应用独立进程，supervisord 守护
  ├─ /media      media core-ts (:3000)  │ 目录名 = URL 子路径
  ├─ /draw       AI 绘图     (:3004)   │
  ├─ /tools      工具箱      （静态）    │
  ├─ /link       mei-link    (:3002)   │
  ├─ /novels     小说阅读     (:3001)   ┘
  └─ （bgutil PO Token 服务，:4416，音乐 YouTube 源加速，不经 nginx）
```

进程与端口（`image/supervisord.conf`，共 10 个进程）：

| 进程 | 端口 | 说明 |
|---|---|---|
| nginx | 7777 | 唯一对外入口，路由分发 + 缓存策略 + 顶栏注入 |
| shell | 3010 | 门户外壳（Next.js standalone） |
| novels | 3001 | 小说阅读（Next.js + SQLite） |
| link | 3002 | mei-link 内网穿透（Node/TS） |
| tv | 3003 | 影视门户（Next.js） |
| draw | 3004 | AI 绘图（Express + Vite 静态） |
| music | 3005 | 音乐播放（原生 JS + Node） |
| bgutil | 4416 | YouTube PO Token Provider（实验性音乐源） |
| media | 3000 | media core-ts 引擎（React UI 静态托管） |
| disks | 3008 | 网盘搜索引擎（Node/TS + Vue 前端） |

## 同源子路径 + Sec-Fetch-Dest 路由分发

所有应用跑在**同一域名的不同子路径**（`/tv`、`/music`、`/draw`……，目录名与子路径对齐）。

同一 URL 下 nginx 用 `Sec-Fetch-Dest` 请求头区分两种访问形态：

- **顶级文档请求**（`document`）→ `error_page 418` 内部跳到 `@mei_shell`，渲染门户壳（有顶栏、可导航、承载 iframe）
- **iframe 内嵌请求**（`iframe`，或带 `meiEmbed=1` 参数）→ 直接代理到应用原生页面

外网域名中间的反向代理层可能剥离 `Sec-Fetch-Dest`，因此判别带 fallback：头缺失时用 `Accept` 头（`text/html` 开头）且 URL 不含 `meiEmbed=1` 判定为 document（nginx 侧由 `$mei_is_doc` 复合 map 实现，详见 `AGENTS.md` 的「nginx 路由分发」节）。

应用因此既能独立访问（浏览器直接打开 `http://host:7777/tv` 得到门户壳体验），又能无缝嵌入门户的 iframe。

## 应用接入模型

- **本地代码**：每个应用是 `apps/` 下的一等公民目录，多阶段构建（`image/Dockerfile`）各自编译产物，运行时由 supervisord 拉起独立进程
- **新增应用** = `apps/<id>` 源码 + `image/Dockerfile` 一个 builder/COPY 段 + `image/nginx/conf.d/00-main.conf` 一个 location + `image/supervisord.conf` 一个 `[program:]`，无需任何外部镜像
- **统一鉴权**：门户自管单账户门禁（`/data/shell/user.json`），登录一次全应用通行。部分应用（mei-link、media 等）直接校验门户 `mei-auth` 会话；无法共享会话的应用（mediago / ai-draw）由顶栏经 `/api/auth/me` 把登录凭证注入 localStorage
- **数据持久化**：全部状态落在 `/data`（`shell/` 账户与音乐状态、`novels/` 书架、`link/` 穿透配置、`tv/` `music/` `draw/` 各应用数据、`media/` 下载与配置、`disks/` 搜索缓存），目录名与 `apps/` 对齐，备份该卷即备份一切

## 插件清单（plugins/）

`plugins/<id>/manifest.yml` 是应用的元数据声明，驱动门户首页卡片与外壳应用注册表：

```yaml
id: lunatv          # 唯一标识（= 目录名）
name: 影视门户       # 展示名
description: ...    # 一句话说明
icon: lucide:tv      # iconify 图标
category: media     # 分组（media/utility/network/game/productivity/other）
weight: 10          # 同组排序权重
path: /tv           # 单镜像下的 URL 子路径（nginx location 前缀）
endpoint: http://lunatv:3000   # 健康探活目标（运行时被 image/plugins.json 覆盖为同源）
theme:              # 主题协调（has_skin + theme.css）
health:             # 探活路径与期望状态码
```

构建链：

```
npm run build = validate（schema 校验 + 交叉检查）
              + build:theme（聚合主题资产到 packages/shall/public/__theme/）
                    ├─ tokens.css / loader.js     ← src/theme/
                    ├─ <id>.css                   ← plugins/<id>/theme.css（has_skin=true）
                    └─ plugins.json               ← manifest 聚合（含子路径前缀）
```

运行时链：`packages/shall/src/lib/plugins.ts` 读 `public/__theme/plugins.json`（Docker standalone 容器唯一可用途径）驱动外壳注册表；镜像内由 `image/plugins.json`（含同源 endpoint 与子路径 healthPath 覆盖修正）经 entrypoint 覆盖为 `/app/public/__theme/plugins.json`。

## 主题与视觉统一

- `tokens.css`（全局设计令牌：主色/字体/圆角/暗亮双色板）由 nginx 以 `/__shell/tokens.css` 别名提供，顶栏脚本注入到每个应用页面
- 每个应用的协调 CSS（`plugins/<id>/theme.css`）针对该应用真实 DOM 写覆盖规则，构建期聚合到 `/__theme/<id>.css`
- 统一顶栏（`packages/shall/public/__shell/topbar.js`）与标准左侧面板由门户注入各应用，任何子应用不得自行重写（约束见 `AGENTS.md`）

## 关键文件索引

| 文件 | 作用 |
|---|---|
| `image/Dockerfile` | 多阶段构建：8 个应用 + Shell 全部本地源码编译进单镜像 |
| `image/supervisord.conf` | 10 进程编排（nginx/shell/各应用/bgutil），含优雅停机参数 |
| `image/nginx/conf.d/00-main.conf` | 路由分发核心：同源子路径反代 + Sec-Fetch-Dest 判别 + 顶栏注入 |
| `image/nginx/snippets/cache-policy.conf` | 静态资源缓存策略（map 派生 + 上游头回填） |
| `image/entrypoint.sh` | 首启初始化：数据目录、plugins.json 覆盖、默认账户 |
| `image/plugins.json` | 单镜像运行时插件清单（同源 endpoint + 子路径 healthPath 修正） |
| `packages/shall/src/lib/plugins.ts` | 运行时读 plugins.json 驱动应用注册表，⚠️ 含 node:fs 仅服务端 |
| `packages/shall/src/lib/categories.ts` | 纯客户端常量/类型，避免把 fs 拖入客户端 bundle |
| `packages/shall/src/theme/tokens.css` | 全局设计令牌（改这里=全局焕新） |
| `packages/shall/public/__shell/topbar.js` | 注入到各应用页面的统一顶栏（唯一样式来源） |
| `scripts/validate-manifests.mjs` | manifest schema 校验 + id/path 唯一性交叉检查 |
| `scripts/build-theme.mjs` | 聚合 tokens + loader + 各 app.css + plugins.json 到 public/__theme |
