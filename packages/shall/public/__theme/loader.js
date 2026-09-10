/* =============================================================================
 * mei-portal 主题注入 loader（运行在被嵌入应用 iframe 内部）
 *
 * 工作原理：
 *   网关通过 nginx sub_filter 在每个应用 HTML 的 </head> 前注入本脚本：
 *   <script src="<shell>/__theme/loader.js" data-app="lunatv"></script>
 *
 *   本脚本在 iframe 内执行：
 *   1. 注入 tokens.css（全局设计令牌）
 *   2. 注入 data-app 对应的协调 CSS（如 lunatv.css）
 *   3. 从 localStorage 读取主题偏好，设置 :root[data-mei-theme]
 *   4. 监听来自 Shell（window.parent）的 postMessage，实时切换主题
 *
 *   跨子域 iframe 受同源策略限制，但 postMessage 可跨域通信，这是
 *   跨异构框架统一换肤的关键手段。
 * ========================================================================== */
(function () {
  'use strict';

  // 防重复注入
  if (window.__meiThemeLoader) return;
  window.__meiThemeLoader = true;

  var scriptTag = document.currentScript;
  var APP_ID = (scriptTag && scriptTag.getAttribute('data-app')) || '';
  // shell origin 从脚本 src 推断（避免硬编码，支持 nip.io 子域）
  var SHELL_ORIGIN = (function () {
    if (scriptTag && scriptTag.src) return new URL(scriptTag.src).origin;
    // 回退：推断同根域
    try {
      var parts = location.hostname.split('.');
      if (parts.length >= 2) return location.protocol + '//' + parts.slice(-2).join('.');
    } catch (e) {}
    return '';
  })();

  var THEME_KEY = 'mei-theme';
  var ACCENT_KEY = 'mei-accent';

  // ---------- 工具：插入 <link rel="stylesheet"> ----------
  function injectLink(href) {
    if (!href) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-mei', '1');
    document.head.appendChild(link);
  }

  // ---------- 1. 注入 tokens.css + 协调 CSS ----------
  injectLink(SHELL_ORIGIN + '/__theme/tokens.css');
  if (APP_ID) {
    injectLink(SHELL_ORIGIN + '/__theme/' + APP_ID + '.css');
  }

  // ---------- 2. 应用主题偏好 ----------
  function applyTheme(mode) {
    if (mode === 'light') {
      document.documentElement.setAttribute('data-mei-theme', 'light');
    } else if (mode === 'dark' || !mode) {
      document.documentElement.setAttribute('data-mei-theme', 'dark');
    } else if (mode === 'auto') {
      document.documentElement.removeAttribute('data-mei-theme');
      // auto 由 prefers-color-scheme 驱动 tokens.css 的 color-scheme
    }
  }
  function applyAccent(accent) {
    if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
      document.documentElement.style.setProperty('--mei-primary', accent);
    }
  }

  // 首次加载读 localStorage
  try {
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    applyAccent(localStorage.getItem(ACCENT_KEY));
  } catch (e) {}

  // ---------- 3. 监听 Shell 的 postMessage 广播 ----------
  function handleMessage(ev) {
    // 来源校验：只接受 Shell origin（同根域或指定 origin）
    if (SHELL_ORIGIN && ev.origin !== SHELL_ORIGIN) return;
    var data = ev.data || {};
    if (data.source !== 'mei-shell') return;

    if (data.type === 'theme' && data.mode) {
      applyTheme(data.mode);
      try { localStorage.setItem(THEME_KEY, data.mode); } catch (e) {}
    }
    if (data.type === 'accent' && data.accent) {
      applyAccent(data.accent);
      try { localStorage.setItem(ACCENT_KEY, data.accent); } catch (e) {}
    }
  }
  window.addEventListener('message', handleMessage);

  // ---------- 4. 同步系统主题变化（auto 模式） ----------
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener && mq.addEventListener('change', function () {
      try {
        if (localStorage.getItem(THEME_KEY) === 'auto') applyTheme('auto');
      } catch (e) {}
    });
  }

  // ---------- 5. 向 Shell 上报就绪 ----------
  function notifyReady() {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { source: 'mei-iframe', app: APP_ID, type: 'ready' },
        SHELL_ORIGIN || '*'
      );
    }
  }
  if (document.readyState !== 'loading') notifyReady();
  else document.addEventListener('DOMContentLoaded', notifyReady);
})();
