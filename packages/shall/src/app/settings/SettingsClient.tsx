'use client';
// 设置中心首页：SettingsShell（左侧菜单常驻）+ 右侧欢迎区
// 无页面 header；所有设置项点击后在右侧容器渲染
import { useRouter } from 'next/navigation';
import MeiIcon from '@/components/MeiIcon';
import SettingsShell from '@/components/SettingsShell';
import { SETTING_GROUPS } from '@/lib/settings-entries';

export default function SettingsClient() {
  const router = useRouter();

  return (
    <SettingsShell>
      <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center', paddingTop: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" style={{ width: 68, height: 68, borderRadius: 19 }} />
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: '14px 0 6px' }}>聚合设置</h2>
        <p style={{ fontSize: 13, color: 'var(--mei-text-muted)', maxWidth: 420, margin: '0 auto', lineHeight: 1.7 }}>
          左侧选择要管理的应用设置、查阅各应用的使用文档，或在系统设置中管理账号安全。
        </p>
        <div className="mei-settings-quick">
          {SETTING_GROUPS.map((g) => (
            <div key={g.id} className="mei-settings-quick-card">
              <div className="mei-settings-quick-title">
                <MeiIcon icon={g.icon} size={15} />
                {g.label}
              </div>
              <div className="mei-settings-quick-items">
                {g.entries.filter((e) => !e.action).slice(0, 6).map((e) => (
                  <button key={e.id} onClick={() => router.push(e.url)} className="mei-settings-quick-item">
                    <MeiIcon icon={e.icon} size={13} />
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .mei-settings-quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:26px;text-align:left;}
        .mei-settings-quick-card{background:var(--mei-surface);border:1px solid var(--mei-border);border-radius:var(--mei-radius-lg);padding:14px;box-shadow:var(--mei-shadow-sm);}
        .mei-settings-quick-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:1px;color:var(--mei-text-muted);text-transform:uppercase;margin-bottom:10px;}
        .mei-settings-quick-items{display:flex;flex-direction:column;gap:2px;}
        .mei-settings-quick-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border:none;border-radius:8px;background:transparent;font-size:12.5px;color:var(--mei-text);cursor:pointer;text-align:left;transition:var(--mei-transition);}
        .mei-settings-quick-item:hover{background:rgba(99,102,241,0.08);color:var(--mei-primary);}
      `}</style>
    </SettingsShell>
  );
}
