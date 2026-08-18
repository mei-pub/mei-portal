'use client';
// 门户首页 —— 深空极光玻璃风格：问候 + 实时时钟 + 聚焦搜索 + 玻璃应用网格
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlugin } from '@/lib/categories';
import TopBar from './TopBar';
import AppCard from './AppCard';
import { isSwitchable, isAppEnabled } from '@/lib/app-toggles';
import 'iconify-icon';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

interface ResolvedItem extends Item {
  disabled?: boolean;
}

// 时段问候
function greeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  if (hour < 22) return '晚上好';
  return '夜深了';
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad = (n: number) => String(n).padStart(2, '0');

export default function PortalClient({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [enabledTick, setEnabledTick] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [username, setUsername] = useState<string>('');

  // 实时时钟（SSR 安全：挂载后才启动）
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.loggedIn) setUsername(d.username || 'admin');
      })
      .catch(() => {});
  }, []);

  // 应用开关变化时刷新（兜底）
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

  const filtered = useMemo(() => {
    if (!query.trim()) return resolvedItems;
    const q = query.toLowerCase();
    return resolvedItems.filter(
      (i) =>
        i.plugin.name.toLowerCase().includes(q) ||
        i.plugin.id.includes(q) ||
        (i.plugin.description || '').toLowerCase().includes(q)
    );
  }, [resolvedItems, query]);

  // 应用数量不多：不做分类，统一按名称排序平铺
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) =>
      a.plugin.name.localeCompare(b.plugin.name, 'zh-Hans-CN')
    );
  }, [filtered]);

  // Cmd/Ctrl+K 聚焦搜索
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

  const clock = now
    ? { hh: pad(now.getHours()), mm: pad(now.getMinutes()), ss: pad(now.getSeconds()) }
    : { hh: '--', mm: '--', ss: '--' };
  const dateText = now
    ? `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}`
    : '';

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* 极光动态背景 */}
      <div className="mei-aurora" aria-hidden>
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      {/* 顶栏（透明玻璃，仅右侧操作区） */}
      <TopBar query="" onSearch={() => {}} showSearch={false} transparent />

      <main
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '84px var(--mei-space-6) var(--mei-space-8)',
        }}
      >
        {/* Hero：问候 + 时钟 */}
        <section style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 14px',
              borderRadius: 'var(--mei-radius-full)',
              background: 'var(--mei-surface)',
              border: '1px solid var(--mei-border)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              color: 'var(--mei-text-muted)',
              fontSize: 12,
              letterSpacing: 1,
              marginBottom: 20,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--mei-success)',
                boxShadow: '0 0 8px var(--mei-success)',
              }}
            />
            MEI ALLIN · 私人应用宇宙
          </div>

          <h1
            style={{
              margin: '0 0 6px',
              fontSize: 34,
              fontWeight: 750,
              letterSpacing: 0.5,
              background: 'var(--mei-gradient)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {greeting(now ? now.getHours() : 12)}
            {username ? `，${username}` : ''}
          </h1>

          <div
            style={{
              fontSize: 56,
              fontWeight: 250,
              letterSpacing: 2,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.15,
              color: 'var(--mei-text)',
              textShadow: '0 0 40px rgba(129,140,248,0.35)',
            }}
          >
            {clock.hh}
            <span style={{ color: 'var(--mei-text-faint)', margin: '0 4px' }}>:</span>
            {clock.mm}
            <span style={{ fontSize: 30, color: 'var(--mei-text-faint)', margin: '0 4px' }}>:</span>
            <span style={{ fontSize: 30, color: 'var(--mei-text-muted)' }}>{clock.ss}</span>
          </div>

          <div style={{ color: 'var(--mei-text-muted)', fontSize: 13, letterSpacing: 1.5 }}>{dateText}</div>
        </section>

        {/* 聚焦搜索 */}
        <section style={{ maxWidth: 560, margin: '0 auto 36px' }}>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <iconify-icon
              icon="lucide:search"
              width="18"
              style={{
                position: 'absolute',
                left: 18,
                color: 'var(--mei-text-faint)',
                pointerEvents: 'none',
              }}
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用，或按 ⌘K 聚焦…"
              style={{
                width: '100%',
                padding: '14px 88px 14px 46px',
                fontSize: 14,
                color: 'var(--mei-text)',
                background: 'var(--mei-surface)',
                backdropFilter: 'blur(22px) saturate(1.5)',
                WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                border: '1px solid var(--mei-border)',
                borderRadius: 'var(--mei-radius-full)',
                outline: 'none',
                transition: 'var(--mei-transition)',
                boxShadow: 'var(--mei-shadow-sm)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(129,140,248,0.55)';
                e.currentTarget.style.boxShadow = 'var(--mei-glow)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--mei-border)';
                e.currentTarget.style.boxShadow = 'var(--mei-shadow-sm)';
              }}
            />
            <span
              style={{
                position: 'absolute',
                right: 14,
                fontSize: 11,
                padding: '3px 9px',
                color: 'var(--mei-text-faint)',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--mei-border)',
                borderRadius: 'var(--mei-radius-sm)',
                pointerEvents: 'none',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              ⌘K
            </span>
          </div>
        </section>

        {/* 应用网格 */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 'var(--mei-space-3)',
            }}
          >
            <span style={{ fontSize: 12, letterSpacing: 2, color: 'var(--mei-text-faint)' }}>
              全部应用 · {sorted.length}
            </span>
            {query && (
              <span style={{ fontSize: 12, color: 'var(--mei-text-faint)' }}>
                匹配「{query}」
              </span>
            )}
          </div>
          <div className="mei-card-grid">
            {sorted.map(({ plugin, url, disabled }) => (
              <a key={plugin.id} href={disabled ? undefined : url} style={{ textDecoration: 'none' }}>
                <AppCard plugin={plugin} url={url} disabled={disabled} onClick={() => {}} />
              </a>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="mei-empty">没有匹配「{query}」的应用</div>
          )}
        </section>
      </main>
    </div>
  );
}
