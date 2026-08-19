'use client';
// 主页设置 —— 全量复刻 Sun-Panel 管理能力
// 分区：风格设置（背景/Logo/时钟/搜索/图标样式/边距/页脚/监控）/ 分组管理 / 图标项管理（图标上传/拖拽排序/双地址）/ 导入导出
import { useCallback, useEffect, useRef, useState } from 'react';
import MeiIcon from '@/components/MeiIcon';
import type { PanelConfig, PanelItem, PanelGroup } from '@/lib/panel-store';

type Tab = 'style' | 'groups' | 'items' | 'backup';

export default function HomeEditorClient() {
  const [config, setConfig] = useState<PanelConfig | null>(null);
  const [tab, setTab] = useState<Tab>('style');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/panel', { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function save(next: PanelConfig) {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/panel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(body.error || '保存失败'); return; }
      setConfig(body.config || next);
      setMessage('已保存，刷新首页生效');
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !config) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--mei-text-muted)' }}>加载中…</div>;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'style', label: '风格设置' },
    { id: 'groups', label: '分组管理' },
    { id: 'items', label: '图标项管理' },
    { id: 'backup', label: '导入导出' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--mei-bg)', color: 'var(--mei-text)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 80px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 750, margin: '0 0 4px' }}>主页设置</h1>
        <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', margin: '0 0 16px' }}>
          内置应用由系统自动管理；此处管理主页风格、分组与自定义应用/链接。
        </p>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '7px 16px',
                borderRadius: 'var(--mei-radius-full)',
                border: '1px solid ' + (tab === t.id ? 'transparent' : 'var(--mei-border-strong)'),
                background: tab === t.id ? 'var(--mei-gradient)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--mei-text-muted)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'style' && <StyleTab config={config} setConfig={setConfig} />}
        {tab === 'groups' && <GroupsTab config={config} setConfig={setConfig} />}
        {tab === 'items' && <ItemsTab config={config} setConfig={setConfig} />}
        {tab === 'backup' && <BackupTab config={config} reload={reload} />}

        {/* 保存条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', bottom: 12 }}>
          <button
            onClick={() => save(config)}
            disabled={saving}
            style={{
              padding: '10px 26px', borderRadius: 'var(--mei-radius-full)', border: 'none',
              background: 'var(--mei-gradient)', color: '#fff', fontSize: 14, fontWeight: 650,
              cursor: 'pointer', boxShadow: 'var(--mei-glow)', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
          {message && (
            <span style={{ fontSize: 12, color: message.includes('失败') ? 'var(--mei-danger)' : 'var(--mei-success)' }}>{message}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== 风格设置 ==================== */
function StyleTab({ config, setConfig }: { config: PanelConfig; setConfig: (c: PanelConfig) => void }) {
  const setStyle = (patch: Partial<PanelConfig['style']>) =>
    setConfig({ ...config, style: { ...config.style, ...patch } });
  const setBg = (patch: Partial<PanelConfig['background']>) =>
    setConfig({ ...config, background: { ...config.background, ...patch } });

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10,
    fontSize: 13, border: '1px solid var(--mei-border-strong)', outline: 'none',
    color: 'var(--mei-text)', background: '#fff',
  };
  const card: React.CSSProperties = {
    background: 'var(--mei-surface)', border: '1px solid var(--mei-border)',
    borderRadius: 'var(--mei-radius)', padding: 16, marginBottom: 14,
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--mei-text-muted)', marginBottom: 4 };

  const readImageFile = (file: File, cb: (dataUrl: string) => void) => {
    if (file.size > 30 * 1024 * 1024) { alert('图片过大（>30MB）'); return; }
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <>
      <section style={card}>
        <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 12px' }}>背景图</h2>
        <label style={label}>图片地址（留空使用默认极光背景）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={input} placeholder="https://example.com/wallpaper.jpg" value={config.background.url} onChange={(e) => setBg({ url: e.target.value })} />
          <label style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--mei-border-strong)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            上传
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readImageFile(f, (d) => setBg({ url: d })); }} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <div>
            <label style={label}>遮罩不透明度：{config.background.mask.toFixed(2)}</label>
            <input type="range" min={0} max={0.9} step={0.05} value={config.background.mask} style={{ width: '100%' }} onChange={(e) => setBg({ mask: Number(e.target.value) })} />
          </div>
          <div>
            <label style={label}>背景模糊：{config.background.blur}px</label>
            <input type="range" min={0} max={24} step={1} value={config.background.blur} style={{ width: '100%' }} onChange={(e) => setBg({ blur: Number(e.target.value) })} />
          </div>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 12px' }}>Logo 与时钟</h2>
        <label style={label}>Logo 文字</label>
        <input style={input} value={config.style.logoText} onChange={(e) => setStyle({ logoText: e.target.value })} placeholder="留空则不显示" />
        <label style={{ ...label, marginTop: 10 }}>Logo 图片（优先于文字）</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={input} placeholder="图片地址或上传" value={config.style.logoImage} onChange={(e) => setStyle({ logoImage: e.target.value })} />
          <label style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--mei-border-strong)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            上传
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readImageFile(f, (d) => setStyle({ logoImage: d })); }} />
          </label>
          {config.style.logoImage && (
            <button onClick={() => setStyle({ logoImage: '' })} style={{ border: 'none', background: 'transparent', color: 'var(--mei-danger)', fontSize: 12, cursor: 'pointer' }}>清除</button>
          )}
        </div>
        <label style={{ ...label, marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config.style.clockShowSecond} onChange={(e) => setStyle({ clockShowSecond: e.target.checked })} />
          时钟显示秒
        </label>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 12px' }}>搜索框</h2>
        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config.style.searchBoxShow} onChange={(e) => setStyle({ searchBoxShow: e.target.checked })} />
          显示搜索框（过滤应用/链接；无匹配回车跳转网页搜索）
        </label>
        <label style={{ ...label, marginTop: 8 }}>网页搜索引擎</label>
        <select style={input} value={config.style.searchEngine} onChange={(e) => setStyle({ searchEngine: e.target.value as PanelConfig['style']['searchEngine'] })}>
          <option value="bing">必应</option>
          <option value="google">Google</option>
          <option value="baidu">百度</option>
          <option value="duckduckgo">DuckDuckGo</option>
        </select>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 12px' }}>图标样式与布局</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div>
            <label style={label}>卡片样式</label>
            <select style={input} value={config.style.iconStyle} onChange={(e) => setStyle({ iconStyle: e.target.value as 'icon' | 'info' })}>
              <option value="info">详情（图标+标题+描述）</option>
            </select>
          </div>
          <div>
            <label style={label}>图标文字颜色（壁纸场景可调白）</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={config.style.iconTextColor || '#1c2333'} onChange={(e) => setStyle({ iconTextColor: e.target.value })} style={{ width: 44, height: 34, border: '1px solid var(--mei-border-strong)', borderRadius: 8, background: '#fff', cursor: 'pointer' }} />
              {config.style.iconTextColor && (
                <button onClick={() => setStyle({ iconTextColor: '' })} style={{ border: 'none', background: 'transparent', color: 'var(--mei-danger)', fontSize: 12, cursor: 'pointer' }}>重置</button>
              )}
            </div>
          </div>
          <div>
            <label style={label}>顶部边距 %：{config.style.marginTop}</label>
            <input type="range" min={0} max={30} value={config.style.marginTop} style={{ width: '100%' }} onChange={(e) => setStyle({ marginTop: Number(e.target.value) })} />
          </div>
          <div>
            <label style={label}>底部边距 %：{config.style.marginBottom}</label>
            <input type="range" min={0} max={30} value={config.style.marginBottom} style={{ width: '100%' }} onChange={(e) => setStyle({ marginBottom: Number(e.target.value) })} />
          </div>
          <div>
            <label style={label}>左右边距 px：{config.style.marginX}</label>
            <input type="range" min={0} max={100} value={config.style.marginX} style={{ width: '100%' }} onChange={(e) => setStyle({ marginX: Number(e.target.value) })} />
          </div>
          <div>
            <label style={label}>内容最大宽度 px：{config.style.maxWidth}</label>
            <input type="range" min={600} max={2000} step={20} value={config.style.maxWidth} style={{ width: '100%' }} onChange={(e) => setStyle({ maxWidth: Number(e.target.value) })} />
          </div>
        </div>
        <label style={{ ...label, marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config.style.systemMonitorShow} onChange={(e) => setStyle({ systemMonitorShow: e.target.checked })} />
          显示系统监控（内存/CPU 负载，5s 刷新）
        </label>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 12px' }}>页脚 HTML</h2>
        <textarea
          style={{ ...input, minHeight: 64, resize: 'vertical' }}
          placeholder="自定义页脚 HTML（默认空）"
          value={config.style.footerHtml}
          onChange={(e) => setStyle({ footerHtml: e.target.value })}
        />
      </section>
    </>
  );
}

/* ==================== 分组管理 ==================== */
function GroupsTab({ config, setConfig }: { config: PanelConfig; setConfig: (c: PanelConfig) => void }) {
  const [name, setName] = useState('');
  const input: React.CSSProperties = {
    flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13,
    border: '1px solid var(--mei-border-strong)', outline: 'none', color: 'var(--mei-text)', background: '#fff',
  };

  const move = (idx: number, dir: -1 | 1) => {
    const groups = [...config.groups];
    const j = idx + dir;
    if (j < 0 || j >= groups.length) return;
    [groups[idx], groups[j]] = [groups[j], groups[idx]];
    setConfig({ ...config, groups });
  };

  return (
    <section style={{ background: 'var(--mei-surface)', border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius)', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input style={input} placeholder="新分组名称" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          onClick={() => {
            if (!name.trim()) return;
            setConfig({ ...config, groups: [...config.groups, { id: `g${Date.now()}`, name: name.trim() }] });
            setName('');
          }}
          style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--mei-gradient)', color: '#fff', fontSize: 13, cursor: 'pointer' }}
        >
          添加分组
        </button>
      </div>
      {config.groups.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', textAlign: 'center', padding: '14px 0' }}>暂无分组，自定义项将显示在「其他链接」</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {config.groups.map((g, idx) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--mei-border)', background: 'rgba(255,255,255,0.6)' }}>
              <MeiIcon icon="lucide:library" size={16} />
              <input
                value={g.name}
                onChange={(e) => setConfig({ ...config, groups: config.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })}
                style={{ ...input, border: 'none', background: 'transparent', padding: '4px 0', fontWeight: 600 }}
              />
              <span style={{ fontSize: 11, color: 'var(--mei-text-faint)' }}>{config.items.filter((i) => i.groupId === g.id).length} 项</span>
              <button onClick={() => move(idx, -1)} title="上移" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mei-text-muted)' }}>↑</button>
              <button onClick={() => move(idx, 1)} title="下移" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mei-text-muted)' }}>↓</button>
              <button
                onClick={() => {
                  if (!confirm(`删除分组「${g.name}」？组内 ${config.items.filter((i) => i.groupId === g.id).length} 个项将移至未分组。`)) return;
                  setConfig({ ...config, groups: config.groups.filter((x) => x.id !== g.id), items: config.items.map((i) => (i.groupId === g.id ? { ...i, groupId: '' } : i)) });
                }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mei-danger)', fontSize: 12 }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ==================== 图标项管理 ==================== */
function ItemsTab({ config, setConfig }: { config: PanelConfig; setConfig: (c: PanelConfig) => void }) {
  const [editing, setEditing] = useState<PanelItem | null>(null);
  const dragIdx = useRef<number | null>(null);

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10,
    fontSize: 13, border: '1px solid var(--mei-border-strong)', outline: 'none',
    color: 'var(--mei-text)', background: '#fff',
  };

  const readImageFile = (file: File, cb: (dataUrl: string) => void) => {
    if (file.size > 30 * 1024 * 1024) { alert('图标过大（>30MB）'); return; }
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result));
    reader.readAsDataURL(file);
  };

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= config.items.length) return;
    const items = [...config.items];
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    setConfig({ ...config, items });
  };

  const isImg = (s: string) => /^https?:\/\//.test(s) || s.startsWith('data:image/');

  return (
    <section style={{ background: 'var(--mei-surface)', border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={() => setEditing({ id: '', groupId: '', title: '', description: '', url: '', lanUrl: '', icon: 'lucide:link' })}
          style={{ padding: '6px 16px', borderRadius: 'var(--mei-radius-full)', border: '1px solid var(--mei-primary)', background: 'transparent', color: 'var(--mei-primary)', fontSize: 13, cursor: 'pointer' }}
        >
          + 添加图标项
        </button>
      </div>

      {editing && (
        <div style={{ border: '1px dashed var(--mei-border-strong)', borderRadius: 12, padding: 14, marginBottom: 14, display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={input} placeholder="标题（必填）" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <select style={input} value={editing.groupId} onChange={(e) => setEditing({ ...editing, groupId: e.target.value })}>
              <option value="">未分组</option>
              {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <input style={input} placeholder="描述（可选）" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={input} placeholder="地址（https://… 或 /path，必填）" value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
            <input style={input} placeholder="内网地址（可选，内网模式优先）" value={editing.lanUrl} onChange={(e) => setEditing({ ...editing, lanUrl: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...input, flex: 1 }} placeholder="图标（lucide:github 等）或图片地址" value={isImg(editing.icon) ? '' : editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} />
            <label style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--mei-border-strong)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              上传图标
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readImageFile(f, (d) => setEditing({ ...editing, icon: d })); }} />
            </label>
            <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--mei-text-muted)' }}>
              {isImg(editing.icon)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={editing.icon} alt="icon" style={{ width: 22, height: 22, objectFit: 'contain' }} />
                : <MeiIcon icon={editing.icon || 'lucide:link'} size={20} />}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditing(null)} style={{ padding: '7px 16px', borderRadius: 10, border: '1px solid var(--mei-border)', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>取消</button>
            <button
              onClick={() => {
                if (!editing.title.trim() || !editing.url.trim()) return;
                const item = { ...editing, id: editing.id || `c${Date.now()}` };
                const exists = config.items.some((i) => i.id === item.id);
                setConfig({ ...config, items: exists ? config.items.map((i) => (i.id === item.id ? item : i)) : [...config.items, item] });
                setEditing(null);
              }}
              style={{ padding: '7px 16px', borderRadius: 10, border: 'none', background: 'var(--mei-gradient)', color: '#fff', fontSize: 13, cursor: 'pointer' }}
            >
              {editing.id ? '保存修改' : '添加'}
            </button>
          </div>
        </div>
      )}

      {config.items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', textAlign: 'center', padding: '14px 0' }}>
          暂无自定义图标项（内置应用由系统自动管理）
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {config.items.map((item, idx) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIdx.current !== null && dragIdx.current !== idx) moveItem(dragIdx.current, idx); dragIdx.current = null; }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 10, border: '1px solid var(--mei-border)', background: 'rgba(255,255,255,0.6)',
                cursor: 'grab',
              }}
            >
              <span style={{ color: 'var(--mei-text-faint)', fontSize: 11, cursor: 'grab' }} title="拖拽排序">⠿</span>
              {isImg(item.icon)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.icon} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                : <MeiIcon icon={item.icon || 'lucide:link'} size={17} />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</span>
              {item.lanUrl && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'rgba(99,102,241,0.1)', color: 'var(--mei-primary)' }}>双地址</span>}
              <span style={{ fontSize: 11, color: 'var(--mei-text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.url}
              </span>
              <button onClick={() => moveItem(idx, -1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mei-text-muted)' }}>↑</button>
              <button onClick={() => moveItem(idx, 1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mei-text-muted)' }}>↓</button>
              <button onClick={() => setEditing(item)} style={{ border: 'none', background: 'transparent', color: 'var(--mei-primary)', fontSize: 12, cursor: 'pointer' }}>编辑</button>
              <button
                onClick={() => { if (confirm(`删除「${item.title}」？`)) setConfig({ ...config, items: config.items.filter((i) => i.id !== item.id) }); }}
                style={{ border: 'none', background: 'transparent', color: 'var(--mei-danger)', fontSize: 12, cursor: 'pointer' }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ==================== 导入导出 ==================== */
function BackupTab({ config, reload }: { config: PanelConfig; reload: () => void }) {
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function doImport(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/panel', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(parsed),
      });
      if (!res.ok) { setMsg('导入失败：格式不正确'); return; }
      setMsg('导入成功');
      reload();
    } catch {
      setMsg('导入失败：JSON 解析错误');
    }
  }

  function doExport() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mei-panel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const btn: React.CSSProperties = {
    padding: '10px 20px', borderRadius: 'var(--mei-radius-full)', fontSize: 13,
    cursor: 'pointer', border: '1px solid var(--mei-border-strong)', background: 'transparent', color: 'var(--mei-text)',
  };

  return (
    <section style={{ background: 'var(--mei-surface)', border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius)', padding: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 6px' }}>配置备份与恢复</h2>
      <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', margin: '0 0 14px' }}>
        导出当前主页配置（风格/分组/图标项）为 JSON；导入将覆盖现有配置。
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={doExport} style={{ ...btn, border: 'none', background: 'var(--mei-gradient)', color: '#fff' }}>导出配置</button>
        <button onClick={() => fileRef.current?.click()} style={btn}>导入配置</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); }} />
      </div>
      {msg && <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', marginTop: 10 }}>{msg}</p>}
    </section>
  );
}
