/* =============================================================================
 * mei-allin 统一顶栏（注入到每个应用页面）
 * 亮色风格，无主题切换。所有样式严格 scope 到 #mei-topbar，不污染应用。
 * 支持嵌入模式（?meiEmbed=1）：不注入顶栏，仅保留登录态副作用。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__meiTopbar) return;
  window.__meiTopbar = true;

  var APP_ID = (document.currentScript && document.currentScript.getAttribute('data-app')) || '';

  // ---- 嵌入模式（?meiEmbed=1）：不注入顶栏与 body padding，仅保留登录态副作用 ----
  function isEmbedMode() {
    try {
      return new URLSearchParams(window.location.search).get('meiEmbed') === '1' ||
        localStorage.getItem('mei-embed') === '1';
    } catch (e) { return false; }
  }
  var EMBED = isEmbedMode();

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
      'display:flex;align-items:center;gap:6px;padding:0 10px 0 14px;box-sizing:border-box;',
      'max-width:calc(100vw - 28px);width:max-content;',
      'background:linear-gradient(165deg,rgba(255,255,255,0.82),rgba(255,255,255,0.62));',
      '-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);',
      'border:1px solid rgba(255,255,255,0.9);border-radius:999px;',
      'font-family:"Inter","Noto Sans SC","PingFang SC",sans-serif;font-size:13px;color:#1c2333;',
      'box-shadow:0 12px 36px rgba(23,32,56,0.14),0 0 0 1px rgba(99,102,241,0.08),inset 0 1px 0 rgba(255,255,255,0.95);}',
      /* 应用 fixed 导航元素下移到胶囊下方 */
      'header[class*="fixed"],nav[class*="fixed"],aside[class*="fixed"],',
      '[class*="Navbar"][class*="fixed"],[class*="navbar"][class*="fixed"],',
      '[class*="Sidebar"][class*="fixed"],[class*="sidebar"][class*="fixed"],',
      '[class*="header"][class*="fixed"],[class*="Header"][class*="fixed"]{top:74px!important;}',
      'body{padding-top:74px!important;--mei-topbar-space:74px;transition:padding-top .25s ease;}',
      'body.mei-topbar-collapsed{padding-top:30px!important;--mei-topbar-space:30px;}',
      /* 收起把手：贴顶居中的小渐变条 */
      '#mei-topbar-toggle{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;height:22px;width:64px;',
      'border-radius:0 0 14px 14px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;',
      'background:linear-gradient(180deg,#6366f1,#a855f7);box-shadow:0 4px 14px rgba(99,102,241,0.45);',
      'transition:width .18s ease,box-shadow .18s ease;}',
      '#mei-topbar-toggle:hover{width:84px;box-shadow:0 6px 20px rgba(99,102,241,0.6);}',
      /* 胶囊收起按钮 */
      '#mei-topbar .mei-collapse{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;',
      'border-radius:999px;border:none;background:transparent;color:#9aa3b8;cursor:pointer;flex-shrink:0;transition:all .18s;}',
      '#mei-topbar .mei-collapse:hover{background:rgba(23,32,56,0.08);color:#1c2333;}',
      '#mei-topbar *{box-sizing:border-box;}',
      '#mei-topbar a{color:inherit;text-decoration:none;}',
      /* Toast/notification 容器下移 */
      '[class*="toast"][class*="fixed"],[class*="Toast"][class*="fixed"],[class*="toast"][class*="absolute"],[class*="Toast"][class*="absolute"],',
      '[class*="notification"][class*="fixed"],[class*="Notification"][class*="fixed"],',
      '.sonner-toast-wrapper,[data-sonner-toaster],[role="region"][class*="fixed"]{top:74px!important;}',
      '[class*="toast"],[class*="Toast"],[class*="notification"],[class*="Notification"]{z-index:10000!important;}',
      '#mei-topbar .mei-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;margin-right:6px;flex-shrink:0;color:#1c2333;white-space:nowrap;}',
      '#mei-topbar .mei-logo{width:22px;height:22px;border-radius:7px;flex-shrink:0;',
      'background:linear-gradient(135deg,#6366f1 0%,#a855f7 55%,#ec4899 100%);',
      'box-shadow:0 0 14px rgba(129,140,248,0.55),inset 0 1px 0 rgba(255,255,255,0.35);}',
      '#mei-topbar .mei-apps{display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0;}',
      '#mei-topbar .mei-apps::-webkit-scrollbar{display:none;}',
      '#mei-topbar .mei-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;',
      'cursor:pointer;border:1px solid transparent;background:transparent;color:#5d6778;',
      'font-size:12.5px;white-space:nowrap;transition:all .18s ease;text-decoration:none;}',
      '#mei-topbar .mei-btn:hover{background:rgba(23,32,56,0.06);color:#1c2333;}',
      '#mei-topbar .mei-btn.active{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;',
      'box-shadow:0 0 18px rgba(129,140,248,0.45),inset 0 1px 0 rgba(255,255,255,0.25);}',
      '#mei-topbar .mei-btn.off{opacity:.4;}',
      /* spacer 不再 flex:1：否则与 .mei-apps 平分空间 */
      '#mei-topbar .mei-spacer{flex:0 0 6px;}',
      '#mei-topbar .mei-user{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;',
      'background:rgba(23,32,56,0.05);border:1px solid rgba(23,32,56,0.1);color:#3d465a;',
      'flex-shrink:0;cursor:pointer;text-decoration:none;transition:all .18s;}',
      '#mei-topbar .mei-user:hover{background:rgba(23,32,56,0.1);color:#1c2333;}',
      '#mei-topbar .mei-login{padding:6px 15px;border-radius:999px;background:linear-gradient(135deg,#6366f1,#a855f7);',
      'color:#fff;font-size:12.5px;flex-shrink:0;cursor:pointer;text-decoration:none;',
      'box-shadow:0 0 16px rgba(129,140,248,0.4);}',
      /* 设置齿轮下拉 */
      '#mei-topbar .mei-gear-wrap{position:relative;flex-shrink:0;}',
      '#mei-topbar .mei-gear{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;',
      'border-radius:999px;border:1px solid rgba(23,32,56,0.1);background:transparent;cursor:pointer;font-size:14px;',
      'color:#5d6778;transition:all .18s;}',
      '#mei-topbar .mei-gear:hover,#mei-topbar .mei-gear.open{background:rgba(23,32,56,0.07);color:#1c2333;}',
      '#mei-topbar .mei-menu{position:absolute;right:-8px;top:44px;width:260px;padding:8px;z-index:10001;',
      'background:rgba(255,255,255,0.94);-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);',
      'border:1px solid rgba(23,32,56,0.1);border-radius:18px;',
      'box-shadow:0 20px 48px rgba(23,32,56,0.18),0 0 0 1px rgba(99,102,241,0.08),inset 0 1px 0 rgba(255,255,255,0.95);}',
      '#mei-topbar .mei-menu-title{padding:7px 10px 5px;font-size:10.5px;color:#9aa3b8;font-weight:700;letter-spacing:1.5px;}',
      '#mei-topbar .mei-switch{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:10px;color:#1c2333;font-size:13px;text-align:left;}',
      '#mei-topbar .mei-switch:hover{background:rgba(23,32,56,0.05);}',
      '#mei-topbar .mei-switch .mei-switch-label{flex:1;opacity:.92;}',
      '#mei-topbar .mei-switch.off .mei-switch-label{opacity:.4;}',
      '#mei-topbar .mei-track{width:34px;height:19px;border-radius:999px;background:rgba(23,32,56,0.14);position:relative;flex-shrink:0;transition:all .18s;}',
      '#mei-topbar .mei-track.on{background:linear-gradient(135deg,#6366f1,#a855f7);box-shadow:0 0 12px rgba(129,140,248,0.5);}',
      '#mei-topbar .mei-knob{position:absolute;top:2.5px;left:2.5px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 3px rgba(0,0,0,0.4);}',
      '#mei-topbar .mei-track.on .mei-knob{left:17px;}',
      '#mei-topbar .mei-menu-sep{height:1px;background:rgba(23,32,56,0.08);margin:5px 4px;}',
      '#mei-topbar .mei-menu-link{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:10px;color:#1c2333;font-size:13px;text-align:left;text-decoration:none;}',
      '#mei-topbar .mei-menu-link:hover{background:rgba(23,32,56,0.05);}',
      /* 书架选择面板（挂 body 下，fixed 定位，避免被 .mei-apps 的 overflow 裁剪） */
      '#mei-lib-menu{background:rgba(255,255,255,0.94);-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);',
      'border:1px solid rgba(23,32,56,0.1);border-radius:18px;',
      'box-shadow:0 20px 48px rgba(23,32,56,0.18),0 0 0 1px rgba(99,102,241,0.08),inset 0 1px 0 rgba(255,255,255,0.95);',
      'font-family:"Inter","Noto Sans SC","PingFang SC",sans-serif;}',
      '#mei-lib-menu *{box-sizing:border-box;}',
      '#mei-lib-menu .mei-menu-link{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:10px;color:#1c2333;font-size:13px;text-align:left;text-decoration:none;}',
      '#mei-lib-menu .mei-menu-link:hover{background:rgba(23,32,56,0.05);}',
      '@media(max-width:900px){#mei-topbar .mei-brand-text{display:none;}}',
    ].join('');
    document.head.appendChild(style);

    // 顶栏用 position:sticky 自然占位，无需 padding-top
    function buildTopbar(plugins) {
      // 重建前清理旧的书架面板（SPA heal 重建顶栏时避免残留多个）
      var staleLibMenu = document.getElementById('mei-lib-menu');
      if (staleLibMenu) staleLibMenu.remove();
      var bar = document.createElement('div');
      bar.id = 'mei-topbar';

      // 品牌（默认 Logo，可被面板配置的图片/文字覆盖）
      var brand = document.createElement('a');
      brand.className = 'mei-brand';
      brand.href = '/';
      brand.innerHTML = '<img src="/logo.svg" alt="logo" style="width:22px;height:22px;border-radius:7px;flex-shrink:0;" /><span class="mei-brand-text" id="mei-brand-text">mei-allin</span>';
      // 从面板配置加载品牌名
      fetch('/api/panel', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(cfg) {
          if (cfg && cfg.style) {
            var txt = document.getElementById('mei-brand-text');
            if (cfg.style.logoImage) {
              brand.innerHTML = '<img src="' + cfg.style.logoImage + '" alt="logo" style="height:22px;max-width:120px;object-fit:contain;border-radius:6px;flex-shrink:0;" /><span class="mei-brand-text" id="mei-brand-text"></span>';
            } else if (cfg.style.logoText) {
              if (txt) txt.textContent = cfg.style.logoText;
            }
          }
        })
        .catch(function() {});
      bar.appendChild(brand);

      // 应用切换（小说阅读：固定入口 + 下拉站点面板，站点列表实时拉取）
      var apps = document.createElement('div');
      apps.className = 'mei-apps';
      var tutorialPlugin = null;
      plugins.forEach(function (p) {
        if (p.id === 'tutorial') { tutorialPlugin = p; return; }
        var isActive = p.id === APP_ID;
        var b = document.createElement('a');
        b.className = 'mei-btn' + (isActive ? ' active' : '');
        b.href = p.url;
        b.textContent = p.name;
        b.title = p.name;
        apps.appendChild(b);
      });
      if (tutorialPlugin) {
        var libGroupActive = APP_ID === 'tutorial';
        var wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.style.flexShrink = '0';
        var libBtn = document.createElement('button');
        libBtn.className = 'mei-btn' + (libGroupActive ? ' active' : '');
        libBtn.style.display = 'inline-flex';
        libBtn.innerHTML = '<span>' + tutorialPlugin.name + '</span>' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:.6"><path d="m6 9 6 6 6-6"/></svg>';
        libBtn.title = '小说阅读 · 站点面板';
        // 站点面板：挂 body + fixed 定位（.mei-apps 有 overflow-x:auto，绝对定位会被裁剪）
        var libMenu = document.createElement('div');
        libMenu.id = 'mei-lib-menu';
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
              item.className = 'mei-menu-link';
              item.href = '/novels/s/' + encodeURIComponent(s.slug);
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
        document.body.appendChild(libMenu);
        wrap.appendChild(libBtn);
        apps.appendChild(wrap);
      }
      bar.appendChild(apps);

      var spacer = document.createElement('div');
      spacer.className = 'mei-spacer';
      bar.appendChild(spacer);

      // 设置齿轮下拉（内联 SVG，不依赖 emoji/CDN）
      // 设置入口：直达设置中心（不再展开面板；内网模式开关只在首页设置面板里）
      var GEAR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
      var gear = document.createElement('a');
      gear.className = 'mei-gear';
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
      collapseBtn.className = 'mei-collapse';
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
    function ensureToggle() {
      var t = document.getElementById('mei-topbar-toggle');
      if (!t) {
        t = document.createElement('div');
        t.id = 'mei-topbar-toggle';
        t.title = '展开导航面板';
        t.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        t.onclick = function () { transientCollapsed = false; setCollapsed(false); };
        (document.body || document.documentElement).appendChild(t);
      }
      t.style.display = effectiveCollapsed() ? 'flex' : 'none';
    }
    function setCollapsed(collapsed) {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
      document.body.classList.toggle('mei-topbar-collapsed', collapsed);
      var bar = document.getElementById('mei-topbar');
      if (bar) bar.style.display = collapsed ? 'none' : 'flex';
      ensureToggle();
    }
    window.addEventListener('mei-topbar-set', function (e) {
      var detail = (e && e.detail) || {};
      transientCollapsed = !!detail.collapsed;
      document.body.classList.toggle('mei-topbar-collapsed', effectiveCollapsed());
      var bar = document.getElementById('mei-topbar');
      if (bar) bar.style.display = effectiveCollapsed() ? 'none' : 'flex';
      ensureToggle();
    });

    function render(plugins) {
      cachedPlugins = plugins;
      ensureBar();
    }

    // 自愈：SPA hydration 可能移除顶栏，定期检查重建
    function ensureBar() {
      if (!document.body) { setTimeout(ensureBar, 50); return; }
      ensureToggle();
      if (!document.getElementById('mei-topbar') && cachedPlugins) {
        var built = buildTopbar(cachedPlugins);
        document.body.insertBefore(built.bar, document.body.firstChild);
        // 应用折叠态（记忆或应用编程触发）
        if (effectiveCollapsed()) {
          document.getElementById('mei-topbar').style.display = 'none';
          document.body.classList.add('mei-topbar-collapsed');
        }
      }
    }
    var healCount = 0;
    function healLoop() {
      ensureBar();
      healCount++;
      setTimeout(healLoop, healCount < 20 ? 300 : 5000);
    }
    setTimeout(healLoop, 500);

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
