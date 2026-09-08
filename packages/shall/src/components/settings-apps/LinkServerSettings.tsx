'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  Select,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';
import { ensureAppSession, jsonFetch } from '@/lib/app-settings-client';

interface ServerConfig {
  serverAddr: string;
  serverPort: number | string;
  authToken?: string;
  subDomainHost?: string;
  managementURL?: string;
  domainAPIToken?: string;
  vhostHTTPPort?: number | string;
  vhostHTTPSPort?: number | string;
  tlsEnabled?: boolean;
  adminPort?: number | string;
  adminUser?: string;
  adminPassword?: string;
}

interface ReconnectConfig {
  enabled: boolean;
  intervalSeconds: number;
  mode: 'reconnect' | 'restart';
  maxAttempts: number;
}

const EMPTY: ServerConfig = {
  serverAddr: '',
  serverPort: 7000,
  authToken: '',
  subDomainHost: '',
  managementURL: '',
  domainAPIToken: '',
  vhostHTTPPort: 8080,
  vhostHTTPSPort: 8443,
  tlsEnabled: false,
  adminPort: 7400,
  adminUser: '',
  adminPassword: '',
};

export default function LinkServerSettings() {
  const [config, setConfig] = useState<ServerConfig>(EMPTY);
  const [reconnect, setReconnect] = useState<ReconnectConfig>({
    enabled: false,
    intervalSeconds: 15,
    mode: 'reconnect',
    maxAttempts: 10,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const searchParams = useSearchParams();
  // mei-link 引导弹层深链带来 ?highlight=serverAddr,serverPort,authToken（字段名与其表单 name 对齐）
  const highlight = useMemo(
    () => (searchParams.get('highlight') || '').split(',').map((s) => s.trim()).filter(Boolean),
    [searchParams]
  );
  const hl = useCallback((name: string) => highlight.includes(name), [highlight]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      await ensureAppSession('mei-link');
      const [cfg, rc] = await Promise.all([
        jsonFetch<ServerConfig | null>('/link/api/server-config'),
        jsonFetch<ReconnectConfig>('/link/api/reconnect'),
      ]);
      if (cfg) setConfig({ ...EMPTY, ...cfg, authToken: '', adminPassword: '' });
      setReconnect(rc);
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(start = false) {
    setBusy(start ? 'connect' : 'save');
    setMessage('');
    setError('');
    try {
      const payload = { ...config };
      if (!payload.authToken) delete payload.authToken;
      if (!payload.adminPassword) delete payload.adminPassword;
      const res = await fetch('/link/api/server-config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `保存失败：HTTP ${res.status}`);
      }
      await jsonFetch('/link/api/reconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reconnect),
      });
      if (start) {
        const startRes = await fetch('/link/api/control/start', { method: 'POST', credentials: 'include' });
        if (!startRes.ok) {
          const d = await startRes.json().catch(() => ({}));
          throw new Error(d.error || '保存成功，但连接启动失败');
        }
      }
      setMessage(start ? '已保存并开始连接' : '服务器配置已保存');
      setConfig((prev) => ({ ...prev, authToken: '', adminPassword: '' }));
    } catch (err) {
      setError((err as Error).message || '保存失败');
    } finally {
      setBusy('');
    }
  }

  async function testConnection() {
    setBusy('test');
    setMessage('');
    setError('');
    try {
      const d = await jsonFetch<{ ok: boolean; err?: string }>('/link/api/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addr: config.serverAddr, port: Number(config.serverPort) }),
      });
      if (!d.ok) throw new Error(d.err || '连接测试失败');
      setMessage('服务器端口连通');
    } catch (err) {
      setError((err as Error).message || '连接测试失败');
    } finally {
      setBusy('');
    }
  }

  async function bootstrap() {
    setBusy('bootstrap');
    setMessage('');
    setError('');
    try {
      // POST 带上表单当前的管理页地址与 token：填完即可直接拉取，不需要先保存
      const d = await jsonFetch<Partial<ServerConfig> & { error?: string }>('/link/api/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ managementURL: config.managementURL, domainAPIToken: config.domainAPIToken }),
      });
      if (d.error) throw new Error(d.error);
      setConfig((prev) => ({
        ...prev,
        serverAddr: d.serverAddr || prev.serverAddr,
        serverPort: d.serverPort || prev.serverPort,
        authToken: d.authToken || prev.authToken,
        subDomainHost: d.subDomainHost || prev.subDomainHost,
        vhostHTTPPort: d.vhostHTTPPort ?? prev.vhostHTTPPort,
        vhostHTTPSPort: d.vhostHTTPSPort ?? prev.vhostHTTPSPort,
        tlsEnabled: d.tlsEnabled ?? prev.tlsEnabled,
      }));
      setMessage('已从服务端拉取配置，请确认后保存');
    } catch (err) {
      setError((err as Error).message || '拉取配置失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <SettingsPage
      icon="lucide:server"
      title="隧道服务器设置"
      description="配置 frp 服务器连接、管理接口与断线恢复策略。"
      actions={
        <>
          <Pill tone={loading ? 'warning' : 'neutral'}>{loading ? '读取中' : '已同步'}</Pill>
          <SettingsButton variant="secondary" onClick={() => void save(false)} disabled={busy !== ''}>
            {busy === 'save' ? '保存中' : '保存设置'}
          </SettingsButton>
          <SettingsButton variant="primary" onClick={() => void save(true)} disabled={busy !== ''}>
            {busy === 'connect' ? '连接中' : '保存并连接'}
          </SettingsButton>
        </>
      }
    >
      <SettingsSection
        title="服务器连接"
        description="这些参数用于生成 frpc.toml 并建立隧道连接。"
        actions={
          <SettingsButton onClick={testConnection} disabled={busy !== '' || !config.serverAddr}>
            {busy === 'test' ? '测试中' : '测试连接'}
          </SettingsButton>
        }
      >
        <div className="mei-grid">
          <SettingsField label="服务器地址" highlight={hl('serverAddr')}>
            <TextInput value={config.serverAddr} onChange={(e) => setConfig({ ...config, serverAddr: e.target.value })} placeholder="frps.example.com" />
          </SettingsField>
          <SettingsField label="服务器端口" highlight={hl('serverPort')}>
            <TextInput type="number" value={config.serverPort} onChange={(e) => setConfig({ ...config, serverPort: e.target.value })} />
          </SettingsField>
          <SettingsField label="连接令牌" hint="留空表示沿用已保存的令牌。" highlight={hl('authToken')}>
            <TextInput type="password" value={config.authToken || ''} onChange={(e) => setConfig({ ...config, authToken: e.target.value })} />
          </SettingsField>
          <SettingsField label="子域名主机" highlight={hl('subDomainHost')}>
            <TextInput value={config.subDomainHost || ''} onChange={(e) => setConfig({ ...config, subDomainHost: e.target.value })} placeholder="example.com" />
          </SettingsField>
          <SettingsField label="HTTP 端口">
            <TextInput type="number" value={config.vhostHTTPPort || ''} onChange={(e) => setConfig({ ...config, vhostHTTPPort: e.target.value })} />
          </SettingsField>
          <SettingsField label="HTTPS 端口">
            <TextInput type="number" value={config.vhostHTTPSPort || ''} onChange={(e) => setConfig({ ...config, vhostHTTPSPort: e.target.value })} />
          </SettingsField>
          <div className="mei-field span">
            <Toggle checked={!!config.tlsEnabled} onChange={(v) => setConfig({ ...config, tlsEnabled: v })} label="启用 TLS" description="frps 开启 TLS 时开启。" />
          </div>
        </div>
      </SettingsSection>

      <div className="mei-grid mei-grid-equal">
        <SettingsSection
          title="服务端管理接口"
          description="填写服务端管理页地址后即可一键拉取连接配置与可用域名，无需逐项手填。"
          actions={
            <SettingsButton onClick={bootstrap} disabled={busy !== ''}>
              {busy === 'bootstrap' ? '拉取中' : '从服务端拉取配置'}
            </SettingsButton>
          }
        >
          <div className="mei-field-stack">
            <SettingsField label="管理页地址" hint="服务端 mei-link 管理页地址，如 http://frps.example.com:8080" span highlight={hl('managementURL')}>
              <TextInput value={config.managementURL || ''} onChange={(e) => setConfig({ ...config, managementURL: e.target.value })} />
            </SettingsField>
            <SettingsField label="接口 Token" hint="服务端 MEILINK_DOMAIN_API_TOKEN。" span highlight={hl('domainAPIToken')}>
              <TextInput type="password" value={config.domainAPIToken || ''} onChange={(e) => setConfig({ ...config, domainAPIToken: e.target.value })} />
            </SettingsField>
          </div>
        </SettingsSection>
        <SettingsSection title="本地管理接口" description="frpc Admin API，用于状态读取与进程管理。">
          <div className="mei-field-stack">
            <SettingsField label="端口" highlight={hl('adminPort')}>
              <TextInput type="number" value={config.adminPort || ''} onChange={(e) => setConfig({ ...config, adminPort: e.target.value })} />
            </SettingsField>
            <SettingsField label="用户名">
              <TextInput value={config.adminUser || ''} onChange={(e) => setConfig({ ...config, adminUser: e.target.value })} />
            </SettingsField>
            <SettingsField label="密码" hint="留空表示沿用已保存的密码。" span>
              <TextInput type="password" value={config.adminPassword || ''} onChange={(e) => setConfig({ ...config, adminPassword: e.target.value })} />
            </SettingsField>
          </div>
        </SettingsSection>
      </div>

      <SettingsSection
        title="自动重连"
        description="重连打满次数后自动升级为重启，两种方式都失败才停止。"
      >
        <div className="mei-grid">
          <div className="mei-field span">
            <Toggle checked={reconnect.enabled} onChange={(v) => setReconnect({ ...reconnect, enabled: v })} label="启用断线自动恢复" description="仅进程退出或日志识别到断线时触发。" />
          </div>
          <SettingsField label="重连间隔（秒）" hint="范围 5-3600 秒。">
            <TextInput type="number" min={5} max={3600} value={reconnect.intervalSeconds} onChange={(e) => setReconnect({ ...reconnect, intervalSeconds: Number(e.target.value) })} />
          </SettingsField>
          <SettingsField label="最大连续尝试次数" hint="0 表示不限制。">
            <TextInput type="number" min={0} max={9999} value={reconnect.maxAttempts} onChange={(e) => setReconnect({ ...reconnect, maxAttempts: Number(e.target.value) })} />
          </SettingsField>
          <SettingsField label="恢复方式">
            <Select value={reconnect.mode} onChange={(e) => setReconnect({ ...reconnect, mode: e.target.value as ReconnectConfig['mode'] })}>
              <option value="reconnect">重新连接</option>
              <option value="restart">直接重启</option>
            </Select>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="操作结果">
        {message ? <Alert tone="success" title={message} /> : null}
        {error ? <Alert tone="error" title={error} description="请根据错误提示调整上方配置后重试。" /> : null}
        {!message && !error ? <div className="mei-cloud-info"><strong>连接令牌与管理密码留空时会沿用已有值</strong></div> : null}
      </SettingsSection>

      <style>{`
        .mei-grid-equal{align-items:stretch;margin-bottom:20px;}
        .mei-grid-equal>section{height:100%;display:flex;flex-direction:column;}
        .mei-grid-equal .mei-field-stack{display:flex;flex-direction:column;gap:12px;height:100%;}
      `}</style>
    </SettingsPage>
  );
}
