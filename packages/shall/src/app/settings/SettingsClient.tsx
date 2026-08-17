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
    <div className='mei-settings-root'>
      <TopBar query="" onSearch={() => {}} />
      <div className='mei-settings-body'>
        {/* 左侧栏：设置选项按系统分组 */}
        <nav className='mei-settings-nav'>
          {SETTING_GROUPS.map((g) => (
            <div key={g.id} className='mei-settings-group'>
              <div className='mei-settings-group-title'>
                <iconify-icon icon={g.icon} width='16' />
                {g.label}
              </div>
              {g.entries.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setActiveId(e.id)}
                  className={`mei-settings-item${e.id === activeId ? ' active' : ''}`}
                >
                  <iconify-icon icon={e.icon} width='16' />
                  {e.name}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* 右侧：iframe 挂载对应设置入口（同源子路径 + meiEmbed 免顶栏） */}
        <main className='mei-settings-main'>
          <div className='mei-settings-content-head'>
            <span className='mei-settings-content-title'>{active.name}</span>
            <a href={active.url} target='_blank' rel='noreferrer' className='mei-settings-open'>
              在新窗口打开 ↗
            </a>
          </div>
          <div className='mei-settings-frame'>
            {tokenReady ? (
              <IframeHost key={active.id} url={active.url} name={active.name} />
            ) : (
              <div className='mei-settings-loading'>正在准备登录态…</div>
            )}
          </div>
        </main>
      </div>
      <style>{`
        .mei-settings-root{height:100vh;display:flex;flex-direction:column;overflow:hidden;}
        .mei-settings-body{flex:1;display:flex;min-height:0;}
        .mei-settings-nav{width:220px;flex-shrink:0;padding:var(--mei-space-4);background:var(--mei-surface);border-right:1px solid var(--mei-border);overflow-y:auto;}
        .mei-settings-group{margin-bottom:var(--mei-space-4);}
        .mei-settings-group-title{display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;font-weight:600;color:var(--mei-text-muted);}
        .mei-settings-item{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;background:transparent;border:1px solid transparent;border-radius:var(--mei-radius-sm);color:var(--mei-text);cursor:pointer;font-size:13px;text-align:left;}
        .mei-settings-item:hover{background:var(--mei-gradient-soft);}
        .mei-settings-item.active{background:var(--mei-gradient-soft);border-color:var(--mei-primary-soft);}
        .mei-settings-main{flex:1;min-width:0;display:flex;flex-direction:column;padding:var(--mei-space-4);gap:var(--mei-space-3);}
        .mei-settings-content-head{display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .mei-settings-content-title{font-size:14px;font-weight:600;color:var(--mei-text);}
        .mei-settings-open{font-size:12px;color:var(--mei-primary);text-decoration:none;}
        .mei-settings-open:hover{text-decoration:underline;}
        .mei-settings-frame{flex:1;min-height:0;background:var(--mei-surface);border:1px solid var(--mei-border);border-radius:var(--mei-radius);overflow:hidden;}
        .mei-settings-loading{height:100%;display:flex;align-items:center;justify-content:center;color:var(--mei-text-muted);font-size:13px;}
        @media(max-width:760px){
          .mei-settings-body{flex-direction:column;}
          .mei-settings-nav{width:100%;display:flex;gap:14px;overflow-x:auto;overflow-y:hidden;padding:var(--mei-space-2) var(--mei-space-3);border-right:none;border-bottom:1px solid var(--mei-border);}
          .mei-settings-group{margin-bottom:0;display:flex;align-items:center;gap:4px;flex-shrink:0;}
          .mei-settings-group-title{padding:0 6px 0 0;white-space:nowrap;}
          .mei-settings-item{width:auto;white-space:nowrap;padding:6px 10px;}
          .mei-settings-main{padding:var(--mei-space-2) var(--mei-space-3);}
        }
      `}</style>
    </div>
  );
}
