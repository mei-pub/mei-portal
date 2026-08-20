'use client';

// mei-allin 集成：影视源管理页（门户设置集成页 iframe 深链入口）
// localstorage 模式下原 admin 页的配置功能不可用（服务端无 db），
// 本页通过 /tv/api/admin/source（已适配单密码模式 + 文件持久化）管理采集源：
// 列表 / 启用停用 / 新增 / 删除自定义源 / 单源可用性检测 / 恢复内置热门源
import { useCallback, useEffect, useState } from 'react';

interface SourceItem {
  key: string;
  name: string;
  api: string;
  detail?: string;
  from: 'config' | 'custom';
  disabled?: boolean;
}

interface CheckResult {
  state: 'idle' | 'checking' | 'ok' | 'fail';
  ms?: number;
  count?: number;
  error?: string;
}

const API_BASE = '/tv/api/admin/source';

const BG = { minHeight: '100vh', background: '#f4f6fb' } as const;
export default function MeiSourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', api: '', detail: '' });
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 1800);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API_BASE, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSources(data.sources || []);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data?: any }> {
    const res = await fetch(API_BASE, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function toggle(source: SourceItem) {
    const { ok, data } = await post({ action: source.disabled ? 'enable' : 'disable', key: source.key });
    if (!ok) { showToast(data?.error || '操作失败'); return; }
    setSources((list) => list.map((s) => (s.key === source.key ? { ...s, disabled: !source.disabled } : s)));
    showToast(source.disabled ? `已启用「${source.name}」` : `已停用「${source.name}」`);
  }

  async function remove(source: SourceItem) {
    if (!confirm(`删除源「${source.name}」？`)) return;
    const { ok, data } = await post({ action: 'delete', key: source.key });
    if (!ok) { showToast(data?.error || '删除失败'); return; }
    setSources((list) => list.filter((s) => s.key !== source.key));
    showToast('已删除');
  }

  async function check(source: SourceItem) {
    setChecks((c) => ({ ...c, [source.key]: { state: 'checking' } }));
    const { ok, data } = await post({ action: 'check', key: source.key });
    if (!ok && !data?.key) {
      setChecks((c) => ({ ...c, [source.key]: { state: 'fail', error: data?.error || '检测失败' } }));
      return;
    }
    setChecks((c) => ({
      ...c,
      [source.key]: data.ok
        ? { state: 'ok', ms: data.ms, count: data.count }
        : { state: 'fail', ms: data.ms, error: data.error || '无数据' },
    }));
  }

  async function checkAll() {
    const enabled = sources.filter((s) => !s.disabled);
    for (const s of enabled) {
      // 串行检测，避免并发打满源站
      // eslint-disable-next-line no-await-in-loop
      await check(s);
    }
  }

  async function resetDefaults() {
    if (!confirm('恢复内置热门源将覆盖当前源列表（自定义源也会被移除），继续？')) return;
    setResetBusy(true);
    const { ok, data } = await post({ action: 'reset' });
    setResetBusy(false);
    if (!ok) { showToast(data?.error || '恢复失败'); return; }
    setSources(data.sources || []);
    setChecks({});
    showToast('已恢复内置热门源');
  }

  async function submitAdd() {
    setAddError('');
    const name = addForm.name.trim();
    const api = addForm.api.trim();
    if (!name || !api) { setAddError('名称与 API 地址必填'); return; }
    if (!/^https?:\/\//.test(api)) { setAddError('API 地址需以 http(s):// 开头'); return; }
    const key = `custom-${Date.now().toString(36)}`;
    setAddBusy(true);
    const { ok, data } = await post({ action: 'add', key, name, api, detail: addForm.detail.trim() || undefined });
    setAddBusy(false);
    if (!ok) { setAddError(data?.error || '添加失败'); return; }
    setSources((list) => [...list, { key, name, api, detail: addForm.detail.trim() || undefined, from: 'custom', disabled: false }]);
    setAddOpen(false);
    setAddForm({ name: '', api: '', detail: '' });
    showToast('已添加');
  }

  const enabledCount = sources.filter((s) => !s.disabled).length;

  return (
    <div className='min-h-screen text-[#1c2333]' style={{ background: '#f4f6fb' }}>
      <div className='mx-auto max-w-3xl px-4 pt-[76px] pb-10'>
        {/* 头部 */}
        <div className='mb-5 flex flex-wrap items-center gap-3'>
          <div className='flex-1 min-w-[180px]'>
            <h1 className='text-xl font-bold text-[#1c2333]'>影视源管理</h1>
            <p className='mt-1 text-xs text-[#5d6778]'>
              共 {sources.length} 个源 · {enabledCount} 个启用中；搜索与点播只会使用启用中的源
            </p>
          </div>
          <button
            onClick={checkAll}
            className='rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          >
            全部检测
          </button>
          <button
            onClick={resetDefaults}
            disabled={resetBusy}
            className='rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          >
            {resetBusy ? '恢复中…' : '恢复内置源'}
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className='rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700'
          >
            + 添加源
          </button>
        </div>

        {/* 内容 */}
        {loading ? (
          <div className='py-20 text-center text-sm text-gray-400'>加载中…</div>
        ) : error ? (
          <div className='py-20 text-center'>
            <p className='text-sm text-red-500'>{error}</p>
            <button onClick={load} className='mt-3 rounded-lg border border-gray-300 px-4 py-2 text-xs dark:border-gray-700'>重试</button>
          </div>
        ) : (
          <div className='space-y-2'>
            {sources.map((s) => {
              const chk = checks[s.key];
              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 transition-opacity dark:bg-gray-900 ${
                    s.disabled
                      ? 'border-gray-200 opacity-55 dark:border-gray-800'
                      : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  {/* 状态开关 */}
                  <button
                    onClick={() => toggle(s)}
                    title={s.disabled ? '点击启用' : '点击停用'}
                    className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                      s.disabled ? 'bg-gray-300 dark:bg-gray-700' : 'bg-green-500'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        s.disabled ? 'left-0.5' : 'left-[18px]'
                      }`}
                    />
                  </button>

                  {/* 信息 */}
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='truncate text-sm font-medium text-[#1c2333]'>{s.name}</span>
                      <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                        s.from === 'config'
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                      }`}>
                        {s.from === 'config' ? '内置' : '自定义'}
                      </span>
                      {chk?.state === 'ok' && (
                        <span className='flex-shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600 dark:bg-green-900/30 dark:text-green-400'>
                          可用 · {chk.count} 条 · {chk.ms}ms
                        </span>
                      )}
                      {chk?.state === 'fail' && (
                        <span className='flex-shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-500 dark:bg-red-900/30' title={chk.error}>
                          不可用{chk.error ? ` · ${chk.error}` : ''}
                        </span>
                      )}
                    </div>
                    <div className='mt-0.5 truncate text-xs text-gray-400' title={s.api}>{s.api}</div>
                  </div>

                  {/* 操作 */}
                  <button
                    onClick={() => check(s)}
                    disabled={chk?.state === 'checking'}
                    className='flex-shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                  >
                    {chk?.state === 'checking' ? '检测中…' : '检测'}
                  </button>
                  {s.from !== 'config' && (
                    <button
                      onClick={() => remove(s)}
                      className='flex-shrink-0 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-900/20'
                    >
                      删除
                    </button>
                  )}
                </div>
              );
            })}
            {sources.length === 0 && (
              <div className='py-20 text-center text-sm text-gray-400'>
                暂无源，点击右上角「恢复内置源」或「添加源」
              </div>
            )}
          </div>
        )}
      </div>

      {/* 添加源弹层 */}
      {addOpen && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
          onClick={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}
        >
          <div className='w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900'>
            <h2 className='mb-4 text-base font-bold text-[#1c2333]'>添加影视源</h2>
            {[
              { label: '名称', key: 'name' as const, ph: '例如：黑木耳' },
              { label: 'API 地址', key: 'api' as const, ph: 'https://…/api.php/provide/vod' },
              { label: '站点地址（可选）', key: 'detail' as const, ph: 'https://…' },
            ].map((f) => (
              <div key={f.key} className='mb-3'>
                <label className='mb-1 block text-xs font-medium text-[#5d6778]'>{f.label}</label>
                <input
                  value={addForm[f.key]}
                  onChange={(e) => setAddForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.ph}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-green-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
                />
              </div>
            ))}
            <p className='mb-2 text-xs text-gray-400'>API 需为苹果CMS 采集格式（?ac=videolist 返回 JSON）</p>
            {addError && <p className='mb-2 text-xs text-red-500'>{addError}</p>}
            <div className='mt-4 flex gap-2'>
              <button
                onClick={() => setAddOpen(false)}
                className='flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-500 dark:border-gray-700'
              >
                取消
              </button>
              <button
                onClick={submitAdd}
                disabled={addBusy}
                className='flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50'
              >
                {addBusy ? '添加中…' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className='fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900/90 px-5 py-2 text-xs text-white shadow-lg dark:bg-white/90 dark:text-gray-900'>
          {toast}
        </div>
      )}
    </div>
  );
}
