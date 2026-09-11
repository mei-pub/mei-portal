'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  EmptyState,
  Pill,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsSection,
  TextInput,
} from '@/components/SettingsUI';
import { ensureAppSession, jsonFetch } from '@/lib/app-settings-client';
import { triggerBrowserDownload } from '@/lib/browser-download';

interface LogEvent {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

interface Status {
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  desiredConnected?: boolean;
}

export default function LinkLogs() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState<'all' | LogEvent['level']>('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      await ensureAppSession('mei-link');
      const [ev, st] = await Promise.all([
        jsonFetch<LogEvent[]>('/link/api/events'),
        jsonFetch<Status>('/link/api/status'),
      ]);
      setEvents(Array.isArray(ev) ? ev : []);
      setStatus(st);
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取日志失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => events.filter((e) => {
    if (level !== 'all' && e.level !== level) return false;
    if (!keyword.trim()) return true;
    const kw = keyword.trim().toLowerCase();
    return e.message.toLowerCase().includes(kw) || e.timestamp.toLowerCase().includes(kw);
  }), [events, keyword, level]);

  async function clearLogs() {
    if (!window.confirm('确定清空当前日志吗？此操作不可撤销。')) return;
    try {
      await jsonFetch('/link/api/events', { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message || '清空失败');
    }
  }

  async function copyLogs() {
    const text = filtered
      .map((e) => `[${new Date(e.timestamp).toLocaleString()}] [${e.level.toUpperCase()}] ${e.message}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
  }

  function downloadLogs() {
    const text = filtered
      .map((e) => `[${new Date(e.timestamp).toLocaleString()}] [${e.level.toUpperCase()}] ${e.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    // 延迟释放 object URL：同步 revoke 会让浏览器下载永远停在下载中
    triggerBrowserDownload(
      blob,
      `meilink-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
  }

  return (
    <SettingsPage
      icon="lucide:scroll-text"
      title="隧道运行日志"
      description="实时查看连接状态、重连升级与 frpc 输出。"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Pill tone={status?.connected ? 'success' : status?.running ? 'warning' : 'neutral'}>
            {status?.connected ? '已连接' : status?.running ? '运行中' : '未运行'}
          </Pill>
          <Pill tone="neutral">{events.length} 条</Pill>
        </div>
      }
    >
      <SettingsSection
        title="日志筛选"
        actions={
          <>
            <SettingsButton onClick={() => void load()}>刷新</SettingsButton>
            <SettingsButton onClick={() => void copyLogs()}>复制</SettingsButton>
            <SettingsButton onClick={downloadLogs}>导出</SettingsButton>
            <SettingsButton variant="danger" onClick={() => void clearLogs()}>清空</SettingsButton>
          </>
        }
      >
        <div className="mei-grid">
          <SettingsField label="关键词">
            <TextInput value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索日志内容" />
          </SettingsField>
          <SettingsField label="级别">
            <div className="chip-group">
              {(['all', 'info', 'warning', 'error'] as const).map((v) => (
                <button key={v} className={level === v ? 'active' : ''} onClick={() => setLevel(v)}>
                  {v === 'all' ? '全部' : v === 'info' ? '信息' : v === 'warning' ? '警告' : '错误'}
                </button>
              ))}
            </div>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="日志流" description="最新日志在最上方，每 3 秒自动刷新。">
        {error ? <Alert tone="error" title={error} /> : loading ? <EmptyState title="正在读取日志…" /> : filtered.length === 0 ? <EmptyState title="暂无日志" description="当前筛选条件下没有匹配记录。" /> : (
          <div className="mei-logs">
            {filtered.map((e, i) => (
              <div key={`${e.timestamp}-${i}`} className={`mei-log ${e.level}`}>
                <span>{new Date(e.timestamp).toLocaleString()}</span>
                <span>{e.level}</span>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="状态摘要">
        <div className="status-grid">
          <div>
            <span>配置状态</span>
            <strong>{status?.configured ? '已配置' : '未配置'}</strong>
          </div>
          <div>
            <span>进程状态</span>
            <strong>{status?.running ? '运行中' : '已停止'}</strong>
          </div>
          <div>
            <span>连接状态</span>
            <strong>{status?.connected ? '已连接' : '未连接'}</strong>
          </div>
          <div>
            <span>期望状态</span>
            <strong>{status?.desiredConnected ? '保持连接' : '保持停止'}</strong>
          </div>
        </div>
      </SettingsSection>

      <style>{`
        .chip-group{display:flex;gap:6px;flex-wrap:wrap;height:38px;align-items:center;}
        .chip-group button{height:28px;padding:0 11px;border:1px solid var(--mei-border);border-radius:99px;background:rgba(255,255,255,.7);font-size:11.5px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;transition:var(--mei-transition);}
        .chip-group button.active{border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:var(--mei-primary);}
        .status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
        .status-grid div{padding:13px;border-radius:14px;background:rgba(255,255,255,.6);border:1px solid var(--mei-border);}
        .status-grid span{display:block;font-size:11px;color:var(--mei-text-muted);margin-bottom:5px;}
        .status-grid strong{font-size:14px;}
        @media(max-width:800px){.status-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
      `}</style>
    </SettingsPage>
  );
}
