'use client';

import { useRef, useState } from 'react';
import MeiIcon from '@/components/MeiIcon';
import {
  Alert,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  SettingsTabs,
  TextInput,
} from '@/components/SettingsUI';
import {
  BACKUP_SCOPES,
  BACKUP_SCOPE_META,
  BROWSER_STORAGE_KEYS,
  type BackupMode,
  type BackupScope,
} from '@/lib/backup-scopes';

type CloudTarget = 'webdav' | 's3';
type Tab = 'local' | 'cloud';

interface WebdavForm {
  url: string;
  username: string;
  password: string;
}

interface S3Form {
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
  accessKey: string;
  secretKey: string;
}

type BrowserData = Record<string, Record<string, string>>;

const EMPTY_WEBDAV: WebdavForm = { url: '', username: '', password: '' };
const EMPTY_S3: S3Form = {
  endpoint: '',
  region: '',
  bucket: '',
  key: 'backups/mei-portal-backup.zip',
  accessKey: '',
  secretKey: '',
};

function collectBrowserData(scopes: BackupScope[]): BrowserData {
  const data: BrowserData = {};
  for (const scope of scopes) {
    const record: Record<string, string> = {};
    for (const key of BROWSER_STORAGE_KEYS[scope]) {
      const value = localStorage.getItem(key);
      if (value !== null) record[key] = value;
    }
    data[scope] = record;
  }
  return data;
}

function applyBrowserData(data: BrowserData, mode: BackupMode): void {
  for (const [scope, values] of Object.entries(data)) {
    const known = BROWSER_STORAGE_KEYS[scope as BackupScope] || [];
    if (mode === 'replace') {
      for (const key of known) {
        if (!(key in values)) localStorage.removeItem(key);
      }
    }
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, value);
    }
  }
  window.dispatchEvent(new Event('config:saved'));
  window.dispatchEvent(new Event('storage'));
}

function shouldReload(scopes: string[]): boolean {
  return scopes.some((scope) => scope !== 'pansou');
}

export default function BackupSettings() {
  const [scopes, setScopes] = useState<BackupScope[]>(BACKUP_SCOPES);
  const [tab, setTab] = useState<Tab>('local');
  const [mode, setMode] = useState<BackupMode>('replace');
  const [target, setTarget] = useState<CloudTarget>('webdav');
  const [webdav, setWebdav] = useState<WebdavForm>(EMPTY_WEBDAV);
  const [s3, setS3] = useState<S3Form>(EMPTY_S3);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleScope(scope: BackupScope) {
    setScopes((prev) => {
      if (prev.includes(scope)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== scope);
      }
      return [...prev, scope];
    });
    setMessage('');
    setError('');
  }

  async function exportZip() {
    setBusy('export');
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/backup/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes, browserData: collectBrowserData(scopes) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || '导出失败');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mei-portal-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(`已导出 ${scopes.length} 项数据的 Zip 备份包`);
    } catch (err) {
      setError((err as Error).message || '导出失败');
    } finally {
      setBusy('');
    }
  }

  async function importZip(file: File) {
    setBusy('import');
    setMessage('');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '导入失败');
      applyBrowserData((body as { browserData?: BrowserData }).browserData || {}, mode);
      const restarted = (body as { restarted?: string[] }).restarted || [];
      const warning = (body as { restartWarning?: string }).restartWarning;
      const scopes = (body as { scopes?: string[] }).scopes || [];
      const base = `已${mode === 'replace' ? '整包恢复' : '合并去重恢复'}${restarted.length ? `，并重启应用：${restarted.join('、')}` : ''}${warning ? `（${warning}）` : ''}`;
      setMessage(shouldReload(scopes) ? `${base} 页面即将刷新以加载恢复后的数据。` : base);
      if (shouldReload(scopes)) {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch (err) {
      setError((err as Error).message || '导入失败');
    } finally {
      setBusy('');
    }
  }

  async function remote(direction: 'export' | 'import') {
    setBusy(`${target}-${direction}`);
    setMessage('');
    setError('');
    try {
      const payload: Record<string, unknown> = {
        direction,
        target,
        config: target === 'webdav' ? webdav : s3,
        mode,
      };
      if (direction === 'export') {
        payload.scopes = scopes;
        payload.browserData = collectBrowserData(scopes);
      }
      const res = await fetch('/api/backup/remote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || '云端操作失败');
      if (direction === 'import') {
        applyBrowserData((body as { browserData?: BrowserData }).browserData || {}, mode);
        const restarted = (body as { restarted?: string[] }).restarted || [];
        const warning = (body as { restartWarning?: string }).restartWarning;
        const scopes = (body as { scopes?: string[] }).scopes || [];
        const base = `已从云端${mode === 'replace' ? '整包恢复' : '合并恢复'}${restarted.length ? `，并重启应用：${restarted.join('、')}` : ''}${warning ? `（${warning}）` : ''}`;
        setMessage(shouldReload(scopes) ? `${base} 页面即将刷新以加载恢复后的数据。` : base);
        if (shouldReload(scopes)) {
          window.setTimeout(() => window.location.reload(), 1200);
        }
      } else {
        setMessage((body as { message?: string }).message || '已备份到云端');
      }
    } catch (err) {
      setError((err as Error).message || '云端操作失败');
    } finally {
      setBusy('');
    }
  }

  const restoreLabel = mode === 'replace' ? '整包覆盖' : '合并去重';

  return (
    <SettingsPage
      icon="lucide:database"
      title="数据备份/恢复"
      description="按应用勾选备份范围，支持 Zip 与 WebDAV/S3 两种备份目标。"
      actions={
        <>
          <Pill tone="neutral">已选 {scopes.length}/{BACKUP_SCOPES.length} 项</Pill>
          {tab === 'local' ? (
            <>
              <SettingsButton onClick={() => fileRef.current?.click()} disabled={busy !== ''}>
                {busy === 'import' ? '恢复中…' : `按「${restoreLabel}」恢复`}
              </SettingsButton>
              <SettingsButton variant="primary" onClick={() => void exportZip()} disabled={busy !== ''}>
                {busy === 'export' ? '导出中…' : '导出 Zip 包'}
              </SettingsButton>
            </>
          ) : (
            <>
              <SettingsButton onClick={() => void remote('export')} disabled={busy !== ''}>
                {busy === `${target}-export` ? '备份中…' : '备份到云端'}
              </SettingsButton>
              <SettingsButton
                variant="primary"
                onClick={() => {
                  if (window.confirm(`从云端按「${restoreLabel}」恢复所选范围数据，确定继续吗？`)) void remote('import');
                }}
                disabled={busy !== ''}
              >
                {busy === `${target}-import` ? '恢复中…' : '从云端恢复'}
              </SettingsButton>
            </>
          )}
        </>
      }
      tabs={
        <SettingsTabs
          items={[
            { id: 'local', label: '本机文件', icon: 'lucide:folder' },
            { id: 'cloud', label: '云端同步', icon: 'lucide:cloud' },
          ]}
          active={tab}
          onChange={(id) => setTab(id as Tab)}
        />
      }
    >
      {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}

      <SettingsSection title="备份范围" description="默认包含全部应用；取消勾选后该应用的数据不会进入备份包。">
        <div className="backup-scope-grid">
          {BACKUP_SCOPES.map((scope) => {
            const meta = BACKUP_SCOPE_META[scope];
            const checked = scopes.includes(scope);
            return (
              <button
                key={scope}
                className={`backup-scope-card${checked ? ' checked' : ''}`}
                onClick={() => toggleScope(scope)}
                type="button"
              >
                <span className="backup-scope-icon">
                  <MeiIcon icon={meta.icon} size={17} />
                </span>
                <span className="backup-scope-main">
                  <strong>{meta.name}</strong>
                  <small>{meta.description}</small>
                </span>
                <span className="backup-check">{checked ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="恢复策略" description="整包覆盖会完整还原备份时刻；合并去重会保留当前数据并补充备份中缺失的内容。">
        <div className="mei-grid">
          <SettingsField label="恢复模式">
            <select className="mei-select" value={mode} onChange={(e) => setMode(e.target.value as BackupMode)}>
              <option value="replace">整包覆盖（推荐）</option>
              <option value="merge">合并去重</option>
            </select>
          </SettingsField>
          <div className="mei-field">
            <span>说明</span>
            <p className="backup-mode-hint">
              {mode === 'replace'
                ? '覆盖后与备份时刻完全一致，受影响应用会自动重启。'
                : '各应用按稳定键去重合并，不会删除当前数据。'}
            </p>
          </div>
        </div>
      </SettingsSection>

      {tab === 'local' ? (
        <SettingsSection title="本机 Zip 备份" description="导出整个备份包或从备份包恢复。">
          <div className="mei-cloud-info">
            <strong>操作入口在页面右上角</strong>
            <p>「导出 Zip 包」下载包含所选应用数据的压缩包；「按策略恢复」从备份包按当前恢复策略还原数据。</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="mei-file-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importZip(file);
              e.target.value = '';
            }}
          />
        </SettingsSection>
      ) : (
        <SettingsSection title="云端备份" description="支持 WebDAV 与 S3 兼容对象存储，凭据仅本次操作使用。">
          <div className="cloud-target-row">
            {(['webdav', 's3'] as const).map((item) => (
              <button key={item} className={target === item ? 'active' : ''} onClick={() => setTarget(item)}>
                {item === 'webdav' ? 'WebDAV' : 'S3'}
              </button>
            ))}
          </div>
          {target === 'webdav' ? (
            <div className="mei-grid" style={{ marginTop: 14 }}>
             <SettingsField label="文件地址" span>
                <TextInput value={webdav.url} onChange={(e) => setWebdav({ ...webdav, url: e.target.value })} placeholder="https://dav.example.com/backups/mei-portal-backup.zip" />
              </SettingsField>
              <SettingsField label="用户名">
                <TextInput value={webdav.username} onChange={(e) => setWebdav({ ...webdav, username: e.target.value })} />
              </SettingsField>
              <SettingsField label="密码">
                <TextInput type="password" value={webdav.password} onChange={(e) => setWebdav({ ...webdav, password: e.target.value })} />
              </SettingsField>
            </div>
          ) : (
            <div className="mei-grid" style={{ marginTop: 14 }}>
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
          <div className="mei-cloud-info" style={{ marginTop: 16 }}>
            <strong>操作入口在页面右上角</strong>
            <p>「备份到云端」上传当前范围数据；「从云端恢复」按当前恢复策略拉取云端备份。</p>
          </div>
        </SettingsSection>
      )}

      <style>{`
        .backup-scope-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
        .backup-scope-card{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid var(--mei-border);border-radius:15px;background:rgba(255,255,255,.62);cursor:pointer;text-align:left;transition:var(--mei-transition);}
        .backup-scope-card:hover{border-color:rgba(99,102,241,.35);transform:translateY(-1px);}
        .backup-scope-card.checked{border-color:rgba(99,102,241,.45);background:rgba(99,102,241,.07);}
        .backup-scope-icon{width:32px;height:32px;flex-shrink:0;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:var(--mei-primary);background:rgba(99,102,241,.1);}
        .backup-scope-main{min-width:0;flex:1;}
        .backup-scope-main strong{display:block;font-size:12.5px;font-weight:800;}
        .backup-scope-main small{display:block;margin-top:2px;font-size:10.5px;line-height:1.4;color:var(--mei-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .backup-check{width:20px;height:20px;border-radius:7px;border:1px solid var(--mei-border-strong);display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#fff;background:transparent;flex-shrink:0;}
        .backup-scope-card.checked .backup-check{background:var(--mei-primary);border-color:var(--mei-primary);}
        .backup-mode-hint{margin:0;font-size:12px;color:var(--mei-text-muted);line-height:1.6;padding-top:9px;}
        .cloud-target-row{display:inline-flex;gap:6px;padding:4px;background:rgba(255,255,255,.8);border:1px solid var(--mei-border);border-radius:12px;}
        .cloud-target-row button{height:32px;padding:0 14px;border:none;border-radius:9px;background:transparent;font-size:12px;font-weight:750;color:var(--mei-text-muted);cursor:pointer;}
        .cloud-target-row button.active{background:var(--mei-primary);color:#fff;}
        @media(max-width:1000px){.backup-scope-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media(max-width:680px){.backup-scope-grid{grid-template-columns:1fr;}}
      `}</style>
    </SettingsPage>
  );
}
