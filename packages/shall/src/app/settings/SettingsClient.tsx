'use client';
// 设置集成页：左侧栏按系统分组挂载各子应用设置入口，右侧 iframe 深链内嵌
import { useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';
import IframeHost from '@/components/IframeHost';
import { SETTING_GROUPS } from '@/lib/settings-entries';
import { syncAppTokens } from '@/lib/token-sync';
import 'iconify-icon';

export default function SettingsClient() {
  const [activeId, setActiveId] = useState<string>(SETTING_GROUPS[0].entries[0].id);
  const [tokenReady, setTokenReady] = useState(false);

  // 挂载 iframe 前同步 token 类应用凭证（嵌入模式不注入 topbar.js）
  useEffect(() => {
    syncAppTokens().finally(() => setTokenReady(true));
  }, []);

  const active = useMemo(() => {
    for (const g of SETTING_GROUPS) {
      const hit = g.entries.find((e) => e.id === activeId);
      if (hit) return hit;
    }
    return SETTING_GROUPS[0].entries[0];
  }, [activeId]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar query="" onSearch={() => {}} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧栏：设置选项按系统分组 */}
        <nav
          style={{
            width: 220,
            flexShrink: 0,
            padding: 'var(--mei-space-4)',
            background: 'var(--mei-surface)',
            borderRight: '1px solid var(--mei-border)',
            overflowY: 'auto',
          }}
        >
          {SETTING_GROUPS.map((g) => (
            <div key={g.id} style={{ marginBottom: 'var(--mei-space-4)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--mei-text-muted)',
                }}
              >
                <iconify-icon icon={g.icon} width="16" />
                {g.label}
              </div>
              {g.entries.map((e) => {
                const isActive = e.id === activeId;
                return (
                  <button
                    key={e.id}
                    onClick={() => setActiveId(e.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: isActive ? 'var(--mei-gradient-soft)' : 'transparent',
                      border: '1px solid',
                      borderColor: isActive ? 'var(--mei-primary-soft)' : 'transparent',
                      borderRadius: 'var(--mei-radius-sm)',
                      color: 'var(--mei-text)',
                      cursor: 'pointer',
                      fontSize: 13,
                      textAlign: 'left',
                    }}
                  >
                    <iconify-icon icon={e.icon} width="16" />
                    {e.name}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 右侧：iframe 挂载对应设置入口（同源子路径 + meiEmbed 免顶栏） */}
        <main style={{ flex: 1, minWidth: 0, padding: 'var(--mei-space-4)' }}>
          <div
            style={{
              height: 'calc(100vh - 48px - var(--mei-space-8))',
              minHeight: 480,
              background: 'var(--mei-surface)',
              border: '1px solid var(--mei-border)',
              borderRadius: 'var(--mei-radius)',
              overflow: 'hidden',
            }}
          >
            {tokenReady ? (
              <IframeHost key={active.id} url={active.url} name={active.name} />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--mei-text-muted)',
                  fontSize: 13,
                }}
              >
                正在准备登录态…
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
