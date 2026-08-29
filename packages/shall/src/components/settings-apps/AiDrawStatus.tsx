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
import { authorizedJsonFetch } from '@/lib/app-settings-client';

interface StatPoint { date: string; count: number }
interface ChatLog { id: string; userId: string; modelName: string; timestamp: string; details?: string }
interface FileLog { id: string; userId: string; fileTitle: string; timestamp: string }
interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export default function AiDrawStatus() {
  const [chatStats, setChatStats] = useState<StatPoint[]>([]);
  const [fileStats, setFileStats] = useState<StatPoint[]>([]);
  const [chatLogs, setChatLogs] = useState<Paged<ChatLog> | null>(null);
  const [fileLogs, setFileLogs] = useState<Paged<FileLog> | null>(null);
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function detailText(value: unknown): string {
    if (!value) return '-';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = userId ? `?userId=${encodeURIComponent(userId)}&` : '?';
      const [cs, fs, cl, fl] = await Promise.all([
        authorizedJsonFetch<StatPoint[]>(`/draw/api/admin/stats/chat-by-date${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, 'ai-draw'),
        authorizedJsonFetch<StatPoint[]>(`/draw/api/admin/stats/file-by-date${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, 'ai-draw'),
        authorizedJsonFetch<Paged<ChatLog>>(`/draw/api/admin/logs/chat${q}page=${page}&pageSize=10`, 'ai-draw'),
        authorizedJsonFetch<Paged<FileLog>>(`/draw/api/admin/logs/file${q}page=${page}&pageSize=10`, 'ai-draw'),
      ]);
      setChatStats(Array.isArray(cs) ? cs : []);
      setFileStats(Array.isArray(fs) ? fs : []);
      setChatLogs(cl);
      setFileLogs(fl);
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取绘图运行状态失败');
    } finally {
      setLoading(false);
    }
  }, [userId, page]);

  useEffect(() => { void load(); }, [load]);

  const chatTotal = useMemo(() => chatStats.reduce((sum, item) => sum + item.count, 0), [chatStats]);
  const fileTotal = useMemo(() => fileStats.reduce((sum, item) => sum + item.count, 0), [fileStats]);
  const max = Math.max(1, ...chatStats.map((v) => v.count), ...fileStats.map((v) => v.count));

  return (
    <SettingsPage
      icon="lucide:bar-chart"
      title="绘图运行状态"
      description="查看近 7 天 AI 对话与文件生成情况。"
      actions={<Pill tone={loading ? 'warning' : 'neutral'}>{loading ? '读取中' : `${chatTotal + fileTotal} 次生成`}</Pill>}
    >
      <SettingsSection
        title="筛选"
        actions={<SettingsButton variant="primary" onClick={() => void load()}>查询</SettingsButton>}
      >
        <div className="mei-grid">
          <SettingsField label="用户 ID" hint="留空查看全部用户。">
            <TextInput value={userId} onChange={(e) => { setUserId(e.target.value.trim()); setPage(1); }} placeholder="user-id" />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="生成概览">
        <div className="metric-grid">
          <div className="metric chat">
            <span>AI 对话</span>
            <strong>{chatTotal}</strong>
          </div>
          <div className="metric file">
            <span>文件创建</span>
            <strong>{fileTotal}</strong>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="近 7 天趋势">
        {chatStats.length === 0 && fileStats.length === 0 ? <EmptyState title="暂无统计数据" /> : (
          <div className="chart-wrap">
            <div className="chart-legend">
              <span><i className="bar chat" /> AI 对话</span>
              <span><i className="bar file" /> 文件创建</span>
            </div>
            <div className="chart">
              {[...chatStats].reverse().map((item, i) => {
                const fileItem = [...fileStats].reverse()[i];
                return (
                  <div key={item.date} className="chart-day">
                    <div className="bars">
                      <div className="bar chat" style={{ height: `${Math.max(3, (item.count / max) * 100)}px` }} />
                      <div className="bar file" style={{ height: `${Math.max(3, ((fileItem?.count || 0) / max) * 100)}px` }} />
                    </div>
                    <small>{item.date.slice(5)}</small>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="AI 对话记录">
        {error ? <Alert tone="error" title={error} /> : !chatLogs?.items.length ? <EmptyState title="暂无对话记录" /> : (
          <table className="mei-table">
            <thead><tr><th>时间</th><th>用户</th><th>模型</th><th>详情</th></tr></thead>
            <tbody>
              {chatLogs.items.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.timestamp).toLocaleString()}</td>
                  <td>{item.userId}</td>
                  <td>{item.modelName || '-'}</td>
                  <td>{detailText(item.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsSection>

      <SettingsSection title="文件生成记录">
        {!fileLogs?.items.length ? <EmptyState title="暂无文件记录" /> : (
          <table className="mei-table">
            <thead><tr><th>时间</th><th>用户</th><th>文件</th></tr></thead>
            <tbody>
              {fileLogs.items.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.timestamp).toLocaleString()}</td>
                  <td>{item.userId}</td>
                  <td>{item.fileTitle || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsSection>

      <div className="mei-footer-actions pager">
        <SettingsButton onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page <= 1}>上一页</SettingsButton>
        <span>第 {page} 页 / 共 {Math.max(1, Math.ceil(Math.max(chatLogs?.total || 0, fileLogs?.total || 0) / 10))} 页</span>
        <SettingsButton onClick={() => setPage((v) => v + 1)} disabled={page >= Math.ceil(Math.max(chatLogs?.total || 0, fileLogs?.total || 0) / 10)}>下一页</SettingsButton>
      </div>

      <style>{`
        .metric{padding:18px;border-radius:16px;}
        .metric span{display:block;font-size:11.5px;color:var(--mei-text-muted);margin-bottom:6px;}
        .metric strong{font-size:30px;font-weight:900;letter-spacing:-1px;}
        .metric-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
        .metric.chat{background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.08));}
        .metric.file{background:linear-gradient(135deg,rgba(14,165,233,.12),rgba(56,189,248,.08));}
        .chart-wrap{display:flex;flex-direction:column;gap:10px;}
        .chart-legend{display:flex;gap:16px;font-size:11.5px;color:var(--mei-text-muted);font-weight:700;}
        .chart-legend i{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:5px;vertical-align:middle;}
        .chart-legend i.chat{background:linear-gradient(180deg,#818cf8,#6366f1);}
        .chart-legend i.file{background:linear-gradient(180deg,#38bdf8,#0ea5e9);}
        .chart{display:flex;gap:8px;overflow-x:auto;padding-top:10px;}
        .chart-day{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:38px;}
        .bars{display:flex;gap:4px;align-items:flex-end;min-height:100px;}
        .bars .bar{width:14px;border-radius:6px 6px 3px 3px;}
        .bars .bar.chat{background:linear-gradient(180deg,#818cf8,#6366f1);}
        .bars .bar.file{background:linear-gradient(180deg,#38bdf8,#0ea5e9);}
        .chart small{font-size:10px;color:var(--mei-text-muted);white-space:nowrap;}
        .pager{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:13px;font-size:12px;color:var(--mei-text-muted);}
      `}</style>
    </SettingsPage>
  );
}
