'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  StickyBar,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';
import { authorizedJsonFetch } from '@/lib/app-settings-client';

interface MediagoConfig {
  local?: string;
  language?: string;
  proxy?: string;
  downloadProxySwitch?: boolean;
  deleteSegments?: boolean;
  maxRunner?: number;
  apiKey?: string;
  enableMobilePlayer?: boolean;
}

interface Wrapped<T> { success?: boolean; message?: string; data?: T }

export default function MediagoSettings() {
  const [config, setConfig] = useState<MediagoConfig>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const d = await authorizedJsonFetch<Wrapped<MediagoConfig>>('/media/api/config', 'mediago');
      setConfig(d.data || {});
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取媒体下载配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(key: keyof MediagoConfig, silent = false) {
    setSavingKey(key);
    if (!silent) setMessage('');
    setError('');
    try {
      const d = await authorizedJsonFetch<Wrapped<{ message?: string }>>(`/media/api/config/${key}`, 'mediago', {
        method: 'PUT',
        body: JSON.stringify({ value: config[key] }),
      });
      if (!silent) setMessage(d.data?.message || `${key} 已保存`);
      return true;
    } catch (err) {
      setError((err as Error).message || '保存失败');
      // 失败时不回拉整份配置，避免覆盖用户正在编辑的其他字段
      return false;
    } finally {
      setSavingKey('');
    }
  }

  async function saveAllFields() {
    setMessage('');
    setError('');
    const keys: Array<keyof MediagoConfig> = ['local', 'proxy', 'maxRunner', 'downloadProxySwitch', 'deleteSegments'];
    for (const key of keys) {
      const ok = await save(key, true);
      if (!ok) return;
    }
    setMessage('全部设置已保存');
  }

  const fields: Array<{ key: keyof MediagoConfig; label: string; hint?: string; type?: 'text' | 'number' }> = [
    { key: 'local', label: '下载目录', hint: '服务器保存下载内容的位置。' },
    { key: 'proxy', label: '网络代理', hint: '留空则不使用代理。' },
    { key: 'maxRunner', label: '并发下载数', type: 'number' },
  ];

  return (
    <SettingsPage
      icon="lucide:download"
      title="媒体下载设置"
      description="配置下载目录、代理与任务执行策略。"
      actions={<Pill tone={loading ? 'warning' : 'success'}>{loading ? '读取中' : '已连接'}</Pill>}
    >
      <SettingsSection title="基础设置" description="修改后点击底部保存按钮统一保存。">
        {fields.map((f) => (
          <SettingsField key={f.key} label={f.label} hint={f.hint}>
            <TextInput
              type={f.type || 'text'}
              value={String(config[f.key] ?? '')}
              onChange={(e) => setConfig({ ...config, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
            />
          </SettingsField>
        ))}
      </SettingsSection>

      <SettingsSection title="任务策略" description="影响下载稳定性与磁盘占用。">
        <div className="toggle-stack">
          <Toggle
            checked={!!config.downloadProxySwitch}
            onChange={(v) => setConfig({ ...config, downloadProxySwitch: v })}
            label="下载使用代理"
            description="开启后下载请求走上方代理地址。"
          />
          <Toggle
            checked={!!config.deleteSegments}
            onChange={(v) => setConfig({ ...config, deleteSegments: v })}
            label="完成后删除分片"
            description="合并成功后自动清理临时分片。"
          />
        </div>
      </SettingsSection>

      <SettingsSection title="访问凭据" description="Web 模式下的只读 API Key。">
        <SettingsField label="API Key">
          <TextInput value={config.apiKey || ''} readOnly />
        </SettingsField>
      </SettingsSection>

      {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}
      <StickyBar>
        <SettingsButton variant="primary" onClick={() => { void saveAllFields(); }} disabled={savingKey !== ''}>保存全部设置</SettingsButton>
      </StickyBar>

      <style>{`
        .toggle-stack{display:flex;flex-direction:column;gap:10px;}
      `}</style>
    </SettingsPage>
  );
}
