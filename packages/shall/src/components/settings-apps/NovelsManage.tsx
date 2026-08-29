'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  EmptyState,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  TextInput,
} from '@/components/SettingsUI';

// 小说站点管理（统一设置页）：复刻 third_party/tutorial/src/app/manage/page.tsx 的逻辑，
// 但 UI 全部走 SettingsUI，不再跳转到 tutorial 子应用。

interface SiteRow {
  id: number;
  slug: string;
  name: string;
  type: 'normal' | 'secret';
  icon: string;
  icon_color: string;
  description: string;
  hasPassword: boolean;
  created_at: string;
}

interface SiteForm {
  name: string;
  slug: string;
  type: 'normal' | 'secret';
  password: string;
  icon: string;
  iconColor: string;
  description: string;
}

const EMPTY_FORM: SiteForm = {
  name: '',
  slug: '',
  type: 'normal',
  password: '',
  icon: '',
  iconColor: '#6366f1',
  description: '',
};

async function parseError(res: Response): Promise<string> {
  const d = await res.json().catch(() => ({}));
  return (d as { error?: string }).error || `请求失败：HTTP ${res.status}`;
}

export default function NovelsManage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [masterPw, setMasterPw] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [form, setForm] = useState<SiteForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // 初次拉管理列表：403 = 未解锁（需主密码）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/novels/api/sites?manage=1', { credentials: 'include' });
        if (cancelled) return;
        if (res.status === 403) {
          setUnlocked(false);
          return;
        }
        if (!res.ok) throw new Error(await parseError(res));
        const data = await res.json();
        setSites(Array.isArray(data) ? (data as SiteRow[]) : []);
        setUnlocked(true);
      } catch (err) {
        setUnlockErr((err as Error).message || '无法连接到站点服务');
        setUnlocked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/novels/api/sites?manage=1', { credentials: 'include' });
      if (res.status === 403) {
        setUnlocked(false);
        setSites([]);
        return;
      }
      if (!res.ok) throw new Error(await parseError(res));
      const data = await res.json();
      setSites(Array.isArray(data) ? (data as SiteRow[]) : []);
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取站点列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function unlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUnlockErr('');
    setBusy(true);
    try {
      const res = await fetch('/novels/api/auth/unlock', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: masterPw }),
      });
      if (!res.ok) {
        setUnlockErr(res.status === 401 ? '主密码错误' : await parseError(res));
        return;
      }
      setUnlocked(true);
      setMasterPw('');
      await refresh();
    } catch (err) {
      setUnlockErr((err as Error).message || '解锁失败');
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setMode('create');
    setEditing(null);
    setForm(EMPTY_FORM);
    setMessage('');
    setError('');
  }

  function startEdit(site: SiteRow) {
    setMode('edit');
    setEditing(site);
    setForm({
      name: site.name,
      slug: site.slug,
      type: site.type,
      password: '',
      icon: site.icon || '',
      iconColor: site.icon_color || '#6366f1',
      description: site.description || '',
    });
    setMessage('');
    setError('');
  }

  function cancelForm() {
    setMode('idle');
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (mode === 'create') {
        const body: Record<string, string> = {
          name: form.name.trim(),
          slug: form.slug.trim(),
          type: form.type,
          icon: form.icon,
          iconColor: form.iconColor,
          description: form.description,
        };
        if (form.type === 'secret' && form.password) body.password = form.password;
        const res = await fetch('/novels/api/sites', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 403) {
          setUnlocked(false);
          setSites([]);
          setError('管理会话已过期，请重新解锁');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || '创建失败');
        setMessage(`站点「${(data as { name?: string }).name || form.name.trim()}」已创建`);
        cancelForm();
        await refresh();
      } else if (mode === 'edit' && editing) {
        const body: Record<string, string> = {
          name: form.name.trim(),
          slug: form.slug.trim(),
          icon: form.icon,
          iconColor: form.iconColor,
          description: form.description,
        };
        // 仅在填写了新密码时提交，留空表示不修改
        if (form.password) body.password = form.password;
        const res = await fetch(`/novels/api/sites/${encodeURIComponent(editing.slug)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 403) {
          setUnlocked(false);
          setSites([]);
          setError('管理会话已过期，请重新解锁');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || '保存失败');
        setMessage('已保存');
        cancelForm();
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function removeSite(site: SiteRow) {
    if (!confirm(`删除站点「${site.name}」？站内所有小说与章节将一并删除，不可恢复。`)) return;
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/novels/api/sites?slug=${encodeURIComponent(site.slug)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 403) {
        setUnlocked(false);
        setSites([]);
        setError('管理会话已过期，请重新解锁');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || '删除失败');
      setMessage(`站点「${site.name}」已删除`);
      await refresh();
    } catch (err) {
      setError((err as Error).message || '删除失败');
    }
  }

  function renderSiteIcon(site: SiteRow) {
    const bg = site.icon_color || 'linear-gradient(135deg,#6366f1,#a855f7)';
    if (site.icon && /^(https?:)?\//.test(site.icon)) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={site.icon} alt="" className="site-icon" style={{ background: bg }} />;
    }
    const isEmoji = !!site.icon && !site.icon.includes(':');
    return (
      <span className="site-icon" style={{ background: bg, color: isEmoji ? undefined : '#fff' }}>
        {isEmoji ? site.icon : site.name.slice(0, 1)}
      </span>
    );
  }

  // ---- 未解锁 ----
  if (unlocked === null) {
    return (
      <SettingsPage icon="lucide:book-open" title="小说站点管理" description="管理小说站点的创建、编辑与删除。">
        <SettingsSection title="加载中">
          <EmptyState title="正在读取站点列表…" />
        </SettingsSection>
      </SettingsPage>
    );
  }

  if (!unlocked) {
    return (
      <SettingsPage icon="lucide:book-open" title="小说站点管理" description="输入主密码解锁管理功能。">
        <form onSubmit={unlock}>
          <SettingsSection title="解锁管理" description="站点管理需要主密码（与门户管理密码一致）。">
            <SettingsField label="主密码">
              <TextInput
                type="password"
                value={masterPw}
                onChange={(e) => setMasterPw(e.target.value)}
                placeholder="主密码"
                autoFocus
              />
            </SettingsField>
            {unlockErr ? <Alert tone="error" title={unlockErr} /> : null}
            <div className="mei-footer-actions">
              <SettingsButton variant="primary" type="submit" disabled={busy || !masterPw}>
                解锁
              </SettingsButton>
            </div>
          </SettingsSection>
        </form>
      </SettingsPage>
    );
  }

  // ---- 已解锁 ----
  const canSubmit =
    form.name.trim() !== '' && (mode === 'edit' || form.type !== 'secret' || form.password !== '');

  return (
    <SettingsPage
      icon="lucide:book-open"
      title="小说站点管理"
      description="管理小说站点的创建、编辑与删除。"
      actions={
        <>
          <Pill tone="success">已解锁</Pill>
          <SettingsButton onClick={() => void refresh()} disabled={loading}>
            刷新
          </SettingsButton>
          <SettingsButton variant="primary" onClick={() => (mode === 'create' ? cancelForm() : startCreate())}>
            {mode === 'create' ? '取消新建' : '新建站点'}
          </SettingsButton>
        </>
      }
    >
      {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}

      <SettingsSection title="站点列表" description="隐秘站点需开启密码才能访问。">
        {loading && sites.length === 0 ? (
          <EmptyState title="正在读取站点列表…" />
        ) : sites.length === 0 ? (
          <EmptyState title="暂无站点" description="点击右上角「新建站点」创建第一个小说站点。" />
        ) : (
          <div className="source-grid">
            {sites.map((site) => (
              <article key={site.id}>
                <header>
                  <div className="site-head">
                    {renderSiteIcon(site)}
                    <div>
                      <strong>{site.name}</strong>
                      <Pill tone={site.type === 'secret' ? 'warning' : 'success'}>
                        {site.type === 'secret' ? '隐秘' : '普通'}
                      </Pill>
                    </div>
                  </div>
                </header>
                <p className="site-meta">
                  标识 <code>/{site.slug}</code> · 路径 <code>/novels/s/{site.slug}</code>
                </p>
                {site.description ? <p className="site-desc">{site.description}</p> : null}
                <footer>
                  <span>
                    {site.type === 'secret' ? (site.hasPassword ? '已设开启密码' : '未设密码') : '公开访问'}
                  </span>
                  <div>
                    <SettingsButton onClick={() => startEdit(site)}>编辑</SettingsButton>
                    <SettingsButton variant="danger" onClick={() => void removeSite(site)}>
                      删除
                    </SettingsButton>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </SettingsSection>

      {mode !== 'idle' ? (
        <SettingsSection
          title={mode === 'create' ? '新建站点' : `编辑站点：${editing?.name ?? ''}`}
          description={mode === 'create' ? '站点类型创建后不可修改。' : '类型不可修改；修改标识后旧路径将失效。'}
          actions={<SettingsButton variant="ghost" onClick={cancelForm}>取消</SettingsButton>}
        >
          <form onSubmit={submit}>
            <div className="mei-grid">
              <SettingsField label="显示名称" hint="必填">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：天一阁"
                />
              </SettingsField>
              <SettingsField
                label="标识"
                hint={mode === 'create' ? '路径用，留空自动生成' : '修改后旧路径失效'}
              >
                <TextInput
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                  placeholder="如：tianyi（小写字母/数字/中划线）"
                />
              </SettingsField>
            </div>

            {/* 类型用两个按钮切换，不用 Select；编辑态只读 */}
            <div className="mei-field span">
              <span>站点类型</span>
              <div className="type-toggle">
                <button
                  type="button"
                  className={form.type === 'normal' ? 'active' : ''}
                  onClick={() => setForm({ ...form, type: 'normal' })}
                  disabled={mode === 'edit'}
                >
                  <strong>普通站点</strong>
                  <small>公开可访问，无需密码</small>
                </button>
                <button
                  type="button"
                  className={form.type === 'secret' ? 'active' : ''}
                  onClick={() => setForm({ ...form, type: 'secret' })}
                  disabled={mode === 'edit'}
                >
                  <strong>隐秘站点</strong>
                  <small>需要开启密码才能访问</small>
                </button>
              </div>
              <small>类型创建后不可修改{mode === 'edit' ? '，当前为只读' : ''}</small>
            </div>

            {form.type === 'secret' ? (
              <SettingsField label="开启密码" hint="开启方式：门户首页搜索框输入 open:标识:密码">
                <TextInput
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={mode === 'edit' ? '留空不修改' : '隐秘站点的开启密码'}
                />
              </SettingsField>
            ) : null}

            <div className="mei-grid">
              <SettingsField label="图标" hint="emoji 或图片地址">
                <TextInput
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="如：📚 或 https://…/logo.png"
                />
              </SettingsField>
              <SettingsField label="图标底色" hint={form.iconColor}>
                <input
                  type="color"
                  value={form.iconColor}
                  onChange={(e) => setForm({ ...form, iconColor: e.target.value })}
                  className="mei-color-input"
                  aria-label="图标底色"
                />
              </SettingsField>
            </div>

            <SettingsField label="站点描述" span>
              <TextInput
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="一句话介绍这个小说站点"
              />
            </SettingsField>

            <div className="mei-footer-actions">
              <SettingsButton variant="primary" type="submit" disabled={busy || !canSubmit}>
                {mode === 'create' ? '创建' : '保存'}
              </SettingsButton>
            </div>
          </form>
        </SettingsSection>
      ) : null}

      <style>{`
        .source-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
        .source-grid article{padding:14px;border:1px solid var(--mei-border);border-radius:16px;background:rgba(255,255,255,.6);display:flex;flex-direction:column;gap:9px;min-width:0;}
        .source-grid header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
        .source-grid .site-head{display:flex;align-items:center;gap:10px;min-width:0;}
        .source-grid .site-head>div{display:flex;align-items:center;gap:7px;min-width:0;}
        .source-grid strong{font-size:13px;font-weight:780;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .source-grid .site-icon{width:36px;height:36px;border-radius:10px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;color:#fff;}
        .source-grid img.site-icon{object-fit:cover;display:block;}
        .source-grid .site-meta{margin:0;font-size:11px;color:var(--mei-text-muted);word-break:break-all;line-height:1.5;}
        .source-grid .site-meta code{background:rgba(99,102,241,.1);color:var(--mei-primary);padding:1px 5px;border-radius:5px;font-size:10.5px;font-family:ui-monospace,SFMono-Regular,monospace;}
        .source-grid .site-desc{margin:0;font-size:11.5px;color:var(--mei-text-muted);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .source-grid footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:auto;}
        .source-grid footer>span{font-size:11px;color:var(--mei-text-muted);}
        .source-grid footer>div{display:flex;gap:6px;flex-shrink:0;}
        .type-toggle{display:flex;gap:10px;}
        .type-toggle button{flex:1;display:flex;flex-direction:column;gap:3px;align-items:flex-start;padding:11px 14px;border-radius:13px;border:1px solid var(--mei-border-strong);background:rgba(255,255,255,.6);cursor:pointer;text-align:left;transition:var(--mei-transition);font-family:inherit;}
        .type-toggle button:hover:not(:disabled){border-color:rgba(99,102,241,.4);}
        .type-toggle button strong{font-size:13px;font-weight:750;color:var(--mei-text);}
        .type-toggle button small{font-size:11px;color:var(--mei-text-muted);line-height:1.4;}
        .type-toggle button.active{border-color:var(--mei-primary);background:rgba(99,102,241,.08);}
        .type-toggle button.active strong{color:var(--mei-primary);}
        .type-toggle button:disabled{opacity:.6;cursor:not-allowed;}
        .mei-color-input{width:38px;height:38px;border-radius:10px;border:1px solid var(--mei-border-strong);background:transparent;cursor:pointer;padding:2px;}
      `}</style>
    </SettingsPage>
  );
}
