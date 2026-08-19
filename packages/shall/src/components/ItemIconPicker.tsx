'use client';
// 图标选择器 —— 对齐 Sun-Panel 图标能力：图标库 / 文字图标 / 在线图片 / 上传图片 / 底色
import { useMemo, useState } from 'react';
import MeiIcon from './MeiIcon';

// 内置图标库（MeiIcon 已实现渲染）
export const ICON_LIBRARY = [
  'lucide:link', 'lucide:globe', 'lucide:home', 'lucide:star', 'lucide:heart',
  'lucide:search', 'lucide:settings', 'lucide:user', 'lucide:mail', 'lucide:calendar',
  'lucide:clock', 'lucide:camera', 'lucide:image', 'lucide:video', 'lucide:music',
  'lucide:film', 'lucide:tv', 'lucide:book-open', 'lucide:book', 'lucide:file',
  'lucide:folder', 'lucide:database', 'lucide:server', 'lucide:cloud', 'lucide:wifi',
  'lucide:lock', 'lucide:key', 'lucide:shield', 'lucide:zap', 'lucide:sun',
  'lucide:moon', 'lucide:rocket', 'lucide:map-pin', 'lucide:phone', 'lucide:monitor',
  'lucide:download', 'lucide:upload', 'lucide:play', 'lucide:external-link', 'lucide:message-circle',
  'lucide:bell', 'lucide:bookmark', 'lucide:tag', 'lucide:palette', 'lucide:terminal',
  'lucide:code', 'lucide:shopping-cart', 'lucide:credit-card', 'lucide:briefcase', 'lucide:building',
  'lucide:github', 'lucide:wrench', 'lucide:pen-tool', 'lucide:layout-dashboard', 'lucide:network',
  'lucide:scroll-text', 'lucide:library', 'lucide:plug', 'lucide:settings-2', 'lucide:server',
];

// 预设底色板
export const COLOR_SWATCHES = [
  '', // 默认（渐变）
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#1f2937', '#64748b',
];

export function isImgIcon(src: string): boolean {
  return /^https?:\/\//.test(src) || src.startsWith('data:image/');
}
export function isTextIcon(src: string): boolean {
  return src.startsWith('text:');
}
export function textIconContent(src: string, fallbackTitle: string): string {
  const t = src.slice(5).trim();
  return t || fallbackTitle.trim().charAt(0) || '链';
}

type IconType = 'library' | 'text' | 'image';

export function detectType(icon: string): IconType {
  if (isImgIcon(icon)) return 'image';
  if (isTextIcon(icon)) return 'text';
  return 'library';
}

export default function ItemIconPicker({
  icon, iconColor, title = '', onIcon, onColor,
}: {
  icon: string;
  iconColor: string;
  title?: string;
  onIcon: (icon: string) => void;
  onColor: (color: string) => void;
}) {
  const [type, setType] = useState<IconType>(detectType(icon));
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ICON_LIBRARY;
    return ICON_LIBRARY.filter((n) => n.includes(q));
  }, [search]);

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10,
    fontSize: 13, border: '1px solid var(--mei-border-strong)', outline: 'none',
    color: 'var(--mei-text)', background: '#fff',
  };

  const preview = (
    <span
      style={{
        width: 42, height: 42, borderRadius: 13, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0,
        background: iconColor || 'linear-gradient(135deg,#6366f1,#a855f7)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px rgba(0,0,0,0.18)',
        fontSize: isTextIcon(icon) ? 20 : undefined, fontWeight: isTextIcon(icon) ? 700 : undefined,
      }}
    >
      {isImgIcon(icon) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
      ) : isTextIcon(icon) ? (
        textIconContent(icon, title)
      ) : (
        <MeiIcon icon={icon || 'lucide:link'} size={22} />
      )}
    </span>
  );

  return (
    <div>
      {/* 类型切换 + 预览 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {preview}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {([['library', '图标库'], ['text', '文字'], ['image', '图片']] as [IconType, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setType(t)}
              style={{
                padding: '5px 12px', borderRadius: 'var(--mei-radius-full)', fontSize: 12, cursor: 'pointer',
                border: '1px solid ' + (type === t ? 'transparent' : 'var(--mei-border-strong)'),
                background: type === t ? 'var(--mei-gradient)' : 'transparent',
                color: type === t ? '#fff' : 'var(--mei-text-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 图标库 */}
      {type === 'library' && (
        <div>
          <input style={{ ...input, marginBottom: 8 }} placeholder="搜索图标（如 link / home / cloud）" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, padding: 4, border: '1px solid var(--mei-border)', borderRadius: 10 }}>
            {filtered.map((name) => (
              <button
                key={name}
                title={name}
                onClick={() => onIcon(name)}
                style={{
                  aspectRatio: '1', borderRadius: 8, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  border: icon === name ? '2px solid var(--mei-primary)' : '1px solid transparent',
                  background: icon === name ? 'var(--mei-gradient-soft)' : 'transparent',
                  color: icon === name ? 'var(--mei-primary)' : 'var(--mei-text-muted)',
                }}
              >
                <MeiIcon icon={name} size={17} />
              </button>
            ))}
            {filtered.length === 0 && <span style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 12, color: 'var(--mei-text-faint)', padding: 12 }}>无匹配图标</span>}
          </div>
        </div>
      )}

      {/* 文字图标 */}
      {type === 'text' && (
        <input
          style={input}
          placeholder="输入 1-2 个字作为图标（如 知、B站）"
          value={isTextIcon(icon) ? icon.slice(5) : ''}
          onChange={(e) => onIcon('text:' + e.target.value.slice(0, 4))}
        />
      )}

      {/* 图片（在线 URL / 上传） */}
      {type === 'image' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={input}
            placeholder="图片地址（https://…）"
            value={isImgIcon(icon) ? icon : ''}
            onChange={(e) => onIcon(e.target.value)}
          />
          <label style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--mei-border-strong)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            上传
            <input
              type="file" accept="image/*" hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 30 * 1024 * 1024) { alert('图片过大（>30MB）'); return; }
                const r = new FileReader();
                r.onload = () => onIcon(String(r.result));
                r.readAsDataURL(f);
              }}
            />
          </label>
        </div>
      )}

      {/* 底色 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--mei-text-muted)' }}>底色：</span>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c || 'default'}
            title={c || '默认渐变'}
            onClick={() => onColor(c)}
            style={{
              width: 24, height: 24, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
              border: iconColor === c ? '2px solid var(--mei-primary)' : '1px solid var(--mei-border-strong)',
              background: c || 'linear-gradient(135deg,#6366f1,#a855f7)',
              padding: 0,
            }}
          />
        ))}
        <input
          type="color"
          title="自定义底色"
          value={iconColor || '#6366f1'}
          onChange={(e) => onColor(e.target.value)}
          style={{ width: 26, height: 26, border: '1px solid var(--mei-border-strong)', borderRadius: 8, background: '#fff', cursor: 'pointer', padding: 1 }}
        />
      </div>
    </div>
  );
}
