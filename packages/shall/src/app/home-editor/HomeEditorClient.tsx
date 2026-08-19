'use client';
// 主页设置 —— 背景与自定义应用管理（设置集成页 iframe 挂载）
import { useCallback, useEffect, useState } from 'react';
import MeiIcon from '@/components/MeiIcon';
import type { PanelConfig, CustomItem } from '@/lib/panel-store';

const DEFAULT_CONFIG: PanelConfig = {
  background: { url: '', mask: 0.35, blur: 0 },
  customItems: [],
};

export default function HomeEditorClient() {
  const [config, setConfig] = useState<PanelConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // 自定义应用编辑表单
  const [editing, setEditing] = useState<CustomItem | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/panel', { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save(next: PanelConfig) {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/panel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || '保存失败');
        return;
      }
      setConfig(body.config || next);
      setMessage('已保存，刷新首页生效');
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  }

  const setBg = (patch: Partial<PanelConfig['background']>) => {
    setConfig((c) => ({ ...c, background: { ...c.background, ...patch } }));
  };

  const setItems = (items: CustomItem[]) => {
    setConfig((c) => ({ ...c, customItems: items }));
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 12px',
    borderRadius: 10,
    fontSize: 13,
    border: '1px solid var(--mei-border-strong)',
    outline: 'none',
    color: 'var(--mei-text)',
    background: '#fff',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--mei-bg)', color: 'var(--mei-text)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 20px 60px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 750, margin: '0 0 4px' }}>主页设置</h1>
        <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', margin: '0 0 20px' }}>
          自定义主页背景与自定义应用/链接；内置应用（门户与导航栏各应用）由系统自动管理。
        </p>

        {/* ===== 背景设置 ===== */}
        <section
          style={{
            background: 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius)',
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 12px' }}>背景图</h2>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--mei-text-muted)', marginBottom: 4 }}>
            图片地址（留空使用默认极光背景）
          </label>
          <input
            style={inputStyle}
            placeholder="https://example.com/wallpaper.jpg"
            value={config.background.url}
            onChange={(e) => setBg({ url: e.target.value })}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--mei-text-muted)', marginBottom: 4 }}>
                遮罩不透明度：{config.background.mask.toFixed(2)}
              </label>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={config.background.mask}
                style={{ width: '100%' }}
                onChange={(e) => setBg({ mask: Number(e.target.value) })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--mei-text-muted)', marginBottom: 4 }}>
                背景模糊：{config.background.blur}px
              </label>
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={config.background.blur}
                style={{ width: '100%' }}
                onChange={(e) => setBg({ blur: Number(e.target.value) })}
              />
            </div>
          </div>

          {config.background.url && (
            <div
              style={{
                marginTop: 12,
                height: 110,
                borderRadius: 10,
                backgroundImage: `url(${config.background.url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: config.background.blur ? `blur(${config.background.blur}px)` : undefined,
                border: '1px solid var(--mei-border)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `rgba(7,10,19,${config.background.mask})`,
                }}
              />
            </div>
          )}
        </section>

        {/* ===== 自定义应用 ===== */}
        <section
          style={{
            background: 'var(--mei-surface)',
            border: '1px solid var(--mei-border)',
            borderRadius: 'var(--mei-radius)',
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 650, margin: 0 }}>自定义应用 / 链接</h2>
            <button
              onClick={() => setEditing({ id: '', name: '', url: '', icon: 'lucide:link' })}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--mei-radius-full)',
                border: '1px solid var(--mei-primary)',
                background: 'transparent',
                color: 'var(--mei-primary)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              + 添加
            </button>
          </div>

          {editing && (
            <div
              style={{
                border: '1px dashed var(--mei-border-strong)',
                borderRadius: 12,
                padding: 12,
                marginBottom: 12,
                display: 'grid',
                gap: 8,
              }}
            >
              <input
                style={inputStyle}
                placeholder="名称（如：Gitea）"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
              <input
                style={inputStyle}
                placeholder="地址（https://… 或 /path）"
                value={editing.url}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              />
              <input
                style={inputStyle}
                placeholder="图标（lucide:link / lucide:github 等）"
                value={editing.icon}
                onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--mei-text-muted)' }}>图标预览：</span>
                <MeiIcon icon={editing.icon || 'lucide:link'} size={20} />
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => setEditing(null)}
                  style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--mei-border)', background: 'transparent', fontSize: 12, cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (!editing.name.trim() || !editing.url.trim()) return;
                    const item = { ...editing, id: editing.id || `c${Date.now()}` };
                    const exists = config.customItems.some((i) => i.id === item.id);
                    setItems(exists ? config.customItems.map((i) => (i.id === item.id ? item : i)) : [...config.customItems, item]);
                    setEditing(null);
                  }}
                  style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--mei-gradient)', color: '#fff', fontSize: 12, cursor: 'pointer' }}
                >
                  {editing.id ? '保存修改' : '添加'}
                </button>
              </div>
            </div>
          )}

          {config.customItems.length === 0 && !loading ? (
            <p style={{ fontSize: 12, color: 'var(--mei-text-muted)', textAlign: 'center', padding: '14px 0' }}>
              暂无自定义应用，点击右上「+ 添加」
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {config.customItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--mei-border)',
                    background: 'rgba(255,255,255,0.6)',
                  }}
                >
                  <MeiIcon icon={item.icon} size={18} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--mei-text-faint)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.url}
                  </span>
                  <button
                    onClick={() => setEditing(item)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--mei-primary)', fontSize: 12, cursor: 'pointer' }}
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => setItems(config.customItems.filter((i) => i.id !== item.id))}
                    style={{ border: 'none', background: 'transparent', color: 'var(--mei-danger)', fontSize: 12, cursor: 'pointer' }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 保存条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', bottom: 12 }}>
          <button
            onClick={() => save(config)}
            disabled={saving}
            style={{
              padding: '10px 26px',
              borderRadius: 'var(--mei-radius-full)',
              border: 'none',
              background: 'var(--mei-gradient)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 650,
              cursor: 'pointer',
              boxShadow: 'var(--mei-glow)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
          <button
            onClick={() => save({ ...config, background: { url: '', mask: 0.35, blur: 0 } })}
            disabled={saving}
            style={{
              padding: '10px 18px',
              borderRadius: 'var(--mei-radius-full)',
              border: '1px solid var(--mei-border-strong)',
              background: 'transparent',
              color: 'var(--mei-text-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            恢复默认背景
          </button>
          {message && (
            <span style={{ fontSize: 12, color: message.includes('失败') ? 'var(--mei-danger)' : 'var(--mei-success)' }}>
              {message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
