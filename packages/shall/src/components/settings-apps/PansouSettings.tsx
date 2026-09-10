'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  EmptyState,
  Pill,
  SettingsButton,
  SettingsPage,
  SettingsSection,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';
import { jsonFetch, readJsonStorage, writeJsonStorage } from '@/lib/app-settings-client';
import {
  DISK_PLUGIN_BY_ID,
  categorizeDiskPlugins,
  diskPluginName,
  isMagnetChannel,
} from '@/lib/disk-sources';

interface Health {
  status?: string;
  channels?: string[];
  plugins?: string[];
  plugin_count?: number;
}

const DISK_TYPES: Array<[string, string]> = [
  ['baidu', '百度网盘'], ['aliyun', '阿里云盘'], ['quark', '夸克网盘'], ['guangya', '光鸭网盘'],
  ['tianyi', '天翼云盘'], ['115', '115 网盘'], ['xunlei', '迅雷云盘'], ['uc', 'UC 网盘'],
  ['mobile', '移动云盘'], ['pikpak', 'PikPak'], ['123', '123 网盘'],
  ['others', '其他网盘'], ['magnet', '磁力链接'], ['ed2k', '电驴链接'],
];

function SelectAllCheck({ all, onToggle }: { all: boolean; onToggle: () => void }) {
  return (
    <label className="mei-select-all">
      <input type="checkbox" checked={all} onChange={onToggle} />
      <span>全选</span>
    </label>
  );
}

export default function PansouSettings() {
  const [health, setHealth] = useState<Health | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<string[]>([]);
  const [diskTypes, setDiskTypes] = useState<string[]>(DISK_TYPES.map(([id]) => id));
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  const [detection, setDetection] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const h = await jsonFetch<Health>('/search/api/health');
        setHealth(h);
        const allChannels = h.channels || [];
        const allPlugins = h.plugins || [];
        setChannels(readJsonStorage('pansou_channels', allChannels));
        setPlugins(readJsonStorage('pansou_plugins', allPlugins));
        setDiskTypes(readJsonStorage('pansou_disk_types', DISK_TYPES.map(([id]) => id)));
        setCustomChannels(readJsonStorage<string[]>('pansou_custom_channels', []));
        setDetection(readJsonStorage('pansou_detection_settings', { enabled: false }).enabled);
      } catch (err) {
        setError((err as Error).message || '读取搜索配置失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const allChannels = useMemo(() => [...(health?.channels || []), ...customChannels], [health, customChannels]);
  // Registry-driven grouping; unknown plugins fall back to the cloud group.
  const { cloud: webPlugins, magnet: magnetPlugins, needsAccount } = useMemo(
    () => categorizeDiskPlugins(health?.plugins || []),
    [health],
  );
  const panChannels = useMemo(() => allChannels.filter((c) => !isMagnetChannel(c)), [allChannels]);
  const magnetChannels = useMemo(() => allChannels.filter((c) => isMagnetChannel(c)), [allChannels]);

  function toggle(list: string[], value: string, setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function save() {
    writeJsonStorage('pansou_channels', channels);
    writeJsonStorage('pansou_plugins', plugins);
    writeJsonStorage('pansou_disk_types', diskTypes);
    writeJsonStorage('pansou_custom_channels', customChannels);
    writeJsonStorage('pansou_detection_settings', { enabled: detection });
    window.dispatchEvent(new CustomEvent('config:saved'));
    setMessage('搜索配置已保存，搜索结果将按此生效');
    setError('');
  }

  function reset() {
    if (!window.confirm('恢复默认配置会清除自定义频道与筛选，确定继续吗？')) return;
    setChannels(health?.channels || []);
    setPlugins(health?.plugins || []);
    setDiskTypes(DISK_TYPES.map(([id]) => id));
    setCustomChannels([]);
    setDetection(false);
    setMessage('已恢复默认值，尚未保存');
  }

  function addChannel() {
    const value = newChannel.trim();
    if (!value || allChannels.includes(value)) return;
    setCustomChannels([...customChannels, value]);
    setChannels([...channels, value]);
    setNewChannel('');
  }

  function renderChips(list: string[], selected: string[], setter: (v: string[]) => void, labelFn: (v: string) => string, removable = false) {
    return (
      <div className="chip-cloud">
        {list.map((item) => (
          <button
            key={item}
            className={selected.includes(item) ? 'active' : ''}
            onClick={() => toggle(selected, item, setter)}
          >
            {labelFn(item)}
            {removable && customChannels.includes(item) ? (
              <i onClick={(e) => {
                e.stopPropagation();
                setCustomChannels(customChannels.filter((v) => v !== item));
                setChannels(channels.filter((v) => v !== item));
              }}>×</i>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  function renderSourceChips(list: string[]) {
    return (
      <div className="chip-cloud">
        {list.map((item) => {
          const meta = DISK_PLUGIN_BY_ID[item];
          return (
            <button
              key={item}
              className={plugins.includes(item) ? 'active' : ''}
              onClick={() => toggle(plugins, item, setPlugins)}
              title={meta?.note || undefined}
            >
              {diskPluginName(item)}
              {meta?.needsAccount ? <em title="需要先在网盘应用内配置账户，否则无结果">需配置</em> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <SettingsPage
      icon="lucide:search"
      title="网盘搜索设置"
      description="管理搜索频道、插件、网盘类型与链接检测，保存后即时生效于综合搜索。"
      actions={
        <>
          <Pill tone={loading ? 'warning' : 'success'}>{loading ? '读取中' : `${health?.plugin_count ?? plugins.length} 个插件`}</Pill>
          <SettingsButton onClick={reset}>恢复默认</SettingsButton>
          <SettingsButton variant="primary" onClick={save}>保存配置</SettingsButton>
        </>
      }
    >
      {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}
      <SettingsSection
        title="搜索频道"
        description={`TG 频道决定搜索的数据来源，可添加自定义频道（当前 ${panChannels.length} 个网盘频道、${magnetChannels.length} 个磁力频道）。`}
        actions={
          <SelectAllCheck
            all={channels.length === allChannels.length}
            onToggle={() => setChannels(channels.length === allChannels.length ? [] : allChannels)}
          />
        }
      >
        {renderChips(panChannels, channels, setChannels, (v) => v, true)}
        {magnetChannels.length > 0 ? (
          <p className="group-hint">磁力/电驴频道：{magnetChannels.map((c) => (
            <button key={c} className={`chip-inline ${channels.includes(c) ? 'active' : ''}`} onClick={() => toggle(channels, c, setChannels)}>{c}</button>
          ))}</p>
        ) : null}
        <div className="channel-add">
          <TextInput value={newChannel} onChange={(e) => setNewChannel(e.target.value)} placeholder="输入自定义频道名" onKeyDown={(e) => e.key === 'Enter' && addChannel()} />
          <SettingsButton variant="primary" onClick={addChannel}>添加频道</SettingsButton>
        </div>
      </SettingsSection>

      <SettingsSection
        title="网盘与网页插件"
        description="网盘聚合与影视资源站，覆盖大部分网盘资源。"
        actions={
          <SelectAllCheck
            all={webPlugins.length > 0 && webPlugins.every((p) => plugins.includes(p))}
            onToggle={() => {
              const all = webPlugins.length > 0 && webPlugins.every((p) => plugins.includes(p));
              setPlugins(all ? plugins.filter((p) => !webPlugins.includes(p)) : [...new Set([...plugins, ...webPlugins])]);
            }}
          />
        }
      >
        {webPlugins.length === 0 ? <EmptyState title="暂无网盘插件" description="后端未返回可用插件。" /> : renderSourceChips(webPlugins)}
        {needsAccount.length > 0 ? (
          <p className="group-hint">标有「需配置」的源需先在网盘应用内完成账户配置，否则不出结果。</p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="磁力与电驴插件"
        description="以 magnet/ed2k 链接为主的专用搜索源。"
        actions={
          <SelectAllCheck
            all={magnetPlugins.length > 0 && magnetPlugins.every((p) => plugins.includes(p))}
            onToggle={() => {
              const all = magnetPlugins.length > 0 && magnetPlugins.every((p) => plugins.includes(p));
              setPlugins(all ? plugins.filter((p) => !magnetPlugins.includes(p)) : [...new Set([...plugins, ...magnetPlugins])]);
            }}
          />
        }
      >
        {magnetPlugins.length === 0 ? <EmptyState title="暂无磁力插件" /> : renderSourceChips(magnetPlugins)}
      </SettingsSection>

      <SettingsSection
        title="网盘类型筛选"
        description="控制聚合结果中保留哪些网盘类型。"
        actions={
          <SelectAllCheck
            all={diskTypes.length === DISK_TYPES.length}
            onToggle={() => setDiskTypes(diskTypes.length === DISK_TYPES.length ? [] : DISK_TYPES.map(([id]) => id))}
          />
        }
      >
        {renderChips(DISK_TYPES.map(([id]) => id), diskTypes, setDiskTypes, (id) => DISK_TYPES.find(([d]) => d === id)?.[1] || id)}
      </SettingsSection>

      <SettingsSection title="链接有效性检测" description="搜索后检测链接是否可用，会额外消耗请求。">
        <Toggle checked={detection} onChange={setDetection} label="启用链接有效性检测" description="检测结果会按链接缓存，减少重复检测。" />
      </SettingsSection>

      <style>{`
        .chip-cloud{display:flex;flex-wrap:wrap;gap:7px;max-height:280px;overflow:auto;padding-right:3px;}
        .chip-cloud button{display:inline-flex;align-items:center;gap:5px;height:29px;padding:0 11px;border:1px solid var(--mei-border);border-radius:99px;background:rgba(255,255,255,.66);font-size:11.5px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;transition:var(--mei-transition);}
        .chip-cloud button.active{border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:var(--mei-primary);}
        .chip-cloud button em{font-style:normal;font-size:10px;padding:1px 5px;border-radius:99px;background:rgba(245,158,11,.15);color:#b45309;}
        .chip-cloud i{font-style:normal;opacity:.65;}
        .group-hint{margin:10px 0 0;font-size:11.5px;color:var(--mei-text-muted);display:flex;flex-wrap:wrap;gap:5px;align-items:center;}
        .chip-inline{height:24px;padding:0 9px;border:1px solid var(--mei-border);border-radius:99px;background:rgba(255,255,255,.66);font-size:11px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;}
        .chip-inline.active{border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:var(--mei-primary);}
        .mei-select-all{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;user-select:none;}
        .mei-select-all input{width:16px;height:16px;margin:0;accent-color:var(--mei-primary);cursor:pointer;}
        .channel-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:13px;}
      `}</style>
    </SettingsPage>
  );
}
