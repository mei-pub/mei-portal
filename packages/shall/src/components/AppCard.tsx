'use client';
// 应用卡片 —— 门户网格单元
import type { ClientPlugin } from '@/lib/categories';
import 'iconify-icon';

export default function AppCard({
  plugin,
  url,
  onClick,
}: {
  plugin: ClientPlugin;
  url: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--mei-space-3)',
        padding: 'var(--mei-space-6)',
        background: 'var(--mei-surface)',
        backdropFilter: 'var(--mei-blur)',
        WebkitBackdropFilter: 'var(--mei-blur)',
        border: '1px solid var(--mei-border)',
        borderRadius: 'var(--mei-radius)',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--mei-text)',
        boxShadow: 'var(--mei-shadow-sm)',
        transition: 'var(--mei-transition)',
        minHeight: 132,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'var(--mei-primary-soft)';
        e.currentTarget.style.boxShadow = 'var(--mei-glow)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.borderColor = 'var(--mei-border)';
        e.currentTarget.style.boxShadow = 'var(--mei-shadow-sm)';
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--mei-radius-sm)',
          background: 'var(--mei-gradient-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <iconify-icon icon={plugin.icon} width="24" style={{ color: 'var(--mei-primary)' }} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 16 }}>{plugin.name}</div>
      {plugin.description && (
        <div style={{ color: 'var(--mei-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {plugin.description}
        </div>
      )}
    </button>
  );
}
