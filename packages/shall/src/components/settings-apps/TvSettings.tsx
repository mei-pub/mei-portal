'use client';

import {
  SettingsField,
  SettingsSection,
  Select,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';

export interface TvFormState {
  defaultAggregateSearch: boolean;
  fluidSearch: boolean;
  enableOptimization: boolean;
  liveDirectConnect: boolean;
  doubanDataSource: string;
  doubanProxyUrl: string;
  doubanImageProxyType: string;
  doubanImageProxyUrl: string;
}

export const TV_DEFAULTS: TvFormState = {
  defaultAggregateSearch: true,
  fluidSearch: true,
  enableOptimization: true,
  liveDirectConnect: false,
  doubanDataSource: 'cmliussss-cdn-tencent',
  doubanProxyUrl: '',
  doubanImageProxyType: 'cmliussss-cdn-tencent',
  doubanImageProxyUrl: '',
};

const SOURCE_OPTIONS = [
  ['direct', '直连'],
  ['cors-proxy-zwei', 'Cors Proxy By Zwei'],
  ['cmliussss-cdn-tencent', 'CMLiussss CDN（腾讯云）'],
  ['cmliussss-cdn-ali', 'CMLiussss CDN（阿里云）'],
  ['custom', '自定义代理'],
];

const IMAGE_OPTIONS = [
  ['server', '服务器代理'],
  ['cmliussss-cdn-tencent', 'CMLiussss CDN（腾讯云）'],
  ['cmliussss-cdn-ali', 'CMLiussss CDN（阿里云）'],
  ['custom', '自定义代理'],
];

export function loadTvSettings(): TvFormState {
  const f = { ...TV_DEFAULTS };
  try {
    const bool = (key: string, fallback: boolean) => {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw) === true;
    };
    f.defaultAggregateSearch = bool('defaultAggregateSearch', true);
    f.fluidSearch = bool('fluidSearch', true);
    f.enableOptimization = bool('enableOptimization', true);
    f.liveDirectConnect = bool('liveDirectConnect', false);
    f.doubanDataSource = localStorage.getItem('doubanDataSource') || f.doubanDataSource;
    f.doubanProxyUrl = localStorage.getItem('doubanProxyUrl') || '';
    f.doubanImageProxyType = localStorage.getItem('doubanImageProxyType') || f.doubanImageProxyType;
    f.doubanImageProxyUrl = localStorage.getItem('doubanImageProxyUrl') || '';
  } catch {}
  return f;
}

export default function TvSettings({
  form,
  onChange,
}: {
  form: TvFormState;
  onChange: (next: TvFormState) => void;
}) {
  return (
    <div>
      <SettingsSection title="搜索">
        <div className="toggle-stack">
          <Toggle checked={form.defaultAggregateSearch} onChange={(v) => onChange({ ...form, defaultAggregateSearch: v })} label="默认聚合搜索" description="同时聚合全部启用源。" />
          <Toggle checked={form.fluidSearch} onChange={(v) => onChange({ ...form, fluidSearch: v })} label="流式搜索" description="边返回边展示结果。" />
        </div>
      </SettingsSection>

      <SettingsSection title="播放与直播">
        <div className="toggle-stack">
          <Toggle checked={form.enableOptimization} onChange={(v) => onChange({ ...form, enableOptimization: v })} label="优选最佳播放源" description="自动选择最佳清晰度与线路。" />
          <Toggle checked={form.liveDirectConnect} onChange={(v) => onChange({ ...form, liveDirectConnect: v })} label="直播直连" description="服务器无法访问直播源时开启。" />
        </div>
      </SettingsSection>

      <SettingsSection title="豆瓣数据源">
        <div className="mei-grid">
          <SettingsField label="数据获取方式">
            <Select value={form.doubanDataSource} onChange={(e) => onChange({ ...form, doubanDataSource: e.target.value })}>
              {SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </SettingsField>
          <SettingsField label="图片代理">
            <Select value={form.doubanImageProxyType} onChange={(e) => onChange({ ...form, doubanImageProxyType: e.target.value })}>
              {IMAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </SettingsField>
          {form.doubanDataSource === 'custom' ? (
            <SettingsField label="自定义代理地址" span>
              <TextInput value={form.doubanProxyUrl} onChange={(e) => onChange({ ...form, doubanProxyUrl: e.target.value })} placeholder="https://your-proxy.example.com/?url=" />
            </SettingsField>
          ) : null}
          {form.doubanImageProxyType === 'custom' ? (
            <SettingsField label="自定义图片代理地址" span>
              <TextInput value={form.doubanImageProxyUrl} onChange={(e) => onChange({ ...form, doubanImageProxyUrl: e.target.value })} placeholder="https://your-image-proxy.example.com/?url=" />
            </SettingsField>
          ) : null}
        </div>
      </SettingsSection>

      <style>{`.toggle-stack{display:flex;flex-direction:column;gap:9px;}`}</style>
    </div>
  );
}
