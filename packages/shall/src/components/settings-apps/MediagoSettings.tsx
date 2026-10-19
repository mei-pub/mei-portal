'use client';

import { useEffect, useState } from 'react';
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
import { authorizedJsonFetch } from '@/lib/app-settings-client';

// =====================================================================
// 下载中心设置（主应用设置中心原生实现）
// - 基础设置/任务策略：media core 自身配置（下载目录/代理/并发等）
// - 下载引擎（FluxDown）：引擎配置 40+ 键（常规/BT/eD2K）+ Tracker/eD2K
//   订阅 + 刷新 + 运行统计。全部经 /downloads/api 代理，引擎不开放任何
//   独立 web 口（控制台/aria2 RPC 仅容器内可达）。
// =====================================================================

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

interface EngineSnapshot {
  revision: number;
  values: Record<string, string>;
}

interface EngineStats {
  activeTasks: number;
  pendingTasks: number;
  totalDownloadBps: number;
  totalUploadBps: number;
  diskFreeBytes: number | null;
}

type FieldType = 'text' | 'number';

interface EngineField {
  key: string;
  label: string;
  hint?: string;
  type?: FieldType;
}

export default function MediagoSettings() {
  const [config, setConfig] = useState<MediagoConfig>({});
  const [engine, setEngine] = useState<EngineSnapshot | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [cfg, eng] = await Promise.all([
        authorizedJsonFetch<Wrapped<MediagoConfig>>('/downloads/api/config', 'mediago'),
        authorizedJsonFetch<Wrapped<EngineSnapshot>>('/downloads/api/downloads/engine-config', 'mediago').catch(() => null),
      ]);
      setConfig(cfg.data || {});
      if (eng?.data) {
        setEngine(eng.data);
        setDraft(eng.data.values ?? {});
      }
      setError('');
    } catch (err) {
      setError((err as Error).message || '读取下载中心配置失败');
    } finally {
      setLoading(false);
    }
    // 引擎运行统计（信息展示，失败静默）
    try {
      const s = await authorizedJsonFetch<Wrapped<EngineStats>>('/downloads/api/downloads/engine-stats', 'mediago');
      setStats(s.data ?? null);
    } catch { /* 引擎离线时保留空态 */ }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(key: keyof MediagoConfig, silent = false) {
    setSavingKey(key);
    if (!silent) setMessage('');
    setError('');
    try {
      const d = await authorizedJsonFetch<Wrapped<{ message?: string }>>(`/downloads/api/config/${key}`, 'mediago', {
        method: 'PUT',
        body: JSON.stringify({ value: config[key] }),
      });
      if (!silent) setMessage(d.data?.message || `${key} 已保存`);
      return true;
    } catch (err) {
      setError((err as Error).message || '保存失败');
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
    setMessage('基础设置已保存');
  }

  /** 引擎配置保存：只 PATCH 草稿与引擎快照的差异键（revision 由桥接层持有） */
  async function saveEngine() {
    if (!engine) return;
    setMessage('');
    setError('');
    setBusy('engine');
    try {
      const changed: Record<string, string> = {};
      for (const [k, v] of Object.entries(draft)) {
        if ((engine.values ?? {})[k] !== v) changed[k] = v;
      }
      if (Object.keys(changed).length === 0) {
        setMessage('引擎配置无变更');
        return;
      }
      const d = await authorizedJsonFetch<Wrapped<EngineSnapshot>>('/downloads/api/downloads/engine-config', 'mediago', {
        method: 'PATCH',
        body: JSON.stringify({ values: changed }),
      });
      if (!d.data) throw new Error('引擎配置保存失败');
      setEngine(d.data);
      setDraft(d.data.values ?? {});
      setMessage(`引擎配置已保存（${Object.keys(changed).length} 项）`);
    } catch (err) {
      setError((err as Error).message || '引擎配置保存失败');
    } finally {
      setBusy('');
    }
  }

  /** 订阅立即刷新（tracker / eD2K 服务器列表） */
  async function refreshSub(kind: 'trackers' | 'ed2k') {
    setMessage('');
    setError('');
    setBusy(kind);
    try {
      const url = kind === 'trackers'
        ? '/downloads/api/downloads/engine-trackers/refresh'
        : '/downloads/api/downloads/engine-ed2k/refresh';
      const d = await authorizedJsonFetch<Wrapped<{ success?: boolean; trackerCount?: number; serverCount?: number; error?: string }>>(url, 'mediago', { method: 'POST' });
      if (d.data?.success === false) throw new Error(d.data?.error || '刷新未成功');
      setMessage(kind === 'trackers'
        ? `Tracker 订阅已刷新（当前 ${d.data?.trackerCount ?? 0} 个）`
        : `eD2K 服务器列表已刷新（当前 ${d.data?.serverCount ?? 0} 台）`);
      await load();
    } catch (err) {
      setError((err as Error).message || '刷新失败');
    } finally {
      setBusy('');
    }
  }

  const fields: Array<{ key: keyof MediagoConfig; label: string; hint?: string; type?: 'text' | 'number' }> = [
    { key: 'local', label: '下载目录', hint: '服务器保存下载内容的位置。' },
    { key: 'proxy', label: '网络代理', hint: '留空则不使用代理。' },
    { key: 'maxRunner', label: '并发下载数', type: 'number' },
  ];

  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (k: string) => String(draft[k] ?? '');
  const bool = (k: string) => draft[k] === '1' || draft[k] === 'true';
  const setBool = (k: string, v: boolean) => set(k, v ? '1' : '0');

  const commonFields: EngineField[] = [
    { key: 'max_concurrent_tasks', label: '最大并行任务数', type: 'number' },
    { key: 'speed_limit_bytes', label: '全局下载限速（字节/秒）', hint: '0 = 不限制。', type: 'number' },
    { key: 'upload_limit_bytes', label: 'BT 上传限速（字节/秒）', hint: '含做种；0 = 不限制。', type: 'number' },
    { key: 'default_segments', label: '默认分段数', hint: '0 = 按文件大小自动推荐（动态分段）。', type: 'number' },
    { key: 'auto_max_connections', label: '单任务连接数上限', hint: '0 = 自动（智能调度）。', type: 'number' },
    { key: 'max_auto_retries', label: '失败自动重试次数', type: 'number' },
    { key: 'auto_retry_delay_secs', label: '重试间隔（秒）', type: 'number' },
  ];

  const seedFields: EngineField[] = [
    { key: 'bt_seed_max_active', label: '同时做种任务数', type: 'number' },
    { key: 'bt_seed_ratio_limit', label: '总分享率停止阈值', hint: '千分比（1000 = 1.0）。', type: 'number' },
    { key: 'bt_seed_post_ratio_limit', label: '完成后分享率停止阈值', hint: '千分比（1000 = 1.0）。', type: 'number' },
    { key: 'bt_seed_time_limit_minutes', label: '做种时长停止阈值（分钟）', type: 'number' },
    { key: 'bt_seed_inactive_time_limit_minutes', label: '无上传停止阈值（分钟）', type: 'number' },
  ];

  const trackerCount = (draft.bt_tracker_sub_cache ?? '').split('\n').filter(Boolean).length;
  const fmtBps = (b: number) => {
    if (!b) return '0 B/s';
    const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = b; let i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  };

  return (
    <SettingsPage
      icon="lucide:download"
      title="下载中心设置"
      description="下载目录、代理与 FluxDown 下载引擎（直链 / BT / 磁力 / eD2K）统一管理。"
      actions={
        <>
          <Pill tone={loading ? 'warning' : 'success'}>{loading ? '读取中' : engine ? '引擎已连接' : '基础模式'}</Pill>
          <SettingsButton variant="primary" onClick={() => { void saveAllFields(); }} disabled={savingKey !== ''}>保存基础设置</SettingsButton>
        </>
      }
    >
      {error ? <Alert tone="error" title={error} /> : message ? <Alert tone="success" title={message} /> : null}

      <SettingsSection title="基础设置" description="media core 自身行为（修改后点顶部保存）。">
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

      {engine ? (
        <>
          <SettingsSection
            title="下载引擎 · 常规"
            description={`FluxDown（Rust + librqbit）：动态分段直链加速、BT 做种回馈、eD2K/Kad 找源。${stats ? ` 当前 ↓ ${fmtBps(stats.totalDownloadBps)} · 活跃 ${stats.activeTasks} · 排队 ${stats.pendingTasks}。` : ''}`}
          >
            {commonFields.map((f) => (
              <SettingsField key={f.key} label={f.label} hint={f.hint}>
                <TextInput type={f.type || 'text'} value={num(f.key)} onChange={(e) => set(f.key, e.target.value)} />
              </SettingsField>
            ))}
            <SettingsField label="文件已存在时" hint="同名产物已落盘时的处理策略。">
              <Select value={draft.file_exists_behavior ?? 'rename'} onChange={(e) => set('file_exists_behavior', e.target.value)}>
                <option value="rename">自动编号改名（默认）</option>
                <option value="overwrite">覆盖旧文件</option>
                <option value="skip">跳过该文件</option>
              </Select>
            </SettingsField>
            <SettingsField label="产物文件消失时" hint="已完成任务的文件在磁盘上被移动/删除后。">
              <Select value={draft.file_missing_action ?? 'keep'} onChange={(e) => set('file_missing_action', e.target.value)}>
                <option value="keep">保留任务记录（可重新下载）</option>
                <option value="delete">删除任务记录</option>
              </Select>
            </SettingsField>
            <div className="toggle-stack">
              <Toggle checked={bool('dedup_same_url')} onChange={(v) => setBool('dedup_same_url', v)} label="相同链接去重" description="重复提交同一链接时自动并入既有任务。" />
              <Toggle checked={bool('auto_resume_on_start')} onChange={(v) => setBool('auto_resume_on_start', v)} label="启动自动续传" description="引擎重启后自动恢复未完成任务。" />
            </div>
          </SettingsSection>

          <SettingsSection title="下载引擎 · BitTorrent / 磁力" description="DHT / PEX / MSE 加密 / 做种回馈（librqbit）。">
            <div className="toggle-stack">
              <Toggle checked={bool('bt_enable_dht')} onChange={(v) => setBool('bt_enable_dht', v)} label="DHT 网络" description="去中心化找源（无 tracker 也能下载）。" />
              <Toggle checked={bool('bt_enable_upnp')} onChange={(v) => setBool('bt_enable_upnp', v)} label="UPnP 端口映射" description="自动在网关开放入站端口（提升可连通性）。" />
              <Toggle checked={bool('bt_seed_enabled')} onChange={(v) => setBool('bt_seed_enabled', v)} label="下载完成后做种" description="完成后按策略回馈 swarm（分享率/时长阈值控制）。" />
              <Toggle checked={bool('bt_auto_reseed')} onChange={(v) => setBool('bt_auto_reseed', v)} label="启动自动续种" description="引擎重启后自动续种历史任务。" />
            </div>
            <div className="grid-2">
              <SettingsField label="监听端口起">
                <TextInput type="number" value={num('bt_port_start')} onChange={(e) => set('bt_port_start', e.target.value)} />
              </SettingsField>
              <SettingsField label="监听端口止">
                <TextInput type="number" value={num('bt_port_end')} onChange={(e) => set('bt_port_end', e.target.value)} />
              </SettingsField>
            </div>
            <SettingsField label="连接加密（MSE）" hint="对不支持加密的对端自动降级明文。">
              <Select value={draft.bt_mse_mode ?? 'enabled'} onChange={(e) => set('bt_mse_mode', e.target.value)}>
                <option value="disabled">关闭</option>
                <option value="enabled">自动协商（默认）</option>
                <option value="forced">强制加密</option>
              </Select>
            </SettingsField>
            {seedFields.map((f) => (
              <SettingsField key={f.key} label={f.label} hint={f.hint}>
                <TextInput type="number" value={num(f.key)} onChange={(e) => set(f.key, e.target.value)} />
              </SettingsField>
            ))}
            <SettingsField label="多阈值组合方式" hint="分享率 / 时长 / 无上传阈值的组合逻辑。">
              <Select value={draft.bt_seed_limit_operator ?? 'or'} onChange={(e) => set('bt_seed_limit_operator', e.target.value)}>
                <option value="or">任一达到即停止</option>
                <option value="and">全部达到才停止</option>
              </Select>
            </SettingsField>
            <SettingsField label="达到阈值后的动作">
              <Select value={draft.bt_seed_then_action ?? 'stop'} onChange={(e) => set('bt_seed_then_action', e.target.value)}>
                <option value="stop">停止做种（默认）</option>
                <option value="delete">删除任务</option>
                <option value="delete_files">删除任务和文件</option>
              </Select>
            </SettingsField>
            <SettingsField label="自定义 Tracker" hint="每行一个，追加到订阅列表之后。">
              <TextInput value={draft.bt_custom_trackers ?? ''} onChange={(e) => set('bt_custom_trackers', e.target.value)} />
            </SettingsField>
          </SettingsSection>

          <SettingsSection
            title="Tracker 订阅"
            description={`定期从社区维护的订阅源获取最新 Tracker 列表（当前 ${trackerCount} 个）。`}
            actions={
              <SettingsButton onClick={() => { void refreshSub('trackers'); }} disabled={busy === 'trackers'}>
                {busy === 'trackers' ? '刷新中…' : '立即刷新'}
              </SettingsButton>
            }
          >
            <Toggle checked={bool('bt_tracker_sub_enabled')} onChange={(v) => setBool('bt_tracker_sub_enabled', v)} label="启用订阅" description="关闭后停止自动更新（保留缓存）。" />
            <SettingsField label="订阅源地址" hint="每行一个订阅地址；与缓存列表自动合并去重。">
              <TextInput value={draft.bt_tracker_sub_urls ?? ''} onChange={(e) => set('bt_tracker_sub_urls', e.target.value)} />
            </SettingsField>
          </SettingsSection>

          <SettingsSection
            title="eD2K（电驴网络）"
            description="direct 类型 ed2k:// 链接的 Kad 去中心化找源。"
            actions={
              <SettingsButton onClick={() => { void refreshSub('ed2k'); }} disabled={busy === 'ed2k'}>
                {busy === 'ed2k' ? '刷新中…' : '刷新服务器列表'}
              </SettingsButton>
            }
          >
            <div className="toggle-stack">
              <Toggle checked={bool('ed2k_enable_kad')} onChange={(v) => setBool('ed2k_enable_kad', v)} label="Kad 网络" description="Kademlia 去中心化找源网络。" />
              <Toggle checked={bool('ed2k_enable_upnp')} onChange={(v) => setBool('ed2k_enable_upnp', v)} label="UPnP 端口映射" description="自动开放 eD2K 入站端口。" />
              <Toggle checked={bool('ed2k_server_sub_enabled')} onChange={(v) => setBool('ed2k_server_sub_enabled', v)} label="服务器列表订阅" description="定期从订阅源更新 server.met 找源网络。" />
            </div>
            <SettingsField label="监听端口">
              <TextInput type="number" value={num('ed2k_listen_port')} onChange={(e) => set('ed2k_listen_port', e.target.value)} />
            </SettingsField>
            <SettingsField label="服务器列表" hint="每行一台（host:port）；与订阅自动合并。">
              <TextInput value={draft.ed2k_server_list ?? ''} onChange={(e) => set('ed2k_server_list', e.target.value)} />
            </SettingsField>
            <SettingsField label="订阅源地址" hint="每行一个 server.met 订阅地址。">
              <TextInput value={draft.ed2k_server_sub_urls ?? ''} onChange={(e) => set('ed2k_server_sub_urls', e.target.value)} />
            </SettingsField>
          </SettingsSection>

          <div className="engine-save-bar">
            <SettingsButton variant="primary" onClick={() => { void saveEngine(); }} disabled={busy === 'engine'}>
              {busy === 'engine' ? '保存中…' : '保存引擎配置'}
            </SettingsButton>
            <span className="hint">仅提交有变更的配置项；下载中的任务会自动暂停并恢复以立即生效。</span>
          </div>
        </>
      ) : (
        <SettingsSection title="下载引擎" description="FluxDown 引擎未连接（容器内 127.0.0.1:17800）。基础下载仍可用，引擎任务将在引擎恢复后自动重连。">
          <div className="engine-offline-hint">引擎离线——直链 / BT / 磁力 / eD2K 任务暂不可执行。</div>
        </SettingsSection>
      )}

      <style>{`
        .toggle-stack{display:flex;flex-direction:column;gap:10px;}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;}
        .engine-save-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--mei-border);border-radius:14px;background:var(--mei-surface,#fff);}
        .engine-save-bar .hint{font-size:12px;color:var(--mei-text-tertiary,#8a8f99);}
        .engine-offline-hint{font-size:13px;color:var(--mei-text-tertiary,#8a8f99);padding:6px 0;}
      `}</style>
    </SettingsPage>
  );
}
