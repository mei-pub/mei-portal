'use client';
// 门户主页 —— 全量复刻 Sun-Panel 能力（风格/分组/图标项/双地址/搜索/时钟/监控/页脚）
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlugin } from '@/lib/categories';
import TopBar from './TopBar';
import AppCard from './AppCard';
import MeiIcon from './MeiIcon';
import { isSwitchable, isAppEnabled } from '@/lib/app-toggles';
import type { PanelConfig, PanelItem } from '@/lib/panel-store';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

interface ResolvedItem extends Item {
  disabled?: boolean;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad = (n: number) => String(n).padStart(2, '0');
const SEARCH_ENGINES: Record<string, string> = {
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

function isImg(src: string): boolean {
  return /^https?:\/\//.test(src) || src.startsWith('data:image/');
}

// 自定义图标项卡片（复用 mei-app-card 玻璃样式）
function ItemCard({ item, lanMode }: { item: PanelItem; lanMode: boolean }) {
  const href = lanMode && item.lanUrl ? item.lanUrl : item.url;
  const iconNode = isImg(item.icon) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.icon} alt={item.title} style={{ width: 22, height: 22, objectFit: 'contain' }} />
  ) : (
    <MeiIcon icon={item.icon || 'lucide:link'} size={22} />
  );
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
      <button className="mei-app-card" type="button">
        <div className="mei-icon-tile" style={{ background: 'linear-gradient(135deg,#64748b,#334155)' }}>
          {iconNode}
        </div>
        <div style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.3, letterSpacing: 0.2 }}>{item.title}</div>
        {item.description && (
          <div
            style={{
              color: 'var(--mei-text-muted)',
              fontSize: 12,
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.description}
          </div>
        )}
        <span
          style={{
            marginTop: 'auto',
            paddingTop: 6,
            fontSize: 10.5,
            letterSpacing: 0.6,
            color: 'var(--mei-text-faint)',
            opacity: 0.85,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {href.replace(/^https?:\/\//, '').split('/')[0]}
        </span>
      </button>
    </a>
  );
}

interface SystemInfo {
  memory: { percent: number; used: number; total: number };
  loadavg: number[];
  cpuCount: number;
}

export default function PortalClient({ items, panel }: { items: Item[]; panel: PanelConfig }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [enabledTick, setEnabledTick] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [username, setUsername] = useState<string>('');
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [lanMode, setLanMode] = useState(false);

  const style = panel?.style;

  // 实时时钟
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 内网模式（localStorage，双地址项优先 lanUrl）
  useEffect(() => {
    try { setLanMode(localStorage.getItem('mei-lan-mode') === '1'); } catch {}
    const onLan = () => {
      try { setLanMode(localStorage.getItem('mei-lan-mode') === '1'); } catch {}
    };
    window.addEventListener('storage', onLan);
    window.addEventListener('mei-lan-change', onLan as EventListener);
    return () => {
      window.removeEventListener('storage', onLan);
      window.removeEventListener('mei-lan-change', onLan as EventListener);
    };
  }, []);

  // 系统监控
  useEffect(() => {
    if (!style?.systemMonitorShow) return;
    const load = () => fetch('/api/system').then((r) => r.json()).then(setSys).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [style?.systemMonitorShow]);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.loggedIn) setUsername(d.username || 'admin'); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onStore = () => setEnabledTick((t) => t + 1);
    window.addEventListener('storage', onStore);
    return () => window.removeEventListener('storage', onStore);
  }, []);

  const resolvedItems = useMemo<ResolvedItem[]>(() => {
    return items.map((i) => {
      const disabled = isSwitchable(i.plugin.id) && !isAppEnabled(i.plugin.id);
      return disabled ? { ...i, disabled: true } : i;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, enabledTick]);

  const q = query.trim().toLowerCase();
  const matchText = (t: string) => !q || t.toLowerCase().includes(q);

  const filteredBuiltin = useMemo(() => {
    const list = resolvedItems.filter(
      (i) => matchText(i.plugin.name) || matchText(i.plugin.description || '') || i.plugin.id.includes(q)
    );
    return [...list].sort((a, b) => a.plugin.name.localeCompare(b.plugin.name, 'zh-Hans-CN'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedItems, query]);

  const filteredItems = useMemo(() => {
    return (panel?.items || []).filter((i) => matchText(i.title) || matchText(i.description));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.items, query]);

  // 未分组 + 各分组的自定义项
  const ungrouped = filteredItems.filter((i) => !i.groupId || !panel.groups.some((g) => g.id === i.groupId));
  const grouped = (panel?.groups || []).map((g) => ({
    group: g,
    list: filteredItems.filter((i) => i.groupId === g.id),
  })).filter((s) => s.list.length > 0);

  // ⌘K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function submitSearch() {
    const q = query.trim();
    if (!q) return;
    if (filteredBuiltin.length > 0 || filteredItems.length > 0) return;
    const engine = SEARCH_ENGINES[style?.searchEngine || 'bing'] || SEARCH_ENGINES.bing;
    window.open(engine + encodeURIComponent(q), '_blank');
  }

  const clock = now
    ? { hh: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds()) }
    : { hh: '--', mm: '--', ss: '--' };
  const dateText = now
    ? `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}`
    : '';

  const maxW = style?.maxWidth || 1180;
  const gridStyle: React.CSSProperties = {
    maxWidth: maxW,
    margin: `0 ${style?.marginX || 0}px`,
  };
  const textColor = style?.iconTextColor || undefined;

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* 背景：自定义壁纸（可配遮罩/模糊）或默认极光 */}
      {panel?.background?.url ? (
        <>
          <div
            aria-hidden
            style={{
              position: 'fixed', inset: 0, zIndex: -3,
              backgroundImage: `url(${panel.background.url})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              filter: panel.background.blur ? `blur(${panel.background.blur}px)` : undefined,
              transform: panel.background.blur ? 'scale(1.06)' : undefined,
            }}
          />
          <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -2, background: `rgba(7,10,19,${panel.background.mask})` }} />
        </>
      ) : (
        <div className="mei-aurora" aria-hidden>
          <div className="blob blob-1" /><div className="blob blob-2" /><div className="blob blob-3" />
        </div>
      )}

      <TopBar query="" onSearch={() => {}} showSearch={false} transparent />

      <main
        style={{
          maxWidth: maxW,
          margin: '0 auto',
          paddingTop: `${style?.marginTop ?? 4}%`,
          paddingBottom: `${style?.marginBottom ?? 6}%`,
          paddingLeft: 'var(--mei-space-6)',
          paddingRight: 'var(--mei-space-6)',
        }}
      >
        {/* ===== 顶部区：Logo + 时钟 + 系统监控 ===== */}
        <section style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            {style?.logoImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={style.logoImage} alt="logo" style={{ maxHeight: 56, maxWidth: 260, objectFit: 'contain' }} />
            ) : style?.logoText ? (
              <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: 1, color: textColor, textShadow: '0 2px 24px rgba(99,102,241,0.25)' }}>
                {style.logoText}
              </span>
            ) : null}
            {(style?.logoImage || style?.logoText) && (
              <span style={{ color: 'var(--mei-text-faint)', fontSize: 20 }}>|</span>
            )}
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 34, fontWeight: 250, letterSpacing: 1, color: textColor, textShadow: '0 1px 18px rgba(99,102,241,0.18)' }}>
              {clock.hh}:{clock.mm}
              {style?.clockShowSecond ? (
                <span style={{ fontSize: 20, color: 'var(--mei-text-muted)' }}>:{clock.ss}</span>
              ) : null}
            </span>
          </div>
          <div style={{ color: textColor || 'var(--mei-text-muted)', fontSize: 13, letterSpacing: 1.5, marginTop: 4 }}>{dateText}</div>

          {/* 系统监控 */}
          {style?.systemMonitorShow && sys && (
            <div
              style={{
                display: 'inline-flex', gap: 16, marginTop: 12, padding: '6px 16px',
                borderRadius: 'var(--mei-radius-full)', background: 'var(--mei-surface)',
                border: '1px solid var(--mei-border)', backdropFilter: 'blur(14px)',
                fontSize: 12, color: 'var(--mei-text-muted)',
              }}
            >
              <span>内存 {sys.memory.percent}%（{sys.memory.used}/{sys.memory.total}MB）</span>
              <span>CPU 负载 {sys.loadavg[0]}（{sys.cpuCount} 核）</span>
            </div>
          )}
        </section>

        {/* ===== 搜索框（可关闭；回车无匹配时用所选引擎搜索） ===== */}
        {style?.searchBoxShow !== false && (
          <section style={{ maxWidth: 560, margin: '0 auto 32px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 18, color: 'var(--mei-text-faint)', pointerEvents: 'none', display: 'inline-flex' }}>
                <MeiIcon icon="lucide:search" size={18} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
                placeholder="搜索应用与链接，或直接搜索网页…"
                style={{
                  width: '100%', padding: '14px 90px 14px 46px', fontSize: 14,
                  color: 'var(--mei-text)', background: 'var(--mei-surface)',
                  backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                  border: '1px solid var(--mei-border)', borderRadius: 'var(--mei-radius-full)',
                  outline: 'none', transition: 'var(--mei-transition)', boxShadow: 'var(--mei-shadow-sm)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(99,102,248,0.55)'; e.currentTarget.style.boxShadow = 'var(--mei-glow)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--mei-border)'; e.currentTarget.style.boxShadow = 'var(--mei-shadow-sm)'; }}
              />
              <span
                style={{
                  position: 'absolute', right: 14, border: 'none',
                  background: 'rgba(23,32,56,0.04)', borderRadius: 'var(--mei-radius-sm)',
                  padding: '4px 8px', fontSize: 11.5, color: 'var(--mei-text-muted)',
                  pointerEvents: 'none',
                }}
              >
                {style?.searchEngine === 'google' ? 'Google' : style?.searchEngine === 'baidu' ? '百度' : style?.searchEngine === 'duckduckgo' ? 'Duck' : '必应'}
              </span>
            </div>
          </section>
        )}

        {/* ===== 内置应用 ===== */}
        {(filteredBuiltin.length > 0 || !q) && (
          <section style={{ ...gridStyle, marginBottom: 26 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--mei-space-3)' }}>
              <span style={{ fontSize: 12, letterSpacing: 2, color: 'var(--mei-text-faint)' }}>全部应用 · {filteredBuiltin.length}</span>
              {lanMode && <span style={{ fontSize: 11, color: 'var(--mei-primary)' }}>内网模式</span>}
            </div>
            <div className="mei-card-grid">
              {filteredBuiltin.map(({ plugin, url, disabled }) => (
                <a key={plugin.id} href={disabled ? undefined : url} style={{ textDecoration: 'none' }}>
                  <AppCard plugin={plugin} url={url} disabled={disabled} onClick={() => {}} />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ===== 自定义分组 ===== */}
        {grouped.map(({ group, list }) => (
          <section key={group.id} style={{ ...gridStyle, marginBottom: 26 }}>
            <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--mei-text-faint)', marginBottom: 'var(--mei-space-3)' }}>
              {group.name}
            </div>
            <div className="mei-card-grid">
              {list.map((item) => <ItemCard key={item.id} item={item} lanMode={lanMode} />)}
            </div>
          </section>
        ))}

        {/* ===== 未分组自定义项 ===== */}
        {ungrouped.length > 0 && (
          <section style={gridStyle}>
            {grouped.length > 0 && (
              <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--mei-text-faint)', marginBottom: 'var(--mei-space-3)' }}>其他链接</div>
            )}
            <div className="mei-card-grid">
              {ungrouped.map((item) => <ItemCard key={item.id} item={item} lanMode={lanMode} />)}
            </div>
          </section>
        )}

        {/* 空态 */}
        {q && filteredBuiltin.length === 0 && filteredItems.length === 0 && (
          <div className="mei-empty">
            没有匹配「{query}」的应用，按 Enter 进行网页搜索
          </div>
        )}

        {/* ===== 页脚（自定义 HTML） ===== */}
        {style?.footerHtml && (
          <section
            style={{ marginTop: 40, textAlign: 'center', color: 'var(--mei-text-muted)' }}
            dangerouslySetInnerHTML={{ __html: style.footerHtml }}
          />
        )}
      </main>
    </div>
  );
}
