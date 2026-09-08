'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EmptyState,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  Select,
  SettingsTabs,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';
import { Alert, FileInput } from '@/components/SettingsUI';
import type { PanelConfig, PanelGroup } from '@/lib/panel-store';
import { PRESET_GROUP_IDS } from '@/lib/panel-presets';
import {
  MAX_SEARCH_ENGINES,
  resolveDefaultEngineId,
  resolveSearchEngines,
  type ManagedSearchEngine,
} from '@/lib/search-engines';

type Tab = 'style' | 'groups';

export default function HomeEditorClient() {
  const [config, setConfig] = useState<PanelConfig | null>(null);
  const [tab, setTab] = useState<Tab>('style');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      // 用 lite=1 获取不含 base64 背景图的轻量配置（2MB → 3KB）
      const res = await fetch('/api/panel?lite=1', { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
      else setError('读取主页配置失败');
    } catch {
      setError('读取主页配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  function update(next: PanelConfig) {
    setConfig(next);
    setDirty(true);
    setMessage('');
    setError('');
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/panel', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || '保存失败');
      setConfig(body.config || config);
      setDirty(false);
      setMessage('主页配置已保存，刷新首页生效');
    } catch (err) {
      setError((err as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !config) {
    return <EmptyState title="正在读取主页配置…" />;
  }

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'style', label: '风格与布局', icon: 'lucide:palette' },
    { id: 'groups', label: '分组管理', icon: 'lucide:folder' },
  ];

  return (
    <SettingsPage
      icon="lucide:layout-dashboard"
      title="主页设置"
      description="管理背景、风格与分组；内置应用由系统自动同步。"
      actions={
        <>
          <Pill tone={dirty ? 'warning' : 'success'}>{dirty ? '有未保存修改' : '配置已同步'}</Pill>
          <SettingsButton variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存配置'}
          </SettingsButton>
        </>
      }
      tabs={<SettingsTabs items={tabs} active={tab} onChange={(id) => setTab(id as Tab)} />}
    >
      {error ? <Alert tone="error" title={error} /> : null}
      {message ? <Alert tone="success" title={message} /> : null}
      <div className="home-editor-content">
        {tab === 'style' && <StyleTab config={config} update={update} />}
        {tab === 'groups' && <GroupsTab config={config} update={update} />}
      </div>

      <style>{`
        .home-editor-content{min-width:0;}
        .range-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;min-height:38px;}
        .range-row output{font-size:11.5px;color:var(--mei-text-muted);font-weight:750;min-width:52px;text-align:right;}
        .group-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--mei-border);border-radius:14px;background:rgba(255,255,255,.6);margin-bottom:10px;}
        .group-row:last-child{margin-bottom:0;}
        .group-row.drag{border-color:rgba(99,102,241,.45);background:rgba(99,102,241,.06);}
        .group-handle{cursor:grab;color:var(--mei-text-faint);text-align:center;}
        .cloud-grid{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;align-items:start;}
        @media(max-width:900px){.cloud-grid{grid-template-columns:1fr;}}
      `}</style>
    </SettingsPage>
  );
}

function StyleTab({ config, update }: { config: PanelConfig; update: (c: PanelConfig) => void }) {
  const setStyle = (patch: Partial<PanelConfig['style']>) =>
    update({ ...config, style: { ...config.style, ...patch } });
  const setBg = (patch: Partial<PanelConfig['background']>) =>
    update({ ...config, background: { ...config.background, ...patch } });

  function readImage(file: File, cb: (dataUrl: string) => void) {
    if (file.size > 30 * 1024 * 1024) {
      window.alert('图片过大（>30MB）');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <>
      <SettingsSection title="背景" description="背景图、遮罩与模糊会实时影响首页氛围。">
        <div className="mei-grid">
          <SettingsField label="背景图地址" span>
            <TextInput
              value={config.background.url}
              onChange={(e) => setBg({ url: e.target.value })}
              placeholder={(config.background as { hasCustomBg?: boolean }).hasCustomBg ? '已上传自定义背景图，清空则恢复默认' : 'https://example.com/wallpaper.jpg'}
            />
          </SettingsField>
          <SettingsField label="上传背景图" span>
            <FileInput
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readImage(file, (dataUrl) => setBg({ url: dataUrl }));
              }}
            />
          </SettingsField>
          <SettingsField label="遮罩不透明度">
            <div className="range-row">
              <input type="range" min={0} max={0.9} step={0.05} value={config.background.mask} onChange={(e) => setBg({ mask: Number(e.target.value) })} />
              <output>{config.background.mask.toFixed(2)}</output>
            </div>
          </SettingsField>
          <SettingsField label="背景模糊">
            <div className="range-row">
              <input type="range" min={0} max={24} step={1} value={config.background.blur} onChange={(e) => setBg({ blur: Number(e.target.value) })} />
              <output>{config.background.blur}px</output>
            </div>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="标识与时钟">
        <div className="mei-grid">
          <SettingsField label="Logo 文字">
            <TextInput value={config.style.logoText} onChange={(e) => setStyle({ logoText: e.target.value })} />
          </SettingsField>
          <SettingsField label="Logo 图片地址">
            <TextInput value={config.style.logoImage} onChange={(e) => setStyle({ logoImage: e.target.value })} placeholder="留空使用默认 Logo" />
          </SettingsField>
          <SettingsField label="上传 Logo 图片" span>
            <FileInput accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImage(file, (dataUrl) => setStyle({ logoImage: dataUrl })); }} />
          </SettingsField>
          <div className="mei-field span">
            <Toggle checked={config.style.clockShowSecond} onChange={(v) => setStyle({ clockShowSecond: v })} label="时钟显示秒" />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="搜索与主题">
        <div className="mei-grid">
          <div className="mei-field span">
            <Toggle checked={config.style.searchBoxShow} onChange={(v) => setStyle({ searchBoxShow: v })} label="显示搜索框" description="支持应用过滤、综合搜索与网页搜索。" />
          </div>
          <SettingsField label="主题模式">
            <Select value={config.style.themeMode} onChange={(e) => setStyle({ themeMode: e.target.value as 'light' | 'dark' })}>
              <option value="light">浅色文字</option>
              <option value="dark">深色背景 / 浅色文字</option>
            </Select>
          </SettingsField>
          <SettingsField label="卡片样式">
            <Select value={config.style.iconStyle} onChange={(e) => setStyle({ iconStyle: e.target.value as 'icon' | 'info' })}>
              <option value="info">卡片模式</option>
              <option value="icon">图标模式</option>
            </Select>
          </SettingsField>
          <SettingsField label="图标文字颜色">
            <TextInput type="color" value={config.style.iconTextColor || '#1c2333'} onChange={(e) => setStyle({ iconTextColor: e.target.value })} />
          </SettingsField>
        </div>
      </SettingsSection>

      <EnginesSection config={config} update={update} />

      <SettingsSection title="布局与页脚">
        <div className="mei-grid">
          <SettingsField label="顶部边距">
            <div className="range-row"><input type="range" min={0} max={30} value={config.style.marginTop} onChange={(e) => setStyle({ marginTop: Number(e.target.value) })} /><output>{config.style.marginTop}%</output></div>
          </SettingsField>
          <SettingsField label="底部边距">
            <div className="range-row"><input type="range" min={0} max={30} value={config.style.marginBottom} onChange={(e) => setStyle({ marginBottom: Number(e.target.value) })} /><output>{config.style.marginBottom}%</output></div>
          </SettingsField>
          <SettingsField label="左右边距">
            <div className="range-row"><input type="range" min={0} max={100} value={config.style.marginX} onChange={(e) => setStyle({ marginX: Number(e.target.value) })} /><output>{config.style.marginX}px</output></div>
          </SettingsField>
          <SettingsField label="内容最大宽度">
            <div className="range-row"><input type="range" min={600} max={2000} step={20} value={config.style.maxWidth} onChange={(e) => setStyle({ maxWidth: Number(e.target.value) })} /><output>{config.style.maxWidth}px</output></div>
          </SettingsField>
          <SettingsField label="页脚 HTML" span>
            <textarea className="mei-input" value={config.style.footerHtml} onChange={(e) => setStyle({ footerHtml: e.target.value })} />
          </SettingsField>
          <div className="mei-field span">
            <Toggle checked={config.style.systemMonitorShow} onChange={(v) => setStyle({ systemMonitorShow: v })} label="显示系统监控" description="每 5 秒刷新内存与 CPU 负载。" />
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

/**
 * 搜索引擎管理：新增 / 编辑 / 删除 / 设为默认。
 * 展示列表 = resolveSearchEngines（未自定义时显示内置种子）；任何修改即整体物化到
 * style.searchEngines（保存配置后落盘，服务端 normalizeSearchEngines 再次清洗兜底）。
 */
function EnginesSection({ config, update }: { config: PanelConfig; update: (c: PanelConfig) => void }) {
  const engines = resolveSearchEngines(config.style);
  const defaultId = resolveDefaultEngineId(config.style, engines);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  // 列表变更（增/改/删）后的统一落地：默认引擎不在新列表内时回落第一个
  function commit(next: ManagedSearchEngine[]) {
    const saved = config.style.searchEngine;
    const nextDefault = next.some((e) => e.id === saved) ? saved : next[0]?.id || '';
    update({ ...config, style: { ...config.style, searchEngines: next, searchEngine: nextDefault } });
  }

  function setDefault(id: string) {
    update({ ...config, style: { ...config.style, searchEngines: engines, searchEngine: id } });
  }

  function addEngine() {
    const n = name.trim();
    const u = url.trim();
    if (!n || !/^https?:\/\//i.test(u) || engines.length >= MAX_SEARCH_ENGINES) return;
    commit([...engines, { id: `ce${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: n, url: u }]);
    setName('');
    setUrl('');
  }

  function removeEngine(id: string) {
    if (engines.length <= 1) return;
    const target = engines.find((e) => e.id === id);
    if (!target || !window.confirm(`删除搜索引擎「${target.name}」？`)) return;
    commit(engines.filter((e) => e.id !== id));
  }

  return (
    <SettingsSection title="搜索引擎管理" description="网页搜索可用的引擎列表；链接模板中用 {q} 表示关键词。">
      <div className="mei-channel-add" style={{ marginBottom: 12 }}>
        <TextInput value={name} placeholder="名称（如 必应）" onChange={(e) => setName(e.target.value)} />
        <TextInput value={url} placeholder="https://www.bing.com/search?q={q}" onChange={(e) => setUrl(e.target.value)} />
        <SettingsButton variant="primary" onClick={addEngine} disabled={engines.length >= MAX_SEARCH_ENGINES}>添加引擎</SettingsButton>
      </div>
      <div className="source-stack">
        {engines.map((eng) => (
          <div key={eng.id} className="engine-row" data-default={eng.id === defaultId || undefined}>
            <button
              type="button"
              className="engine-default-btn"
              title={eng.id === defaultId ? '当前默认引擎' : '设为默认'}
              onClick={() => setDefault(eng.id)}
            >
              {eng.id === defaultId ? '★ 默认' : '设默认'}
            </button>
            <input
              className="mei-input"
              value={eng.name}
              placeholder="名称"
              onChange={(e) => commit(engines.map((x) => (x.id === eng.id ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className="mei-input engine-url"
              value={eng.url}
              placeholder="https://…?q={q}"
              onChange={(e) => commit(engines.map((x) => (x.id === eng.id ? { ...x, url: e.target.value } : x)))}
            />
            <SettingsButton variant="danger" disabled={engines.length <= 1} onClick={() => removeEngine(eng.id)}>
              删除
            </SettingsButton>
          </div>
        ))}
      </div>
      <style>{`
        .engine-row{display:grid;grid-template-columns:84px 128px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--mei-border);border-radius:14px;background:rgba(255,255,255,.6);margin-bottom:10px;}
        .engine-row:last-child{margin-bottom:0;}
        .engine-row[data-default]{border-color:rgba(99,102,241,.45);}
        .engine-default-btn{border:1px solid var(--mei-border);border-radius:10px;background:#fff;color:var(--mei-text-muted);font-size:12px;padding:7px 10px;cursor:pointer;white-space:nowrap;}
        .engine-row[data-default] .engine-default-btn{border-color:transparent;background:var(--mei-gradient-soft);color:var(--mei-primary);font-weight:650;}
      `}</style>
    </SettingsSection>
  );
}

function GroupsTab({ config, update }: { config: PanelConfig; update: (c: PanelConfig) => void }) {
  const [name, setName] = useState('');
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function move(from: number, to: number) {
    if (to < 0 || to >= config.groups.length || from === to) return;
    const groups = [...config.groups];
    const [group] = groups.splice(from, 1);
    groups.splice(to, 0, group);
    update({ ...config, groups });
  }

  function addGroup() {
    const value = name.trim();
    if (!value) return;
    const group: PanelGroup = { id: `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: value };
    update({ ...config, groups: [...config.groups, group] });
    setName('');
  }

  return (
    <SettingsSection
      title="分组管理"
      description="拖动行排序；内置分组由系统维护，不可删除。"
    >
      <div className="mei-channel-add" style={{ marginBottom: 12 }}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="新分组名称" onKeyDown={(e) => e.key === 'Enter' && addGroup()} />
        <SettingsButton variant="primary" onClick={addGroup}>添加分组</SettingsButton>
      </div>
      {config.groups.length === 0 ? <EmptyState title="暂无分组" /> : (
        <div className="source-stack">
          {config.groups.map((group, index) => {
            const preset = PRESET_GROUP_IDS.has(group.id);
            return (
              <div
                key={group.id}
                className={`group-row${dragOver === index ? ' drag' : ''}`}
                draggable
                onDragStart={() => { dragIndex.current = index; }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(index); }}
                onDragLeave={() => setDragOver((v) => (v === index ? null : v))}
                onDrop={() => {
                  if (dragIndex.current !== null) move(dragIndex.current, index);
                  dragIndex.current = null;
                  setDragOver(null);
                }}
                onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
              >
                <span className="group-handle">⠿</span>
                <input
                  className="mei-input"
                  value={group.name}
                  readOnly={preset}
                  onChange={(e) => update({
                    ...config,
                    groups: config.groups.map((g) => (g.id === group.id ? { ...g, name: e.target.value } : g)),
                  })}
                />
                <Pill tone="neutral">{config.items.filter((item) => item.groupId === group.id).length} 项</Pill>
                {!preset ? (
                  <SettingsButton
                    variant="danger"
                    onClick={() => {
                      const count = config.items.filter((item) => item.groupId === group.id).length;
                      if (!window.confirm(`删除分组「${group.name}」？组内 ${count} 个项将移至未分组。`)) return;
                      update({
                        ...config,
                        groups: config.groups.filter((g) => g.id !== group.id),
                        items: config.items.map((item) => (item.groupId === group.id ? { ...item, groupId: '' } : item)),
                      });
                    }}
                  >
                    删除
                  </SettingsButton>
                ) : <Pill tone="neutral">内置</Pill>}
              </div>
            );
          })}
        </div>
      )}
      <style>{``}</style>
    </SettingsSection>
  );
}
