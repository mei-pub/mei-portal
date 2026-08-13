/* =============================================================================
 * mei-allin 统一顶栏（注入到每个应用页面）
 * 亮色风格，无主题切换。所有样式严格 scope 到 #mei-topbar，不污染应用。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__meiTopbar) return;
  window.__meiTopbar = true;

  var APP_ID = (document.currentScript && document.currentScript.getAttribute('data-app')) || '';

  // ---- 隐藏模式（蜘蛛纸牌伪装）----
  function isDisguised() {
    try { return localStorage.getItem('mei-disguise') === 'true'; } catch (e) { return false; }
  }
  // 根据 disguise 配置调整 plugin 显示
  function applyDisguise(plugins) {
    var disguised = isDisguised();
    return plugins.map(function (p) {
      if (p.disguise) {
        return disguised
          ? { id: p.id, name: p.disguise.name, icon: p.disguise.icon, url: p.disguise.url, category: 'game', weight: p.weight }
          : { id: p.id, name: p.name, icon: p.icon, url: p.url, category: p.category, weight: p.weight };
      }
      return p;
    });
  }

  // ---- 注入主题令牌（仅 --mei-* 前缀，不污染应用）----
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/__shell/tokens.css';
  document.head.appendChild(link);

  // 严格 scope 的样式：所有选择器以 #mei-topbar 开头
  var style = document.createElement('style');
  style.id = 'mei-topbar-style';
  style.textContent = [
    '#mei-topbar{position:fixed;top:0;left:0;right:0;z-index:2147483646;height:48px;',
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
    '#mei-topbar .mei-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-right:8px;flex-shrink:0;}',
    '#mei-topbar .mei-logo{width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#6366f1,#7c3aed);flex-shrink:0;}',
    '#mei-topbar .mei-apps{display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;}',
    '#mei-topbar .mei-apps::-webkit-scrollbar{display:none;}',
    '#mei-topbar .mei-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;',
    'cursor:pointer;border:1px solid transparent;background:transparent;color:#4b5563;',
    'font-size:13px;white-space:nowrap;transition:all .15s;text-decoration:none;}',
    '#mei-topbar .mei-btn:hover{background:#f3f4f6;color:#1f2937;}',
    '#mei-topbar .mei-btn.active{background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;}',
    '#mei-topbar .mei-spacer{flex:1;}',
    '#mei-topbar .mei-user{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;',
    'background:#f3f4f6;color:#4b5563;font-size:13px;flex-shrink:0;cursor:pointer;text-decoration:none;}',
    '#mei-topbar .mei-user:hover{background:#e5e7eb;color:#1f2937;}',
    '#mei-topbar .mei-login{padding:6px 14px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;font-size:13px;flex-shrink:0;cursor:pointer;text-decoration:none;}',
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
    plugins.forEach(function (p) {
      var b = document.createElement('a');
      b.className = 'mei-btn' + (p.id === APP_ID ? ' active' : '');
      b.href = p.url;
      b.textContent = p.name;
      apps.appendChild(b);
    });
    bar.appendChild(apps);

    var spacer = document.createElement('div');
    spacer.className = 'mei-spacer';
    bar.appendChild(spacer);

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
      render(Array.isArray(plugins) ? applyDisguise(plugins) : []);
    })
    .catch(function () { render([]); });

  // 注入 token 类应用的凭证到 localStorage（sun-panel 等）
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
        // mediago: apiKey 存 zustand persist localStorage
        if (d.tokens['mediago']) {
          try {
            var mgExisting = localStorage.getItem('app-store');
            var mgParsed = mgExisting ? JSON.parse(mgExisting) : {};
            if (!mgParsed.state) mgParsed.state = {};
            if (!mgParsed.state.app) mgParsed.state.app = {};
            mgParsed.state.app.apiKey = d.tokens['mediago'];
            mgParsed.version = mgParsed.version || 0;
            localStorage.setItem('app-store', JSON.stringify(mgParsed));
          } catch (e) {
            localStorage.setItem('app-store', JSON.stringify({ state: { app: { apiKey: d.tokens['mediago'] } }, version: 0 }));
          }
        }
      }
    })
    .catch(function () {});
})();
