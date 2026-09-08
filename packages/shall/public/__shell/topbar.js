/* =============================================================================
 * Mei-Portal 统一顶栏（注入到每个应用页面）
* 亮色风格，无主题切换。所有样式严格 scope 到 #mei-topbar，不污染应用。
 * 支持嵌入模式（?meiEmbed=1）：不注入顶栏，仅保留登录态副作用。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__meiTopbar) return;
  window.__meiTopbar = true;

  var APP_ID = (document.currentScript && document.currentScript.getAttribute('data-app')) || '';

  // 顶栏挂载容器。门户外壳（Next/React）提供 #mei-shell-slot：React 只渲染这个空 div，
  // 不管理它的子节点，因此往里塞顶栏不会破坏 React 的 DOM 对账。
  // 直接 body.insertBefore(bar, body.firstChild) 会让 React 卸载时抛
  // 「removeChild of null」并清空整页（曾导致切换应用后 iframe/播放条一起消失）。
  function mountRoot() {
    return document.getElementById('mei-shell-slot') || document.body || document.documentElement;
  }

  // 外壳页面（Next/React）由 layout 注入 window.__MEI_ROOT_DOMAIN__，
  // 此时必须等 #mei-shell-slot 渲染出来再挂载，不能退化到直接改 body。
  function mountReady() {
    if (document.getElementById('mei-shell-slot')) return true;
    if (typeof window.__MEI_ROOT_DOMAIN__ !== 'undefined') return false;
    return !!document.body;
  }

  // 承载页（/app）在客户端切换子应用时不重载页面，通过该事件更新顶栏高亮
  window.addEventListener('mei-topbar-app', function (e) {
    var next = (e && e.detail && e.detail.app) || '';
    if (!next || next === APP_ID) return;
    APP_ID = next;
    // 跨应用跳转：上一个应用的「瞬时收起」（mei-topbar-set，不写记忆）不得泄漏到
    // 下一个应用，否则用户看到的全局形态会随跳转莫名改变。记忆态（localStorage）保留。
    window.dispatchEvent(new Event('mei-topbar-reset-transient'));
    var bar = document.getElementById('mei-topbar');
    if (bar) bar.remove();
    window.dispatchEvent(new Event('mei-topbar-rebuild'));
  });

  // ---- 嵌入模式：不注入顶栏与 body padding，仅保留登录态副作用 ----
  // 判定优先用「是否在 iframe 内」：门户承载页（/app）用 iframe 装子应用，
  // 顶栏由承载页自身注入。仅靠 ?meiEmbed=1 不可靠——子应用内部跳转会丢查询串。
  function isEmbedMode() {
    try {
      if (window.parent && window.parent !== window) return true;
    } catch (e) {
      // 跨域父窗口：同样视为被嵌入
      return true;
    }
    try {
      return new URLSearchParams(window.location.search).get('meiEmbed') === '1' ||
        localStorage.getItem('mei-embed') === '1';
    } catch (e) { return false; }
  }
  var EMBED = isEmbedMode();

  // 承载页（/app）注入顶栏后是单页应用：离开承载页时必须能整体隐藏，
  // 否则自愈循环会把顶栏重建到门户自研主页上，出现两套导航。
  var SUPPRESSED = false;

  // 门户外壳文档（Next/React）由 layout 注入 __MEI_ROOT_DOMAIN__。
  // 外壳自身不是「应用页面」：它只负责放胶囊和铺满的 iframe，不需要顶部内缩。
  var IS_SHELL = typeof window.__MEI_ROOT_DOMAIN__ !== 'undefined';

  // ---- 顶部空间契约（全应用唯一实现）------------------------------------
  // 顶栏是悬浮玻璃胶囊，不参与文档流。顶部避让绝不能由「外壳挖一块留白」实现：
  // 那块留白属于外壳文档，露出的是外壳底色，与应用自身背景（渐变 / 暖白 / 深色）
  // 拼接出一条突兀色带，同时胶囊的 backdrop-filter 背后只有纯色，模糊完全失效。
  //
  // 统一设计：
  //   1. 应用背景铺满整个视口（外壳 iframe 全屏，不再挖空、不再切圆角）；
  //   2. 顶部避让改为「应用文档内部内缩」——body padding-top，背景随之延伸到胶囊下方；
  //   3. body 强制 border-box，并补偿 100vh 类满高布局，避免内缩造成整页溢出；
  //   4. 胶囊下方铺一层与底色无关的渐隐模糊 scrim，滚动内容自然融入胶囊而非生硬穿插。
  var SPACE_EXPANDED = 74;
  var SPACE_COLLAPSED = 30;

  function spaceCss() {
    return [
      // 顶部内缩：变量挂 body，应用内部所有 calc 都可引用
      'body{--mei-topbar-space:' + SPACE_EXPANDED + 'px;box-sizing:border-box !important;',
      'padding-top:var(--mei-topbar-space) !important;transition:padding-top .25s ease;}',
      'body.mei-topbar-collapsed{--mei-topbar-space:' + SPACE_COLLAPSED + 'px;}',
      'html.mei-topbar-off body{--mei-topbar-space:0px;}',
      // 满高布局补偿：body 自身靠 border-box 吃掉内缩（100vh 内含 padding，不溢出），
      // 但**内层** 100vh 容器会在缩小后的内容区里再撑满一屏，多顶出一段空白滚动区。
      '.min-h-screen{min-height:calc(100vh - var(--mei-topbar-space,0px)) !important;}',
      '.h-screen{height:calc(100vh - var(--mei-topbar-space,0px)) !important;}',
      '#root,#app,#__next{min-height:calc(100vh - var(--mei-topbar-space,0px));}',
      // body 例外：它带 padding，border-box 下 100vh 已是正确总高，减一次会短一截
      'body.min-h-screen{min-height:100vh !important;}',
      'body.h-screen{height:100vh !important;}',
      // 应用自身的 fixed 导航/浮层下移到胶囊下方（fixed 不受 body padding 影响）
      'header[class*="fixed"],nav[class*="fixed"],aside[class*="fixed"],',
      '[class*="Navbar"][class*="fixed"],[class*="navbar"][class*="fixed"],',
      '[class*="Sidebar"][class*="fixed"],[class*="sidebar"][class*="fixed"],',
      '[class*="header"][class*="fixed"],[class*="Header"][class*="fixed"]{top:var(--mei-topbar-space,0px) !important;}',
      '[class*="toast"][class*="fixed"],[class*="Toast"][class*="fixed"],[class*="toast"][class*="absolute"],[class*="Toast"][class*="absolute"],',
      '[class*="notification"][class*="fixed"],[class*="Notification"][class*="fixed"],',
      '.sonner-toast-wrapper,[data-sonner-toaster],[role="region"][class*="fixed"]{top:var(--mei-topbar-space,0px) !important;}',
      '[class*="toast"],[class*="Toast"],[class*="notification"],[class*="Notification"]{z-index:10000 !important;}',
      // 渐隐模糊 scrim：只做 backdrop-filter + mask，不引入任何颜色，
      // 因此深色/浅色/渐变背景都能自适应，不会像纯色遮罩那样撞色。
      '#mei-topbar-scrim{position:fixed;top:0;left:0;right:0;z-index:9998;pointer-events:none;',
      'height:calc(var(--mei-topbar-space,0px) + 18px);',
      '-webkit-backdrop-filter:blur(14px) saturate(1.15);backdrop-filter:blur(14px) saturate(1.15);',
      '-webkit-mask-image:linear-gradient(to bottom,#000 0,#000 55%,transparent 100%);',
      'mask-image:linear-gradient(to bottom,#000 0,#000 55%,transparent 100%);',
      'transition:height .25s ease;}',
      'html.mei-topbar-off #mei-topbar-scrim{display:none;}',
    ].join('');
  }

  function injectSpaceStyle() {
    if (IS_SHELL) return; // 外壳文档不做顶部内缩：iframe 已全屏铺满
    if (document.getElementById('mei-topbar-space-style')) return;
    var s = document.createElement('style');
    s.id = 'mei-topbar-space-style';
    s.textContent = spaceCss();
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureScrim() {
    if (IS_SHELL) return;
    if (!document.body) return;
    if (document.getElementById('mei-topbar-scrim')) return;
    var el = document.createElement('div');
    el.id = 'mei-topbar-scrim';
    document.body.appendChild(el);
  }

  function mountSpace() {
    injectSpaceStyle();
    if (document.body) ensureScrim();
    else document.addEventListener('DOMContentLoaded', ensureScrim, { once: true });
  }

  // 顶部空间的落地时机：
  // - 嵌入模式（iframe 内的子应用）：不注入顶栏，但必须做顶部内缩 + scrim，
  //   因为可见背景是它自己的，胶囊悬浮在它上方；空间大小由外壳广播。
  // - 非嵌入且非外壳（子应用独立域名直访）：自己注入顶栏，同样需要内缩。
  // - 外壳文档：iframe 全屏铺满，不内缩。
  mountSpace();

  // 外壳侧：把当前顶部空间形态广播给 iframe 里的子应用（它自己看不到顶栏）。
  function broadcastSpace() {
    var frames = document.querySelectorAll('iframe');
    if (!frames.length) return;
    var payload = {
      source: 'mei-shell',
      type: 'topbar-space',
      collapsed: document.body ? document.body.classList.contains('mei-topbar-collapsed') : false,
      off: document.documentElement.classList.contains('mei-topbar-off'),
    };
    for (var i = 0; i < frames.length; i++) {
      try { frames[i].contentWindow.postMessage(payload, window.location.origin); } catch (e) {}
    }
  }
  window.__meiBroadcastTopbarSpace = broadcastSpace;
  window.addEventListener('message', function (ev) {
    var d = (ev && ev.data) || {};
    if (d.source === 'mei-iframe' && (d.type === 'topbar-space-request' || d.type === 'ready')) broadcastSpace();
  });

  // 外壳 → iframe 的形态广播：iframe 内没有顶栏，收起态只能靠外壳告知。
  // 与 body class 语义一致，直接复用 mei-topbar-collapsed / mei-topbar-off。
  if (EMBED) {
    window.addEventListener('message', function (ev) {
      var d = (ev && ev.data) || {};
      if (d.source !== 'mei-shell' || d.type !== 'topbar-space') return;
      if (!document.body) return;
      document.body.classList.toggle('mei-topbar-collapsed', !!d.collapsed);
      document.documentElement.classList.toggle('mei-topbar-off', !!d.off);
    });
    // 首帧主动索要一次，避免错过外壳早于 iframe 的广播
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'mei-iframe', type: 'topbar-space-request' }, window.location.origin);
      }
    } catch (e) {}
  }

  // ---- 应用预热 ----
  // 观感上「点了好几秒才打开」的大头是点击之后才开始下载整套应用资源。
  // 顶栏按钮悬停/按下即通知外壳提前挂一个隐藏 iframe 开始加载，
  // 真正点击时资源多半已就位，切换接近瞬时。
  // 顶栏可能运行在 iframe 内（子应用独立注入），因此统一往父窗口发消息；
  // 外壳自身注入时 parent === window，同一个监听器也能收到。
  function requestPrefetch(appId) {
    if (!appId) return;
    var payload = { source: 'mei-topbar', type: 'prefetch-app', app: appId };
    try { window.postMessage(payload, window.location.origin); } catch (e) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, window.location.origin);
      }
    } catch (e) {}
  }
  var prefetched = {};
  function attachPrefetch(el, appId) {
    if (!el || !appId) return;
    function fire() {
      if (prefetched[appId]) return;
      prefetched[appId] = true;
      requestPrefetch(appId);
    }
    // pointerenter 覆盖鼠标；touchstart / focus 覆盖触屏与键盘
    el.addEventListener('pointerenter', fire);
    el.addEventListener('touchstart', fire, { passive: true });
    el.addEventListener('focus', fire);
  }

  // ---- 主页内网模式开关（自研主页版：localStorage mei-lan-mode，自定义链接优先 lanUrl）----
  function isLanMode() {
    try { return localStorage.getItem('mei-lan-mode') === '1'; } catch (e) { return false; }
  }
  function setLanMode(on) {
    try { localStorage.setItem('mei-lan-mode', on ? '1' : '0'); } catch (e) {}
    window.dispatchEvent(new Event('mei-lan-change'));
  }

  // ---- 应用开关（localStorage mei-enabled，仅当前浏览器）----
  var SWITCHABLE = [
    ['ai-draw', 'AI 绘图', '关闭后门户卡片与顶栏入口置灰'],
    ['solara', '音乐播放', '关闭后门户卡片与顶栏入口置灰'],
    ['lunatv', '影视门户', '关闭后门户卡片与顶栏入口置灰'],
    ['mediago', '流媒体下载', '关闭后门户卡片与顶栏入口置灰'],
  ];
  function readEnabled() {
    try { return JSON.parse(localStorage.getItem('mei-enabled') || '{}') || {}; } catch (e) { return {}; }
  }
  function isAppOn(id) { return readEnabled()[id] !== false; }
  function setAppOn(id, on) {
    var m = readEnabled();
    m[id] = !!on;
    try { localStorage.setItem('mei-enabled', JSON.stringify(m)); } catch (e) {}
  }

  // 兼容旧 panel 数据中内置应用绑定 loopback:7777 / same-host:7777 的地址。
  // 显式自定义域名和同 host 的其他端口必须保留。
  function normalizeBuiltinUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return url;
    try {
      var parsed = new URL(url, window.location.href);
      var localHost = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].indexOf(parsed.hostname) >= 0;
      var sameHost = parsed.hostname === window.location.hostname;
      var legacyPort = parsed.port === '' || parsed.port === '7777';
      if ((localHost && parsed.port === '7777') || (sameHost && legacyPort)) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
    } catch (e) {}
    return url;
  }

  // 非嵌入模式才注入顶栏
  if (!EMBED) {
    // ---- 注入主题令牌（仅 --mei-* 前缀，不污染应用）----
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/__shell/tokens.css';
    document.head.appendChild(link);

    // 严格 scope 的样式：所有选择器以 #mei-topbar 开头
    // 深空玻璃 · 浮动胶囊 Dock
    var style = document.createElement('style');
    style.id = 'mei-topbar-style';
    style.textContent = [
     '#mei-topbar{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;height:46px;',
      'display:flex;align-items:center;gap:6px;padding:0 10px 0 14px !important;box-sizing:border-box;',
      'max-width:calc(100vw - 28px);width:max-content;',
      'background:linear-gradient(165deg,rgba(255,255,255,0.82),rgba(255,255,255,0.62));',
     '-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);',
      'border:1px solid rgba(23,32,56,0.10);border-radius:999px;',
      'font-family:"Inter","Noto Sans SC","PingFang SC",sans-serif;font-size:13px;color:#1c2333;',
      'box-shadow:0 12px 36px rgba(23,32,56,0.16),0 2px 8px rgba(23,32,56,0.08),0 0 0 1px rgba(99,102,241,0.10),inset 0 1px 0 rgba(255,255,255,0.95) !important;}',
      /* 顶部空间与 fixed 元素避让统一由 spaceCss() 提供（见「顶部空间契约」），
         此处不得再写 body padding / --mei-topbar-space，否则外壳会挖出撞色留白 */
      /* 收起把手：贴顶居中的小渐变条 */
      '#mei-topbar-toggle{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;height:22px;width:64px;',
      'border-radius:0 0 14px 14px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;',
      'background:linear-gradient(180deg,#6366f1,#a855f7);box-shadow:0 4px 14px rgba(99,102,241,0.45);',
      'transition:width .18s ease,box-shadow .18s ease;}',
      '#mei-topbar-toggle:hover{width:84px;box-shadow:0 6px 20px rgba(99,102,241,0.6);}',
      /* 胶囊收起按钮 */
      // 作用域复位：顶栏为全应用共享组件，抵抗宿主应用的全局样式（button/img/* 规则）
      '#mei-topbar *{box-sizing:border-box;margin:0;padding:0;letter-spacing:normal;text-transform:none;}',
      '#mei-topbar,#mei-topbar *{font-family:"Inter","Noto Sans SC","PingFang SC",sans-serif !important;}',
      '#mei-topbar{font-size:13px !important;line-height:1.4;}',
      '#mei-topbar img{display:inline-block;max-width:none;}',
      '#mei-topbar .mtb-collapse{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;',
      'border-radius:999px;border:none;background:transparent;color:#9aa3b8;cursor:pointer;flex-shrink:0;transition:all .18s;}',
      '#mei-topbar .mtb-collapse:hover{background:rgba(23,32,56,0.08);color:#1c2333;}',
      '#mei-topbar *{box-sizing:border-box;}',
      '#mei-topbar a{color:inherit;text-decoration:none;}',
      '#mei-topbar .mtb-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px !important;margin-right:6px;flex-shrink:0;color:#1c2333;white-space:nowrap;}',
      '#mei-topbar .mtb-logo{width:22px;height:22px;border-radius:7px;flex-shrink:0;',
      'background:linear-gradient(135deg,#6366f1 0%,#a855f7 55%,#ec4899 100%);',
      'box-shadow:0 0 14px rgba(129,140,248,0.55),inset 0 1px 0 rgba(255,255,255,0.35);}',
      '#mei-topbar .mtb-apps{display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0;}',
     '#mei-topbar .mtb-apps::-webkit-scrollbar{display:none;}',
     '#mei-topbar .mtb-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 9px !important;border-radius:999px;border:none;background:transparent;',
     // 紧凑布局：搜索框占位收窄，应用按钮 padding 压缩，确保 8 个应用 + 搜索都能展示
      'cursor:pointer;color:#5d6778;',
      'font-size:12.5px !important;white-space:nowrap;transition:all .18s ease;text-decoration:none;}',
      '#mei-topbar .mtb-btn:hover{background:rgba(23,32,56,0.06);color:#1c2333;}',
      '#mei-topbar .mtb-btn.active{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;',
      'box-shadow:0 0 18px rgba(129,140,248,0.45),inset 0 1px 0 rgba(255,255,255,0.25);}',
   '#mei-topbar .mtb-btn.off{opacity:.4;}',
   '#mei-topbar .mtb-search{display:flex;align-items:center;gap:4px;flex:0 1 240px;min-width:140px;height:32px;',
     'padding:0 4px 0 9px;border-radius:999px;background:rgba(23,32,56,0.055);border:1px solid rgba(23,32,56,0.1);}',
      '#mei-topbar .mtb-search input{flex:1;min-width:0;height:26px;border:0;background:transparent;outline:0;color:#1c2333;font-size:12.5px !important;}',
      '#mei-topbar .mtb-search input::placeholder{color:#9aa3b8;}',
      '#mei-topbar .mtb-search select{height:26px;border:0;background:transparent;outline:0;color:#5d6778;font-size:12px !important;cursor:pointer;}',
      '#mei-topbar .mtb-search button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:999px;',
      'background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;cursor:pointer;flex-shrink:0;}',
      '#mei-topbar .mtb-search-toggle{display:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;',
      'border:1px solid rgba(23,32,56,0.1);background:transparent;color:#5d6778;cursor:pointer;flex-shrink:0;}',
      /* spacer 不再 flex:1：否则与 .mei-apps 平分空间 */
      '#mei-topbar .mtb-spacer{flex:0 0 6px;}',
      '#mei-topbar .mtb-user{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;',
      'background:rgba(23,32,56,0.05);border:1px solid rgba(23,32,56,0.1);color:#3d465a;',
      'flex-shrink:0;cursor:pointer;text-decoration:none;transition:all .18s;}',
      '#mei-topbar .mtb-user:hover{background:rgba(23,32,56,0.1);color:#1c2333;}',
      '#mei-topbar .mtb-login{padding:6px 15px;border-radius:999px;background:linear-gradient(135deg,#6366f1,#a855f7);',
      'color:#fff;font-size:12.5px;flex-shrink:0;cursor:pointer;text-decoration:none;',
      'box-shadow:0 0 16px rgba(129,140,248,0.4);}',
      /* 设置齿轮下拉 */
      '#mei-topbar .mtb-gear-wrap{position:relative;flex-shrink:0;}',
      '#mei-topbar .mtb-gear{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;',
      'border-radius:999px;border:1px solid rgba(23,32,56,0.1);background:transparent;cursor:pointer;font-size:14px;',
      'color:#5d6778;transition:all .18s;}',
      '#mei-topbar .mtb-gear:hover,#mei-topbar .mtb-gear.open{background:rgba(23,32,56,0.07);color:#1c2333;}',
      '#mei-topbar .mtb-menu{position:absolute;right:-8px;top:44px;width:260px;padding:8px;z-index:10001;',
      'background:rgba(255,255,255,0.94);-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);',
      'border:1px solid rgba(23,32,56,0.1);border-radius:18px;',
      'box-shadow:0 20px 48px rgba(23,32,56,0.18),0 0 0 1px rgba(99,102,241,0.08),inset 0 1px 0 rgba(255,255,255,0.95);}',
      '#mei-topbar .mtb-menu-title{padding:7px 10px 5px;font-size:10.5px !important;color:#9aa3b8;font-weight:700;letter-spacing:1.5px;}',
      '#mei-topbar .mtb-switch{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:10px;color:#1c2333;font-size:13px;text-align:left;}',
      '#mei-topbar .mtb-switch:hover{background:rgba(23,32,56,0.05);}',
      '#mei-topbar .mtb-switch .mtb-switch-label{flex:1;opacity:.92;}',
      '#mei-topbar .mtb-switch.off .mtb-switch-label{opacity:.4;}',
      '#mei-topbar .mtb-track{width:34px;height:19px;border-radius:999px;background:rgba(23,32,56,0.14);position:relative;flex-shrink:0;transition:all .18s;}',
      '#mei-topbar .mtb-track.on{background:linear-gradient(135deg,#6366f1,#a855f7);box-shadow:0 0 12px rgba(129,140,248,0.5) !important;}',
      '#mei-topbar .mtb-knob{position:absolute;top:2.5px;left:2.5px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 3px rgba(0,0,0,0.4) !important;}',
      '#mei-topbar .mtb-track.on .mtb-knob{left:17px;}',
      '#mei-topbar .mtb-menu-sep{height:1px;background:rgba(23,32,56,0.08);margin:5px 4px;}',
      '#mei-topbar .mtb-menu-link{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:10px;color:#1c2333;font-size:13px;text-align:left;text-decoration:none;}',
      '#mei-topbar .mtb-menu-link:hover{background:rgba(23,32,56,0.05);}',
      /* 书架选择面板（挂 body 下，fixed 定位，避免被 .mei-apps 的 overflow 裁剪） */
      '#mtb-lib-menu{background:rgba(255,255,255,0.94);-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);',
      'border:1px solid rgba(23,32,56,0.1);border-radius:18px;',
      'box-shadow:0 20px 48px rgba(23,32,56,0.18),0 0 0 1px rgba(99,102,241,0.08),inset 0 1px 0 rgba(255,255,255,0.95);',
      'font-family:"Inter","Noto Sans SC","PingFang SC",sans-serif;}',
      '#mtb-lib-menu *{box-sizing:border-box;}',
      '#mtb-lib-menu .mtb-menu-link{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:10px;color:#1c2333;font-size:13px;text-align:left;text-decoration:none;}',
      '#mtb-lib-menu .mtb-menu-link:hover{background:rgba(23,32,56,0.05);}',
    '@media(max-width:1100px){#mei-topbar .mtb-search{flex-basis:220px;min-width:140px;}}',
     '@media(max-width:1280px){#mei-topbar .mtb-search{flex-basis:200px;min-width:120px;}#mei-topbar .mtb-search select{display:none;}}',
      '@media(max-width:900px){#mei-topbar .mtb-brand-text{display:none;}',
      '#mei-topbar .mtb-search{display:none;position:absolute;top:52px;left:0;width:calc(100vw - 40px);height:38px;',
      'background:rgba(255,255,255,0.96);box-shadow:0 16px 38px rgba(23,32,56,0.18);}',
      '#mei-topbar.mtb-search-open .mtb-search{display:flex;}',
      '#mei-topbar .mtb-search-toggle{display:inline-flex;}}',
    ].join('');
    document.head.appendChild(style);

    // 顶栏用 position:sticky 自然占位，无需 padding-top
    function buildTopbar(plugins) {
      // 重建前清理旧的书架面板（SPA heal 重建顶栏时避免残留多个）
    var staleLibMenu = document.getElementById('mtb-lib-menu');
      if (staleLibMenu) staleLibMenu.remove();
      var bar = document.createElement('div');
      bar.id = 'mei-topbar';

      // 品牌（默认 Logo，可被面板配置的图片/文字覆盖）
      var brand = document.createElement('a');
      brand.className = 'mtb-brand';
      brand.href = '/';
      brand.innerHTML = '<img src="/logo.svg" alt="logo" style="width:22px;height:22px;border-radius:7px;flex-shrink:0;" /><span class="mtb-brand-text" id="mtb-brand-text">Mei-Portal</span>';
      // 从面板配置加载品牌名
      fetch('/api/panel', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(cfg) {
          if (cfg && cfg.style) {
            var txt = document.getElementById('mtb-brand-text');
            if (cfg.style.logoImage) {
              brand.innerHTML = '<img src="' + cfg.style.logoImage + '" alt="logo" style="height:22px;max-width:120px;object-fit:contain;border-radius:6px;flex-shrink:0;" /><span class="mtb-brand-text" id="mtb-brand-text"></span>';
            } else if (cfg.style.logoText) {
              if (txt) txt.textContent = cfg.style.logoText;
            }
            // favicon 联动：所有子应用页面统一使用主应用可配置 Logo 作为网站图标
            try {
              var iconUrl = cfg.style.logoImage || '/logo.svg';
              // 只改写 href、绝不 remove()：React 把 <link rel=icon> 当 hoistable resource
              // 托管，外部删除它会让卸载时 parentNode 为 null，抛
              // 「Cannot read properties of null (reading 'removeChild')」并清空整页。
              var oldIcon = document.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]');
              if (oldIcon.length) {
                for (var i = 0; i < oldIcon.length; i++) oldIcon[i].href = iconUrl;
              } else {
                var link = document.createElement('link');
                link.rel = 'icon';
                link.href = iconUrl;
                document.head.appendChild(link);
              }
            } catch (e) {}
            // 应用域名适配：主页设置为应用配置的 URL（可能是独立域名）优先于默认子路径
            try {
              var urlByBuiltin = {};
              (cfg.items || []).forEach(function (it) {
                if (it && it.builtin && it.url) urlByBuiltin[it.builtin] = it.url;
              });
              Object.keys(appLinks).forEach(function (id) {
                var u = urlByBuiltin[id];
                if (u && /^https?:\/\//i.test(u)) appLinks[id].href = normalizeBuiltinUrl(u);
              });
              var tutorialUrl = urlByBuiltin['tutorial'];
              if (tutorialUrl && /^https?:\/\//i.test(tutorialUrl)) {
                var normalizedTutorialUrl = normalizeBuiltinUrl(tutorialUrl);
                novelBase = normalizedTutorialUrl.replace(/\/+$/, '');
              }
            } catch (e) {}
          }
        })
        .catch(function() {});
      bar.appendChild(brand);

      // 应用切换（小说阅读：固定入口 + 下拉站点面板，站点列表实时拉取）
      var apps = document.createElement('div');
      apps.className = 'mtb-apps';
      var tutorialPlugin = null;
      // 应用链接按插件 id 索引：面板配置（自定义域名）到达后统一改写
      var appLinks = {};
      // 小说站点链接基址：默认 /novels 子路径，配置自定义域名时替换
      var novelBase = '/novels';
      plugins.forEach(function (p) {
        if (p.id === 'tutorial') { tutorialPlugin = p; return; }
        var isActive = p.id === APP_ID;
        var b = document.createElement('a');
        b.className = 'mtb-btn' + (isActive ? ' active' : '');
        b.href = normalizeBuiltinUrl(p.url);
        b.textContent = p.name;
        b.title = p.name;
        if (!isActive) attachPrefetch(b, p.id);
        appLinks[p.id] = b;
        apps.appendChild(b);
      });
      if (tutorialPlugin) {
        var libGroupActive = APP_ID === 'tutorial';
        var wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.style.flexShrink = '0';
        var libBtn = document.createElement('button');
        libBtn.className = 'mtb-btn' + (libGroupActive ? ' active' : '');
        libBtn.style.display = 'inline-flex';
        libBtn.innerHTML = '<span>' + tutorialPlugin.name + '</span>' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:.6"><path d="m6 9 6 6 6-6"/></svg>';
        libBtn.title = '小说阅读 · 站点面板';
        // 站点面板：挂 body + fixed 定位（.mei-apps 有 overflow-x:auto，绝对定位会被裁剪）
        var libMenu = document.createElement('div');
        libMenu.id = 'mtb-lib-menu';
        libMenu.style.cssText = 'position:fixed;display:none;width:200px;padding:8px;z-index:10003;';
        function closeLibMenu() { libMenu.style.display = 'none'; }
        function renderSites(list) {
          libMenu.innerHTML = '';
          if (!list.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'padding:10px;font-size:12.5px;color:#9aa3b8;text-align:center;';
            empty.textContent = '暂无站点';
            libMenu.appendChild(empty);
          } else {
            list.forEach(function (s) {
              var item = document.createElement('a');
              item.className = 'mtb-menu-link';
              item.href = novelBase + '/s/' + encodeURIComponent(s.slug);
              item.textContent = s.name;
              if (s.type === 'secret') {
                var tag = document.createElement('span');
                tag.textContent = '隐';
                tag.style.cssText = 'margin-left:auto;font-size:10px;padding:1px 5px;border-radius:99px;background:rgba(168,85,247,.12);color:#a855f7;flex-shrink:0;';
                item.appendChild(tag);
              }
              libMenu.appendChild(item);
            });
          }
        }
        var sitesLoaded = false;
        libBtn.onclick = function (e) {
          e.stopPropagation();
          var open = libMenu.style.display === 'block';
          if (open) { closeLibMenu(); return; }
          var rect = libBtn.getBoundingClientRect();
          libMenu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 216)) + 'px';
          libMenu.style.top = (rect.bottom + 8) + 'px';
          libMenu.style.display = 'block';
          // 每次打开都实时拉取（开启/关闭隐秘站点后立即生效）
          sitesLoaded = false;
          renderSites([]);
          libMenu.firstChild.textContent = '加载中...';
          fetch('/api/novels/sites', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (list) { sitesLoaded = true; renderSites(Array.isArray(list) ? list : []); })
            .catch(function () { renderSites([]); });
        };
        libMenu.onclick = function (e) { e.stopPropagation(); };
        document.addEventListener('click', closeLibMenu);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLibMenu(); });
        window.addEventListener('resize', closeLibMenu);
        window.addEventListener('scroll', closeLibMenu, true);
        mountRoot().appendChild(libMenu);
        wrap.appendChild(libBtn);
        apps.appendChild(wrap);
      }
      bar.appendChild(apps);

      // 全站搜索：综合或指定应用，提交后由 Shell 客户端路由接管
      var SEARCH_SCOPES = [
        ['all', '综合'], ['tv', '影视'], ['music', '音乐'], ['disks', '网盘'],
        ['draw', 'AI 绘图'], ['tools', '工具箱'], ['novels', '小说']
      ];
      var savedScope = 'all';
      try { savedScope = localStorage.getItem('mei-search-scope') || 'all'; } catch (e) {}
      var search = document.createElement('form');
      search.className = 'mtb-search';
      search.setAttribute('aria-label', '全站搜索');
      var searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = '搜索全站资源';
      searchInput.setAttribute('aria-label', '搜索关键词');
      var searchScope = document.createElement('select');
      searchScope.setAttribute('aria-label', '搜索范围');
      SEARCH_SCOPES.forEach(function (item) {
        var option = document.createElement('option');
        option.value = item[0];
        option.textContent = item[1];
        option.selected = item[0] === savedScope;
        searchScope.appendChild(option);
      });
      var searchButton = document.createElement('button');
      searchButton.type = 'submit';
      searchButton.title = '搜索';
      searchButton.setAttribute('aria-label', '搜索');
      searchButton.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      search.appendChild(searchInput);
      search.appendChild(searchScope);
      search.appendChild(searchButton);
      function syncSearchFromLocation(detail) {
        try {
          var current = detail || new URL(window.location.href);
          var params = current.searchParams || new URLSearchParams(current.search || '');
          if (current.pathname === '/search' || (window.__meiShellHost && params.get('q'))) {
            if (params.get('q')) searchInput.value = params.get('q');
            if (params.get('scope')) searchScope.value = params.get('scope');
          }
        } catch (e) {}
      }
      syncSearchFromLocation();
      window.addEventListener('mei-search-query', function (event) {
        var detail = event && event.detail;
        if (!detail) return;
        if (typeof detail.query === 'string') searchInput.value = detail.query;
        if (typeof detail.scope === 'string') searchScope.value = detail.scope;
      });
      search.onsubmit = function (e) {
        e.preventDefault();
        var keyword = searchInput.value.trim();
        if (!keyword) return;
        var scope = searchScope.value;
        try { localStorage.setItem('mei-search-scope', scope); } catch (err) {}
        var target = '/search?' + new URLSearchParams({ q: keyword, scope: scope }).toString();
        if (window.__meiShellHost) {
          window.dispatchEvent(new CustomEvent('mei-open-search', { detail: { query: keyword, scope: scope } }));
        } else {
          window.location.href = target;
        }
        bar.classList.remove('mtb-search-open');
      };
      bar.appendChild(search);

      var searchToggle = document.createElement('button');
      searchToggle.type = 'button';
      searchToggle.className = 'mtb-search-toggle';
      searchToggle.title = '打开全站搜索';
      searchToggle.setAttribute('aria-label', '打开全站搜索');
      searchToggle.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      searchToggle.onclick = function (e) {
        e.stopPropagation();
        var open = bar.classList.toggle('mtb-search-open');
        if (open) setTimeout(function () { searchInput.focus(); }, 20);
      };
      bar.appendChild(searchToggle);

      var spacer = document.createElement('div');
      spacer.className = 'mtb-spacer';
      bar.appendChild(spacer);

      // 设置齿轮下拉（内联 SVG，不依赖 emoji/CDN）
      // 设置入口：直达设置中心（不再展开面板；内网模式开关只在首页设置面板里）
      var GEAR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
      var gear = document.createElement('a');
      gear.className = 'mtb-gear';
      gear.href = '/settings';
      gear.title = '设置';
      gear.setAttribute('aria-label', '设置');
      gear.innerHTML = GEAR_SVG;
      gear.style.display = 'inline-flex';
      gear.style.alignItems = 'center';
      gear.style.justifyContent = 'center';
      gear.style.flexShrink = '0';
      bar.appendChild(gear);

      // 收起顶栏按钮
      var collapseBtn = document.createElement('button');
      collapseBtn.className = 'mtb-collapse';
      collapseBtn.title = '收起导航面板';
      collapseBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
      collapseBtn.onclick = function (e) { e.stopPropagation(); setCollapsed(true); };
     bar.appendChild(collapseBtn);

    return { bar: bar };
  }

    var cachedPlugins = null;

  // ---- 顶部导航面板：展开/收起（localStorage 记忆，收起为贴顶小把手）----
    var COLLAPSE_KEY = 'mei-topbar-collapsed';
    // 应用可编程控制：mei-topbar-set {collapsed:boolean}（不写记忆，刷新即还原）
    // 用途：影视播放页进入播放态、AI 绘图进入绘图/对话页时自动收起顶栏
    var transientCollapsed = false;
    function isCollapsed() {
      try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
    }
    function effectiveCollapsed() {
      return transientCollapsed || isCollapsed();
    }
    // 折叠态的唯一落地入口：body class / 顶栏显隐 / 展开把手 三者必须同时成立，
    // 否则会出现「class 残留但顶栏已隐藏」这类形态错乱（返回门户主页时按收起态留白）。
    function applyCollapseState() {
      if (!mountReady()) return;
      var collapsed = effectiveCollapsed();
      // 抑制态（门户自研主页）下注入顶栏整体不存在，折叠占位必须一并归零
      document.body.classList.toggle('mei-topbar-collapsed', !SUPPRESSED && collapsed);
      var bar = document.getElementById('mei-topbar');
      if (bar) bar.style.display = collapsed ? 'none' : 'flex';
      var toggle = document.getElementById('mei-topbar-toggle');
      if (toggle) toggle.style.display = !SUPPRESSED && collapsed ? 'flex' : 'none';
      broadcastSpace();
    }
    function ensureToggle() {
      if (!mountReady()) return;
      var t = document.getElementById('mei-topbar-toggle');
      if (!t) {
        t = document.createElement('div');
        t.id = 'mei-topbar-toggle';
        t.title = '展开导航面板';
        t.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        t.onclick = function () { transientCollapsed = false; setCollapsed(false); };
        mountRoot().appendChild(t);
      }
      t.style.display = !SUPPRESSED && effectiveCollapsed() ? 'flex' : 'none';
    }
    function setCollapsed(collapsed) {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
      ensureToggle();
      applyCollapseState();
    }
    window.addEventListener('mei-topbar-set', function (e) {
      var detail = (e && e.detail) || {};
      transientCollapsed = !!detail.collapsed;
      ensureToggle();
      applyCollapseState();
    });
    // 应用切换：清掉瞬时收起，回到记忆态（记忆态本身跨应用保持）
    window.addEventListener('mei-topbar-reset-transient', function () {
      if (!transientCollapsed) return;
      transientCollapsed = false;
      ensureToggle();
      applyCollapseState();
    });

    function render(plugins) {
      cachedPlugins = plugins;
      ensureBar();
    }

    // 自愈：SPA hydration 可能移除顶栏，定期检查重建
    function ensureBar() {
      if (!mountReady()) { setTimeout(ensureBar, 50); return; }
      if (SUPPRESSED) {
        var existing = document.getElementById('mei-topbar');
        if (existing) existing.remove();
        document.body.style.paddingTop = '';
        // 顶栏不存在时折叠占位/把手都必须收掉，否则门户主页按收起态留白
        applyCollapseState();
        return;
      }
      ensureToggle();
      if (!document.getElementById('mei-topbar') && cachedPlugins) {
        var built = buildTopbar(cachedPlugins);
        mountRoot().appendChild(built.bar);
      }
      // 重建后（或解除抑制后）按当前形态重新落地，保证跨应用跳转形态不变
      applyCollapseState();
    }
    var healCount = 0;
    function healLoop() {
      ensureBar();
      healCount++;
      setTimeout(healLoop, healCount < 20 ? 300 : 5000);
    }
    setTimeout(healLoop, 500);
    // 应用切换后立即重建（不等自愈循环）
    window.addEventListener('mei-topbar-rebuild', ensureBar);
    // 承载页卸载（返回门户自研主页）时抑制顶栏
    window.addEventListener('mei-topbar-suppress', function (e) {
      var detail = (e && e.detail) || {};
      SUPPRESSED = detail.suppressed !== false;
      document.documentElement.classList.toggle('mei-topbar-off', SUPPRESSED);
      ensureBar();
      broadcastSpace();
    });

    // 拉取插件列表
    fetch('/api/plugins', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (plugins) {
        render(Array.isArray(plugins) ? plugins : []);
      })
      .catch(function () { render([]); });
  }

  // 注入 token 类应用的凭证到 localStorage
  // 同时检查子应用 cookie 是否需要刷新（repenetrate）
  // 嵌入模式也保留（应用嵌入后仍需登录态）
  fetch('/api/auth/me', { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.loggedIn && d.tokens) {
        // mediago: apiKey 存 zustand persist localStorage（key=appstore-storage，state 为扁平字段）
        if (d.tokens['mediago']) {
          try {
            var mgExisting = localStorage.getItem('appstore-storage');
            var mgParsed = mgExisting ? JSON.parse(mgExisting) : {};
            if (!mgParsed.state || typeof mgParsed.state !== 'object') mgParsed.state = {};
            mgParsed.state.apiKey = d.tokens['mediago'];
            mgParsed.version = mgParsed.version || 0;
            localStorage.setItem('appstore-storage', JSON.stringify(mgParsed));
          } catch (e) {
            localStorage.setItem('appstore-storage', JSON.stringify({ state: { apiKey: d.tokens['mediago'] }, version: 0 }));
          }
        }
        // ai-draw: JWT token 存 zustand-persist localStorage["auth-storage"]
        if (d.tokens['ai-draw']) {
          try {
            var adExisting = localStorage.getItem('auth-storage');
            var adParsed = adExisting ? JSON.parse(adExisting) : {};
            if (!adParsed.state) adParsed.state = {};
            adParsed.state.token = d.tokens['ai-draw'];
            adParsed.state.user = adParsed.state.user || { username: 'admin', role: 'admin' };
            adParsed.version = adParsed.version || 0;
            localStorage.setItem('auth-storage', JSON.stringify(adParsed));
          } catch (e) {
            localStorage.setItem('auth-storage', JSON.stringify({ state: { user: { username: 'admin', role: 'admin' }, token: d.tokens['ai-draw'] }, version: 0 }));
          }
        }

        // 登录态刷新：如果用户已登录但子应用 cookie 可能过期（session 级 cookie），
        // 调用 repenetrate 重新登录各子应用。每个浏览器会话只调用一次（用 sessionStorage 标记）。
        if (d.loggedIn) {
          try {
            if (!sessionStorage.getItem('mei-repenetrated')) {
              sessionStorage.setItem('mei-repenetrated', '1');
              fetch('/api/auth/repenetrate', { method: 'POST', credentials: 'include' })
                .catch(function () {});
            }
          } catch (e) {}
        }
      }
    })
    .catch(function () {});
})();
