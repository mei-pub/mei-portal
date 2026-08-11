'use client';
// 全局顶栏：品牌 + 搜索 + 主题控制 + 用户
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

export default function TopBar({ onSearch }: { onSearch?: (q: string) => void }) {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [accent, setAccent] = useState('#6366f1');
  const [query, setQuery] = useState('');

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

  const accents = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mei-space-4)',
        padding: 'var(--mei-space-3) var(--mei-space-6)',
        background: 'var(--mei-surface)',
        backdropFilter: 'var(--mei-blur)',
        WebkitBackdropFilter: 'var(--mei-blur)',
        borderBottom: '1px solid var(--mei-border)',
      }}
    >
      {/* 品牌 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--mei-radius-sm)',
            background: 'var(--mei-gradient)',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 18 }}>mei-allin</span>
      </div>

      {/* 搜索 */}
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSearch?.(e.target.value);
        }}
        placeholder="搜索应用…"
        style={{
          flex: 1,
          maxWidth: 360,
          padding: '8px 14px',
          background: 'var(--mei-bg-elevated)',
          border: '1px solid var(--mei-border)',
          borderRadius: 'var(--mei-radius-full)',
          color: 'var(--mei-text)',
          outline: 'none',
        }}
      />

      <div style={{ flex: 1 }} />

      {/* 主题控制台 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* 主题切换 */}
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
              title={m}
              style={{
                border: 'none',
                background: theme === m ? 'var(--mei-gradient)' : 'transparent',
                color: theme === m ? '#fff' : 'var(--mei-text-muted)',
                padding: '4px 10px',
                borderRadius: 'var(--mei-radius-full)',
                cursor: 'pointer',
                fontSize: 12,
                textTransform: 'capitalize',
              }}
            >
              {m === 'dark' ? '◐' : m === 'light' ? '☀' : 'Auto'}
            </button>
          ))}
        </div>

        {/* 主色调色板 */}
        <div style={{ display: 'flex', gap: 4 }}>
          {accents.map((c) => (
            <button
              key={c}
              onClick={() => changeAccent(c)}
              title={c}
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: c,
                border: accent === c ? '2px solid #fff' : '2px solid transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>
    </header>
  );
}
