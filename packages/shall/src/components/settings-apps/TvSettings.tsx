'use client';

import { useEffect, useState } from 'react';
import {
  EmptyState,
  Alert,
  SettingsButton,
  SettingsField,
  SettingsSection,
  Select,
  TextInput,
  Toggle,
  StickyBar,
} from '@/components/SettingsUI';

interface FormState {
  defaultAggregateSearch: boolean;
  fluidSearch: boolean;
  enableOptimization: boolean;
  liveDirectConnect: boolean;
  doubanDataSource: string;
  doubanProxyUrl: string;
  doubanImageProxyType: string;
  doubanImageProxyUrl: string;
}

const DEFAULTS: FormState = {
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

function load(): FormState {
  const f = { ...DEFAULTS };
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

export default function TvSettings() {
  const [form, setForm] = useState(DEFAULTS);
  const [message, setMessage] = useState('');

  useEffect(() => setForm(load()), []);

  function save() {
    localStorage.setItem('defaultAggregateSearch', JSON.stringify(form.defaultAggregateSearch));
    localStorage.setItem('fluidSearch', JSON.stringify(form.fluidSearch));
    localStorage.setItem('enableOptimization', JSON.stringify(form.enableOptimization));
    localStorage.setItem('liveDirectConnect', JSON.stringify(form.liveDirectConnect));
    localStorage.setItem('doubanDataSource', form.doubanDataSource);
    localStorage.setItem('doubanProxyUrl', form.doubanProxyUrl);
    localStorage.setItem('doubanImageProxyType', form.doubanImageProxyType);
    localStorage.setItem('doubanImageProxyUrl', form.doubanImageProxyUrl);
    setMessage('影视设置已保存');
  }

  return (
    <div>
      <SettingsSection title="搜索" wide>
        <div className="toggle-stack">
          <Toggle checked={form.defaultAggregateSearch} onChange={(v) => setForm({ ...form, defaultAggregateSearch: v })} label="默认聚合搜索" description="同时聚合全部启用源。" />
          <Toggle checked={form.fluidSearch} onChange={(v) => setForm({ ...form, fluidSearch: v })} label="流式搜索" description="边返回边展示结果。" />
        </div>
      </SettingsSection>

      <SettingsSection title="播放与直播" wide>
        <div className="toggle-stack">
          <Toggle checked={form.enableOptimization} onChange={(v) => setForm({ ...form, enableOptimization: v })} label="优选最佳播放源" description="自动选择最佳清晰度与线路。" />
          <Toggle checked={form.liveDirectConnect} onChange={(v) => setForm({ ...form, liveDirectConnect: v })} label="直播直连" description="服务器无法访问直播源时开启。" />
        </div>
      </SettingsSection>

      <SettingsSection title="豆瓣数据源" wide>
        <div className="mei-grid">
          <SettingsField label="数据获取方式">
            <Select value={form.doubanDataSource} onChange={(e) => setForm({ ...form, doubanDataSource: e.target.value })}>
              {SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </SettingsField>
          <SettingsField label="图片代理">
            <Select value={form.doubanImageProxyType} onChange={(e) => setForm({ ...form, doubanImageProxyType: e.target.value })}>
              {IMAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </SettingsField>
          {form.doubanDataSource === 'custom' ? (
            <SettingsField label="自定义代理地址" span>
              <TextInput value={form.doubanProxyUrl} onChange={(e) => setForm({ ...form, doubanProxyUrl: e.target.value })} placeholder="https://your-proxy.example.com/?url=" />
            </SettingsField>
          ) : null}
          {form.doubanImageProxyType === 'custom' ? (
            <SettingsField label="自定义图片代理地址" span>
              <TextInput value={form.doubanImageProxyUrl} onChange={(e) => setForm({ ...form, doubanImageProxyUrl: e.target.value })} placeholder="https://your-image-proxy.example.com/?url=" />
            </SettingsField>
          ) : null}
        </div>
      </SettingsSection>

      {message ? <Alert tone="success" title={message} /> : null}
      <StickyBar>
        <SettingsButton onClick={() => {
          setForm(DEFAULTS);
          setMessage('已恢复默认值，尚未保存');
        }}>恢复默认</SettingsButton>
        <SettingsButton variant="primary" onClick={save}>保存设置</SettingsButton>
      </StickyBar>

      <style>{`.toggle-stack{display:flex;flex-direction:column;gap:9px;}.footer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:12px;}`}</style>
    </div>
  );
}
