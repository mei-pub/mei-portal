# AGENTS.md

本文件是 mei-allin 仓库的智能体（Agent）协作强约束。所有智能体（OpenAI Codex、
Cursor、Claude Code、Copilot 等）在本仓库内工作时必须遵守。

## 顶栏与左侧面板组件化强约束

mei-allin 是多应用聚合门户：`packages/shall` 为门户外壳，`third_party/*` 为各子应用
（不同技术栈：React / Vue / 原生 JS / 静态页）。顶栏与左侧面板是全应用共享的门户级
组件，**不允许任何子应用自行重写一套样式**。

### 1. 顶部导航栏

唯一样式来源：`packages/shall/public/__shell/topbar.js`（由 nginx `sub_filter` 注入到
所有子应用页面）。

- 禁止在子应用内重新实现顶栏，或用子应用全局 CSS 覆盖 `#mei-topbar` 系列样式
- 顶栏内部类名一律使用 `mtb-` 前缀命名空间，禁止使用 `mei-` 等通用前缀（历史上曾与
  音乐应用的 `.mei-btn` 类名冲突导致样式错乱）
- 修改顶栏时必须保持作用域复位规则（`#mei-topbar *`）只作用于子元素，不得命中
  `#mei-topbar` 自身（否则会清掉顶栏自身的 padding/box-shadow）

### 1.1 顶部空间契约（悬浮胶囊的避让方式）

顶栏是**悬浮玻璃胶囊**（`position:fixed`），不参与文档流。顶部避让**禁止**由「门户外壳
挖一块留白」实现：那块留白属于外壳文档，露出的是外壳底色，会与应用自身背景（渐变 /
暖白 / 深色）拼出一条突兀色带，同时胶囊的 `backdrop-filter` 背后只有纯色，模糊失效。

唯一实现在 `topbar.js` 的 `spaceCss()` / `mountSpace()` / `ensureScrim()`，规则：

- 承载页 iframe **全屏铺满**（`AppFrame` 不加 paddingTop，`IframeHost` 不加圆角/底色）
- 顶部避让在**应用文档内部**完成：`body{box-sizing:border-box;padding-top:var(--mei-topbar-space)}`，
  应用背景因此自然延伸到胶囊下方
- 空间大小只有两档：展开 74px、收起 30px；抑制态（门户自研主页）为 0 且不注入
- 内层 100vh 容器必须减去 `--mei-topbar-space`（`.min-h-screen` / `.h-screen` / `#root`
  已由 `spaceCss()` 兜底；应用自定义类名需自己引用该变量，如 solara `.mei-main`）
- 胶囊下方由 `#mei-topbar-scrim` 提供**渐隐模糊**过渡：只有 `backdrop-filter` + `mask`，
  **不得引入任何颜色**，否则深色/浅色/渐变背景必然撞色
- iframe 内子应用看不到顶栏，收起态由外壳经 `postMessage`（`{source:'mei-shell',
  type:'topbar-space'}`）广播，子应用侧回写 `body.mei-topbar-collapsed`
- 应用**底色必须挂在 `body`（或 `fixed inset:0` 的背景层）**，不能只挂在内层容器上，
  否则胶囊背后会露出白底（mediago 曾因底色写在内层 div 上出现此问题）

违规判定：应用页面顶部出现与自身背景不一致的横向色带；或顶部内缩后页面底部多出一段
空白滚动区（内层 100vh 未减去 `--mei-topbar-space`）。

### 2. 左侧面板（应用内导航）

每个带应用内导航的子应用必须提供"标准左侧面板"，组件结构由两部分数据驱动：

```text
面板数据 = {
  app:     { logo, name },                          // 当前应用 Logo + 名称
  actions: [ { icon, title, active, onClick } ]     // 行动入口 + 响应事件
}
```

标准视觉规格（各实现必须对齐，参考 `third_party/tutorial/src/components/SitePanel.tsx`）：

- 展开态：`fixed left-2 top-1/2 -translate-y-1/2 z-40`，窄胶囊
  `gap-1 rounded-2xl border border-black/10 bg-white/75 p-1 shadow-lg backdrop-blur-xl`
  （暗色 `dark:bg-gray-900/70 dark:border-white/10`）
- 应用信息区：Logo `30x30 rounded-lg` 渐变底 + 名称纵向
  `text-[10px] [writing-mode:vertical-rl] tracking-[0.18em] max-h-[96px]`
- 分隔线：`h-px w-6`
- 行动入口：`34x34 rounded-xl` 纯图标按钮（图标 15px），激活态
  `bg-{主色}-600/10 text-{主色}-600`，hover 浅底
- 收起按钮：`h-6 w-[34px] rounded-lg`（底部）
- 收起态：左缘渐变把手 `h-14 w-5 rounded-r-lg hover:w-7`
- 展开收起状态存 localStorage，key 为 `mei-float-<appId>`
- 支持编程收起：监听 `mei-panel-set` 事件（`{ detail: { collapsed: boolean } }`，
  不写记忆）

已有标准实现（新增应用或修改面板时先参考对应技术栈的实现）：

| 技术栈 | 参考实现 |
|---|---|
| React | `third_party/tutorial/src/components/SitePanel.tsx`、`third_party/mediago/apps/ui/src/layout/mediago-sidebar.tsx` |
| React (Tailwind) | `third_party/lunatv/src/components/FloatingNav.tsx`、`third_party/ai-draw/src/components/layout/AppSidebar.tsx` |
| Vue | `third_party/pansou-web/src/components/MeiPanel.vue` |
| 原生 JS | `third_party/solara/js/mei/main.js`（mountPanel）、`third_party/mei-link/client/docker/web/index.html`（#meiPanel） |

### 3. 违规判定

以下情况视为违规，必须整改：

- 子应用页面缺少标准左侧面板但存在其他形式的导航侧栏
- 面板应用名称横向展示（必须纵向 `writing-mode: vertical-rl`）
- 面板宽度大于窄面板规格（Logo 30px / 按钮 34px）
- 行动入口带文字标签（必须纯图标 + title 提示）
- 顶栏被子应用 CSS 覆盖导致字号/间距/阴影与其他应用不一致
