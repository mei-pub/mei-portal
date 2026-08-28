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
- 同一面板内两个不同语义的行动入口使用同一个图标（如「重启」与「刷新登录态」
  都用 `refresh`），必须换成语义可区分的图标

## 音乐播放：播放组件与播放页的职责分离

音乐能力由两处 UI 承载，**职责不得混淆、不得互相依赖**：

| | 播放组件（Dock） | 播放页 |
|---|---|---|
| 实现 | `packages/shall/src/components/MusicDock.tsx` | `third_party/solara/js/mei/views.js` 的 `renderPlayer` |
| 归属 | 门户外壳，跨应用常驻 | 音乐应用内页 `#/player` |
| 定位 | 后台播放 + 最小控制，只渲染少量信息 | 整体垂直居中的大组件，局部完整能力 |
| 形态 | 完整 / 缩小 / 隐藏 三态（`ui.dockMode`） | 唱片 / 歌词 双形态（`#ppViewToggle`） |

约束：

- 音频与队列的**唯一真源**是外壳引擎 `packages/shall/src/lib/music-engine.ts`；
  solara 侧 `player.js` 在宿主模式下只做指令转发与状态镜像，本地播放条必须隐藏
  （`body.mei-hosted-player` + `display:none`），不得出现两份 `audio` 同时播放
- 播放页必须自带全套播控（模式 / 上一首 / 播放暂停 / 下一首 / 进度 / 音量 / 收藏 /
  下载 / 加入列表 / 队列切换），**不依赖播放条即可完成全部操作**
- 播放页的 `store.on` 同步器只允许注册一次（用模块级 `playerPageMounted` 守卫）。
  `store.on` 每次调用都新增闭包，切歌/列表变更会反复重渲染，就地注册会导致监听器
  无上限累积
- 进度与播放态刷新走轻量同步函数（`syncPlayerTime` / `syncPlayerControls`），
  只改文本与按钮，不重建 DOM，否则封面闪烁且拖动被打断
- 播放页高度必须减去顶部空间与播放条高度：
  `min-height: calc(100vh - var(--mei-topbar-space,0px) - var(--playerbar-h) - 92px)`

违规判定：播放页缺少某项播控而必须回到播放条操作；切歌若干次后播放页出现重复渲染或
卡顿（监听器累积）；宿主模式下 solara 本地播放条可见。

## 内网穿透（mei-link）：故障引导与自动重连

### 1. 前端 API 路径必须运行时推导

门户经 nginx `sub_filter` 把 `/api/` 改写成 `/link/api/`，但它**只替换双引号字面量**，
模板字符串（`` `/api/tunnels/${id}` ``）一律漏改，请求会打到门户自身并静默失败。

- `web/app.js` 的所有请求必须走 `apiPath()`（基于 `document.currentScript.src` 推导
  `API_BASE`），禁止依赖 sub_filter 改写
- `apiPath()` 内部不得出现 `"/api/"` 字面量，否则它自己会被 sub_filter 改写成
  `/link/api/` 而拼出 `/link/link/api/...`。用 `["","api",""].join("/")` 规避

### 2. 设置类故障必须走引导弹层

隧道操作失败的根因多是服务端设置问题，裸 toast 抛英文报错没有指导性。

- 统一错误出口是 `reportError()`：带 `setup` 走 `#setupModal` 弹层 + 「前往设置」精确
  高亮字段，其余才 toast
- 故障分类只在 `src/setup-error.ts`，纯字符串归类不含 IO
- 规则按**证据具体程度**排序：`connection refused` 必须排在 `login to the server
  failed` 之前。frpc 的登录失败报文里同时带这两者，顺序错了会把用户引去改 Token，
  而真正要改的是服务器地址/端口
- 每个故障码必须标 `retryable`：端口不通 / 管理接口未就绪 / 管理页不可达可能只是服务端
  在重启，标 `true`（弹层提示但后台继续重连）；认证不符 / 未配置 / 域名冲突标 `false`

### 3. 自动重连

- 策略是纯逻辑（`src/reconnect.ts`，不含定时器与 IO），Manager 只负责排程与执行
- **不可重试**的设置故障一律停止重连（重试修不好配置，只会刷日志）；可重试的继续
- 有次数上限时走两段式：`reconnect` 打满 `maxAttempts` 后自动升级为 `restart` 再试
  同样多次，两段都失败才停。`restart` 已是最重手段，打满即停
- 重连偏好存独立的 `reconnect.json`，**不得并进 `config.json`**：未配置服务器时用户
  也要能先存偏好
- `frpc` 掉线后进程仍存活，连接态必须靠 `isFrpcDisconnected()` 识别日志来复位。
  只看进程存活会永远误报「已连接」，自动重连根本不会触发
- `launch()` 失败时若 frpc 已退出并留下原因，必须抛 frpc 自己的原因。否则
  `waitForAdmin` 超时会用「管理接口未就绪」盖掉真正的根因
- 升级、耗尽、setup 故障日志各自去重（`escalationLogged` / `exhaustedLogged` /
  `setupLoggedCode`），否则巡检周期会把同一条刷满日志面板
- 正在进行的尝试未落地前不得宣布「已停止」，否则日志顺序倒置
- 手动 `start()` / `restart()` 必须 `resetReconnectState()`，否则上一轮打满后用户点
  连接会立刻被判定为已耗尽

违规判定：隧道操作失败只弹英文 toast；服务端重启后隧道不能自动连回；状态长期显示
「已连接」但实际不通；日志里同一条重连提示反复刷屏。
