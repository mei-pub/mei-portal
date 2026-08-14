'use client';
// 应用集成开关列表（纯本地 localStorage）
import { useState } from 'react';
import { SWITCHABLE_APPS, isAppEnabled, writeEnabled } from '@/lib/app-toggles';

export default function AppToggles({ reloadOnChange = false }: { reloadOnChange?: boolean }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const app of SWITCHABLE_APPS) init[app.id] = isAppEnabled(app.id);
    return init;
  });

  function toggle(id: string) {
    const next = !enabled[id];
    writeEnabled(id, next);
    setEnabled((prev) => ({ ...prev, [id]: next }));
    if (reloadOnChange) window.location.reload();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {SWITCHABLE_APPS.map((app) => {
        const on = enabled[app.id] !== false;
        return (
          <button
            key={app.id}
            onClick={() => toggle(app.id)}
            role="switch"
            aria-checked={on}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 10px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 'var(--mei-radius-sm, 8px)',
              color: 'var(--mei-text, #1f2937)',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <span style={{ flex: 1, opacity: on ? 1 : 0.5, transition: 'opacity .15s' }}>
              {app.name}
            </span>
            <span
              style={{
                width: 32,
                height: 18,
                borderRadius: 10,
                background: on ? 'var(--mei-primary, #6366f1)' : '#d1d5db',
                position: 'relative',
                transition: 'background .15s',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: on ? 16 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left .15s',
                }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
