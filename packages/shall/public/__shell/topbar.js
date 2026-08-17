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

  // ---- 应用开关（localStorage mei-enabled，仅当前浏览器）----
  var SWITCHABLE = [
    ['ai-draw', 'AI 绘图'],
    ['sun-panel', '主页面板'],
    ['solara', '音乐播放'],
    ['lunatv', '影视门户'],
    ['mediago', '流媒体下载'],
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

  // ---- 主页内网模式开关（sun-panel localStorage panelStorage，0=内网 lan、1=外网 wan）----
  function isLanMode() {
    try {
      var p = JSON.parse(localStorage.getItem('panelStorage') || 'null');
      return !!(p && p.data && p.data.networkMode === 0);
    } catch (e) { return false; }
  }
  function setLanMode(on) {
    try {
      var p = JSON.parse(localStorage.getItem('panelStorage') || '{}');
      if (!p.data || typeof p.data !== 'object') p.data = {};
      p.data.networkMode = on ? 0 : 1;
      p.expire = null;
      localStorage.setItem('panelStorage', JSON.stringify(p));
    } catch (e) {}
    // 面板页面内切换时需重载才生效
    if (window.location.pathname.indexOf('/panel') === 0) window.location.reload();
  }

  // 非嵌入模式才注入顶栏
  if (!EMBED) {
    // ---- 注入主题令牌（仅 --mei-* 前缀，不污染应用）----
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/__shell/tokens.css';
    document.head.appendChild(link);

    // 严格 scope 的样式：所有选择器以 #mei-topbar 开头
    var style = document.createElement('style');
    style.id = 'mei-topbar-style';
    style.textContent = [
      '#mei-topbar{position:fixed;top:0;left:0;right:0;z-index:9999;height:48px;',
      'display:flex;align-items:center;gap:8px;padding:0 14px;box-sizing:border-box;',
      'background:#fff;border-bottom:1px solid #e5e7eb;',
      'font-family:"Inter","Noto Sans SC","PingFang SC",sans-serif;font-size:13px;color:#1f2937;',
      'box-shadow:0 1px 3px rgba(0,0,0,0.05);}',
      /* 应用 fixed 导航元素下移到顶栏下方（aside/header/nav 的 fixed）*/
      'header[class*="fixed"],nav[class*="fixed"],aside[class*="fixed"],',
      '[class*="Navbar"][class*="fixed"],[class*="navbar"][class*="fixed"],',
      '[class*="Sidebar"][class*="fixed"],[class*="sidebar"][class*="fixed"],',
      '[class*="header"][class*="fixed"],[class*="Header"][class*="fixed"]{top:48px!important;}',
      'body{padding-top:48px!important;}',
      '#mei-topbar *{box-sizing:border-box;}',
      '#mei-topbar a{color:inherit;text-decoration:none;}',
      /* Toast/notification 容器下移到顶栏下方，避免被顶栏遮盖 */
      '[class*="toast"][class*="fixed"],[class*="Toast"][class*="fixed"],[class*="toast"][class*="absolute"],[class*="Toast"][class*="absolute"],',
      '[class*="notification"][class*="fixed"],[class*="Notification"][class*="fixed"],',
      '.sonner-toast-wrapper,[data-sonner-toaster],[role="region"][class*="fixed"]{top:48px!important;}',
      '[class*="toast"],[class*="Toast"],[class*="notification"],[class*="Notification"]{z-index:10000!important;}',
      '#mei-topbar .mei-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-right:8px;flex-shrink:0;}',
      '#mei-topbar .mei-logo{width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#6366f1,#7c3aed);flex-shrink:0;}',
      '#mei-topbar .mei-apps{display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;}',
      '#mei-topbar .mei-apps::-webkit-scrollbar{display:none;}',
      '#mei-topbar .mei-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;',
      'cursor:pointer;border:1px solid transparent;background:transparent;color:#4b5563;',
      'font-size:13px;white-space:nowrap;transition:all .15s;text-decoration:none;}',
      '#mei-topbar .mei-btn:hover{background:#f3f4f6;color:#1f2937;}',
      '#mei-topbar .mei-btn.active{background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;}',
      '#mei-topbar .mei-btn.off{opacity:.5;}',
      '#mei-topbar .mei-spacer{flex:1;}',
      '#mei-topbar .mei-user{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;',
      'background:#f3f4f6;color:#4b5563;font-size:13px;flex-shrink:0;cursor:pointer;text-decoration:none;}',
      '#mei-topbar .mei-user:hover{background:#e5e7eb;color:#1f2937;}',
      '#mei-topbar .mei-login{padding:6px 14px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;font-size:13px;flex-shrink:0;cursor:pointer;text-decoration:none;}',
      /* 设置齿轮下拉 */
      '#mei-topbar .mei-gear-wrap{position:relative;flex-shrink:0;}',
      '#mei-topbar .mei-gear{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;',
      'border-radius:8px;border:1px solid #e5e7eb;background:transparent;cursor:pointer;font-size:16px;',
      'color:#6b7280;transition:all .15s;}',
      '#mei-topbar .mei-gear:hover,#mei-topbar .mei-gear.open{background:#f3f4f6;}',
      '#mei-topbar .mei-menu{position:absolute;right:0;top:42px;width:250px;background:#fff;border:1px solid #e5e7eb;',
      'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:6px;z-index:10001;}',
      '#mei-topbar .mei-menu-title{padding:6px 10px;font-size:12px;color:#9ca3af;font-weight:600;}',
      '#mei-topbar .mei-switch{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:8px;color:#1f2937;font-size:13px;text-align:left;}',
      '#mei-topbar .mei-switch:hover{background:#f3f4f6;}',
      '#mei-topbar .mei-switch .mei-switch-label{flex:1;opacity:.9;}',
      '#mei-topbar .mei-switch.off .mei-switch-label{opacity:.45;}',
      '#mei-topbar .mei-track{width:32px;height:18px;border-radius:9px;background:#d1d5db;position:relative;flex-shrink:0;transition:background .15s;}',
      '#mei-topbar .mei-track.on{background:#6366f1;}',
      '#mei-topbar .mei-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s;}',
      '#mei-topbar .mei-track.on .mei-knob{left:16px;}',
      '#mei-topbar .mei-menu-sep{height:1px;background:#e5e7eb;margin:5px 0;}',
      '#mei-topbar .mei-menu-link{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;',
      'background:transparent;cursor:pointer;border-radius:8px;color:#1f2937;font-size:13px;text-align:left;text-decoration:none;}',
      '#mei-topbar .mei-menu-link:hover{background:#f3f4f6;}',
      '@media(max-width:640px){#mei-topbar .mei-brand-text{display:none;}}',
    ].join('');
    document.head.appendChild(style);

    // 顶栏用 position:sticky 自然占位，无需 padding-top
    function buildTopbar(plugins) {
      var bar = document.createElement('div');
      bar.id = 'mei-topbar';

      // 品牌
      var brand = document.createElement('a');
      brand.className = 'mei-brand';
      brand.href = '/';
      brand.innerHTML = '<span class="mei-logo"></span><span class="mei-brand-text">mei-allin</span>';
      bar.appendChild(brand);

      // 应用切换
      var apps = document.createElement('div');
      apps.className = 'mei-apps';
      var currentLib = null;
      try { currentLib = new URLSearchParams(window.location.search).get('lib'); } catch (e) {}
      plugins.forEach(function (p) {
        var isActive = p.id === APP_ID;
        if (currentLib && p.id === APP_ID + '-' + currentLib) isActive = true;
        var b = document.createElement('a');
        b.className = 'mei-btn' + (isActive ? ' active' : '') + (isAppOn(p.id) ? '' : ' off');
        b.href = p.url;
        b.textContent = p.name;
        apps.appendChild(b);
      });
      bar.appendChild(apps);

      var spacer = document.createElement('div');
      spacer.className = 'mei-spacer';
      bar.appendChild(spacer);

      // 设置齿轮下拉
      var gearWrap = document.createElement('div');
      gearWrap.className = 'mei-gear-wrap';
      var gear = document.createElement('button');
      gear.className = 'mei-gear';
      gear.textContent = '⚙️';
      gear.title = '设置';
      var menu = document.createElement('div');
      menu.className = 'mei-menu';
      menu.style.display = 'none';
      gear.onclick = function (e) {
        e.stopPropagation();
        var open = menu.style.display === 'block';
        menu.style.display = open ? 'none' : 'block';
        gear.classList.toggle('open', !open);
      };
      document.addEventListener('click', function () {
        menu.style.display = 'none';
        gear.classList.remove('open');
      });

      // 应用开关
      var title = document.createElement('div');
      title.className = 'mei-menu-title';
      title.textContent = '应用开关';
      menu.appendChild(title);
      SWITCHABLE.forEach(function (pair) {
        var id = pair[0], name = pair[1];
        var row = document.createElement('button');
        row.className = 'mei-switch' + (isAppOn(id) ? '' : ' off');
        row.dataset.app = id;
        var label = document.createElement('span');
        label.className = 'mei-switch-label';
        label.textContent = name;
        var track = document.createElement('span');
        track.className = 'mei-track' + (isAppOn(id) ? ' on' : '');
        track.innerHTML = '<span class="mei-knob"></span>';
        row.appendChild(label);
        row.appendChild(track);
        row.onclick = function (e) {
          e.stopPropagation();
          var next = !isAppOn(id);
          setAppOn(id, next);
          row.classList.toggle('off', !next);
          track.classList.toggle('on', next);
        };
        menu.appendChild(row);
      });

      var sep = document.createElement('div');
      sep.className = 'mei-menu-sep';
      menu.appendChild(sep);

      // 集成开关：主页内网模式
      var title2 = document.createElement('div');
      title2.className = 'mei-menu-title';
      title2.textContent = '集成开关';
      menu.appendChild(title2);
      var lanRow = document.createElement('button');
      lanRow.className = 'mei-switch' + (isLanMode() ? '' : ' off');
      var lanLabel = document.createElement('span');
      lanLabel.className = 'mei-switch-label';
      lanLabel.textContent = '主页内网模式';
      var lanTrack = document.createElement('span');
      lanTrack.className = 'mei-track' + (isLanMode() ? ' on' : '');
      lanTrack.innerHTML = '<span class="mei-knob"></span>';
      lanRow.appendChild(lanLabel);
      lanRow.appendChild(lanTrack);
      lanRow.onclick = function (e) {
        e.stopPropagation();
        var next = !isLanMode();
        setLanMode(next);
        lanRow.classList.toggle('off', !next);
        lanTrack.classList.toggle('on', next);
      };
      menu.appendChild(lanRow);

      var sep2 = document.createElement('div');
      sep2.className = 'mei-menu-sep';
      menu.appendChild(sep2);

      var settings = document.createElement('a');
      settings.className = 'mei-menu-link';
      settings.href = '/settings';
      settings.textContent = '⚙️ 设置集成页';
      menu.appendChild(settings);

      gearWrap.appendChild(gear);
      gearWrap.appendChild(menu);
      bar.appendChild(gearWrap);

      // 用户/登录区（由 renderUser 异步填充）
      var userSlot = document.createElement('div');
      userSlot.style.flexShrink = '0';
      bar.appendChild(userSlot);

      return { bar: bar, userSlot: userSlot };
    }

    // 异步加载用户态
    function renderUser(slot) {
      fetch('/api/auth/me', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          slot.innerHTML = '';
          if (d.loggedIn) {
            var a = document.createElement('a');
            a.className = 'mei-user';
            a.href = '/';
            a.title = '退出登录';
            a.textContent = d.username || 'admin';
            a.onclick = function (e) {
              e.preventDefault();
              fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
                .then(function () { window.location.href = '/'; });
            };
            slot.appendChild(a);
          } else {
            var a2 = document.createElement('a');
            a2.className = 'mei-login';
            a2.href = '/login';
            a2.textContent = '登录';
            slot.appendChild(a2);
          }
        })
        .catch(function () {});
    }

    var cachedPlugins = null;
    function render(plugins) {
      cachedPlugins = plugins;
      ensureBar();
    }

    // 自愈：SPA hydration 可能移除顶栏，定期检查重建
    function ensureBar() {
      if (!document.body) { setTimeout(ensureBar, 50); return; }
      if (!document.getElementById('mei-topbar') && cachedPlugins) {
        var built = buildTopbar(cachedPlugins);
        document.body.insertBefore(built.bar, document.body.firstChild);
        renderUser(built.userSlot);
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

  // 注入 token 类应用的凭证到 localStorage（sun-panel 等）
  // 同时检查子应用 cookie 是否需要刷新（repenetrate）
  // 嵌入模式也保留（应用嵌入后仍需登录态）
  fetch('/api/auth/me', { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.loggedIn && d.tokens) {
        // sun-panel: token 存 AUTH_TOKEN key（与前端 store 一致）
        if (d.tokens['sun-panel']) {
          try {
            var existing = localStorage.getItem('AUTH_TOKEN');
            var parsed = existing ? JSON.parse(existing) : {};
            parsed.token = d.tokens['sun-panel'];
            localStorage.setItem('AUTH_TOKEN', JSON.stringify(parsed));
          } catch (e) {
            localStorage.setItem('AUTH_TOKEN', JSON.stringify({ token: d.tokens['sun-panel'] }));
          }
        }
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
