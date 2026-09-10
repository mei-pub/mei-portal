# mei-portal

> 把多个异构开源 Web 应用，整合为一个统一门户的 docker-compose 项目。
> **不动任何上游源码**，只做交互层「皮」的协调与统一，保留各应用完整功能。

[![status](https://img.shields.io/badge/status-实测可用-brightgreen)](#实测验证) [![apps](https://img.shields.io/badge/apps-8-blue)](#整合的应用) [![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey)](LICENSE)

## 实测验证

本项目已通过完整的浏览器端到端实测（Docker 全量启动 + Chrome 真实访问）：

| 验证项 | 结果 |
|---|---|
| 9 服务全量启动 | ✅ 全部 Up |
| 门户首页渲染 | ✅ 暗色玻璃拟态，8 应用卡片，健康徽标 |
| 应用 iframe 嵌入 | ✅ tutorial/mei-link/ai-draw 实测渲染完整界面 |
| 主题 loader 注入 | ✅ 8 应用全部注入 `data-app` |
| 安全头剥离 | ✅ 8 应用 X-Frame-Options / CSP 全部剥离 |
| 主题切换广播 | ✅ Shell 切换 → iframe 同步（postMessage） |


## 快速开始

```bash
# 1. 克隆（含 submodule —— tutorial / mei-link 从源码本地构建）
git clone --recurse-submodules <repo-url> mei-allin
cd mei-allin
# 已克隆但缺 submodule？运行： git submodule update --init

# 2. 生成根域名（自动用 nip.io 免配置泛解析）
cp .env.example .env
bash scripts/setup-ip.sh

# 3. 生成配置 + 主题资产
npm install && npm run build

# 4. 启动
docker compose up -d

# 5. 访问门户（域名见 .env 的 ROOT_DOMAIN）
#    http://<ROOT_DOMAIN>  默认密码见 .env 的 SHELL_PASSWORD
```

### HTTPS（可选）

```bash
brew install mkcert && mkcert -install   # 一次性；Linux 见 mkcert 官方文档
bash scripts/setup-certs.sh              # 生成通配证书并设 USE_TLS=true
docker compose up -d                      # 网关将同时监听 443 并把 80 跳转到 443
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
mei-portal/
├── packages/
│   ├── shall/            # Next.js 统一外壳（自研）
│   ├── tutorial/         # git submodule —— 小说站，本地构建
│   └── mei-link/         # git submodule —— 内网穿透，client/docker 本地构建
├── plugins/              # 每应用一目录：manifest.yml + theme.css
│   └── _schema/          # 清单 JSON Schema
├── gateway/nginx/        # 网关配置（gen-nginx 自动生成 conf.d）
├── scripts/              # setup-ip / setup-certs / build-theme / gen-nginx / validate
├── docs/                 # 架构 / 排障 / 主题文档
├── docker-compose.yml
└── .env.example
```

> **关于镜像**：除 tutorial 与 mei-link 外，其余 6 个应用均使用官方公开镜像，无需认证。
> tutorial（私有仓库）与 mei-link（私有仓库）通过 git submodule 从源码本地构建，零认证依赖。

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

## 交互体验

门户与 iframe 双模式，统一顶栏主题控件实时广播到所有应用：

| 功能 | 说明 |
|---|---|
| 门户首页 | 分组卡片网格 + 搜索 + 最近使用置顶 + 在线徽标 |
| 设置集成页（`/settings`） | 左侧栏按系统分组挂载各应用设置入口（网盘搜索/流媒体下载/主页面板/音乐播放/AI 绘图/影视门户/内网穿透/小说书架），右侧 iframe 深链内嵌（`?meiEmbed=1` 免顶栏） |
| 开关集成设置（顶部齿轮） | 应用开关 + 主页内网模式开关（写 sun-panel 的 `panelStorage`） |
| 小说书架管理 | 公开书架默认可见；在蜘蛛纸牌输入主密码后列表出现隐藏书架，可"打开"（会话级激活，同一时间仅一个）与"重新隐藏"（收回访问权） |
| iframe 模式 | 顶栏（应用名 + 返回 + 刷新 + 新窗口 + 全屏）+ 可折叠侧栏 |
| 键盘快捷键 | `⌘K` 搜索、`Esc` 返回门户、`R` 刷新当前应用 |
| 移动端 | 响应式卡片网格 + 侧栏抽屉 |

> **行为变更（mei 定制）**：门户级 🃏 隐藏模式（伪装）已移除——蜘蛛纸牌作为常显入口用于输入密码解锁隐藏书架；各应用主界面的原设置入口已迁移到设置集成页；Sun-Panel 显示名改为 **Mei-Panel**、LunaTV 显示名改为 **MeiTV**、绘图使用手册品牌为 **Mei Draw**。

## 文档

- [架构说明](docs/architecture.md) —— 四层抽象与主题注入机制详解
- [部署排障](docs/troubleshooting.md) —— 常见问题与诊断步骤
- [主题定制](docs/theming.md) —— 如何改全局视觉与单个应用协调 CSS

## 技术约束说明

- **子域名拓扑**：各应用跑在 `<prefix>.<ROOT_DOMAIN>`，避免破坏 SPA 的 base-path（单域名路径前缀会破坏多数上游路由）。
- **iframe 嵌入**：网关剥离 `X-Frame-Options`/`CSP`，无需改上游。
- **认证**：Shell 自管入口门禁，各应用保留自身登录（起步不做跨应用 SSO，避免改源码）。
- **tools（MUI）**：因 MUI 用 Emotion inline 样式，仅做配色近似协调。

## 许可与致谢

本项目仅为整合层代码（Apache-2.0）。各上游应用保留各自许可，请遵守对应项目要求。
