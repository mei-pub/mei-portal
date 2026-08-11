'use client';
// 应用卡片 —— 门户网格单元，含在线/离线徽标
import type { ClientPlugin } from '@/lib/categories';
import 'iconify-icon';

export default function AppCard({
  plugin,
  url,
  health,
  onClick,
}: {
  plugin: ClientPlugin;
  url: string;
  health?: { ok: boolean; ms: number; loading: boolean };
  onClick: () => void;
}) {
  const status = !health
    ? null
    : health.loading
    ? { color: 'var(--mei-text-faint)', label: '检测中' }
    : health.ok
    ? { color: 'var(--mei-success)', label: '在线' }
    : { color: 'var(--mei-danger)', label: '离线' };

  return (
    <button
      onClick={onClick}
      className="mei-app-card"
      style={{
        position: 'relative',
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
      {/* 健康徽标 */}
      {status && (
        <span
          title={`${status.label}${health?.ms ? ` · ${health.ms}ms` : ''}`}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: status.color,
            boxShadow: `0 0 8px ${status.color}`,
          }}
        />
      )}
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
