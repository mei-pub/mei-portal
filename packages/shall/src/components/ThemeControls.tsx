'use client';
// 主题控制台：亮/暗/Auto 切换 + 主色调色板
// 供门户顶栏与 iframe 顶栏复用。变更通过 postMessage 广播到所有 iframe。
import { useState, useEffect } from 'react';
import {
  applyThemeToShell,
  applyAccentToShell,
  getStoredTheme,
  getStoredAccent,
  broadcastTheme,
  broadcastAccent,
  type ThemeMode,
} from '@/lib/theme-broadcast';

const ACCENTS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

export default function ThemeControls() {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [accent, setAccent] = useState('#6366f1');

  useEffect(() => {
    setTheme(getStoredTheme());
    setAccent(getStoredAccent());
  }, []);

  function changeTheme(m: ThemeMode) {
    setTheme(m);
    applyThemeToShell(m);
    broadcastTheme(m);
  }
  function changeAccent(c: string) {
    setAccent(c);
    applyAccentToShell(c);
    broadcastAccent(c);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* 主题模式切换 */}
      <div
        style={{
          display: 'flex',
          background: 'var(--mei-bg-elevated)',
          borderRadius: 'var(--mei-radius-full)',
          padding: 2,
          border: '1px solid var(--mei-border)',
        }}
      >
        {(['dark', 'light', 'auto'] as ThemeMode[]).map((m) => (
          <button
            key={m}
            onClick={() => changeTheme(m)}
            title={m === 'dark' ? '暗色' : m === 'light' ? '亮色' : '跟随系统'}
            style={{
              border: 'none',
              background: theme === m ? 'var(--mei-gradient)' : 'transparent',
              color: theme === m ? '#fff' : 'var(--mei-text-muted)',
              padding: '4px 10px',
              borderRadius: 'var(--mei-radius-full)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {m === 'dark' ? '◐' : m === 'light' ? '☀' : 'A'}
          </button>
        ))}
      </div>

      {/* 主色调色板 */}
      <div style={{ display: 'flex', gap: 4 }}>
        {ACCENTS.map((c) => (
          <button
            key={c}
            onClick={() => changeAccent(c)}
            title={c}
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: c,
              border: accent === c ? '2px solid var(--mei-text)' : '2px solid transparent',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
