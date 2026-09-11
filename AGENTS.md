# AGENTS.md

本文件是 mei-portal 仓库的智能体（Agent）协作强约束。所有智能体（OpenAI Codex、
Cursor、Claude Code、Copilot 等）在本仓库内工作时必须遵守。

## 顶栏与左侧面板组件化强约束

mei-portal 是多应用聚合门户：`packages/shall` 为门户外壳，`apps/*` 为各子应用（全部为
一等公民本地代码，不同技术栈：React / Vue / 原生 JS / 静态页；目录名与 URL 子路径
对齐：novels/tv/music/link/draw/tools/disks/media）。顶栏与左侧面板是全应用共享的
门户级组件，**不允许任何子应用自行重写一套样式**。

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

标准视觉规格（各实现必须对齐，参考 `apps/novels/src/components/SitePanel.tsx`）：

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
| React | `apps/novels/src/components/SitePanel.tsx`、`apps/media/apps/ui/src/layout/mediago-sidebar.tsx` |
| React (Tailwind) | `apps/tv/src/components/FloatingNav.tsx`、`apps/draw/src/components/layout/AppSidebar.tsx` |
| Vue | `apps/disks/web/src/components/MeiPanel.vue` |
| 原生 JS | `apps/music/js/mei/main.js`（mountPanel）、`apps/link/client/docker/web/index.html`（#meiPanel） |

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
| 实现 | `packages/shall/src/components/MusicDock.tsx` | `apps/music/js/mei/views.js` 的 `renderPlayer` |
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

## 应用切换性能：iframe 保活、预热与静态缓存

承载页 `/app?app=<id>&path=<路径>` 走客户端路由（外壳不卸载，音乐才能连续播放）。
**禁止**把 NavBridge / openTarget / iframe 导航消息直接 `router.push` 应用路径
（如 `/tv`）：nginx 按 Sec-Fetch-Dest 把应用路径的非 document 请求直通到各应用，
Next 客户端路由的 RSC fetch 拿不到 shell 的路由数据，只会回退整页加载——
常驻音乐引擎与全部保活 iframe 随之销毁。统一用 `appCarrierHref()`（app-routes.ts）；
地址栏的规范路径由 AppFrame 的 URL 回写 effect 用 `replaceState` 维持。
「点了好几秒才打开」的根因有三个，各自的修法都不能退化：

### 1. iframe 保活（`AppFrame.tsx`）

访问过的应用各自保留一个常驻 iframe，切换只改显示，不卸载。

- 保活列表**只记首次进入的 src**。URL 回写会不断改写 `path`，跟着换 src 会把 iframe
  打回重新加载，保活失效
- iframe 的 src 必须由**当前 URL 直接推导**，不能经过 `useState`：走 state 的话同一轮
  渲染里保活列表读到的还是上一个应用的 src，新挂的 iframe 会装错应用（切到 B 却出 A）
- 显隐用 `visibility` + `zIndex` + `pointerEvents`，**不能用 `display:none`**：display
  变化会让部分应用重排并丢掉滚动位置
- 访问顺序存独立的 `orderRef`，**不得靠给 `mounted` 排序来表达 LRU**：数组顺序一变
  React 就会搬动 DOM 节点，iframe 被移动即重新加载
- 上限 `MAX_LIVE_FRAMES`，淘汰最久未访问的；当前应用永不淘汰；预热但未真正访问过的
  应用最先被淘汰
- 顶栏切应用给的是应用根路径，这种情况**只切显示、不导航**，否则每次切回都把应用打回
  首页重启一遍。只有深链（`path` 不等于应用根路径）才 `location.replace`
- URL 回写必须按 `iframe[data-mei-app="<id>"]` 定位，`querySelector('iframe')` 会把
  后台应用的路径写进地址栏

### 2. 加载态必须非阻断

应用其实在逐步渲染，全屏遮罩盖到 `onLoad` 才揭开，观感就是好几秒白屏。

- `IframeHost` 只允许顶部 2px 细进度条（`pointerEvents:none`），进度停在 92% 等真正
  `onLoad` 后整条消失，禁止全屏 loading 遮罩
- 8s 超时只升级为可重试提示条，不得据此判定加载失败

### 3. 预热（`topbar.js` + `AppFrame.tsx`）

顶栏应用按钮 `pointerenter` / `touchstart` / `focus` 即广播
`{source:'mei-topbar', type:'prefetch-app', app}`，外壳提前挂隐藏 iframe 开始加载。
顶栏可能运行在 iframe 内，因此同时发给 `window` 与 `window.parent`。预热只挂应用根
路径（悬停时还不知道目标内页），每个应用只触发一次。

### 4. 静态资源缓存（`nginx.conf` + `snippets/cache-policy.conf`）

上游普遍下发 `Cache-Control: public, max-age=0` 且无 ETag，公网 + 端口映射下单次往返
约 0.25s，十来个资源串起来就是好几秒。策略由 `map $uri $mei_static_cache` 派生，
`map $mei_static_cache $mei_cache_control` 在未命中时回填 `$upstream_http_cache_control`
（HTML 的 no-store、API 的 private、音频代理的 range 语义因此不受影响）。

四条禁忌，都踩过：

- 不能只在 server 级写 `proxy_hide_header` / `add_header`：两者**都不跨层级继承**，
  只要 location 自己写了同名指令（`/music/`、`/tv` 都有 `proxy_hide_header
  X-Frame-Options`），server 级整份列表被覆盖，响应里出现两条 Cache-Control，浏览器
  取更严格的那条，缓存等于没加。必须在每个这样的 location 里 `include
  snippets/cache-policy.conf`
- 不能加静态资源的**正则 location**：正则优先级高于前缀，会抢走各应用 location 并丢掉
  它们的 `proxy_pass` / `sub_filter`（sub_filter 也作用于 JS/CSS 做子路径改写）
- map 的 `default` 不能设 `no-store`：会打到 `/music/proxy` 音频代理流上，干扰 range
  请求与播放缓冲
- 含 `{n,}` 量词的 map 正则必须整体加引号，否则 nginx 把 `{` 当块起始，直接拒绝启动
- `alias` 静态 location（`/tools/`、`/draw/`、`/disks/`）由 nginx 自己发头，没有上游
  头可隐藏，直接 `add_header Cache-Control $mei_cache_control` 即可

违规判定：切回访问过的应用仍出现完整重载（白屏 + 应用重启）；切换应用时装载出上一个
应用的内容；静态资源响应里出现两条 Cache-Control；顶栏切应用把应用打回首页。

## nginx 路由分发：Sec-Fetch-Dest 头缺失的 fallback

nginx 通过 `Sec-Fetch-Dest` 请求头区分顶级文档请求（`document`）与 iframe 内嵌请求
（`iframe`），document 请求通过 `error_page 418` 跳到 `@mei_shell` 路由到门户壳，其余
请求正常代理到子应用。

**外网域名经过的反向代理层可能剥离 `Sec-Fetch-Dest` 头。** 头缺失后 nginx 无法区分
document 与 iframe 请求，所有请求都直接代理到子应用，Shell 不渲染，MusicDock 等外壳
组件全部消失。

约束：

- `Sec-Fetch-Dest` 判别**必须包含头缺失时的 fallback 机制**：当头缺失时，用 `Accept`
  头（`text/html` 开头）且 URL 不含 `meiEmbed=1` 参数判断为 document 请求
- `meiEmbed=1` URL 参数始终优先：带此参数的请求一定是 iframe 子资源，不走 Shell，
  不受 Accept 头影响
- nginx 使用 composite map（`$mei_document_request` + `$mei_html_accept` +
  `$mei_has_embed` 三值拼接查表）实现多信号组合判断，覆盖所有 8 种组合
- 各应用 location 中的 `if` 判别使用 `$mei_is_doc`（复合判断结果），不得单独使用
  `$mei_document_request`

**本地验证通过不等于部署达标。** 实际部署场景是用户通过外网域名（含非默认端口映射）
访问，中间可能经过一层或多层反向代理，这些代理可能修改或剥离请求头。所有基于请求头的
路由判断必须用外网域名验证，或至少用 `curl` 不传 `Sec-Fetch-Dest` 头模拟头缺失场景。

违规判定：外网域名下访问应用路径时页面标题是子应用名称而非门户名称；MusicDock 播放栏
或顶栏不出现；`document.getElementById('mei-shell-slot')` 返回 null。

## 统一下载中心：跨应用契约（/downloads 卷）

「下载到本地服务器」的落盘与管理的跨应用契约，三端字段/路由不得漂移：

- **落盘布局**：`/downloads/music/<歌手>/<歌名> - <源>.mp3`（music 服务端，
  `MUSIC_DOWNLOAD_DIR`）；`/downloads/movie/<电影|电视|动漫|综艺>/<剧名>/`（media
  下载引擎，`--local-dir`；tv 按 `分类/剧名` 组 folder）
- **media 下载中心**（统一下载管理 UI，应用显示名为「下载中心」，但路由与插件 id 仍
  是 `/media` 与 `mediago`，不得因改名改动）：`/media/downloads?type=media|movie|music`
  是唯一对外深链路由格式——影视/音乐应用里的「下载中」引导跳转一律 postMessage
  `{source:'mei-iframe',type:'navigate',path:'/media/downloads?type=…'}`（走外壳
  承载路由，禁止直接改 location）；页面为四 tab（全部/媒体/影视/音乐），「全部」为
  默认 tab 且规范 URL 不带 query（`?type=all` 也接受并归一到无 query）；三个数据面板
  分别消费：`GET /tv/api/local-sources/list`、`GET /music/api/download/library`、
  media 自身任务（SSE）。删除分别走各自 DELETE
- **防穿越**：music 的 serve/DELETE/library 三口共享 resolveWithin（realpath +
  path.relative 双校验）；tv 的删除段消毒 + resolve 后必须位于 `/downloads/movie`
  内——任何新增的文件下发/删除端点必须同款双保险
- **server-local 播放体系**（music）：已下载条目 `id='file:<相对路径>'`、
  `source='server-local'`，`resolvePlayUrl` 首分支零网络直出 serve URL；iframe 宿主
  模式经 `/music/proxy?types=url&source=server-local` 分支——两条路径都必须保活
- **播放操作契约**（下载中心已完成条目「去播放」）：音乐走
  `{source:'mei-music-guest', type:'play-now', song:{id:'file:<path>',name,artist,source:'server-local'}}`
  ——外壳引擎 `playNow()` 进临时队列立即播（不打扰播放列表/收藏，MusicDock 常驻）；
  影视优先 postMessage navigate `playRoute`（tv 播放页本地源自动优先），旧记录降级
  `/media/player?id=<videoId>`（从 localUrl `/videos/<id>` 提取）；媒体任务按
  `/api/v1/videos` 的 title 匹配后开 player
- **本地优先播放**：engine（music-engine.ts tryLocalFile）与 api.js
  （matchLocalDownload）双侧在走网络源之前先查已下载曲库
  （`/music/api/download/library`，60s 缓存、失败静默降级），同名+同歌手命中即用
  serve 流——播放列表/收藏里播放已下载过的歌不再拉网络流

