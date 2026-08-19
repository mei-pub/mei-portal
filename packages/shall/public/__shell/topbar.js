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
      '#mei-topbar .mei-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;margin-right:6px;flex-shrink:0;color:#1c2333;}',
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
      brand.innerHTML = '<span class="mei-logo"></span><span class="mei-brand-text" id="mei-brand-text">mei-allin</span>';
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

      // 应用切换（书架多实例：单个=书架名入口；多个=悬浮下拉，按钮显示当前书架名）
      var apps = document.createElement('div');
      apps.className = 'mei-apps';
      var currentLib = null;
      try { currentLib = new URLSearchParams(window.location.search).get('lib'); } catch (e) {}
      var libEntries = plugins.filter(function (p) { return /^tutorial-/.test(p.id); });
      var libGroupActive = APP_ID === 'tutorial' || /^tutorial-/.test(APP_ID);
      plugins.forEach(function (p) {
        if (/^tutorial-/.test(p.id)) return; // 书架实例统一由下方聚合入口渲染
        var isActive = p.id === APP_ID;
        var b = document.createElement('a');
        b.className = 'mei-btn' + (isActive ? ' active' : '');
        b.href = p.url;
        b.textContent = p.name;
        b.title = p.name;
        apps.appendChild(b);
      });
      if (libEntries.length === 1) {
        var lib = libEntries[0];
        var b1 = document.createElement('a');
        b1.className = 'mei-btn' + (libGroupActive ? ' active' : '');
        b1.href = lib.url;
        b1.textContent = lib.name;
        b1.title = lib.name;
        apps.appendChild(b1);
      } else if (libEntries.length > 1) {
        // 当前书架：URL ?lib=N 匹配；未进入则用第一个书架名
        var current = libEntries[0];
        if (currentLib) {
          for (var i = 0; i < libEntries.length; i++) {
            if (libEntries[i].id === 'tutorial-' + currentLib) { current = libEntries[i]; break; }
          }
        }
        var wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.style.flexShrink = '0';
        var libBtn = document.createElement('button');
        libBtn.className = 'mei-btn' + (libGroupActive ? ' active' : '');
        libBtn.style.display = 'inline-flex';
        libBtn.innerHTML = '<span style="max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + current.name + '</span>' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:.6"><path d="m6 9 6 6 6-6"/></svg>';
        libBtn.title = '书架：' + current.name;
        var libMenu = document.createElement('div');
        libMenu.className = 'mei-menu';
        libMenu.style.cssText += 'left:0;right:auto;top:40px;width:180px;';
        libMenu.style.display = 'none';
        libEntries.forEach(function (l) {
          var item = document.createElement('a');
          item.className = 'mei-menu-link';
          item.href = l.url;
          item.textContent = l.name;
          if (l.id === current.id) {
            item.style.color = 'var(--mei-primary, #6366f1)';
            item.style.fontWeight = '600';
          }
          libMenu.appendChild(item);
        });
        libBtn.onclick = function (e) { e.stopPropagation(); var open = libMenu.style.display === 'block'; libMenu.style.display = open ? 'none' : 'block'; };
        document.addEventListener('click', function () { libMenu.style.display = 'none'; });
        wrap.appendChild(libBtn);
        wrap.appendChild(libMenu);
        apps.appendChild(wrap);
      }
      bar.appendChild(apps);

      var spacer = document.createElement('div');
      spacer.className = 'mei-spacer';
      bar.appendChild(spacer);

      // 设置齿轮下拉（内联 SVG，不依赖 emoji/CDN）
      var GEAR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
      var gearWrap = document.createElement('div');
      gearWrap.className = 'mei-gear-wrap';
      var gear = document.createElement('button');
      gear.className = 'mei-gear';
      gear.innerHTML = GEAR_SVG;
      gear.style.display = 'inline-flex';
      gear.style.alignItems = 'center';
      gear.style.justifyContent = 'center';
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
      // ESC 关闭下拉
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          menu.style.display = 'none';
          gear.classList.remove('open');
        }
      });

      // 集成开关：主页内网模式
      var lanRow = document.createElement('button');
      lanRow.className = 'mei-switch' + (isLanMode() ? '' : ' off');
      lanRow.style.flexDirection = 'column';
      lanRow.style.alignItems = 'flex-start';
      lanRow.style.gap = '2px';
      var lanLabel = document.createElement('span');
      lanLabel.className = 'mei-switch-label';
      lanLabel.style.cssText = 'width:100%;display:flex;align-items:center;';
      lanLabel.textContent = '主页内网模式';
      var lanTrack = document.createElement('span');
      lanTrack.className = 'mei-track' + (isLanMode() ? ' on' : '');
      lanTrack.style.marginLeft = 'auto';
      lanTrack.innerHTML = '<span class="mei-knob"></span>';
      lanLabel.appendChild(lanTrack);
      lanRow.appendChild(lanLabel);
      var lanDesc = document.createElement('span');
      lanDesc.style.cssText = 'font-size:10.5px;color:#9aa3b8;line-height:1.3;text-align:left;';
      lanDesc.textContent = '开启后主页自定义链接优先使用内网地址打开';
      lanRow.appendChild(lanDesc);
      lanRow.onclick = function (e) {
        e.stopPropagation();
        var next = !isLanMode();
        setLanMode(next);
        lanRow.classList.toggle('off', !next);
        lanTrack.classList.toggle('on', next);
      };
      menu.appendChild(lanRow);

      var sep3 = document.createElement('div');
      sep3.className = 'mei-menu-sep';
      menu.appendChild(sep3);

      var settings = document.createElement('a');
      settings.className = 'mei-menu-link';
      settings.href = '/settings';
      settings.innerHTML = GEAR_SVG.replace('width="16" height="16"', 'width="15" height="15"') + '<span style="margin-left:8px;">设置集成页</span>';
      menu.appendChild(settings);

      gearWrap.appendChild(gear);
      gearWrap.appendChild(menu);
      bar.appendChild(gearWrap);

      // 用户/登录区（由 renderUser 异步填充）
      var userSlot = document.createElement('div');
      userSlot.style.flexShrink = '0';
      bar.appendChild(userSlot);

      // 收起顶栏按钮
      var collapseBtn = document.createElement('button');
      collapseBtn.className = 'mei-collapse';
      collapseBtn.title = '收起导航面板';
      collapseBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
      collapseBtn.onclick = function (e) { e.stopPropagation(); setCollapsed(true); };
      bar.appendChild(collapseBtn);

      return { bar: bar, userSlot: userSlot };
    }

    // 异步加载用户态（用户名点击打开账户弹层：修改密码 / 退出登录）
    function renderUser(slot) {
      fetch('/api/auth/me', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          slot.innerHTML = '';
          if (d.loggedIn) {
            var a = document.createElement('button');
            a.className = 'mei-user';
            a.title = '账户';
            a.textContent = d.username || 'admin';
            a.onclick = function (e) { e.stopPropagation(); openAccountModal(d.username || 'admin'); };
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

    // ---- 账户弹层（vanilla 模态：主菜单 / 退出确认 / 修改密码表单）----
    function closeAccountModal() {
      var m = document.getElementById('mei-account-modal');
      if (m) m.remove();
    }
    function accountModalShell() {
      closeAccountModal();
      var overlay = document.createElement('div');
      overlay.id = 'mei-account-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(10,14,26,0.45);display:flex;align-items:center;justify-content:center;';
      overlay.onclick = function (e) { if (e.target === overlay) closeAccountModal(); };
      var card = document.createElement('div');
      card.style.cssText = 'width:320px;max-width:calc(100vw - 32px);border-radius:18px;padding:20px;' +
        'background:rgba(255,255,255,0.96);-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);' +
        'border:1px solid rgba(23,32,56,0.1);box-shadow:0 24px 64px rgba(23,32,56,0.24);color:#1c2333;font-size:13px;';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      return card;
    }
    function accBtn(text, opts) {
      var b = document.createElement(opts && opts.primary ? 'button' : 'button');
      b.textContent = text;
      b.style.cssText = 'width:100%;padding:10px 12px;border-radius:12px;cursor:pointer;font-size:13px;transition:all .15s;' +
        (opts && opts.primary
          ? 'border:none;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;box-shadow:0 4px 14px rgba(99,102,241,0.35);'
          : opts && opts.danger
          ? 'border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.06);color:#ef4444;'
          : 'border:1px solid rgba(23,32,56,0.12);background:transparent;color:#3d465a;');
      return b;
    }
    function accLabel(text) {
      var l = document.createElement('div');
      l.textContent = text;
      l.style.cssText = 'display:block;font-size:12px;font-weight:600;color:#5d6778;margin:10px 0 4px;';
      return l;
    }
    function accInput(type, placeholder) {
      var i = document.createElement('input');
      i.type = type;
      i.placeholder = placeholder;
      i.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;font-size:13px;' +
        'border:1px solid rgba(23,32,56,0.15);outline:none;color:#1c2333;background:#fff;';
      return i;
    }
    function openAccountModal(username) {
      var card = accountModalShell();
      var title = document.createElement('div');
      title.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:2px;';
      title.textContent = username;
      card.appendChild(title);
      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:11px;color:#9aa3b8;margin-bottom:14px;';
      sub.textContent = 'MEI ALLIN 账户';
      card.appendChild(sub);

      var pwBtn = accBtn('修改账户密码');
      pwBtn.style.marginBottom = '8px';
      pwBtn.onclick = function () { openPasswordForm(card); };
      var logoutBtn = accBtn('退出登录', { danger: true });
      logoutBtn.onclick = function () { openLogoutConfirm(card); };
      card.appendChild(pwBtn);
      card.appendChild(logoutBtn);
    }
    function openLogoutConfirm(card) {
      card.innerHTML = '';
      var q = document.createElement('div');
      q.style.cssText = 'font-size:14px;font-weight:650;margin-bottom:6px;';
      q.textContent = '确认退出登录？';
      card.appendChild(q);
      var d = document.createElement('div');
      d.style.cssText = 'font-size:12px;color:#5d6778;margin-bottom:16px;';
      d.textContent = '退出后需要重新输入密码才能进入门户。';
      card.appendChild(d);
      var cancel = accBtn('取消');
      cancel.style.marginBottom = '8px';
      cancel.onclick = closeAccountModal;
      var ok = accBtn('确认退出', { danger: true, primary: true });
      ok.onclick = function () {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
          .then(function () { window.location.href = '/login'; });
      };
      card.appendChild(cancel);
      card.appendChild(ok);
    }
    function openPasswordForm(card) {
      card.innerHTML = '';
      var title = document.createElement('div');
      title.style.cssText = 'font-size:14px;font-weight:650;margin-bottom:8px;';
      title.textContent = '修改账户密码';
      card.appendChild(title);

      card.appendChild(accLabel('当前密码'));
      var oldPw = accInput('password', '输入当前密码');
      card.appendChild(oldPw);
      card.appendChild(accLabel('新密码（至少 4 位）'));
      var newPw = accInput('password', '输入新密码');
      card.appendChild(newPw);
      card.appendChild(accLabel('确认新密码'));
      var newPw2 = accInput('password', '再次输入新密码');
      card.appendChild(newPw2);

      var hint = document.createElement('div');
      hint.style.cssText = 'min-height:16px;font-size:11.5px;color:#ef4444;margin-top:8px;';
      card.appendChild(hint);

      var cancel = accBtn('取消');
      cancel.style.marginTop = '6px';
      cancel.onclick = closeAccountModal;
      var submit = accBtn('提交修改', { primary: true });
      submit.style.marginTop = '8px';
      submit.onclick = function () {
        hint.textContent = '';
        if (!oldPw.value || !newPw.value) { hint.textContent = '请填写完整'; return; }
        if (newPw.value.length < 4) { hint.textContent = '新密码至少 4 位'; return; }
        if (newPw.value !== newPw2.value) { hint.textContent = '两次输入的新密码不一致'; return; }
        submit.disabled = true;
        submit.textContent = '提交中…';
        fetch('/api/auth/password', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword: oldPw.value, newPassword: newPw.value }),
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) {
              hint.textContent = res.j.error || '修改失败';
              submit.disabled = false;
              submit.textContent = '提交修改';
              return;
            }
            hint.style.color = '#10b981';
            hint.textContent = '密码已修改，正在跳转登录…';
            setTimeout(function () {
              fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
                .then(function () { window.location.href = '/login'; });
            }, 900);
          })
          .catch(function () {
            hint.textContent = '网络错误，请重试';
            submit.disabled = false;
            submit.textContent = '提交修改';
          });
      };
      card.appendChild(submit);
      card.appendChild(cancel);
    }

    var cachedPlugins = null;

    // ---- 顶部导航面板：展开/收起（localStorage 记忆，收起为贴顶小把手）----
    var COLLAPSE_KEY = 'mei-topbar-collapsed';
    function isCollapsed() {
      try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
    }
    function ensureToggle() {
      var t = document.getElementById('mei-topbar-toggle');
      if (!t) {
        t = document.createElement('div');
        t.id = 'mei-topbar-toggle';
        t.title = '展开导航面板';
        t.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        t.onclick = function () { setCollapsed(false); };
        (document.body || document.documentElement).appendChild(t);
      }
      t.style.display = isCollapsed() ? 'flex' : 'none';
    }
    function setCollapsed(collapsed) {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
      document.body.classList.toggle('mei-topbar-collapsed', collapsed);
      var bar = document.getElementById('mei-topbar');
      if (bar) bar.style.display = collapsed ? 'none' : 'flex';
      ensureToggle();
    }

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
        renderUser(built.userSlot);
        // 应用记忆的折叠态（默认展开）
        if (isCollapsed()) {
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
