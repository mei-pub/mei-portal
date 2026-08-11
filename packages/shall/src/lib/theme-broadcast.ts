'use client';
// 主题广播 —— Shell 作为 window.parent，向所有 iframe 子页 postMessage
// 这是跨子域 iframe 实时换肤的唯一手段（同源策略下 CSS 变量无法直接共享）

export type ThemeMode = 'dark' | 'light' | 'auto';

const THEME_KEY = 'mei-theme';
const ACCENT_KEY = 'mei-accent';

// 广播给当前页所有 iframe
export function broadcastTheme(mode: ThemeMode, iframes?: HTMLIFrameElement[]) {
  const targets = iframes || Array.from(document.querySelectorAll('iframe'));
  const origin = window.location.origin;
  for (const f of targets) {
    try {
      f.contentWindow?.postMessage(
        { source: 'mei-shell', type: 'theme', mode },
        origin
      );
    } catch (e) {
      /* ignore */
    }
  }
}

export function broadcastAccent(accent: string, iframes?: HTMLIFrameElement[]) {
  const targets = iframes || Array.from(document.querySelectorAll('iframe'));
  const origin = window.location.origin;
  for (const f of targets) {
    try {
      f.contentWindow?.postMessage(
        { source: 'mei-shell', type: 'accent', accent },
        origin
      );
    } catch (e) {
      /* ignore */
    }
  }
}

// 本地应用 + 持久化
export function applyThemeToShell(mode: ThemeMode) {
  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-mei-theme');
  } else {
    document.documentElement.setAttribute('data-mei-theme', mode);
  }
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch (e) {}
}

export function applyAccentToShell(accent: string) {
  document.documentElement.style.setProperty('--mei-primary', accent);
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch (e) {}
}

export function getStoredTheme(): ThemeMode {
  try {
    return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'dark';
  } catch {
    return 'dark';
  }
}

export function getStoredAccent(): string {
  try {
    return localStorage.getItem(ACCENT_KEY) || '#6366f1';
  } catch {
    return '#6366f1';
  }
}
