'use client';
// 影视设置（门户风格原生实现）：搜索/豆瓣数据源/直播/播放优化
// 实现逻辑与 UserMenu 设置面板一致（localStorage 本地设置，同一组 key，保存即生效）
import { useEffect, useState } from 'react';

const DOUBAN_SOURCE_OPTIONS = [
  { value: 'direct', label: '直连（服务器直接请求豆瓣）' },
  { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
  { value: 'cmliussss-cdn-tencent', label: '豆瓣 CDN By CMLiussss（腾讯云）' },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];
const DOUBAN_IMG_PROXY_OPTIONS = [
  { value: 'server', label: '服务器代理（由服务器代理请求豆瓣）' },
  { value: 'cmliussss-cdn-tencent', label: '豆瓣 CDN By CMLiussss（腾讯云）' },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];

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

function load(): FormState {
  const f = { ...DEFAULTS };
  try {
    const p = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
    const bool = (k: string, dft: boolean) => {
      const v = p(k);
      return v === null ? dft : JSON.parse(v) === true;
    };
    f.defaultAggregateSearch = bool('defaultAggregateSearch', true);
    f.fluidSearch = bool('fluidSearch', true);
    f.enableOptimization = bool('enableOptimization', true);
    f.liveDirectConnect = bool('liveDirectConnect', false);
    f.doubanDataSource = p('doubanDataSource') || f.doubanDataSource;
    f.doubanProxyUrl = p('doubanProxyUrl') || '';
    f.doubanImageProxyType = p('doubanImageProxyType') || f.doubanImageProxyType;
    f.doubanImageProxyUrl = p('doubanImageProxyUrl') || '';
  } catch {}
  return f;
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.86)', border: '1px solid rgba(23,32,56,0.08)',
  borderRadius: 16, padding: 18, marginBottom: 16,
  boxShadow: '0 2px 10px rgba(23,32,56,0.07)', backdropFilter: 'blur(18px)',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10,
  fontSize: 13, border: '1px solid rgba(23,32,56,0.14)', outline: 'none', color: '#1c2333', background: '#fff',
};
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#5d6778', marginBottom: 5 };

function Toggle({ on, onChange, title, desc }: { on: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(23,32,56,0.06)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1c2333' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#5d6778', marginTop: 2 }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!on)}
        aria-pressed={on}
        style={{
          position: 'relative', width: 40, height: 23, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: on ? '#6366f1' : 'rgba(23,32,56,0.15)', transition: 'background .2s', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: 3, width: 17, height: 17, borderRadius: '50%',
          background: '#fff', transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transform: on ? 'translateX(17px)' : 'none',
        }} />
      </button>
    </div>
  );
}

export default function MeiSettingsPage() {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    setForm(load());
    setLoaded(true);
  }, []);

  function show(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }

  function save() {
    try {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(form.defaultAggregateSearch));
      localStorage.setItem('fluidSearch', JSON.stringify(form.fluidSearch));
      localStorage.setItem('enableOptimization', JSON.stringify(form.enableOptimization));
      localStorage.setItem('liveDirectConnect', JSON.stringify(form.liveDirectConnect));
      localStorage.setItem('doubanDataSource', form.doubanDataSource);
      localStorage.setItem('doubanProxyUrl', form.doubanProxyUrl);
      localStorage.setItem('doubanImageProxyType', form.doubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', form.doubanImageProxyUrl);
      show('设置已保存');
    } catch (e) {
      show('保存失败：' + (e as Error).message);
    }
  }

  function resetAll() {
    setForm({ ...DEFAULTS });
    try {
      ['defaultAggregateSearch', 'fluidSearch', 'enableOptimization', 'liveDirectConnect', 'doubanDataSource', 'doubanProxyUrl', 'doubanImageProxyType', 'doubanImageProxyUrl']
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    show('已恢复默认设置');
  }

  if (!loaded) return null;

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6fb', fontFamily: '"PingFang SC","Noto Sans SC",sans-serif' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '76px 20px 60px' }}>
        <a href="/tv" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#5d6778', textDecoration: 'none', marginBottom: 16 }}>
          ← 返回影视门户
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1c2333', margin: '0 0 4px' }}>影视设置</h1>
        <p style={{ fontSize: 12.5, color: '#5d6778', margin: '0 0 20px' }}>本地设置，保存后立即生效（存储在浏览器）。</p>

        <div style={card}>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 8px' }}>搜索</h2>
          <Toggle on={form.defaultAggregateSearch} onChange={(v) => set({ defaultAggregateSearch: v })}
            title="默认聚合搜索" desc="搜索时聚合全部启用源的结果；关闭则按单个源搜索" />
          <Toggle on={form.fluidSearch} onChange={(v) => set({ fluidSearch: v })}
            title="流式搜索" desc="边搜边展示结果（推荐开启）；关闭则等待全部源返回后一次性展示" />
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 10px' }}>豆瓣数据源</h2>
          <label style={label}>数据获取方式</label>
          <select value={form.doubanDataSource} onChange={(e) => set({ doubanDataSource: e.target.value })} style={{ ...input, marginBottom: 12 }}>
            {DOUBAN_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {form.doubanDataSource === 'custom' && (
            <>
              <label style={label}>自定义代理地址</label>
              <input value={form.doubanProxyUrl} onChange={(e) => set({ doubanProxyUrl: e.target.value })}
                placeholder="https://your-proxy.example.com/?url=" style={{ ...input, marginBottom: 12 }} />
            </>
          )}
          <label style={label}>图片代理</label>
          <select value={form.doubanImageProxyType} onChange={(e) => set({ doubanImageProxyType: e.target.value })} style={{ ...input, marginBottom: 12 }}>
            {DOUBAN_IMG_PROXY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {form.doubanImageProxyType === 'custom' && (
            <>
              <label style={label}>自定义图片代理地址</label>
              <input value={form.doubanImageProxyUrl} onChange={(e) => set({ doubanImageProxyUrl: e.target.value })}
                placeholder="https://your-image-proxy.example.com/?url=" style={input} />
            </>
          )}
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: '0 0 8px' }}>播放与直播</h2>
          <Toggle on={form.enableOptimization} onChange={(v) => set({ enableOptimization: v })}
            title="优选最佳播放源" desc="播放器自动选择最佳清晰度与线路" />
          <Toggle on={form.liveDirectConnect} onChange={(v) => set({ liveDirectConnect: v })}
            title="直播直连" desc="直播流绕过服务器代理直连（服务器无法访问直播源时开启）" />
        </div>

        <div style={{ position: 'sticky', bottom: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={resetAll}
            style={{ padding: '10px 20px', borderRadius: 999, border: '1px solid rgba(23,32,56,0.16)', background: 'rgba(255,255,255,0.9)', fontSize: 13, cursor: 'pointer', color: '#1c2333' }}>
            恢复默认
          </button>
          <button onClick={save}
            style={{ padding: '10px 26px', borderRadius: 999, border: 'none', background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontSize: 13, fontWeight: 650, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
            保存设置
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)', padding: '9px 20px', borderRadius: 999, background: 'rgba(28,35,51,0.92)', color: '#fff', fontSize: 13, zIndex: 100 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
