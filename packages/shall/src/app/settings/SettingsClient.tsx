'use client';
// 设置中心：左侧三大分组（应用设置 / 文档与帮助 / 系统设置），
// 顶部 header 居中渲染标题（含 Logo）；全部原生直达（无 iframe、无新窗口打开）
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import MeiIcon from '@/components/MeiIcon';
import { SETTING_GROUPS } from '@/lib/settings-entries';

export default function SettingsClient() {
  const router = useRouter();
  const [logoutOpen, setLogoutOpen] = useState(false);

  async function doLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    window.location.href = '/login';
  }

  return (
    <div className="mei-settings-root">
      {/* 极光动态背景 */}
      <div className="mei-aurora" aria-hidden>
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>
      <TopBar query="" onSearch={() => {}} showSearch={false} />

      {/* 顶部 header：标题（含 Logo）居中 */}
      <header className="mei-settings-header">
        <img src="/logo.svg" alt="logo" className="mei-settings-header-logo" />
        <h1 className="mei-settings-header-title">设置</h1>
      </header>

      <div className="mei-settings-body">
        <nav className="mei-settings-nav">
          {SETTING_GROUPS.map((g) => (
            <div key={g.id} className="mei-settings-group">
              <div className="mei-settings-group-title">
                <MeiIcon icon={g.icon} size={14} />
                {g.label}
              </div>
              {g.entries.map((e) => (
                <button
                  key={e.id}
                  onClick={() => (e.action === 'logout' ? setLogoutOpen(true) : router.push(e.url))}
                  className={`mei-settings-item${e.action === 'logout' ? ' danger' : ''}`}
                >
                  <MeiIcon icon={e.icon} size={15} />
                  {e.name}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* 右侧欢迎区 */}
        <main className="mei-settings-main">
          <div className="mei-settings-welcome">
            <img src="/logo.svg" alt="" style={{ width: 72, height: 72, borderRadius: 20 }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '14px 0 6px' }}>聚合设置</h2>
            <p style={{ fontSize: 13, color: 'var(--mei-text-muted)', maxWidth: 420, lineHeight: 1.7 }}>
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
        </main>
      </div>

      {/* 退出登录确认弹层 */}
      {logoutOpen && (
        <div className="mei-modal-mask" onClick={() => setLogoutOpen(false)}>
          <div className="mei-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span className="mei-modal-icon">
                <MeiIcon icon="lucide:log-out" size={18} />
              </span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>退出登录</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--mei-text-muted)', margin: '0 0 16px' }}>
              确定要退出当前账号吗？退出后需要重新登录才能访问门户。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setLogoutOpen(false)} className="mei-btn-ghost">取消</button>
              <button onClick={doLogout} className="mei-btn-danger">退出登录</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mei-settings-root{height:100vh;display:flex;flex-direction:column;overflow:hidden;}
        .mei-settings-header{position:relative;z-index:5;display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 20px;flex-shrink:0;}
        .mei-settings-header-logo{width:26px;height:26px;border-radius:8px;box-shadow:0 4px 14px rgba(99,102,241,0.3);}
        .mei-settings-header-title{font-size:17px;font-weight:800;letter-spacing:0.5px;color:var(--mei-text);margin:0;}
        .mei-settings-body{flex:1;display:flex;min-height:0;position:relative;z-index:5;}
        .mei-settings-nav{width:224px;flex-shrink:0;padding:var(--mei-space-4);background:var(--mei-surface);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border-right:1px solid var(--mei-border);overflow-y:auto;}
        .mei-settings-group{margin-bottom:var(--mei-space-4);}
        .mei-settings-group-title{display:flex;align-items:center;gap:7px;padding:4px 8px 6px;font-size:10.5px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:var(--mei-text-faint);border-bottom:1px solid var(--mei-border);margin-bottom:6px;}
        .mei-settings-item{position:relative;width:100%;display:flex;align-items:center;gap:9px;padding:8px 10px 8px 13px;background:transparent;border:none;border-radius:10px;color:var(--mei-text);cursor:pointer;font-size:13px;font-weight:550;text-align:left;transition:var(--mei-transition);}
        .mei-settings-item::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:2px;background:transparent;transition:var(--mei-transition);}
        .mei-settings-item:hover{background:rgba(23,32,56,0.05);}
        .mei-settings-item.danger{color:#dc2626;}
        .mei-settings-item.danger:hover{background:rgba(220,38,38,0.07);}
        .mei-settings-main{flex:1;min-width:0;overflow-y:auto;padding:28px 32px;}
        .mei-settings-welcome{max-width:860px;margin:0 auto;text-align:center;padding-top:20px;}
        .mei-settings-quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:26px;text-align:left;}
        .mei-settings-quick-card{background:var(--mei-surface);border:1px solid var(--mei-border);border-radius:var(--mei-radius-lg);padding:14px;box-shadow:var(--mei-shadow-sm);}
        .mei-settings-quick-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:1px;color:var(--mei-text-muted);text-transform:uppercase;margin-bottom:10px;}
        .mei-settings-quick-items{display:flex;flex-direction:column;gap:2px;}
        .mei-settings-quick-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border:none;border-radius:8px;background:transparent;font-size:12.5px;color:var(--mei-text);cursor:pointer;text-align:left;transition:var(--mei-transition);}
        .mei-settings-quick-item:hover{background:rgba(99,102,241,0.08);color:var(--mei-primary);}
        .mei-modal-mask{position:fixed;inset:0;z-index:100;background:rgba(10,14,26,0.45);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
        .mei-modal{width:380px;max-width:calc(100vw - 40px);background:rgba(255,255,255,0.97);border:1px solid var(--mei-border);border-radius:var(--mei-radius-lg);padding:20px;box-shadow:var(--mei-shadow-lg);}
        .mei-modal-icon{width:36px;height:36px;border-radius:10px;background:rgba(220,38,38,0.1);color:#dc2626;display:inline-flex;align-items:center;justify-content:center;}
        .mei-btn-ghost{padding:8px 18px;border-radius:var(--mei-radius-full);border:1px solid var(--mei-border-strong);background:transparent;font-size:13px;cursor:pointer;color:var(--mei-text);}
        .mei-btn-danger{padding:8px 18px;border-radius:var(--mei-radius-full);border:none;background:#dc2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;}
        @media(max-width:760px){
          .mei-settings-body{flex-direction:column;}
          .mei-settings-nav{width:100%;display:flex;gap:14px;overflow-x:auto;overflow-y:hidden;padding:var(--mei-space-2) var(--mei-space-3);border-right:none;border-bottom:1px solid var(--mei-border);}
          .mei-settings-group{margin-bottom:0;display:flex;align-items:center;gap:4px;flex-shrink:0;}
          .mei-settings-group-title{padding:0 6px 0 0;white-space:nowrap;}
          .mei-settings-item{width:auto;white-space:nowrap;padding:6px 10px;}
          .mei-settings-main{padding:var(--mei-space-3);}
        }
      `}</style>
    </div>
  );
}
