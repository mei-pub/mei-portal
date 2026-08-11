# 架构说明

## 设计目标

把多个**异构**开源 Web 应用整合为统一门户，满足三个约束：

1. **不动上游源码** —— 只复刻交互层的"皮"
2. **视觉协调统一** —— 跨 5 种 UI 框架（Naive UI / Radix / shadcn / Headless UI / MUI）呈现一致观感
3. **可局部升级、便于扩展** —— 加新应用或升级某应用不影响其他部分

## 为什么"像素级换皮"在不动源码下不可能

8 个应用分别用 Vue+Naive UI、React+Radix、React+shadcn、Next+Headless UI、React+MUI、原生 CSS、Next+Tailwind 等技术栈。它们的样式系统互不兼容，主题机制各异（JS 注入 / CSS 变量 / Tailwind 配置 / Emotion inline）。

**因此方案是：统一外壳（Shell）+ 网关主题注入 + 插件化清单抽象**，做到"视觉协调 + 交互层统一"，而非像素级移植。

## 四层抽象

```
用户浏览器
    │
    ▼
┌─────────────────────────────────────────────┐
│  L1 网关 (gateway/nginx)                     │
│  · 按 server_name 反代到内部应用              │
│  · 剥离 X-Frame-Options / CSP（允许 iframe） │
│  · sub_filter 向 HTML 注入 theme loader      │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴───────────┐
        ▼                      ▼
┌──────────────┐      ┌────────────────────┐
│ L2 Shell     │      │ 内部应用容器         │
│ (packages/   │      │ (官方镜像,不动源码)  │
│  shall)      │      │ sun-panel/ai-draw/  │
· 门户首页     │      │ mediago/lunatv/...  │
│ · iframe宿主 │      └────────────────────┘
│ · 主题控制台 │               ▲
│ · 托管主题   │               │ loader 在此运行
│   资产       │      ┌────────┴───────────┐
└──────┬───────┘      │ L3 主题             │
       │ postMessage  │ · tokens.css 全局令牌│
       └─────────────►│ · <app>.css 协调覆盖 │
                      └────────────────────┘
                               ▲
                               │ 驱动生成
                      ┌────────┴───────────┐
                      │ L4 插件清单         │
                      │ plugins/<id>/      │
                      │   manifest.yml     │
                      │   theme.css        │
                      └────────────────────┘
```

| 层 | 职责 | 升级某应用时影响 |
|---|---|---|
| **L1 网关** | 反代、剥头、注入 loader | 仅改对应 `conf.d` server 块（自动生成） |
| **L2 Shell** | 门户、导航、主题源、iframe 宿主 | 与应用完全解耦，基本不动 |
| **L3 主题** | tokens.css + 每 app 协调 CSS | 改 token → 全局；改某 app.css → 仅局部 |
| **L4 清单** | 每 app 一个 manifest.yml | 升级镜像只改 manifest 的 `upgrade.image` |

## 主题注入机制（核心创新）

这是"只做皮、跨异构框架、不动源码"的关键：

1. **网关侧（nginx sub_filter）**：每个应用的响应 HTML 在 `</head>` 前被注入：
   ```html
   <script src="http://shall/__theme/loader.js" data-app="lunatv"></script>
   ```
   由 `scripts/gen-nginx.mjs` 根据 manifest 自动生成对应 server 块，无需手写。

2. **loader 侧（iframe 内执行）**：
   - 注入 `tokens.css`（全局设计令牌：主色/字体/圆角/暗亮双色板）
   - 注入 `data-app` 对应的 `<app>.css`（针对该应用真实 DOM 的协调规则）
   - 从 localStorage 读主题偏好，设置 `:root[data-mei-theme]`
   - 监听 Shell 通过 `postMessage` 发来的切换指令，实时换肤

3. **Shell 侧**：顶栏主题控件变更时，向所有 `iframe.contentWindow` 广播 `postMessage`。这是跨子域 iframe 实时同步的唯一手段（同源策略下 CSS 变量无法跨 iframe 共享，但 postMessage 允许跨域通信）。

## 拓扑选择：子域名

各应用跑在 `<prefix>.<ROOT_DOMAIN>`，而非单域名的子路径。原因：
- 上游 SPA 的资源路径/basePath 多数写死，单域名路径前缀反代会破坏路由
- 子域名让每个应用都跑在自己的根路径，零侵入

零配置方案：`nip.io` 把 `<x>.<ip>.nip.io` 解析到 `<ip>`，`scripts/setup-ip.sh` 自动生成。

## 认证策略

Shell 自管入口门禁（单一密码，cookie 维持），各应用保留自身登录体系。这是"不动源码"约束下最稳妥的起步方案，未来可逐步为支持 token 的应用加自动登录适配。

## 数据流

```
门户首页渲染：
  page.tsx(server) → getPlugins() 扫描 plugins/*/manifest.yml
                  → 转为 ClientPlugin[] 传给 PortalClient
  PortalClient(client) → 分组、搜索过滤、最近使用、健康徽标

进入应用：
  点击卡片 → setActive(item) → 记录最近使用 → 切换到 iframe 模式
  IframeHost 加载 <app>.<ROOT_DOMAIN> → 网关注入 loader → 主题生效

主题切换：
  TopBar ThemeControls → applyThemeToShell(本地) + broadcastTheme(postMessage)
  iframe loader 收到 message → 设置 :root[data-mei-theme] + 持久化
```

## 关键文件索引

| 文件 | 作用 |
|---|---|
| `packages/shall/src/lib/plugins.ts` | 构建期扫描 manifest，⚠️ 含 node:fs 仅服务端 |
| `packages/shall/src/lib/categories.ts` | 纯客户端常量/类型，避免把 fs 拖入客户端 bundle |
| `packages/shall/src/theme/loader.js` | 被注入到各应用 iframe 内的主题加载器 |
| `packages/shall/src/theme/tokens.css` | 全局设计令牌（改这里=全局焕新） |
| `packages/shall/src/lib/theme-broadcast.ts` | Shell → iframe 的 postMessage 广播 |
| `scripts/gen-nginx.mjs` | 从 manifest 生成 nginx server 块 |
| `scripts/build-theme.mjs` | 聚合 tokens + loader + 各 app.css 到 public/__theme |
| `gateway/docker-entrypoint.sh` | envsubst 替换白名单变量后启动 nginx |
