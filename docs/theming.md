# 主题定制指南

## 主题三层结构

```
tokens.css          ← 全局设计令牌（所有应用共享）
  └─ loader.js 注入到每个应用 iframe 的 <head>
       └─ <app>.css  ← 单个应用的协调规则（覆盖该应用的 DOM）
```

- 改 `tokens.css` 的变量 → **所有应用 + Shell** 同时焕新
- 改 `plugins/<app>/theme.css` → **仅该应用** 局部变化

## 修改全局视觉

编辑 `packages/shall/src/theme/tokens.css`，主要变量：

```css
:root {
  /* 主色（靛蓝→紫渐变） */
  --mei-primary: #6366f1;
  --mei-accent: #7c3aed;
  --mei-gradient: linear-gradient(135deg, #6366f1 0%, #7c3aed 100%);

  /* 暗色表面（玻璃拟态） */
  --mei-bg: #0f1117;
  --mei-surface: rgba(28, 31, 42, 0.72);

  /* 圆角 */
  --mei-radius: 16px;

  /* 模糊强度 */
  --mei-blur: blur(20px) saturate(180%);
}
```

亮色板在 `:root[data-mei-theme="light"]` 下覆盖。改完运行：

```bash
npm run build:theme
docker compose build shall && docker compose up -d shall
```

## 运行时切换

无需改代码。Shell 顶栏提供：
- **暗/亮/Auto** 三态切换（持久化到 localStorage，广播给所有 iframe）
- **主色调色板**（6 色，实时改变 `--mei-primary`）

## 协调单个应用

每个应用的协调 CSS 在 `plugins/<id>/theme.css`。它针对该应用**真实 DOM 选择器**写覆盖规则，引用 tokens 变量。

### 工作流

```bash
# 1. 启动后打开该应用（如 http://tv.<ROOT_DOMAIN>）
# 2. F12 开发者工具，用元素选择器定位要改的组件，记下其 class/选择器
# 3. 编辑 plugins/<id>/theme.css，用 !important 覆盖（上游样式优先级高）
# 4. 重新构建并重启
npm run build:theme
docker compose build shall && docker compose up -d shall
# 5. 浏览器硬刷新该应用 iframe（顶栏刷新按钮或 Ctrl+Shift+R）
```

### 示例：把某应用顶栏玻璃化

```css
/* plugins/lunatv/theme.css */
[class*='Sidebar'], aside {
  background: var(--mei-surface) !important;
  backdrop-filter: var(--mei-blur) !important;
  -webkit-backdrop-filter: var(--mei-blur) !important;
  border-right: 1px solid var(--mei-border) !important;
}
```

## 各应用协调难度参考

| 应用 | UI 框架 | 难度 | 说明 |
|---|---|---|---|
| tutorial | Next + Tailwind4 CSS vars | 极低 | 上游已用 `--primary` 等，tokens 已映射 |
| mei-link | 原生 HTML/CSS | 低 | 无框架，class 覆盖力最强 |
| solara | 原生 HTML/CSS | 低 | 同上，注意保留动态背景层 |
| ai-draw | Radix 自研 + Tailwind4 | 低 | 标准 CSS 变量体系 |
| mediago | shadcn/ui (Radix) | 低 | shadcn 标准变量，直接覆盖 |
| lunatv | Next + Headless UI + Tailwind3 | 中 | primary 是 Tailwind 色阶，需近似覆盖 |
| omni-tools | React + MUI + Emotion | 高 | Emotion inline 样式，仅配色近似，需 `!important` 堆叠 |

## 注意事项

- 协调 CSS 用 `!important` 是常态 —— 上游组件库的样式优先级通常很高，不加 `!important` 难以覆盖。这不优雅但是"不动源码"约束下的必要妥协。
- 上游大版本升级可能改变 DOM 结构，导致选择器失效。升级后做**视觉冒烟**，按需更新 `plugins/<id>/theme.css`。
- omni-tools（MUI）无法做到像素级统一，协调 CSS 仅保证整体暗色调与主色接近，明确标注为"部分协调"。
- tokens.css 同时定义了 `--primary` `--background` 等通用名（映射到 `--mei-*`），方便协调 CSS 统一引用，也兼容上游惯用的变量名。
