'use client';
// 门户顶栏：品牌 + 搜索（亮色，无主题切换控件）
export default function TopBar({
  query,
  onSearch,
  searchRef,
}: {
  query: string;
  onSearch: (q: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
}) {
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
    </header>
  );
}
