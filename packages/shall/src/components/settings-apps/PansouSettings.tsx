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

interface Health {
  status?: string;
  channels?: string[];
  plugins?: string[];
  plugin_count?: number;
}

const DISK_TYPES: Array<[string, string]> = [
  ['baidu', '百度网盘'], ['aliyun', '阿里云盘'], ['quark', '夸克网盘'], ['guangya', '光鸭网盘'],
  ['tianyi', '天翼云盘'], ['115', '115 网盘'], ['xunlei', '迅雷云盘'], ['uc', 'UC 网盘'],
  ['mobile', '移动云盘'], ['pikpak', 'PikPak'], ['123', '123 网盘'], ['magnet', '磁力链接'], ['ed2k', '电驴链接'],
];

// 插件 ID → 中文可读名称
const PLUGIN_LABELS: Record<string, string> = {
  muou: '木偶搜索', zhizhen: '指针搜索', fox4k: 'Fox 4K', lou1: '楼层搜索', wanou: '玩偶搜索',
  ouge: '欧歌搜索', huban: '虎斑搜索', cyg: 'CYG 搜索', pianku: '片库搜索', qqpd: 'QQ 频道',
  nyaa: 'Nyaa 番剧', erxiao: '二小搜索', duoduo: '多多搜索', qiwei: '趣味搜索', xiaoji: '小鸡搜索',
  gying: '广影搜索', lingjisp: '灵迹搜索', xuexizhinan: '学习指南', meitizy: '美蹄资源', xys: '校园搜索',
  dyyj: '电影一级', dyyjpro: '电影一级 Pro', yulinshufa: '玉林书法', mizixing: '觅字星',
  jsnoteclub: 'JS 笔记', yiove: '一搜', panlian: '盘链搜索', xiaozhang: '小张搜索',
  qupansou: '去盘搜', shandian: '闪电搜索', clmao: 'CL 猫', cldi: 'CL 滴',
  clxiong: 'CL 熊', daishudj: '代数 DJ', djgou: 'DJ 狗', haisou: '海搜', hdr4k: 'HDR 4K',
};

const MAGNET_PLUGINS = new Set([
  'muou', 'zhizhen', 'fox4k', 'lou1', 'wanou', 'ouge', 'huban', 'cyg', 'pianku', 'qqpd', 'nyaa',
  'erxiao', 'duoduo', 'qiwei', 'xiaoji', 'gying', 'lingjisp', 'xuexizhinan', 'meitizy', 'xys',
  'dyyj', 'dyyjpro', 'yulinshufa', 'mizixing', 'jsnoteclub', 'yiove', 'panlian', 'xiaozhang',
  'qupansou', 'shandian', 'clmao', 'cldi', 'clxiong', 'daishudj', 'djgou', 'haisou', 'hdr4k',
]);

function pluginLabel(id: string): string {
  return PLUGIN_LABELS[id] || id;
}

function channelLabel(id: string): string {
  // TG 频道通常是 @xxx 或纯英文标识，直接展示即可
  return id;
}

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

  return (
    <SettingsPage
      icon="lucide:search"
      title="网盘搜索设置"
      description="管理搜索频道、插件、网盘类型与链接检测。"
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
        description="TG 频道决定搜索的数据来源，可添加自定义频道。"
        actions={
          <SelectAllCheck
            all={channels.length === allChannels.length}
            onToggle={() => setChannels(channels.length === allChannels.length ? [] : allChannels)}
          />
        }
      >
        {renderChips(allChannels, channels, setChannels, channelLabel, true)}
        <div className="channel-add">
          <TextInput value={newChannel} onChange={(e) => setNewChannel(e.target.value)} placeholder="输入自定义频道名" onKeyDown={(e) => e.key === 'Enter' && addChannel()} />
          <SettingsButton variant="primary" onClick={addChannel}>添加频道</SettingsButton>
        </div>
      </SettingsSection>

      <SettingsSection
        title="网盘与网页插件"
        description="常规搜索插件，覆盖大部分网盘资源。"
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
        {webPlugins.length === 0 ? <EmptyState title="暂无网盘插件" description="后端未返回可用插件。" /> : renderChips(webPlugins, plugins, setPlugins, pluginLabel)}
      </SettingsSection>

      <SettingsSection
        title="磁力与电驴插件"
        description="支持 magnet/ed2k 链接的专用搜索源。"
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
        {magnetPlugins.length === 0 ? <EmptyState title="暂无磁力插件" /> : renderChips(magnetPlugins, plugins, setPlugins, pluginLabel)}
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
        .chip-cloud i{font-style:normal;opacity:.65;}
        .mei-select-all{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;user-select:none;}
        .mei-select-all input{width:16px;height:16px;margin:0;accent-color:var(--mei-primary);cursor:pointer;}
        .channel-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:13px;}
      `}</style>
    </SettingsPage>
  );
}
