'use client';
// 设置中心共享外壳：左侧设置菜单栏（始终在）+ 右侧内容容器
// 完整的左右布局，无页面 header；所有设置子页都在右侧容器里渲染
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MeiIcon from '@/components/MeiIcon';
import { SETTING_GROUPS } from '@/lib/settings-entries';
import { settingsUiStyles } from '@/components/SettingsUI';

export default function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [logoutOpen, setLogoutOpen] = useState(false);

  async function doLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    window.location.href = '/login';
  }

  const isActive = (url: string) => {
    if (url.startsWith('/settings') || url.startsWith('/home-editor')) {
      return pathname === url || pathname.startsWith(url + '/');
    }
    return false;
  };

  return (
    <div className="mei-shell-root">
      {/* 极光动态背景 */}
      <div className="mei-aurora" aria-hidden>
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      <div className="mei-shell-body">
        {/* 左侧设置菜单栏（始终在） */}
        <nav className="mei-shell-nav">
          <button className="mei-shell-home" onClick={() => router.push('/')} title="返回主页">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" />
            <span>
              <strong>Mei AllIn</strong>
              <small>应用门户</small>
            </span>
          </button>
          {SETTING_GROUPS.map((g) => (
            <div key={g.id} className="mei-shell-group">
              <div className="mei-shell-group-title">
                <MeiIcon icon={g.icon} size={14} />
                {g.label}
              </div>
              {g.entries.map((e) => (
                <button
                  key={e.id}
                  onClick={() => (e.action === 'logout' ? setLogoutOpen(true) : router.push(e.url))}
                  className={`mei-shell-item${e.action === 'logout' ? ' danger' : ''}${isActive(e.url) ? ' active' : ''}`}
                >
                  <MeiIcon icon={e.icon} size={15} />
                  {e.name}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* 右侧内容容器：所有设置项在此渲染 */}
        <main className="mei-shell-main">{children}</main>
      </div>

      {/* 退出登录确认弹层 */}
      {logoutOpen && (
        <div className="mei-modal-mask" onClick={() => setLogoutOpen(false)}>
          <div className="mei-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mei-modal-head">
              <span className="mei-modal-icon">
                <MeiIcon icon="lucide:log-out" size={18} />
              </span>
              <span className="mei-modal-title">退出登录</span>
            </div>
            <p className="mei-modal-text">
              确定要退出当前账号吗？退出后需要重新登录才能访问门户。
            </p>
            <div className="mei-modal-foot">
              <button onClick={() => setLogoutOpen(false)} className="mei-btn-ghost">取消</button>
              <button onClick={doLogout} className="mei-btn-danger">退出登录</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mei-shell-root{height:100vh;display:flex;flex-direction:column;overflow:hidden;}
        .mei-shell-body{flex:1;display:flex;min-height:0;position:relative;z-index:5;}
        .mei-shell-nav{width:236px;flex-shrink:0;padding:var(--mei-space-4);background:var(--mei-surface);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border-right:1px solid var(--mei-border);overflow-y:auto;}
        .mei-shell-home{width:100%;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:8px;border:none;border-radius:15px;background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(14,165,233,.09));cursor:pointer;text-align:left;transition:var(--mei-transition);}
        .mei-shell-home:hover{transform:translateY(-1px);box-shadow:0 12px 26px rgba(79,70,229,.13);background:linear-gradient(135deg,rgba(99,102,241,.16),rgba(14,165,233,.12));}
        .mei-shell-home img{width:31px;height:31px;border-radius:11px;}
        .mei-shell-home span{display:flex;flex-direction:column;min-width:0;}
        .mei-shell-home strong{font-size:13px;font-weight:850;letter-spacing:-.2px;}
        .mei-shell-home small{font-size:10.5px;color:var(--mei-text-muted);}
        .mei-shell-group{margin-bottom:var(--mei-space-4);}
        .mei-shell-group-title{display:flex;align-items:center;gap:7px;padding:4px 8px 6px;font-size:10.5px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:var(--mei-text-faint);border-bottom:1px solid var(--mei-border);margin-bottom:6px;}
        .mei-shell-item{position:relative;width:100%;display:flex;align-items:center;gap:9px;padding:8px 10px 8px 13px;background:transparent;border:none;border-radius:10px;color:var(--mei-text);cursor:pointer;font-size:13px;font-weight:550;text-align:left;transition:var(--mei-transition);}
        .mei-shell-item::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:2px;background:transparent;transition:var(--mei-transition);}
        .mei-shell-item:hover{background:rgba(23,32,56,0.05);}
        .mei-shell-item.active{background:var(--mei-gradient-soft);color:var(--mei-primary);font-weight:700;}
        .mei-shell-item.active::before{background:var(--mei-primary);}
        .mei-shell-item.danger{color:#dc2626;}
        .mei-shell-item.danger:hover{background:rgba(220,38,38,0.07);}
        .mei-shell-main{flex:1;min-width:0;overflow-y:auto;padding:24px 28px;}
        .mei-modal-mask{position:fixed;inset:0;z-index:100;background:rgba(10,14,26,0.45);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
        .mei-modal{width:380px;max-width:calc(100vw - 40px);background:rgba(255,255,255,0.97);border:1px solid var(--mei-border);border-radius:var(--mei-radius-lg);padding:20px;box-shadow:var(--mei-shadow-lg);}
.mei-modal-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.mei-modal-title{font-size:15px;font-weight:700;}
.mei-modal-text{font-size:13px;color:var(--mei-text-muted);margin:0 0 16px;}
.mei-modal-foot{display:flex;gap:10px;justify-content:flex-end;}
        .mei-modal-icon{width:36px;height:36px;border-radius:10px;background:rgba(220,38,38,0.1);color:#dc2626;display:inline-flex;align-items:center;justify-content:center;}
        .mei-btn-ghost{padding:8px 18px;border-radius:var(--mei-radius-full);border:1px solid var(--mei-border-strong);background:transparent;font-size:13px;cursor:pointer;color:var(--mei-text);}
        .mei-btn-danger{padding:8px 18px;border-radius:var(--mei-radius-full);border:none;background:#dc2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;}
        @media(max-width:760px){
          .mei-shell-body{flex-direction:column;}
          .mei-shell-nav{width:100%;display:flex;gap:14px;overflow-x:auto;overflow-y:hidden;padding:var(--mei-space-2) var(--mei-space-3);border-right:none;border-bottom:1px solid var(--mei-border);}
          .mei-shell-home{width:auto;flex-shrink:0;margin-bottom:0;padding:5px 8px;}
          .mei-shell-home span{display:none;}
          .mei-shell-group{margin-bottom:0;display:flex;align-items:center;gap:4px;flex-shrink:0;}
          .mei-shell-group-title{padding:0 6px 0 0;white-space:nowrap;}
          .mei-shell-group-title{border-bottom:none;margin-bottom:0;}
          .mei-shell-item{width:auto;white-space:nowrap;padding:6px 10px;}
          .mei-shell-main{padding:var(--mei-space-3);}
        }
      `}
      ${settingsUiStyles}</style>
    </div>
  );
}
