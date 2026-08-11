# mei-allin

> 把多个异构开源 Web 应用，整合为一个统一门户的 docker-compose 项目。
> **不动任何上游源码**，只做交互层「皮」的协调与统一，保留各应用完整功能。

## 整合的应用

| 应用 | 说明 | 上游 |
|---|---|---|
| 🏠 Shell 门户 | 统一入口、导航、主题控制（自研） | — |
| 🖼 AI 绘图 | ai-draw | github.com/stone-yu/ai-draw |
| ⬇️ 流媒体下载 | mediago | github.com/mediago-dev/mediago |
| 📺 影视门户 | LunaTV | github.com/MoonTechLab/LunaTV |
| 🎵 音乐播放 | Solara | github.com/akudamatata/Solara |
| 🧰 工具箱 | omni-tools | github.com/iib0011/omni-tools |
| 🔗 内网穿透 | mei-link（仅 Docker 客户端） | github.com/tomtrije/mei-link |
| 📚 小说站（带纸牌伪装） | tutorial | github.com/tomtrije/tutorial |
| 🔲 主页面板 | sun-panel（可选启动器） | github.com/hslr-s/sun-panel |

## 快速开始

```bash
# 1. 生成根域名（自动用 nip.io 免配置泛解析）
cp .env.example .env
bash scripts/setup-ip.sh

# 2. 启动
docker compose up -d

# 3. 访问门户（域名见 .env 的 ROOT_DOMAIN）
#    http://<ROOT_DOMAIN>  默认密码见 .env 的 SHELL_PASSWORD
```

## 架构（四层抽象）

```
用户 → Nginx 网关（反代+剥头+注入 loader） → { Shell 门户 | 各应用容器 }
                  ↓ sub_filter 注入
          theme loader（iframe 内运行）→ 应用 tokens.css + 协调 CSS
```

| 层 | 职责 | 升级影响 |
|---|---|---|
| L1 网关 | 反代、剥离 X-Frame/CSP、注入 loader | 仅 nginx 配置片段 |
| L2 Shell | 门户、导航、主题源、iframe 宿主 | 自有代码，与 app 解耦 |
| L3 主题 | tokens.css + 每 app 协调 CSS | 改 token 全局，改 app.css 局部 |
| L4 插件清单 | 每 app 一个 `manifest.yml` | 新增 app = 加清单 + 1 个 service |

## 目录结构

```
mei-allin/
├── packages/shall/        # Next.js 统一外壳（自研）
├── plugins/               # 每应用一目录：manifest.yml + theme.css
│   └── _schema/           # 清单 JSON Schema
├── gateway/nginx/         # 网关配置
├── scripts/               # setup-ip / build-theme / validate-manifests
├── docker-compose.yml
└── .env.example
```

## 扩展指南（加第 9 个应用）

1. 新建 `plugins/<id>/manifest.yml`（参考 `plugins/_schema` 或现有应用）。
2. 如需视觉协调，新建 `plugins/<id>/theme.css` 并在 manifest 设 `theme.has_skin: true`。
3. 在 `docker-compose.yml` 加一个 service（指向官方镜像，加入 `mei-net` 网络）。
4. 在 `gateway/nginx/conf.d/` 加 `<id>.conf`（复制现有文件，改 server_name 和 proxy_pass）。
5. 运行 `node scripts/validate-manifests.mjs && node scripts/build-theme.mjs`。
6. 重启：`docker compose up -d <id> gateway shall`。

**无需改动 Shell 代码**——门户会自动发现并展示新应用。

## 升级指南（升级某应用）

1. 改 `docker-compose.yml` 中该 service 的 `image` tag。
2. `docker compose pull <service> && docker compose up -d <service>`。
3. 视觉冒烟：若上游 DOM/类名变化导致 `plugins/<id>/theme.css` 失效，更新对应选择器。
4. manifest 的 `upgrade.image` / `upgrade.repo` 字段记录了官方来源便于检索。

## 主题定制

- 全局视觉令牌集中在 `packages/shall/src/theme/tokens.css`（主色、圆角、暗/亮双色板）。
- 改 token → 所有应用焕新；改某应用 `plugins/<id>/theme.css` → 仅局部生效。
- Shell 顶栏的主题控制台支持运行时亮/暗切换、主色调微调。

## 技术约束说明

- **子域名拓扑**：各应用跑在 `<prefix>.<ROOT_DOMAIN>`，避免破坏 SPA 的 base-path（单域名路径前缀会破坏多数上游路由）。
- **iframe 嵌入**：网关剥离 `X-Frame-Options`/`CSP`，无需改上游。
- **认证**：Shell 自管入口门禁，各应用保留自身登录（起步不做跨应用 SSO，避免改源码）。
- **omni-tools（MUI）**：因 MUI 用 Emotion inline 样式，仅做配色近似协调。

## 许可与致谢

本项目仅为整合层代码（Apache-2.0）。各上游应用保留各自许可，请遵守对应项目要求。
