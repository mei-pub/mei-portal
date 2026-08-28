'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  EmptyState,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';
import { jsonFetch, readJsonStorage, writeJsonStorage } from '@/lib/app-settings-client';

interface Health {
  status?: string;
  channels?: string[];
  plugins?: string[];
  plugin_count?: number;
}

const DISK_TYPES = [
  ['baidu', '百度'], ['aliyun', '阿里'], ['quark', '夸克'], ['guangya', '光鸭'],
  ['tianyi', '天翼'], ['115', '115'], ['xunlei', '迅雷'], ['uc', 'UC'],
  ['mobile', '移动'], ['pikpak', 'PikPak'], ['123', '123'], ['magnet', '磁力'], ['ed2k', '电驴'],
] as const;

const MAGNET_PLUGINS = new Set(['muou', 'zhizhen', 'fox4k', 'lou1', 'wanou', 'ouge', 'huban', 'cyg', 'pianku', 'qqpd', 'nyaa', 'erxiao', 'duoduo', 'qiwei', 'xiaoji', 'gying', 'lingjisp', 'xuexizhinan', 'meitizy', 'xys', 'dyyj', 'dyyjpro', 'yulinshufa', 'mizixing', 'jsnoteclub', 'yiove', 'panlian', 'xiaozhang', 'qupansou', 'shandian', 'clmao', 'cldi', 'clxiong', 'daishudj', 'djgou', 'haisou', 'hdr4k']);

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
  const webPlugins = (health?.plugins || []).filter((p) => !MAGNET_PLUGINS.has(p));
  const magnetPlugins = (health?.plugins || []).filter((p) => MAGNET_PLUGINS.has(p));

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
    setMessage('搜索配置已保存');
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

  function renderChips(list: string[], selected: string[], setter: (v: string[]) => void, removable = false) {
    return (
      <div className="chip-cloud">
        {list.map((item) => (
          <button
            key={item}
            className={selected.includes(item) ? 'active' : ''}
            onClick={() => toggle(selected, item, setter)}
          >
            {item}
            {removable && customChannels.includes(item) ? (
              <i
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomChannels(customChannels.filter((v) => v !== item));
                  setChannels(channels.filter((v) => v !== item));
                }}
              >
                ×
              </i>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <SettingsPage
      icon="lucide:search"
      title="网盘搜索设置"
      description="管理 TG 频道、搜索插件、网盘类型与链接检测。"
      actions={<Pill tone={loading ? 'warning' : 'success'}>{loading ? '读取中' : `${health?.plugin_count ?? plugins.length} 个插件`}</Pill>}
    >
      <SettingsSection title="搜索频道" description="频道决定 TG 搜索的数据来源。">
        <div className="section-tools">
          <SettingsButton onClick={() => setChannels(channels.length === allChannels.length ? [] : allChannels)}>
            {channels.length === allChannels.length ? '取消全选' : '全选'}
          </SettingsButton>
        </div>
        {renderChips(allChannels, channels, setChannels, true)}
        <div className="channel-add">
          <TextInput value={newChannel} onChange={(e) => setNewChannel(e.target.value)} placeholder="新增自定义频道" onKeyDown={(e) => e.key === 'Enter' && addChannel()} />
          <SettingsButton variant="primary" onClick={addChannel}>添加</SettingsButton>
        </div>
      </SettingsSection>

      <div>
        <SettingsSection title="网盘与网页插件">
          <div className="section-tools">
            <SettingsButton onClick={() => {
              const all = webPlugins.every((p) => plugins.includes(p));
              setPlugins(all ? plugins.filter((p) => !webPlugins.includes(p)) : [...new Set([...plugins, ...webPlugins])]);
            }}>
              切换全选
            </SettingsButton>
          </div>
          {renderChips(webPlugins, plugins, setPlugins)}
        </SettingsSection>
        <SettingsSection title="磁力 / 电驴插件">
          <div className="section-tools">
            <SettingsButton onClick={() => {
              const all = magnetPlugins.every((p) => plugins.includes(p));
              setPlugins(all ? plugins.filter((p) => !magnetPlugins.includes(p)) : [...new Set([...plugins, ...magnetPlugins])]);
            }}>
              切换全选
            </SettingsButton>
          </div>
          {renderChips(magnetPlugins, plugins, setPlugins)}
        </SettingsSection>
      </div>

      <SettingsSection title="网盘类型" description="控制聚合结果中保留的网盘类型。">
        <div className="section-tools">
          <SettingsButton onClick={() => setDiskTypes(diskTypes.length === DISK_TYPES.length ? [] : DISK_TYPES.map(([id]) => id))}>
            {diskTypes.length === DISK_TYPES.length ? '取消全选' : '全选'}
          </SettingsButton>
        </div>
        {renderChips(DISK_TYPES.map(([id]) => id), diskTypes, setDiskTypes)}
      </SettingsSection>

      <SettingsSection title="链接检测" description="搜索后检测链接有效性，会消耗更多请求。">
        <Toggle checked={detection} onChange={setDetection} label="启用链接有效性检测" description="检测结果会按链接缓存，减少重复检测。" />
      </SettingsSection>

      <SettingsSection title="操作" wide>
        {error ? <EmptyState title={error} /> : message ? <EmptyState title={message} /> : <EmptyState title="配置保存在本浏览器" description="切换设备后需要重新配置。" />}
        <div className="footer-actions">
          <SettingsButton onClick={reset}>恢复默认</SettingsButton>
          <SettingsButton variant="primary" onClick={save}>保存配置</SettingsButton>
        </div>
      </SettingsSection>

      <style>{`
        .chip-cloud{display:flex;flex-wrap:wrap;gap:7px;max-height:280px;overflow:auto;padding-right:3px;}
        .chip-cloud button{display:inline-flex;align-items:center;gap:5px;height:29px;padding:0 11px;border:1px solid var(--mei-border);border-radius:99px;background:rgba(255,255,255,.66);font-size:11.5px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;transition:var(--mei-transition);}
        .chip-cloud button.active{border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:var(--mei-primary);}
        .chip-cloud i{font-style:normal;opacity:.65;}
        .section-tools{display:flex;justify-content:flex-end;margin-bottom:10px;}
        .channel-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:13px;}
        .footer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:13px;}
      `}</style>
    </SettingsPage>
  );
}
