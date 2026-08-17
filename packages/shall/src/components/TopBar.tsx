'use client';
// 门户顶栏：品牌 + 搜索 + 开关集成设置下拉（应用开关 / 主页内网模式开关）
import { useEffect, useRef, useState } from 'react';
import AppToggles from './AppToggles';
import PanelNetModeToggle from './PanelNetModeToggle';

export default function TopBar({
  query,
  onSearch,
  searchRef,
}: {
  query: string;
  onSearch: (q: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setLoggedIn(!!d.loggedIn))
      .catch(() => {});
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .then(() => { window.location.href = '/'; });
  }

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mei-space-4)',
        padding: 'var(--mei-space-3) var(--mei-space-6)',
        background: 'var(--mei-surface)',
        borderBottom: '1px solid var(--mei-border)',
      }}
    >
      {/* 品牌 */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--mei-radius-sm)',
            background: 'var(--mei-gradient)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 18 }}>mei-allin</span>
      </a>

      {/* 搜索 */}
      <input
        ref={searchRef}
        value={query}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="搜索应用…"
        style={{
          flex: 1,
          maxWidth: 360,
          padding: '8px 14px',
          background: 'var(--mei-bg)',
          border: '1px solid var(--mei-border)',
          borderRadius: 'var(--mei-radius-full)',
          color: 'var(--mei-text)',
          outline: 'none',
          fontSize: 14,
        }}
      />

      <div style={{ flex: 1 }} />

      {/* 开关集成设置齿轮下拉 */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="开关集成设置"
          aria-label="开关集成设置"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 'var(--mei-radius-full)',
            background: menuOpen ? 'var(--mei-primary-soft)' : 'transparent',
            border: '1px solid var(--mei-border)',
            color: 'var(--mei-text-muted)',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ⚙️
        </button>

        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              width: 260,
              background: 'var(--mei-surface)',
              border: '1px solid var(--mei-border)',
              borderRadius: 'var(--mei-radius)',
              boxShadow: 'var(--mei-shadow-md)',
              padding: 'var(--mei-space-2)',
              zIndex: 999,
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                fontSize: 12,
                color: 'var(--mei-text-muted)',
                fontWeight: 600,
              }}
            >
              应用开关
            </div>
            <AppToggles reloadOnChange />
            <div
              style={{
                height: 1,
                background: 'var(--mei-border)',
                margin: '6px 0',
              }}
            />
            <div
              style={{
                padding: '8px 10px',
                fontSize: 12,
                color: 'var(--mei-text-muted)',
                fontWeight: 600,
              }}
            >
              集成开关
            </div>
            <PanelNetModeToggle />
            <div
              style={{
                height: 1,
                background: 'var(--mei-border)',
                margin: '6px 0',
              }}
            />
            <a
              href="/settings"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 10px',
                borderRadius: 'var(--mei-radius-sm)',
                color: 'var(--mei-text)',
                fontSize: 13,
                textDecoration: 'none',
              }}
              onClick={() => setMenuOpen(false)}
            >
              ⚙️ 设置集成页
            </a>
            {loggedIn && (
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 'var(--mei-radius-sm)',
                  color: 'var(--mei-text)',
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                }}
              >
                退出登录
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
