'use client';
// 设置集成页：左侧栏按系统分组挂载各子应用设置入口，右侧 iframe 深链内嵌
// 支持 ?entry=<id> 深链直达指定入口，切换时同步地址栏（刷新/分享保持当前入口）
import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';
import IframeHost from '@/components/IframeHost';
import MeiIcon from '@/components/MeiIcon';
import { SETTING_GROUPS } from '@/lib/settings-entries';
import { syncAppTokens } from '@/lib/token-sync';

const ALL_ENTRIES = SETTING_GROUPS.flatMap((g) => g.entries.map((e) => e.id));
const DEFAULT_ENTRY = ALL_ENTRIES[0];
const LAST_ENTRY_KEY = 'mei-settings-entry';

// 深链 ?entry= 优先；否则回到上次浏览的入口（localStorage 记忆）
function initialEntry(): string {
  try {
    const entry = new URLSearchParams(window.location.search).get('entry');
    if (entry && ALL_ENTRIES.includes(entry)) return entry;
    const last = localStorage.getItem(LAST_ENTRY_KEY);
    if (last && ALL_ENTRIES.includes(last)) return last;
  } catch {}
  return DEFAULT_ENTRY;
}

export default function SettingsClient() {
  const [activeId, setActiveId] = useState<string>(initialEntry);
  const [tokenReady, setTokenReady] = useState(false);

  // 挂载 iframe 前同步 token 类应用凭证（嵌入模式不注入 topbar.js）
  useEffect(() => {
    syncAppTokens().finally(() => setTokenReady(true));
  }, []);

  const pick = useCallback((id: string) => {
    setActiveId(id);
    // 同步地址栏（不产生历史记录）并记忆，刷新/再次进入时回到当前入口
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('entry', id);
      window.history.replaceState(null, '', url);
      localStorage.setItem(LAST_ENTRY_KEY, id);
    } catch {}
  }, []);

  const active = useMemo(() => {
    for (const g of SETTING_GROUPS) {
      const hit = g.entries.find((e) => e.id === activeId);
      if (hit) return hit;
    }
    return SETTING_GROUPS[0].entries[0];
  }, [activeId]);

  // 当前激活入口所在分组
  const activeGroupId = useMemo(() => {
    for (const g of SETTING_GROUPS) {
      if (g.entries.some((e) => e.id === activeId)) return g.id;
    }
    return SETTING_GROUPS[0].id;
  }, [activeId]);

  return (
    <div className='mei-settings-root'>
      {/* 极光动态背景 */}
      <div className='mei-aurora' aria-hidden>
        <div className='blob blob-1' />
        <div className='blob blob-2' />
        <div className='blob blob-3' />
      </div>
      <TopBar query="" onSearch={() => {}} showSearch={false} />
      <div className='mei-settings-body'>
        {/* 左侧栏：设置选项按系统分组 */}
        <nav className='mei-settings-nav'>
          {SETTING_GROUPS.map((g) => (
            <div key={g.id} className='mei-settings-group'>
              <div
                className={`mei-settings-group-title${g.id === activeGroupId ? ' active' : ''}`}
              >
                <MeiIcon icon={g.icon} size={14} />
                {g.label}
              </div>
              {g.entries.map((e) => (
                <button
                  key={e.id}
                  onClick={() => pick(e.id)}
                  className={`mei-settings-item${e.id === activeId ? ' active' : ''}`}
                >
                  <MeiIcon icon={e.icon} size={15} />
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
        .mei-settings-nav{width:220px;flex-shrink:0;padding:var(--mei-space-4);background:var(--mei-surface);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border-right:1px solid var(--mei-border);overflow-y:auto;}
        .mei-settings-group{margin-bottom:var(--mei-space-4);}
        /* 分组标题：小号大写间距 + 底部细线，与入口按钮明显区分 */
        .mei-settings-group-title{display:flex;align-items:center;gap:7px;padding:4px 8px 6px;font-size:10.5px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:var(--mei-text-faint);border-bottom:1px solid var(--mei-border);margin-bottom:6px;}
        .mei-settings-group-title.active{color:var(--mei-primary);}
        /* 入口按钮：左侧强调条 + 主体字号，激活时渐变底 */
        .mei-settings-item{position:relative;width:100%;display:flex;align-items:center;gap:9px;padding:8px 10px 8px 13px;background:transparent;border:none;border-radius:10px;color:var(--mei-text);cursor:pointer;font-size:13px;font-weight:550;text-align:left;transition:var(--mei-transition);}
        .mei-settings-item::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:2px;background:transparent;transition:var(--mei-transition);}
        .mei-settings-item:hover{background:rgba(23,32,56,0.05);}
        .mei-settings-item.active{background:var(--mei-gradient-soft);}
        .mei-settings-item.active::before{background:var(--mei-gradient);}
        .mei-settings-item.active{color:var(--mei-primary);}
        .mei-settings-main{flex:1;min-width:0;display:flex;flex-direction:column;padding:var(--mei-space-4);gap:var(--mei-space-3);}
        .mei-settings-content-head{display:flex;align-items:center;justify-content:space-between;flex-shrink:0;padding:0 4px;}
        .mei-settings-content-title{font-size:14px;font-weight:650;color:var(--mei-text);letter-spacing:0.3px;}
        .mei-settings-open{font-size:12px;color:var(--mei-primary);text-decoration:none;}
        .mei-settings-open:hover{text-decoration:underline;}
        .mei-settings-frame{flex:1;min-height:0;background:rgba(255,255,255,0.78);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.9);border-radius:var(--mei-radius-lg);overflow:hidden;box-shadow:var(--mei-shadow),inset 0 1px 0 rgba(255,255,255,0.9);}
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
