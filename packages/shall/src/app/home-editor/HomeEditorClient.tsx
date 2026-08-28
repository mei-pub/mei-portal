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
import { Alert, FileInput, StickyBar } from '@/components/SettingsUI';
import type { PanelConfig, PanelGroup } from '@/lib/panel-store';
import { PRESET_GROUP_IDS } from '@/lib/panel-presets';

type Tab = 'style' | 'groups' | 'backup';
type CloudTarget = 'webdav' | 's3';

interface WebdavForm { url: string; username: string; password: string }
interface S3Form { endpoint: string; region: string; bucket: string; key: string; accessKey: string; secretKey: string }

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
    return <EmptyState title="正在读取主页配置…" description="首次加载可能需要几秒钟。" />;
  }

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'style', label: '风格与布局', icon: 'lucide:palette' },
    { id: 'groups', label: '分组管理', icon: 'lucide:folder' },
    { id: 'backup', label: '备份与恢复', icon: 'lucide:cloud' },
  ];

  return (
    <SettingsPage
      icon="lucide:layout-dashboard"
      title="主页设置"
      description="管理背景、风格、分组与备份；内置应用由系统自动同步。"
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
        {tab === 'backup' && <BackupTab config={config} reload={reload} />}
      </div>

      <style>{`
        .home-editor-content{min-width:0;}
        .range-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;min-height:38px;}
        .range-row output{font-size:11.5px;color:var(--mei-text-muted);font-weight:750;min-width:52px;text-align:right;}
        .group-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--mei-border);border-radius:14px;background:rgba(255,255,255,.6);}
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
            <Toggle checked={config.style.searchBoxShow} onChange={(v) => setStyle({ searchBoxShow: v })} label="显示搜索框" description="支持过滤应用与网页搜索。" />
          </div>
          <SettingsField label="搜索引擎">
            <Select value={config.style.searchEngine} onChange={(e) => setStyle({ searchEngine: e.target.value as PanelConfig['style']['searchEngine'] })}>
              <option value="bing">必应</option>
              <option value="google">Google</option>
              <option value="baidu">百度</option>
              <option value="duckduckgo">DuckDuckGo</option>
            </Select>
          </SettingsField>
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

      <SettingsSection title="布局与页脚" wide>
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
      <div className="channel-add" style={{ marginBottom: 12 }}>
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
      <style>{`.source-stack{display:flex;flex-direction:column;gap:8px;}`}</style>
    </SettingsSection>
  );
}

function BackupTab({ config, reload }: { config: PanelConfig; reload: () => void }) {
  const [target, setTarget] = useState<CloudTarget>('webdav');
  const [webdav, setWebdav] = useState<WebdavForm>({ url: '', username: '', password: '' });
  const [s3, setS3] = useState<S3Form>({ endpoint: '', region: '', bucket: '', key: 'backups/mei-panel.json', accessKey: '', secretKey: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function remote(direction: 'export' | 'import') {
    setBusy(`${target}-${direction}`);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/panel/remote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction, target, config: target === 'webdav' ? webdav : s3 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `云端${direction === 'export' ? '备份' : '恢复'}失败`);
      setMessage(direction === 'export' ? '已备份到云端' : '已从云端恢复');
      if (direction === 'import') reload();
    } catch (err) {
      setError((err as Error).message || '云端操作失败');
    } finally {
      setBusy('');
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mei-panel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('已导出 JSON 文件');
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch('/api/panel', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || '导入失败');
      setMessage('导入成功，刷新首页生效');
      reload();
    } catch (err) {
      setError((err as Error).message || '导入失败：JSON 解析错误');
    }
  }

  return (
    <>
      <SettingsSection title="本地备份" description="导出或导入完整 JSON 配置。">
        <div className="cloud-grid">
          <div className="cloud-info">
            <strong>JSON 文件</strong>
            <p>适合手动迁移与临时存档。</p>
          </div>
          <div className="footer-actions">
            <SettingsButton onClick={exportJson}>导出 JSON</SettingsButton>
            <SettingsButton variant="primary" onClick={() => fileRef.current?.click()}>导入 JSON</SettingsButton>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importJson(file); }} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="云端备份" description="支持 WebDAV 与 S3 兼容对象存储。" wide>
        <div className="cloud-grid">
          <div className="cloud-target">
            {(['webdav', 's3'] as const).map((item) => (
              <button key={item} className={target === item ? 'active' : ''} onClick={() => setTarget(item)}>
                {item === 'webdav' ? 'WebDAV' : 'S3'}
              </button>
            ))}
          </div>
          {target === 'webdav' ? (
            <div className="mei-grid">
              <SettingsField label="文件地址" span>
                <TextInput value={webdav.url} onChange={(e) => setWebdav({ ...webdav, url: e.target.value })} placeholder="https://dav.example.com/backups/mei-panel.json" />
              </SettingsField>
              <SettingsField label="用户名">
                <TextInput value={webdav.username} onChange={(e) => setWebdav({ ...webdav, username: e.target.value })} />
              </SettingsField>
              <SettingsField label="密码">
                <TextInput type="password" value={webdav.password} onChange={(e) => setWebdav({ ...webdav, password: e.target.value })} />
              </SettingsField>
            </div>
          ) : (
            <div className="mei-grid">
              <SettingsField label="Endpoint" span>
                <TextInput value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} placeholder="https://s3.example.com" />
              </SettingsField>
              <SettingsField label="Region">
                <TextInput value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })} placeholder="us-east-1" />
              </SettingsField>
              <SettingsField label="Bucket">
                <TextInput value={s3.bucket} onChange={(e) => setS3({ ...s3, bucket: e.target.value })} />
              </SettingsField>
              <SettingsField label="对象路径">
                <TextInput value={s3.key} onChange={(e) => setS3({ ...s3, key: e.target.value })} />
              </SettingsField>
              <SettingsField label="Access Key">
                <TextInput value={s3.accessKey} onChange={(e) => setS3({ ...s3, accessKey: e.target.value })} />
              </SettingsField>
              <SettingsField label="Secret Key">
                <TextInput type="password" value={s3.secretKey} onChange={(e) => setS3({ ...s3, secretKey: e.target.value })} />
              </SettingsField>
            </div>
          )}
        </div>
        <div className="footer-actions">
          <SettingsButton onClick={() => void remote('export')} disabled={busy !== ''}>{busy === 'webdav-export' || busy === 's3-export' ? '备份中…' : '备份到云端'}</SettingsButton>
          <SettingsButton variant="primary" onClick={() => { if (window.confirm('从云端恢复将覆盖当前主页配置，确定继续吗？')) void remote('import'); }} disabled={busy !== ''}>{busy === 'webdav-import' || busy === 's3-import' ? '恢复中…' : '从云端恢复'}</SettingsButton>
        </div>
      </SettingsSection>

      <SettingsSection title="操作结果" wide>
        {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : <div className="cloud-info"><strong>云端凭据不落盘</strong><p>仅在本次操作中提交，不会保存到服务器。</p></div>}
      </SettingsSection>

      <style>{`
        .cloud-target{display:flex;flex-direction:column;gap:7px;padding:10px;background:rgba(255,255,255,.58);border:1px solid var(--mei-border);border-radius:16px;}
        .cloud-target button{height:36px;border:1px solid var(--mei-border);border-radius:12px;background:transparent;font-size:12.5px;font-weight:750;color:var(--mei-text-muted);cursor:pointer;transition:var(--mei-transition);}
        .cloud-target button.active{border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:var(--mei-primary);}
        .cloud-info{padding:14px;border-radius:14px;background:rgba(255,255,255,.5);border:1px solid var(--mei-border);}
        .cloud-info strong{font-size:13px;font-weight:800;display:block;}
        .cloud-info p{margin:5px 0 0;font-size:11.5px;color:var(--mei-text-muted);line-height:1.5;}
        .footer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:12px;flex-wrap:wrap;}
      `}</style>
    </>
  );
}
