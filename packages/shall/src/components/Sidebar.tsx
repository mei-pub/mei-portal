'use client';
// 侧栏导航 —— iframe 模式下用于在应用间切换
import type { ClientPlugin } from '@/lib/categories';
import { CATEGORY_LABELS } from '@/lib/categories';
import 'iconify-icon';

export default function Sidebar({
  plugins,
  currentId,
  onPick,
  onHome,
}: {
  plugins: ClientPlugin[];
  currentId: string | null;
  onPick: (p: ClientPlugin) => void;
  onHome: () => void;
}) {
  // 分组
  const groups = plugins.reduce<Record<string, ClientPlugin[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  return (
    <nav
      style={{
        width: 220,
        flexShrink: 0,
        padding: 'var(--mei-space-4)',
        background: 'var(--mei-surface)',
        backdropFilter: 'var(--mei-blur)',
        WebkitBackdropFilter: 'var(--mei-blur)',
        borderRight: '1px solid var(--mei-border)',
        overflowY: 'auto',
      }}
    >
      <button
        onClick={onHome}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: currentId === null ? 'var(--mei-gradient-soft)' : 'transparent',
          border: '1px solid',
          borderColor: currentId === null ? 'var(--mei-primary-soft)' : 'transparent',
          borderRadius: 'var(--mei-radius-sm)',
          color: 'var(--mei-text)',
          cursor: 'pointer',
          marginBottom: 'var(--mei-space-3)',
          fontWeight: 600,
        }}
      >
        <iconify-icon icon="lucide:layout-grid" width="18" />
        门户首页
      </button>

      {Object.entries(groups).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 'var(--mei-space-4)' }}>
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: 1,
              color: 'var(--mei-text-faint)',
              padding: '0 12px 6px',
            }}
          >
            {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
          </div>
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                background: currentId === p.id ? 'var(--mei-gradient-soft)' : 'transparent',
                border: '1px solid',
                borderColor: currentId === p.id ? 'var(--mei-primary-soft)' : 'transparent',
                borderRadius: 'var(--mei-radius-sm)',
                color: 'var(--mei-text)',
                cursor: 'pointer',
                marginBottom: 2,
                fontSize: 14,
              }}
            >
              <iconify-icon icon={p.icon} width="18" style={{ color: 'var(--mei-primary-soft)' }} />
              {p.name}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
