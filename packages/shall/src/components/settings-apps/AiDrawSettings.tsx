'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  EmptyState,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  Select,
  TextInput,
  Toggle,
} from '@/components/SettingsUI';
import { authorizedJsonFetch } from '@/lib/app-settings-client';

interface Provider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  models?: string[];
  maxTokens?: number;
}

interface AiConfig {
  useCustom?: boolean;
  currentProviderId?: string;
  providers?: Provider[];
}

interface Profile { aiConfig?: AiConfig }
interface SystemSettings {
  allowRegister?: boolean;
  defaultEngine?: string;
  logoColor?: string;
  useLocalDrawio?: boolean;
  drawioBaseUrl?: string;
}
interface AdminSettings { ai?: { provider?: string; baseUrl?: string; apiKey?: string; modelId?: string }; system?: SystemSettings }

const PRESETS = [
  ['custom', '自定义 OpenAI 兼容', ''],
  ['openai', 'OpenAI', 'https://api.openai.com/v1'],
  ['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
  ['siliconflow', 'SiliconFlow', 'https://api.siliconflow.cn/v1'],
  ['volcengine', '火山方舟', 'https://ark.cn-beijing.volces.com/api/v3'],
  ['ollama', 'Ollama', 'http://127.0.0.1:11434/v1'],
  ['moonshot', 'Moonshot', 'https://api.moonshot.cn/v1'],
  ['hunyuan', '混元', 'https://api.hunyuan.cloud.tencent.com/v1'],
] as const;

const emptyProvider = (): Provider => ({
  id: `custom-${Date.now().toString(36)}`,
  name: '新的供应商',
  type: 'custom',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  models: [],
});

export default function AiDrawSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [system, setSystem] = useState<SystemSettings>({});
  const [ai, setAi] = useState<AdminSettings['ai']>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profile, settings] = await Promise.all([
        authorizedJsonFetch<Profile>('/draw/api/auth/profile', 'ai-draw'),
        authorizedJsonFetch<AdminSettings>('/draw/api/admin/settings', 'ai-draw'),
      ]);
      setProviders(profile.aiConfig?.providers || []);
      setSystem(settings.system || {});
      setAi(settings.ai || {});
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取 AI 绘图配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveProviders(next: Provider[]) {
    setBusy('providers');
    try {
      const body = {
        useCustom: next.length > 0,
        currentProviderId: next.find((p) => p.id === editing?.id)?.id || next[0]?.id,
        providers: next,
      };
      await authorizedJsonFetch('/draw/api/auth/profile/ai-config', 'ai-draw', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setProviders(next);
      setMessage('模型供应商已保存');
      setError('');
    } catch (err) {
      setError((err as Error).message || '保存模型供应商失败');
    } finally {
      setBusy('');
    }
  }

  async function saveSystem(next: SystemSettings) {
    setBusy('system');
    try {
      await authorizedJsonFetch('/draw/api/admin/settings', 'ai-draw', {
        method: 'PUT',
        body: JSON.stringify({ system: next }),
      });
      setSystem(next);
      setMessage('基础设置已保存');
      setError('');
    } catch (err) {
      setError((err as Error).message || '保存基础设置失败');
    } finally {
      setBusy('');
    }
  }

  async function saveNotifications(next: SystemSettings) {
    setBusy('notifications');
    try {
      await authorizedJsonFetch('/draw/api/admin/settings', 'ai-draw', {
        method: 'PUT',
        body: JSON.stringify({ system: next }),
      });
      setSystem(next);
      setMessage('通知设置已保存');
      setError('');
    } catch (err) {
      setError((err as Error).message || '保存通知设置失败');
    } finally {
      setBusy('');
    }
  }

  async function setGlobalProvider(provider: Provider) {
    setBusy(`global-${provider.id}`);
    try {
      const nextAi = {
        provider: provider.type,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        modelId: provider.modelId,
      };
      await authorizedJsonFetch('/draw/api/admin/settings', 'ai-draw', {
        method: 'PUT',
        body: JSON.stringify({ ai: nextAi }),
      });
      setAi(nextAi);
      setMessage(`已将「${provider.name}」设为全局 LLM 供应商`);
      setError('');
    } catch (err) {
      setError((err as Error).message || '设置全局供应商失败');
    } finally {
      setBusy('');
    }
  }

  const globalProvider = providers.find((p) => p.baseUrl === ai?.baseUrl && p.modelId === ai?.modelId);

  return (
    <SettingsPage
      icon="lucide:pen-tool"
      title="AI 绘图设置"
      description="基础设置与模型供应商管理。"
      actions={<Pill tone={loading ? 'warning' : 'success'}>{loading ? '读取中' : globalProvider ? `全局：${globalProvider.name}` : '全局供应商未选择'}</Pill>}
    >
      <SettingsSection title="基础设置" description="控制注册、默认引擎与绘图服务。">
        <div className="toggle-stack">
          <Toggle checked={system.allowRegister !== false} onChange={(v) => setSystem({ ...system, allowRegister: v })} label="允许注册" description="关闭后仅已有账号可登录。" />
          <Toggle checked={!!system.useLocalDrawio} onChange={(v) => setSystem({ ...system, useLocalDrawio: v })} label="使用本地 Draw.io" description="启用后优先访问内网部署的 Draw.io。" />
        </div>
        <div className="mei-grid" style={{ marginTop: 12 }}>
          <SettingsField label="默认绘图引擎">
            <Select value={system.defaultEngine || 'drawio'} onChange={(e) => setSystem({ ...system, defaultEngine: e.target.value })}>
              <option value="drawio">Draw.io</option>
              <option value="excalidraw">Excalidraw</option>
              <option value="mermaid">Mermaid</option>
            </Select>
          </SettingsField>
          <SettingsField label="Logo 颜色">
            <TextInput type="color" value={system.logoColor || '#000000'} onChange={(e) => setSystem({ ...system, logoColor: e.target.value })} />
          </SettingsField>
          {system.useLocalDrawio ? (
            <SettingsField label="Draw.io 地址" span>
              <TextInput value={system.drawioBaseUrl || ''} onChange={(e) => setSystem({ ...system, drawioBaseUrl: e.target.value })} placeholder="http://127.0.0.1:8080" />
            </SettingsField>
          ) : null}
        </div>
        <div className="footer-actions">
          <SettingsButton variant="primary" onClick={() => void saveSystem(system)} disabled={busy !== ''}>保存基础设置</SettingsButton>
        </div>
      </SettingsSection>

      <SettingsSection
        title="模型供应商管理"
        description="维护多个供应商，并选择一个作为全局 LLM 供应商。"
        wide
        actions={<SettingsButton onClick={() => setEditing(emptyProvider())}>添加供应商</SettingsButton>}
      >
        {providers.length === 0 ? <EmptyState title="暂无供应商" description="添加后可一键设为全局 LLM。" /> : (
          <div className="provider-grid">
            {providers.map((p) => (
              <article key={p.id} className={globalProvider?.id === p.id ? 'active' : ''}>
                <header>
                  <strong>{p.name}</strong>
                  <span>{p.type}</span>
                </header>
                <p>{p.baseUrl || '未配置 API 地址'}</p>
                <small>{p.modelId || '未选择模型'}</small>
                <footer>
                  <SettingsButton onClick={() => setEditing(p)}>编辑</SettingsButton>
                  <SettingsButton
                    variant="primary"
                    onClick={() => void setGlobalProvider(p)}
                    disabled={busy !== '' || (!p.apiKey && p.type !== 'ollama')}
                  >
                    {busy === `global-${p.id}` ? '设置中' : '设为全局'}
                  </SettingsButton>
                  <SettingsButton
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`删除供应商「${p.name}」？`)) void saveProviders(providers.filter((v) => v.id !== p.id));
                    }}
                  >
                    删除
                  </SettingsButton>
                </footer>
              </article>
            ))}
          </div>
        )}

        {editing ? (
          <div className="provider-editor">
            <header>
              <strong>编辑供应商</strong>
              <SettingsButton onClick={() => setEditing(null)}>关闭</SettingsButton>
            </header>
            <div className="mei-grid">
              <SettingsField label="名称">
                <TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </SettingsField>
              <SettingsField label="类型">
                <Select value={editing.type} onChange={(e) => {
                  const preset = PRESETS.find(([type]) => type === e.target.value);
                  setEditing({ ...editing, type: e.target.value, baseUrl: preset?.[2] || editing.baseUrl });
                }}>
                  {PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </SettingsField>
              <SettingsField label="API 地址" span>
                <TextInput value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
              </SettingsField>
              <SettingsField label="API Key" span>
                <TextInput type="password" value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} />
              </SettingsField>
              <SettingsField label="模型 ID" span>
                <TextInput value={editing.modelId} onChange={(e) => setEditing({ ...editing, modelId: e.target.value })} />
              </SettingsField>
              <SettingsField label="模型列表（每行一个）" span>
                <textarea
                  className="mei-input"
                  value={(editing.models || []).join('\n')}
                  onChange={(e) => setEditing({ ...editing, models: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) })}
                />
              </SettingsField>
            </div>
            <div className="footer-actions">
              <SettingsButton variant="primary" onClick={() => {
                const next = providers.some((p) => p.id === editing.id)
                  ? providers.map((p) => (p.id === editing.id ? editing : p))
                  : [...providers, editing];
                void saveProviders(next).then(() => setEditing(null));
              }}>
                {busy === 'providers' ? '保存中' : '保存供应商'}
              </SettingsButton>
            </div>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="操作结果" wide>
        {error ? <EmptyState title={error} /> : message ? <EmptyState title={message} /> : <EmptyState title="统一配置中心" description="多语言、示例文件与统计入口已移除。" />}
      </SettingsSection>

      <style>{`
        .toggle-stack{display:flex;flex-direction:column;gap:9px;}
        .footer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:12px;flex-wrap:wrap;}
        .provider-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:14px;}
        .provider-grid article{padding:13px;border:1px solid var(--mei-border);border-radius:16px;background:rgba(255,255,255,.6);display:flex;flex-direction:column;gap:7px;}
        .provider-grid article.active{border-color:rgba(99,102,241,.4);box-shadow:0 0 0 3px rgba(99,102,241,.08);}
        .provider-grid header{display:flex;justify-content:space-between;gap:8px;align-items:center;}
        .provider-grid strong{font-size:13px;}
        .provider-grid span{font-size:10px;padding:2px 7px;border-radius:99px;background:rgba(99,102,241,.1);color:var(--mei-primary);font-weight:800;}
        .provider-grid p,.provider-grid small{margin:0;font-size:11px;color:var(--mei-text-muted);word-break:break-all;}
        .provider-grid footer{display:flex;justify-content:flex-end;gap:6px;margin-top:auto;flex-wrap:wrap;}
        .provider-editor{padding:14px;border:1px dashed var(--mei-border-strong);border-radius:18px;background:rgba(255,255,255,.55);}
        .provider-editor>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
        .provider-editor>header strong{font-size:13px;}
      `}</style>
    </SettingsPage>
  );
}
