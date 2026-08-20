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
  const [bgMask, setBgMask] = useState(0.35);
  const [bgBlur, setBgBlur] = useState(0);
  const bgUrlRef = useRef('');
  // 配置未加载完成前禁止保存，否则会把背景图 url 清成空串
  const bgLoadedRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 广播面板配置变更（PortalClient 监听后实时刷新背景遮罩/模糊/主题）
  function broadcastPanelChange() {
    window.dispatchEvent(new CustomEvent('mei-panel-change', { detail: { source: 'topbar' } }));
  }


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

  // 加载面板背景配置（含首页深浅主色调）
  useEffect(() => {
    const load = () => fetch('/api/panel', { credentials: 'include' })
      .then(r => r.json())
      .then(cfg => {
        if (cfg?.background) {
          setBgMask(cfg.background.mask ?? 0.35);
          setBgBlur(cfg.background.blur ?? 0);
          bgUrlRef.current = cfg.background.url || '';
          bgLoadedRef.current = true;
        }
      })
      .catch(() => {});
    load();
    // 其他入口（主页设置/首页操作）保存配置后同步本地状态；自己广播的跳过
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail?.source === 'topbar') return;
      load();
    };
    window.addEventListener('mei-panel-change', onChange);
    return () => window.removeEventListener('mei-panel-change', onChange);
  }, []);

  // 保存遮罩/模糊到面板配置（必须带上当前背景图 url，否则会清空背景；服务端会与其余字段合并）
  function saveBg(patch: { mask?: number; blur?: number }) {
    if (!bgLoadedRef.current) return;
    const mask = patch.mask ?? bgMask;
    const blur = patch.blur ?? bgBlur;
    if (patch.mask !== undefined) setBgMask(mask);
    if (patch.blur !== undefined) setBgBlur(blur);
    fetch('/api/panel', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ background: { url: bgUrlRef.current, mask, blur } }),
    }).then(() => broadcastPanelChange()).catch(() => {});
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
      {/* 首页入口：圆形主页 icon（不再展示品牌 Logo 与文字） */}
      <a
        href="/"
        title="返回主页"
        aria-label="返回主页"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--mei-gradient)',
          color: '#fff',
          boxShadow: '0 4px 14px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
          flexShrink: 0,
        }}
      >
        <MeiIcon icon="lucide:home" size={17} />
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
            {/* 设置入口（第一项，直达设置中心） */}
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
              设置
            </a>
            <div style={{ height: 1, background: 'var(--mei-border)', margin: '6px 0' }} />
            {/* 主页内网模式开关（分组标题已去除，逻辑不变） */}
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
          </div>
        )}
      </div>
    </header>
  );
}
