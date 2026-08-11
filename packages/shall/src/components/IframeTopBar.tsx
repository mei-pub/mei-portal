'use client';
// iframe 模式顶栏：品牌 + 当前应用名 + 工具按钮 + 主题控件
import ThemeControls from './ThemeControls';
import IconButton from './IconButton';

const ICONS = {
  back: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" />
    </svg>
  ),
  refresh: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" />
    </svg>
  ),
  external: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  expand: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  menu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
};

export default function IframeTopBar({
  appName,
  appIcon,
  onBack,
  onRefresh,
  onToggleSidebar,
  externalUrl,
}: {
  appName: string;
  appIcon?: string;
  onBack: () => void;
  onRefresh: () => void;
  onToggleSidebar: () => void;
  externalUrl: string;
}) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mei-space-3)',
        padding: 'var(--mei-space-3) var(--mei-space-4)',
        background: 'var(--mei-surface)',
        backdropFilter: 'var(--mei-blur)',
        WebkitBackdropFilter: 'var(--mei-blur)',
        borderBottom: '1px solid var(--mei-border)',
      }}
    >
      {/* 移动端菜单 */}
      <IconButton title="切换侧栏" onClick={onToggleSidebar} className="mei-only-mobile">
        {ICONS.menu}
      </IconButton>

      {/* 返回门户 */}
      <IconButton title="返回门户 (Esc)" onClick={onBack}>
        {ICONS.back}
      </IconButton>

      {/* 品牌 + 当前应用 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--mei-gradient)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {appName}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* 工具按钮 */}
      <IconButton title="刷新 (R)" onClick={onRefresh}>
        {ICONS.refresh}
      </IconButton>
      <IconButton
        title="新窗口打开"
        onClick={() => window.open(externalUrl, '_blank', 'noopener,noreferrer')}
      >
        {ICONS.external}
      </IconButton>
      <IconButton title="全屏" onClick={() => document.documentElement.requestFullscreen?.()}>
        {ICONS.expand}
      </IconButton>

      <ThemeControls />
    </header>
  );
}
