'use client';
// 门户首页：亮色卡片网格，点击直接跳转到应用子路径（顶栏由各应用自身注入）
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlugin } from '@/lib/categories';
import { CATEGORY_LABELS } from '@/lib/categories';
import TopBar from './TopBar';
import AppCard from './AppCard';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

export default function PortalClient({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // 单镜像模式：url 已是子路径（/novels /link），直接用 items
  // 多容器模式：用浏览器 hostname 重建子域名 url
  const [rootDomain, setRootDomain] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MEI_MODE === 'single') return; // 单镜像直接用 items
    const rd = (window as unknown as { __MEI_ROOT_DOMAIN__?: string }).__MEI_ROOT_DOMAIN__;
    setRootDomain(rd || window.location.hostname);
  }, []);

  const resolvedItems = useMemo(() => {
    if (process.env.NEXT_PUBLIC_MEI_MODE === 'single' || !rootDomain) return items;
    return items.map((i) => ({
      ...i,
      url: `${window.location.protocol}//${i.plugin.subdomainPrefix || i.plugin.id}.${rootDomain}`,
    }));
  }, [items, rootDomain]);

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
          欢迎来到 mei-allin
        </h1>
        <p style={{ color: 'var(--mei-text-muted)', margin: '0 0 var(--mei-space-8)' }}>
          统一门户 · {resolvedItems.length} 个应用 · 点击卡片进入
        </p>

        {Object.entries(groups).map(([cat, list]) => (
          <section key={cat} style={{ marginBottom: 'var(--mei-space-8)' }}>
            <h2 className="mei-section-title">
              {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
            </h2>
            <div className="mei-card-grid">
              {list.map(({ plugin, url }) => (
                <a key={plugin.id} href={url} style={{ textDecoration: 'none' }}>
                  <AppCard plugin={plugin} url={url} onClick={() => {}} />
                </a>
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
