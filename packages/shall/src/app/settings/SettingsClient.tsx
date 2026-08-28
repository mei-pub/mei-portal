'use client';

import { useRouter } from 'next/navigation';
import MeiIcon from '@/components/MeiIcon';
import SettingsShell from '@/components/SettingsShell';
import { SETTING_GROUPS } from '@/lib/settings-entries';

const SPANS: Record<string, string> = {
  apps: 'span 5',
  runtime: 'span 3',
  docs: 'span 2',
  system: 'span 2',
};

export default function SettingsClient() {
  const router = useRouter();

  return (
    <SettingsShell>
      <div className="settings-home">
        <div className="settings-hero">
          <div>
            <span>设置中心</span>
            <h1>聚合设置</h1>
          </div>
          <p>在这里集中管理应用偏好、运行状态与账号安全；所有应用保持同一套交互与视觉规范。</p>
        </div>

        <div className="settings-groups">
          {SETTING_GROUPS.map((g) => (
            <section key={g.id} style={{ gridColumn: SPANS[g.id] || 'span 3' }}>
              <header>
                <span>
                  <MeiIcon icon={g.icon} size={15} />
                </span>
                <div>
                  <h2>{g.label}</h2>
                  <small>{g.entries.filter((e) => !e.action).length} 个入口</small>
                </div>
              </header>
              <div>
                {g.entries.filter((e) => !e.action).map((e) => (
                  <button key={e.id} onClick={() => router.push(e.url)}>
                    <MeiIcon icon={e.icon} size={14} />
                    <span>{e.name}</span>
                    <i>›</i>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <style>{`
        .settings-home{max-width:1180px;margin:0 auto;padding:4px 0 48px;}
        .settings-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.9fr);gap:18px;align-items:end;padding:24px;margin-bottom:16px;border-radius:24px;border:1px solid rgba(255,255,255,.82);background:linear-gradient(135deg,rgba(255,255,255,.85),rgba(255,255,255,.58));box-shadow:var(--mei-shadow-sm);backdrop-filter:blur(20px);}
        .settings-hero span{font-size:10.5px;font-weight:900;letter-spacing:1.8px;color:var(--mei-primary);}
        .settings-hero h1{margin:5px 0 0;font-size:31px;letter-spacing:-1px;font-weight:900;}
        .settings-hero p{margin:0;font-size:13px;line-height:1.7;color:var(--mei-text-muted);}
        .settings-groups{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;align-items:stretch;}
        .settings-groups section{min-width:0;background:rgba(255,255,255,.74);border:1px solid rgba(255,255,255,.82);border-radius:20px;padding:14px;box-shadow:var(--mei-shadow-sm);backdrop-filter:blur(18px);}
        .settings-groups header{display:flex;align-items:center;gap:10px;margin-bottom:11px;}
        .settings-groups header>span{width:31px;height:31px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;color:var(--mei-primary);background:rgba(99,102,241,.1);}
        .settings-groups h2{margin:0;font-size:14px;font-weight:850;}
        .settings-groups small{display:block;margin-top:2px;font-size:11px;color:var(--mei-text-muted);}
        .settings-groups button{width:100%;display:flex;align-items:center;gap:9px;min-height:35px;padding:7px 8px;border:none;border-radius:11px;background:transparent;color:var(--mei-text);font-size:12.5px;font-weight:650;text-align:left;cursor:pointer;transition:var(--mei-transition);}
        .settings-groups button:hover{background:rgba(99,102,241,.08);color:var(--mei-primary);}
        .settings-groups button span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .settings-groups button i{font-style:normal;color:var(--mei-text-faint);}
        @media(max-width:1000px){.settings-hero{grid-template-columns:1fr;}.settings-groups{grid-template-columns:repeat(2,minmax(0,1fr));}.settings-groups section{grid-column:auto !important;}}
        @media(max-width:680px){.settings-groups{grid-template-columns:1fr;}}
      `}</style>
    </SettingsShell>
  );
}
