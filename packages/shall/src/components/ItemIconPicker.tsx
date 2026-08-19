'use client';
// 图标选择器 —— 对齐 Sun-Panel 图标能力：图标库 / 在线 iconify / 文字 / 图片(上传+网址favicon) / 底色 / 实时预览
import { useMemo, useState } from 'react';
import MeiIcon from './MeiIcon';
import 'iconify-icon';

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
  'lucide:scroll-text', 'lucide:library', 'lucide:plug', 'lucide:settings-2',
];

// 预设底色板（白色为默认，含渐变选项）
export const COLOR_SWATCHES = [
  '#ffffff', // 白色（默认）
  '#f1f5f9', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#1f2937',
  'gradient', // 渐变
];

/**
 * 根据底色亮度自动选择图标/文字前景色（深底白字、浅底深字）
 * 传入 CSS background 值（hex/rgb/渐变），返回 '#fff' 或 '#1c2333'
 */
export function contrastColor(bg: string | undefined | null): string {
  if (!bg) return '#1c2333'; // 无底色（白底默认）→ 深色图标
  // 渐变 → 白色图标（渐变均为深色调）
  if (bg === 'gradient' || bg.includes('gradient') || bg.includes('linear')) return '#fff';
  // 解析 hex
  const hex = bg.replace('#', '');
  if (hex.length === 3 || hex.length === 6) {
    const r = parseInt(hex.slice(0, 2).padEnd(2, hex[0]), 16);
    const g = parseInt(hex.slice(hex.length > 3 ? 2 : 1, hex.length > 3 ? 4 : 2).padEnd(2, hex[1]), 16);
    const b = parseInt(hex.slice(hex.length > 3 ? 4 : 2).padEnd(2, hex[2]), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return '#fff';
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? '#1c2333' : '#fff';
  }
  return '#fff';
}

/** 图标块底色解析：''→白色（默认）、'gradient'→渐变、其他→原值 */
export function tileBackground(iconColor: string | undefined, builtinId?: string): string {
  if (iconColor === 'gradient') return builtinId ? '' : 'linear-gradient(135deg,#6366f1,#a855f7)';
  if (iconColor && iconColor !== 'gradient') return iconColor;
  // 未设置：内置项用专属渐变，自定义项用白色
  return builtinId ? '' : '#ffffff';
}

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
/** 从网址提取 favicon URL（Google favicon 服务） */
export function faviconUrlFrom(siteUrl: string): string {
  try {
    const u = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
  } catch {
    return '';
  }
}

type IconType = 'library' | 'online' | 'text' | 'image';

export function detectType(icon: string): IconType {
  if (isImgIcon(icon)) return 'image';
  if (isTextIcon(icon)) return 'text';
  if (icon.includes(':') && !ICON_LIBRARY.includes(icon)) return 'online';
  return 'library';
}

export default function ItemIconPicker({
  icon, iconColor, title = '', itemUrl = '', onIcon, onColor,
}: {
  icon: string;
  iconColor: string;
  title?: string;
  itemUrl?: string; // 图标项的地址（用于从网址获取 favicon）
  onIcon: (icon: string) => void;
  onColor: (color: string) => void;
}) {
  const [type, setType] = useState<IconType>(detectType(icon));
  const [search, setSearch] = useState('');
  const [faviconQuery, setFaviconQuery] = useState(itemUrl);
  // 在线 iconify 搜索
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineIcons, setOnlineIcons] = useState<string[]>([]);
  const [onlineCollections, setOnlineCollections] = useState<Record<string, { name?: string }>>({});
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState('');

  async function searchOnline(q?: string) {
    const query = (q ?? onlineQuery).trim();
    if (!query) return;
    setOnlineLoading(true);
    setOnlineError('');
    try {
      const res = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=60`);
      const data = await res.json();
      setOnlineIcons(Array.isArray(data.icons) ? data.icons : []);
      setOnlineCollections(data.collections || {});
      if (!data.icons || data.icons.length === 0) setOnlineError('无匹配图标');
    } catch {
      setOnlineError('搜索失败（需外网访问 api.iconify.design）');
      setOnlineIcons([]);
      setOnlineCollections({});
    } finally {
      setOnlineLoading(false);
    }
  }

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

  // 判断当前图标是否需要 iconify WC 渲染
  const useIconifyWC = (icon.includes(':') && !ICON_LIBRARY.includes(icon) && !icon.startsWith('lucide:'));

  // 实时预览：底色 + 自动对比前景色
  const previewBg = iconColor === 'gradient' ? 'linear-gradient(135deg,#6366f1,#a855f7)' : (iconColor || '#ffffff');
  const previewFg = contrastColor(iconColor || '#ffffff');

  return (
    <div>
      {/* ===== 实时预览区（大图标 + 标题，随选择即时更新）===== */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
          borderRadius: 'var(--mei-radius)', marginBottom: 10,
          background: 'var(--mei-gradient-soft)', border: '1px solid var(--mei-border)',
        }}
      >
        <span
          style={{
            width: 52, height: 52, borderRadius: 15, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', color: previewFg, flexShrink: 0,
            background: previewBg,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 14px rgba(0,0,0,0.12)',
            fontSize: isTextIcon(icon) ? 24 : undefined, fontWeight: isTextIcon(icon) ? 750 : undefined,
            transition: 'background .2s ease, color .2s ease',
            border: '1px solid rgba(23,32,56,0.08)',
          }}
        >
          {isImgIcon(icon) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={icon} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
          ) : isTextIcon(icon) ? (
            textIconContent(icon, title)
          ) : useIconifyWC ? (
            <iconify-icon icon={icon} width="26" height="26" style={{ color: previewFg }} />
          ) : (
            <MeiIcon icon={icon || 'lucide:link'} size={26} style={{ color: previewFg }} />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--mei-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || '图标预览'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--mei-text-faint)', marginTop: 2 }}>
            {isImgIcon(icon) ? '图片图标' : isTextIcon(icon) ? `文字：${textIconContent(icon, title)}` : useIconifyWC ? `iconify：${icon}` : icon || '未选择图标'}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--mei-text-faint)', marginTop: 1 }}>
            底色：{iconColor === 'gradient' ? '渐变' : iconColor || '白色（默认）'} · 图标色：{previewFg === '#fff' ? '白' : '深'}
          </div>
        </div>
        {/* 类型切换 */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 220 }}>
          {([['library', '图标库'], ['online', '在线图标'], ['text', '文字'], ['image', '图片']] as [IconType, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setType(t)}
              style={{
                padding: '5px 11px', borderRadius: 'var(--mei-radius-full)', fontSize: 11.5, cursor: 'pointer',
                border: '1px solid ' + (type === t ? 'transparent' : 'var(--mei-border-strong)'),
                background: type === t ? 'var(--mei-gradient)' : 'transparent',
                color: type === t ? '#fff' : 'var(--mei-text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 图标库 ===== */}
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

      {/* ===== 在线 iconify 图标 ===== */}
      {type === 'online' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="搜索 iconify 图标（如 home / rocket / cat）"
              value={onlineQuery}
              onChange={(e) => setOnlineQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') searchOnline(); }}
            />
            <button
              onClick={() => searchOnline()}
              disabled={onlineLoading}
              style={{
                padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'var(--mei-gradient)', color: '#fff', fontSize: 12, whiteSpace: 'nowrap',
                opacity: onlineLoading ? 0.6 : 1,
              }}
            >
              {onlineLoading ? '搜索中…' : '搜索'}
            </button>
          </div>
          {(onlineLoading || onlineIcons.length > 0 || onlineError) && (
            <div style={{
              maxHeight: 260, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 6, padding: 6, border: '1px solid var(--mei-border)', borderRadius: 10, marginBottom: 8,
            }}>
              {onlineLoading && <span style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 12, color: 'var(--mei-text-faint)', padding: 16 }}>搜索中…</span>}
              {onlineError && !onlineLoading && <span style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 12, color: 'var(--mei-text-faint)', padding: 16 }}>{onlineError}</span>}
              {!onlineLoading && onlineIcons.map((name) => {
                const colonIdx = name.indexOf(':');
                const prefix = colonIdx > 0 ? name.slice(0, colonIdx) : '';
                const iconName = colonIdx > 0 ? name.slice(colonIdx + 1) : name;
                const collectionName = onlineCollections[prefix]?.name || prefix;
                const selected = icon === name;
                return (
                  <button
                    key={name}
                    title={`${collectionName} · ${iconName}（${name}）`}
                    onClick={() => onIcon(name)}
                    style={{
                      borderRadius: 10, cursor: 'pointer', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 3, padding: '10px 6px 8px',
                      border: selected ? '2px solid var(--mei-primary)' : '1px solid var(--mei-border)',
                      background: selected ? 'var(--mei-gradient-soft)' : 'rgba(255,255,255,0.5)',
                      color: selected ? 'var(--mei-primary)' : 'var(--mei-text-muted)',
                      transition: 'var(--mei-transition)',
                    }}
                  >
                    <iconify-icon icon={name} width="24" height="24" style={{ flexShrink: 0 }} />
                    <span style={{
                      fontSize: 11, fontWeight: 600, maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: 'var(--mei-text)',
                    }}>
                      {iconName}
                    </span>
                    <span style={{
                      fontSize: 9.5, maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: 'var(--mei-text-faint)',
                    }}>
                      {collectionName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <input
            style={input}
            placeholder="或直接输入 iconify 图标名（如 mdi:home、ph:rocket）"
            value={!isImgIcon(icon) && !isTextIcon(icon) && !ICON_LIBRARY.includes(icon) ? icon : ''}
            onChange={(e) => onIcon(e.target.value.trim())}
          />
          <div style={{ fontSize: 11, color: 'var(--mei-text-faint)', marginTop: 4 }}>
            图标名格式 prefix:name，可从 <a href="https://icon-sets.iconify.design" target="_blank" rel="noreferrer" style={{ color: 'var(--mei-primary)' }}>iconify.design</a> 浏览；渲染时从 CDN 加载。
          </div>
        </div>
      )}

      {/* ===== 文字图标 ===== */}
      {type === 'text' && (
        <input
          style={input}
          placeholder="输入 1-2 个字作为图标（如 知、B站）"
          value={isTextIcon(icon) ? icon.slice(5) : ''}
          onChange={(e) => onIcon('text:' + e.target.value.slice(0, 4))}
        />
      )}

      {/* ===== 图片（在线 URL / 上传 / 从网址获取 favicon）===== */}
      {type === 'image' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
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
          {/* 从网址获取 favicon */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="输入网站地址获取图标（如 github.com）"
              value={faviconQuery}
              onChange={(e) => setFaviconQuery(e.target.value)}
            />
            <button
              onClick={() => {
                const url = faviconUrlFrom(faviconQuery);
                if (url) onIcon(url);
                else alert('请输入有效的网址');
              }}
              style={{
                padding: '8px 14px', borderRadius: 10, border: '1px solid var(--mei-primary)',
                background: 'transparent', color: 'var(--mei-primary)', fontSize: 12,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              获取图标
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mei-text-faint)', marginTop: 4 }}>
            通过 Google Favicon 服务从网址自动获取网站图标（需外网）。
          </div>
        </div>
      )}

      {/* ===== 底色 ===== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--mei-text-muted)' }}>底色：</span>
        {COLOR_SWATCHES.map((c) => {
          const isDefault = (c === '#ffffff' && (!iconColor || iconColor === '#ffffff'));
          const isGradient = c === 'gradient';
          const swatchBg = isGradient ? 'linear-gradient(135deg,#6366f1,#a855f7)' : c;
          const selected = isGradient ? iconColor === 'gradient' : iconColor === c;
          return (
            <button
              key={c}
              title={isGradient ? '渐变' : c === '#ffffff' ? '白色（默认）' : c}
              onClick={() => onColor(isGradient ? 'gradient' : c)}
              style={{
                width: 24, height: 24, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                border: (selected || isDefault) && !isGradient ? '2px solid var(--mei-primary)' : '1px solid var(--mei-border-strong)',
                background: swatchBg,
                padding: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {isDefault && <span style={{ fontSize: 9, color: '#6366f1', fontWeight: 800 }}>✓</span>}
            </button>
          );
        })}
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
