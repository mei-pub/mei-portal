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
