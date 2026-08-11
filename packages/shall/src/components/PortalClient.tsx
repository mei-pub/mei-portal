'use client';
// 门户客户端 —— 两种模式：
//   1) 门户模式：分组卡片网格 + 最近使用 + 健康徽标 + 搜索 + 快捷键
//   2) iframe 模式：新顶栏 + 可折叠侧栏 + iframe 宿主 + 刷新
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlugin } from '@/lib/categories';
import { CATEGORY_LABELS } from '@/lib/categories';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import AppCard from './AppCard';
import IframeHost from './IframeHost';
import IframeTopBar from './IframeTopBar';
import { useRecents } from '@/lib/use-recents';
import { useHealth } from '@/lib/use-health';
import 'iconify-icon';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

export default function PortalClient({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<{ plugin: ClientPlugin; url: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const { recents, record } = useRecents();
  const health = useHealth();

  // 用服务端注入的真实 ROOT_DOMAIN 重建子域名 url
  // （客户端不能猜，否则 nip.io 等多级域名会出错）
  const [rootDomain, setRootDomain] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const rd = (window as unknown as { __MEI_ROOT_DOMAIN__?: string }).__MEI_ROOT_DOMAIN__;
      setRootDomain(rd || window.location.hostname);
    }
  }, []);

  // 用动态根域重建每个应用的 url
  const resolvedItems = useMemo(() => {
    if (!rootDomain) return items;
    return items.map((i) => ({
      ...i,
      url: `${window.location.protocol}//${i.plugin.subdomainPrefix || i.plugin.id}.${rootDomain}`,
    }));
  }, [items, rootDomain]);

  // 进入应用时记录最近使用
  function openApp(item: Item) {
    setActive({ plugin: item.plugin, url: item.url });
    record(item.plugin.id);
    setIframeKey((k) => k + 1);
  }
  function goHome() {
    setActive(null);
    setSidebarOpen(false);
  }

  // ----- 搜索过滤 -----
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

  const groups = useMemo(() => {
    return filtered.reduce<Record<string, Item[]>>((acc, i) => {
      (acc[i.plugin.category] = acc[i.plugin.category] || []).push(i);
      return acc;
    }, {});
  }, [filtered]);

  const recentItems = useMemo(() => {
    return recents
      .map((id) => resolvedItems.find((i) => i.plugin.id === id))
      .filter((x): x is Item => !!x);
  }, [recents, resolvedItems]);

  // ----- 键盘快捷键 -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc 返回门户（iframe 模式）
      if (e.key === 'Escape' && active) {
        e.preventDefault();
        goHome();
      }
      // Cmd/Ctrl + K 聚焦搜索
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      // iframe 模式下 R 刷新当前应用
      if (e.key.toLowerCase() === 'r' && active && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setIframeKey((k) => k + 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // ----- iframe 模式 -----
  if (active) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <IframeTopBar
          appName={active.plugin.name}
          onBack={goHome}
          onRefresh={() => setIframeKey((k) => k + 1)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          externalUrl={active.url}
        />
        <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
          {/* 桌面侧栏 */}
          <div className="mei-only-desktop">
            <Sidebar
              plugins={resolvedItems.map((i) => i.plugin)}
              currentId={active.plugin.id}
              onPick={(p) => {
                const found = resolvedItems.find((i) => i.plugin.id === p.id);
                if (found) openApp(found);
              }}
              onHome={goHome}
            />
          </div>
          {/* 移动端抽屉 */}
          {sidebarOpen && (
            <>
              <div
                className="mei-only-mobile"
                onClick={() => setSidebarOpen(false)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'var(--mei-overlay)',
                  zIndex: 40,
                }}
              />
              <div
                className="mei-only-mobile"
                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 41 }}
              >
                <Sidebar
                  plugins={resolvedItems.map((i) => i.plugin)}
                  currentId={active.plugin.id}
                  onPick={(p) => {
                    const found = resolvedItems.find((i) => i.plugin.id === p.id);
                    if (found) {
                      openApp(found);
                      setSidebarOpen(false);
                    }
                  }}
                  onHome={goHome}
                />
              </div>
            </>
          )}
          <main style={{ flex: 1, padding: 'var(--mei-space-4)', minWidth: 0 }}>
            <IframeHost key={iframeKey} url={active.url} name={active.plugin.name} />
          </main>
        </div>
      </div>
    );
  }

  // ----- 门户模式 -----
  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar query={query} onSearch={setQuery} searchRef={searchRef} />
      <main
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'var(--mei-space-8) var(--mei-space-6)',
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: '0 0 var(--mei-space-2)',
            background: 'var(--mei-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          欢迎回到 mei-allin
        </h1>
        <p style={{ color: 'var(--mei-text-muted)', margin: '0 0 var(--mei-space-8)' }}>
          统一门户 · {items.length} 个应用 · 点击卡片进入 · ⌘K 搜索
        </p>

        {/* 最近使用 */}
        {recentItems.length > 0 && !query && (
          <section style={{ marginBottom: 'var(--mei-space-8)' }}>
            <h2 className="mei-section-title">最近使用</h2>
            <div className="mei-card-grid">
              {recentItems.map(({ plugin, url }) => (
                <AppCard
                  key={plugin.id}
                  plugin={plugin}
                  url={url}
                  onClick={() => openApp({ plugin, url })}
                />
              ))}
            </div>
          </section>
        )}

        {Object.entries(groups).map(([cat, list]) => (
          <section key={cat} style={{ marginBottom: 'var(--mei-space-8)' }}>
            <h2 className="mei-section-title">
              {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
            </h2>
            <div className="mei-card-grid">
              {list.map(({ plugin, url }) => (
                <AppCard
                  key={plugin.id}
                  plugin={plugin}
                  url={url}
                  health={health[plugin.id]}
                  onClick={() => openApp({ plugin, url })}
                />
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="mei-empty">没有匹配「{query}」的应用</div>
        )}
      </main>
    </div>
  );
}
