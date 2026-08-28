'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  EmptyState,
  Alert,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsSection,
  Toggle,
  TextInput,
} from '@/components/SettingsUI';
import { jsonFetch } from '@/lib/app-settings-client';

interface SourceItem {
  key: string;
  name: string;
  api: string;
  detail?: string;
  from: 'config' | 'custom';
  disabled?: boolean;
}

interface CheckResult { ok: boolean; ms?: number; count?: number; error?: string }
type CheckState = Record<string, CheckResult | 'checking'>;

export default function TvSources() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<CheckState>({});
  const [form, setForm] = useState({ name: '', api: '', detail: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await jsonFetch<{ sources: SourceItem[] }>('/tv/api/admin/source');
      setSources(d.sources || []);
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取影视源失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, successMessage: string) {
    try {
      const res = await fetch('/tv/api/admin/source', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `操作失败：HTTP ${res.status}`);
      setMessage(successMessage);
      setError('');
      await load();
      return d;
    } catch (err) {
      setError((err as Error).message || '操作失败');
      return null;
    }
  }

  async function check(key: string, all = false) {
    const list = all ? sources.filter((s) => !s.disabled).map((s) => s.key) : [key];
    setChecks((prev) => {
      const next = { ...prev };
      list.forEach((k) => { next[k] = 'checking'; });
      return next;
    });
    for (const k of list) {
      try {
        const d = await jsonFetch<CheckResult>('/tv/api/admin/source', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'check', key: k }),
        });
        setChecks((prev) => ({ ...prev, [k]: d }));
      } catch (err) {
        setChecks((prev) => ({ ...prev, [k]: { ok: false, error: (err as Error).message } }));
      }
    }
  }

  async function addSource() {
    if (!form.name.trim() || !/^https?:\/\//i.test(form.api.trim())) {
      setError('请输入源名称和 http(s) API 地址');
      return;
    }
    const key = `custom-${Date.now().toString(36)}`;
    const ok = await post({ action: 'add', key, name: form.name.trim(), api: form.api.trim(), detail: form.detail.trim() }, '自定义源已添加');
    if (ok) setForm({ name: '', api: '', detail: '' });
  }

  const enabled = sources.filter((s) => !s.disabled).length;

  return (
    <div>
      <div className="mei-source-stats" style={{ marginBottom: 16 }}>
        <Pill tone="neutral">{sources.length} 个源</Pill>
        <Pill tone="success">{enabled} 个启用</Pill>
      </div>
      <SettingsSection
        title="源列表"
        description="检测会向源站发起一次搜索请求，全部检测按顺序执行。"
        wide
        actions={
          <>
            <SettingsButton onClick={() => void check('', true)} disabled={loading}>全部检测</SettingsButton>
            <SettingsButton variant="danger" onClick={() => void post({ action: 'reset' }, '内置源已恢复')}>恢复内置源</SettingsButton>
          </>
        }
      >
        {loading ? <EmptyState title="正在读取源列表…" /> : sources.length === 0 ? <EmptyState title="暂无影视源" /> : (
          <div className="source-grid">
            {sources.map((s) => {
              const result = checks[s.key];
              return (
                <article key={s.key} className={s.disabled ? 'disabled' : ''}>
                  <header>
                    <div>
                      <strong>{s.name}</strong>
                      <small>{s.from === 'custom' ? '自定义' : '内置'}</small>
                    </div>
                    <Toggle
                      checked={!s.disabled}
                      onChange={() => void post({ action: s.disabled ? 'enable' : 'disable', key: s.key }, `${s.name} 已${s.disabled ? '启用' : '停用'}`)}
                      label={`启用 ${s.name}`}
                      hideLabel
                    />
                  </header>
                  <p>{s.api}</p>
                  <footer>
                    <span className={result && result !== 'checking' && result.ok ? 'ok' : result && result !== 'checking' ? 'bad' : ''}>
                      {result === 'checking' ? '检测中…' : !result ? '未检测' : result.ok ? `可用 · ${result.ms}ms · ${result.count ?? 0} 条` : result.error || '不可用'}
                    </span>
                    <div>
                      <SettingsButton onClick={() => void check(s.key)}>检测</SettingsButton>
                      {s.from === 'custom' ? (
                        <SettingsButton variant="danger" onClick={() => void post({ action: 'delete', key: s.key }, `${s.name} 已删除`)}>删除</SettingsButton>
                      ) : null}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="添加自定义源" description="API 地址需为标准 CMS 资源接口。" wide>
        <div className="mei-grid">
          <SettingsField label="名称">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="资源站名称" />
          </SettingsField>
          <SettingsField label="API 地址">
            <TextInput value={form.api} onChange={(e) => setForm({ ...form, api: e.target.value })} placeholder="https://example.com/api.php/provide/vod" />
          </SettingsField>
          <SettingsField label="说明" span>
            <TextInput value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="备注说明，例如源站特点" />
          </SettingsField>
        </div>
        <div className="footer-actions">
          <SettingsButton variant="primary" onClick={() => void addSource()}>添加源</SettingsButton>
        </div>
      </SettingsSection>

      <SettingsSection title="操作结果" wide>
        {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}
      </SettingsSection>

      <style>{`
        .source-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
        .source-grid article{padding:13px;border:1px solid var(--mei-border);border-radius:16px;background:rgba(255,255,255,.6);display:flex;flex-direction:column;gap:9px;min-width:0;}
        .source-grid article.disabled{opacity:.62;}
        .source-grid header{display:flex;justify-content:space-between;align-items:center;gap:10px;}
        .source-grid header div{display:flex;align-items:center;gap:7px;min-width:0;}
        .source-grid strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .source-grid small{height:20px;padding:0 7px;border-radius:99px;background:rgba(99,102,241,.1);color:var(--mei-primary);font-size:10px;font-weight:800;display:inline-flex;align-items:center;}
        .source-grid p{margin:0;font-size:11px;color:var(--mei-text-muted);word-break:break-all;line-height:1.5;}
        .source-grid footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:auto;}
        .source-grid footer>span{font-size:11px;color:var(--mei-text-muted);min-width:0;}
        .source-grid footer>span.ok{color:#059669;}
        .source-grid footer>span.bad{color:#dc2626;}
        .source-grid footer>div{display:flex;gap:6px;flex-shrink:0;}
        .footer-actions{display:flex;justify-content:flex-end;margin-top:12px;}
      `}</style>
    </div>
  );
}
