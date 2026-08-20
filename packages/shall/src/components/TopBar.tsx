'use client';
// Shell 顶栏：品牌 + 搜索 + 开关集成设置齿轮下拉
// transparent 模式用于首页（浮于极光背景之上，无底色边框）
import { useEffect, useRef, useState } from 'react';
import MeiIcon from './MeiIcon';

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
  // 账户操作：修改密码 / 退出确认
  const [brandLogo, setBrandLogo] = useState('');
  const [brandName, setBrandName] = useState('mei-allin');
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ old: '', next: '', confirm: '' });
  const [pwHint, setPwHint] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [bgMask, setBgMask] = useState(0.35);
  const [bgBlur, setBgBlur] = useState(0);
  const bgUrlRef = useRef('');
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

  // 加载面板品牌配置
  useEffect(() => {
    fetch('/api/panel', { credentials: 'include' })
      .then(r => r.json())
      .then(cfg => {
        if (cfg?.style) {
          if (cfg.style.logoImage) setBrandLogo(cfg.style.logoImage);
          if (cfg.style.logoText) setBrandName(cfg.style.logoText);
        }
      })
      .catch(() => {});
  }, []);

  // 加载面板背景配置
  useEffect(() => {
    fetch('/api/panel', { credentials: 'include' })
      .then(r => r.json())
      .then(cfg => {
        if (cfg?.background) {
          setBgMask(cfg.background.mask ?? 0.35);
          setBgBlur(cfg.background.blur ?? 0);
          bgUrlRef.current = cfg.background.url || '';
        }
      })
      .catch(() => {});
  }, []);

  // 保存遮罩/模糊到面板配置（必须带上当前背景图 url，否则会清空背景；服务端会与其余字段合并）
  function saveBg(patch: { mask?: number; blur?: number }) {
    const mask = patch.mask ?? bgMask;
    const blur = patch.blur ?? bgBlur;
    if (patch.mask !== undefined) setBgMask(mask);
    if (patch.blur !== undefined) setBgBlur(blur);
    fetch('/api/panel', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ background: { url: bgUrlRef.current, mask, blur } }),
    }).catch(() => {});
  }
  function saveBgMask(mask: number) { saveBg({ mask }); }
  function saveBgBlur(blur: number) { saveBg({ blur }); }

  const sliderThumb = { width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' } as const;
  const sliderTrack = { width: '100%', height: 4, borderRadius: 2, background: 'var(--mei-border-strong)', WebkitAppearance: 'none', appearance: 'none', outline: 'none', cursor: 'pointer' } as const;
  const bgMaskSlider = (
    <div style={{ padding: '4px 10px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="range" min={0} max={0.9} step={0.05} value={bgMask}
          style={{ ...sliderTrack, accentColor: 'var(--mei-primary)' }}
          onChange={(e) => saveBgMask(Number(e.target.value))}
        />
        <span style={{ fontSize: 11, color: 'var(--mei-text-faint)', minWidth: 32, textAlign: 'right' }}>{Math.round(bgMask * 100)}%</span>
      </div>
    </div>
  );
  const bgBlurSlider = (
    <div style={{ padding: '4px 10px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="range" min={0} max={24} step={1} value={bgBlur}
          style={{ ...sliderTrack, accentColor: 'var(--mei-primary)' }}
          onChange={(e) => saveBgBlur(Number(e.target.value))}
        />
        <span style={{ fontSize: 11, color: 'var(--mei-text-faint)', minWidth: 32, textAlign: 'right' }}>{bgBlur}px</span>
      </div>
    </div>
  );

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .then(() => { window.location.href = '/login'; });
  }

  function submitPassword() {
    setPwHint('');
    if (!pwForm.old || !pwForm.next) { setPwHint('请填写完整'); return; }
    if (pwForm.next.length < 4) { setPwHint('新密码至少 4 位'); return; }
    if (pwForm.next !== pwForm.confirm) { setPwHint('两次输入的新密码不一致'); return; }
    setPwBusy(true);
    fetch('/api/auth/password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: pwForm.old, newPassword: pwForm.next }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setPwHint(j.error || '修改失败'); setPwBusy(false); return; }
        setPwHint('密码已修改，即将前往重新登录…');
        setTimeout(() => {
          fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
            .then(() => { window.location.href = '/login'; });
        }, 900);
      })
      .catch(() => { setPwHint('网络错误，请重试'); setPwBusy(false); });
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
        {brandLogo ? <img src={brandLogo} alt="logo" style={{ height: 24, maxWidth: 120, objectFit: 'contain' }} /> : <span style={{ fontSize: 17, letterSpacing: 0.5, color: 'var(--mei-text)' }}>{brandName}</span>}
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
          <MeiIcon icon="lucide:settings" size={17} />
        </button>

        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 8px)',
              width: 268,
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(28px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
              border: '1px solid var(--mei-border-strong)',
              borderRadius: 'var(--mei-radius-lg)',
              boxShadow: 'var(--mei-shadow-lg), inset 0 1px 0 rgba(255,255,255,0.9)',
              padding: 'var(--mei-space-2)',
              zIndex: 999,
            }}
          >
            {/* 应用开关已移除，顶部不再展示分割线 */}
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
            <div
              style={{
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--mei-text-faint)',
                fontWeight: 700,
                letterSpacing: 1.5,
              }}
            >
              背景遮罩
            </div>
            {bgMaskSlider}
            <div
              style={{
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--mei-text-faint)',
                fontWeight: 700,
                letterSpacing: 1.5,
              }}
            >
              背景模糊
            </div>
            {bgBlurSlider}

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
              <MeiIcon icon="lucide:settings" size={15} />
              设置集成页
            </a>
            {loggedIn && (
              <>
                <button
                  onClick={() => { setMenuOpen(false); setPwOpen(true); setPwForm({ old: '', next: '', confirm: '' }); setPwHint(''); }}
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
                  修改账户密码
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setLogoutConfirm(true); }}
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
              </>
            )}
          </div>
        )}
      </div>

      {/* 修改密码弹层 */}
      {pwOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(10,14,26,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setPwOpen(false); }}
        >
          <div
            style={{
              width: 340,
              maxWidth: 'calc(100vw - 32px)',
              borderRadius: 18,
              padding: 20,
              background: 'rgba(255,255,255,0.97)',
              border: '1px solid var(--mei-border-strong)',
              boxShadow: 'var(--mei-shadow-lg)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>修改账户密码</div>
            {[
              { label: '当前密码', key: 'old' as const, ph: '输入当前密码' },
              { label: '新密码（至少 4 位）', key: 'next' as const, ph: '输入新密码' },
              { label: '确认新密码', key: 'confirm' as const, ph: '再次输入新密码' },
            ].map((f) => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--mei-text-muted)', margin: '10px 0 4px' }}>{f.label}</label>
                <input
                  type="password"
                  value={pwForm[f.key]}
                  placeholder={f.ph}
                  onChange={(e) => setPwForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 12px',
                    borderRadius: 10,
                    fontSize: 13,
                    border: '1px solid var(--mei-border-strong)',
                    outline: 'none',
                    color: 'var(--mei-text)',
                    background: '#fff',
                  }}
                />
              </div>
            ))}
            <div style={{ minHeight: 16, fontSize: 11.5, color: 'var(--mei-danger)', marginTop: 8 }}>{pwHint}</div>
            <button
              onClick={submitPassword}
              disabled={pwBusy}
              style={{
                width: '100%',
                marginTop: 6,
                padding: 10,
                border: 'none',
                borderRadius: 12,
                background: 'var(--mei-gradient)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                opacity: pwBusy ? 0.6 : 1,
              }}
            >
              {pwBusy ? '提交中…' : '提交修改'}
            </button>
            <button
              onClick={() => setPwOpen(false)}
              style={{
                width: '100%',
                marginTop: 8,
                padding: 10,
                borderRadius: 12,
                border: '1px solid var(--mei-border-strong)',
                background: 'transparent',
                color: 'var(--mei-text-muted)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 退出登录确认 */}
      {logoutConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(10,14,26,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setLogoutConfirm(false); }}
        >
          <div
            style={{
              width: 320,
              maxWidth: 'calc(100vw - 32px)',
              borderRadius: 18,
              padding: 20,
              background: 'rgba(255,255,255,0.97)',
              border: '1px solid var(--mei-border-strong)',
              boxShadow: 'var(--mei-shadow-lg)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>确认退出登录？</div>
            <div style={{ fontSize: 12, color: 'var(--mei-text-muted)', marginBottom: 16 }}>
              退出后需要重新输入密码才能进入门户。
            </div>
            <button
              onClick={() => setLogoutConfirm(false)}
              style={{
                width: '100%',
                padding: 10,
                marginBottom: 8,
                borderRadius: 12,
                border: '1px solid var(--mei-border-strong)',
                background: 'transparent',
                color: 'var(--mei-text-muted)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              取消
            </button>
            <button
              onClick={logout}
              style={{
                width: '100%',
                padding: 10,
                border: 'none',
                borderRadius: 12,
                background: 'linear-gradient(135deg,#ef4444,#f97316)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              确认退出
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
