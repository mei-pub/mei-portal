'use client';
// 应用卡片 —— 玻璃拟态 + 每应用专属渐变图标砖 + 悬浮光效（样式主体在 globals.css .mei-app-card）
import type { ClientPlugin } from '@/lib/categories';
import MeiIcon from './MeiIcon';

// 按应用 id 生成专属渐变（同 id 恒定不变）
const GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#a855f7)',
  'linear-gradient(135deg,#0ea5e9,#6366f1)',
  'linear-gradient(135deg,#10b981,#0ea5e9)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#ec4899,#a855f7)',
  'linear-gradient(135deg,#14b8a6,#84cc16)',
  'linear-gradient(135deg,#f43f5e,#f59e0b)',
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#3b82f6,#14b8a6)',
  'linear-gradient(135deg,#a855f7,#f43f5e)',
];

function hashGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

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
      data-disabled={disabled ? 'true' : undefined}
      type="button"
    >
      {/* 健康徽标 */}
      {status && (
        <span
          title={`${status.label}${health?.ms ? ` · ${health.ms}ms` : ''}`}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: status.color,
            boxShadow: `0 0 8px ${status.color}`,
          }}
        />
      )}
      {disabled && (
        <span
          title="已在开关集成设置中关闭此应用"
          style={{
            position: 'absolute',
            top: 9,
            right: 9,
            padding: '1px 7px',
            fontSize: 10,
            borderRadius: 'var(--mei-radius-full)',
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid var(--mei-border)',
            color: 'var(--mei-text-muted)',
          }}
        >
          已禁用
        </span>
      )}
      <div className="mei-icon-tile" style={{ background: hashGradient(plugin.id) }}>
        <MeiIcon icon={plugin.icon} size={22} />
      </div>
      <div style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.3, letterSpacing: 0.2 }}>{plugin.name}</div>
      {plugin.description && (
        <div
          style={{
            color: 'var(--mei-text-muted)',
            fontSize: 12,
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {plugin.description}
        </div>
      )}
      {/* 底部微弱的应用域名提示，增加层次 */}
      <span
        style={{
          marginTop: 'auto',
          paddingTop: 6,
          fontSize: 10.5,
          letterSpacing: 0.6,
          color: 'var(--mei-text-faint)',
          opacity: 0.85,
        }}
      >
        {plugin.subdomainPrefix ? `/${plugin.subdomainPrefix}` : url}
      </span>
    </button>
  );
}
