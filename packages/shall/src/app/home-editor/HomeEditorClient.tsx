'use client';
// 主页设置 —— 全量复刻 Sun-Panel 管理能力
// 分区：风格设置（背景/Logo/时钟/搜索/图标样式/边距/页脚/监控）/ 分组管理 / 图标项管理（图标上传/拖拽排序/双地址）/ 导入导出
import { useCallback, useEffect, useRef, useState } from 'react';
import MeiIcon from '@/components/MeiIcon';
import 'iconify-icon';
import type { PanelConfig, PanelItem, PanelGroup } from '@/lib/panel-store';
import { PRESET_GROUP_IDS } from '@/lib/panel-presets';

type Tab = 'style' | 'groups' | 'backup';

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

  const tabs: { id: Tab; label: string; icon: string; desc: string }[] = [
    { id: 'style', label: '风格设置', icon: 'lucide:palette', desc: '背景 / Logo / 布局' },
    { id: 'groups', label: '分组管理', icon: 'lucide:folder', desc: '分组与拖拽排序' },
    { id: 'backup', label: '导入导出', icon: 'lucide:database', desc: '配置备份恢复' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--mei-bg)', color: 'var(--mei-text)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 24px 120px' }}>
        {/* 页头 */}
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', letterSpacing: 0.3 }}>主页设置</h1>
          <p style={{ fontSize: 12.5, color: 'var(--mei-text-muted)', margin: 0 }}>
            内置应用由系统自动管理；此处管理主页风格、分组与自定义应用/链接。
          </p>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* 侧边导航 */}
          <nav
            style={{
              width: 168, flexShrink: 0, position: 'sticky', top: 76,
              background: 'var(--mei-surface)', border: '1px solid var(--mei-border)',
              borderRadius: 'var(--mei-radius-lg)', padding: 8,
              display: 'flex', flexDirection: 'column', gap: 4,
              boxShadow: 'var(--mei-shadow-sm)',
            }}
          >
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '10px 12px', borderRadius: 'var(--mei-radius)',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: active ? 'var(--mei-gradient)' : 'transparent',
                    color: active ? '#fff' : 'var(--mei-text)',
                    boxShadow: active ? 'var(--mei-glow)' : 'none',
                    transition: 'var(--mei-transition)',
                  }}
                >
                  <MeiIcon icon={t.icon} size={17} />
                  <span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: active ? 700 : 550 }}>{t.label}</span>
                    <span style={{ display: 'block', fontSize: 10.5, opacity: active ? 0.85 : 0.55, marginTop: 1 }}>{t.desc}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* 内容区 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {tab === 'style' && <StyleTab config={config} setConfig={setConfig} />}
            {tab === 'groups' && <GroupsTab config={config} setConfig={setConfig} />}
            {tab === 'backup' && <BackupTab config={config} reload={reload} />}
          </div>
        </div>

        {/* 悬浮保存条（毛玻璃） */}
        <div
          style={{
            position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '10px 12px 10px 22px', borderRadius: 'var(--mei-radius-full)',
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(20px) saturate(1.5)',
            border: '1px solid var(--mei-border)', boxShadow: 'var(--mei-shadow)',
            zIndex: 60,
          }}
        >
          {message ? (
            <span style={{ fontSize: 12.5, color: message.includes('失败') ? 'var(--mei-danger)' : 'var(--mei-success)' }}>{message}</span>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--mei-text-faint)' }}>修改后记得保存</span>
          )}
          <button
            onClick={() => save(config)}
            disabled={saving}
            style={{
              padding: '9px 24px', borderRadius: 'var(--mei-radius-full)', border: 'none',
              background: 'var(--mei-gradient)', color: '#fff', fontSize: 13.5, fontWeight: 650,
              cursor: 'pointer', boxShadow: 'var(--mei-glow)', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
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
        <label style={{ ...label, marginTop: 10 }}>Logo 图片（优先于文字，留空使用默认 Logo）</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 默认/当前 Logo 预览 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={config.style.logoImage || '/logo.svg'} alt="logo" style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'contain', border: '1px solid var(--mei-border)', background: '#fff', flexShrink: 0 }} />
          <input style={input} placeholder="图片地址或上传（留空 = 默认 Logo）" value={config.style.logoImage} onChange={(e) => setStyle({ logoImage: e.target.value })} />
          <label style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--mei-border-strong)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            上传
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readImageFile(f, (d) => setStyle({ logoImage: d })); }} />
          </label>
          {config.style.logoImage && (
            <button onClick={() => setStyle({ logoImage: '' })} style={{ border: 'none', background: 'transparent', color: 'var(--mei-danger)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>重置为默认</button>
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
              <option value="info">卡片模式（图标+标题+描述）</option>
              <option value="icon">图标模式（紧凑图标网格）</option>
            </select>
          </div>
          <div>
            <label style={label}>首页主色调（深色背景选深色，文字自动变浅）</label>
            <select style={input} value={config.style.themeMode} onChange={(e) => setStyle({ themeMode: e.target.value as 'light' | 'dark' })}>
              <option value="light">浅色（深色文字）</option>
              <option value="dark">深色（浅色文字）</option>
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

/* ==================== 分组管理（拖拽排序；预设分组内置只读） ==================== */
function GroupsTab({ config, setConfig }: { config: PanelConfig; setConfig: (c: PanelConfig) => void }) {
  const [name, setName] = useState('');
  const dragIdx = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const input: React.CSSProperties = {
    flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13,
    border: '1px solid var(--mei-border-strong)', outline: 'none', color: 'var(--mei-text)', background: '#fff',
  };

  const moveGroup = (from: number, to: number) => {
    if (to < 0 || to >= config.groups.length || from === to) return;
    const groups = [...config.groups];
    const [g] = groups.splice(from, 1);
    groups.splice(to, 0, g);
    setConfig({ ...config, groups });
  };

  return (
    <section style={{ background: 'var(--mei-surface)', border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius-lg)', padding: 18, boxShadow: 'var(--mei-shadow-sm)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>分组管理</h2>
      <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', margin: '0 0 14px' }}>
        拖动 ⠿ 手柄调整分组顺序；带「内置」标的为系统预设分组，名称只读、不可删除。
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input style={input} placeholder="新分组名称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { setConfig({ ...config, groups: [...config.groups, { id: `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() }] }); setName(''); } }} />
        <button
          onClick={() => {
            if (!name.trim()) return;
            setConfig({ ...config, groups: [...config.groups, { id: `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() }] });
            setName('');
          }}
          style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--mei-gradient)', color: '#fff', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          添加分组
        </button>
      </div>
      {config.groups.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', textAlign: 'center', padding: '14px 0' }}>暂无分组，自定义项将显示在「其他链接」</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {config.groups.map((g, idx) => {
            const preset = PRESET_GROUP_IDS.has(g.id);
            return (
              <div
                key={g.id}
                draggable
                onDragStart={() => { dragIdx.current = idx; }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                onDragLeave={() => setDragOver((d) => (d === idx ? null : d))}
                onDrop={() => { if (dragIdx.current !== null) moveGroup(dragIdx.current, idx); dragIdx.current = null; setDragOver(null); }}
                onDragEnd={() => { dragIdx.current = null; setDragOver(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${dragOver === idx ? 'var(--mei-primary)' : 'var(--mei-border)'}`,
                  background: dragOver === idx ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.7)',
                  cursor: 'grab', transition: 'border-color .15s, background .15s',
                }}
              >
                <span style={{ color: 'var(--mei-text-faint)', fontSize: 12, cursor: 'grab' }} title="拖拽排序">⠿</span>
                <MeiIcon icon="lucide:library" size={16} />
                <input
                  value={g.name}
                  readOnly={preset}
                  onChange={(e) => setConfig({ ...config, groups: config.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })}
                  style={{ ...input, border: 'none', background: 'transparent', padding: '4px 0', fontWeight: 600, color: preset ? 'var(--mei-text-muted)' : 'var(--mei-text)', cursor: preset ? 'default' : 'text' }}
                />
                {preset && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(99,102,241,0.12)', color: 'var(--mei-primary)', fontWeight: 700, letterSpacing: 0.5 }}>内置</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--mei-text-faint)', whiteSpace: 'nowrap' }}>{config.items.filter((i) => i.groupId === g.id).length} 项</span>
                {!preset && (
                  <button
                    onClick={() => {
                      if (!confirm(`删除分组「${g.name}」？组内 ${config.items.filter((i) => i.groupId === g.id).length} 个项将移至未分组。`)) return;
                      setConfig({ ...config, groups: config.groups.filter((x) => x.id !== g.id), items: config.items.map((i) => (i.groupId === g.id ? { ...i, groupId: '' } : i)) });
                    }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--mei-danger)', fontSize: 12 }}
                  >
                    删除
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ==================== 导入导出（两个子 tab，按方式给出行动路径） ==================== */
function BackupTab({ config, reload }: { config: PanelConfig; reload: () => void }) {
  const [sub, setSub] = useState<'export' | 'import'>('export');
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
      setMsg('导入成功，刷新生效');
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
    setMsg('已导出 JSON 配置文件');
  }

  const card: React.CSSProperties = {
    background: 'var(--mei-surface)', border: '1px solid var(--mei-border)',
    borderRadius: 'var(--mei-radius-lg)', padding: 18, boxShadow: 'var(--mei-shadow-sm)',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '10px 22px', borderRadius: 'var(--mei-radius-full)', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: 'none', background: 'var(--mei-gradient)', color: '#fff', boxShadow: 'var(--mei-glow)',
  };

  return (
    <section style={card}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>配置备份与恢复</h2>
      <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', margin: '0 0 14px' }}>
        备份内容：主页风格、分组与图标项配置（JSON 格式）。
      </p>
      {/* 子 tab */}
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 'var(--mei-radius-full)', background: 'rgba(23,32,56,0.06)', marginBottom: 16 }}>
        {(['export', 'import'] as const).map((k) => (
          <button
            key={k}
            onClick={() => { setSub(k); setMsg(''); }}
            style={{
              padding: '6px 18px', borderRadius: 'var(--mei-radius-full)', border: 'none', fontSize: 13, cursor: 'pointer',
              background: sub === k ? '#fff' : 'transparent',
              color: sub === k ? 'var(--mei-text)' : 'var(--mei-text-muted)',
              fontWeight: sub === k ? 650 : 400,
              boxShadow: sub === k ? '0 1px 4px rgba(23,32,56,0.12)' : 'none',
              transition: 'var(--mei-transition)',
            }}
          >
            {k === 'export' ? '导出' : '导入'}
          </button>
        ))}
      </div>

      {sub === 'export' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--mei-border)', background: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
            <MeiIcon icon="lucide:file-json" size={18} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>导出为 JSON 文件</div>
              <div style={{ fontSize: 11.5, color: 'var(--mei-text-muted)', marginTop: 2 }}>下载当前全部主页配置，可用于迁移或存档</div>
            </div>
            <button onClick={doExport} style={btnPrimary}>立即导出</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--mei-border)', background: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
            <MeiIcon icon="lucide:upload" size={18} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>从 JSON 文件导入</div>
              <div style={{ fontSize: 11.5, color: 'var(--mei-text-muted)', marginTop: 2 }}>选择之前导出的配置文件，导入将覆盖现有配置</div>
            </div>
            <button onClick={() => fileRef.current?.click()} style={btnPrimary}>选择文件</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); }} />
          </div>
        </div>
      )}
      {msg && <p style={{ fontSize: 12, color: msg.includes('失败') ? 'var(--mei-danger)' : 'var(--mei-success)', marginTop: 4 }}>{msg}</p>}
    </section>
  );
}
