'use client';
// 应用卡片 —— 门户网格单元，含在线/离线徽标
import type { ClientPlugin } from '@/lib/categories';
import 'iconify-icon';

export default function AppCard({
  plugin,
  url,
  health,
  onClick,
  disabled,
}: {
  plugin: ClientPlugin;
  url: string;
  health?: { ok: boolean; ms: number; loading: boolean };
  onClick: () => void;
  disabled?: boolean;
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
      onClick={disabled ? undefined : onClick}
      className="mei-app-card"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--mei-space-2)',
        padding: 'var(--mei-space-4)',
        background: 'var(--mei-surface)',
        backdropFilter: 'var(--mei-blur)',
        WebkitBackdropFilter: 'var(--mei-blur)',
        border: '1px solid var(--mei-border)',
        borderRadius: 'var(--mei-radius-sm)',
        opacity: disabled ? 0.45 : undefined,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        color: 'var(--mei-text)',
        boxShadow: 'var(--mei-shadow-sm)',
        transition: 'var(--mei-transition)',
        minHeight: 120,
        width: '100%',
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
            top: 10,
            right: 10,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: status.color,
            boxShadow: `0 0 6px ${status.color}`,
          }}
        />
      )}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--mei-radius-sm)',
          background: 'var(--mei-gradient-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <iconify-icon icon={plugin.icon} width="20" style={{ color: 'var(--mei-primary)' }} />
      </div>
      {disabled && (
        <span
          title="已在设置中关闭此应用"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '1px 6px',
            fontSize: 10,
            borderRadius: 'var(--mei-radius-full)',
            background: 'var(--mei-text-faint)',
            color: '#fff',
          }}
        >
          已禁用
        </span>
      )}
      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{plugin.name}</div>
      {plugin.description && (
        <div style={{ color: 'var(--mei-text-muted)', fontSize: 12, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {plugin.description}
        </div>
      )}
    </button>
  );
}
