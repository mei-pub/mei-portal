'use client';
// Shell 顶栏：品牌 + 搜索 + 开关集成设置齿轮下拉
// transparent 模式用于首页（浮于极光背景之上，无底色边框）
import { useEffect, useRef, useState } from 'react';
import AppToggles from './AppToggles';
import PanelNetModeToggle from './PanelNetModeToggle';

export default function TopBar({
  query,
  onSearch,
  searchRef,
  showSearch = true,
  transparent = false,
}: {
  query: string;
  onSearch: (q: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  showSearch?: boolean;
  transparent?: boolean;
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

  // 点击外部 / ESC 关闭下拉
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
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
        padding: transparent
          ? 'var(--mei-space-3) var(--mei-space-6)'
          : 'var(--mei-space-3) var(--mei-space-6)',
        background: transparent ? 'transparent' : 'var(--mei-overlay)',
        backdropFilter: transparent ? undefined : 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: transparent ? undefined : 'blur(20px) saturate(1.4)',
        borderBottom: transparent ? 'none' : '1px solid var(--mei-border)',
      }}
    >
      {/* 品牌 */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: 'var(--mei-gradient)',
            boxShadow: '0 0 16px rgba(129,140,248,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 17, letterSpacing: 0.5, color: 'var(--mei-text)' }}>mei-allin</span>
      </a>

      {/* 搜索（无搜索功能的页面隐藏） */}
      {showSearch && (
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索应用…"
          style={{
            flex: 1,
            maxWidth: 360,
            padding: '8px 14px',
            background: 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius-full)',
            color: 'var(--mei-text)',
            outline: 'none',
            fontSize: 14,
          }}
        />
      )}

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
            background: menuOpen ? 'var(--mei-surface-hover)' : 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: 'var(--mei-text-muted)',
            cursor: 'pointer',
            fontSize: 15,
            transition: 'var(--mei-transition)',
          }}
        >
          ⚙️
        </button>

        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 8px)',
              width: 268,
              background: 'rgba(13, 18, 32, 0.88)',
              backdropFilter: 'blur(28px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
              border: '1px solid var(--mei-border-strong)',
              borderRadius: 'var(--mei-radius-lg)',
              boxShadow: 'var(--mei-shadow-lg), 0 0 0 1px rgba(129,140,248,0.12)',
              padding: 'var(--mei-space-2)',
              zIndex: 999,
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--mei-text-faint)',
                fontWeight: 700,
                letterSpacing: 1.5,
              }}
            >
              应用开关
            </div>
            <AppToggles reloadOnChange />
            <div style={{ height: 1, background: 'var(--mei-border)', margin: '6px 0' }} />
            <div
              style={{
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--mei-text-faint)',
                fontWeight: 700,
                letterSpacing: 1.5,
              }}
            >
              集成开关
            </div>
            <PanelNetModeToggle />
            <div style={{ height: 1, background: 'var(--mei-border)', margin: '6px 0' }} />
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
                  color: 'var(--mei-danger)',
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
