'use client';
// 门户客户端：渲染卡片网格 + 处理点击进入 iframe 模式
import { useMemo, useState } from 'react';
import type { Category, ClientPlugin } from '@/lib/categories';
import { CATEGORY_LABELS } from '@/lib/categories';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import AppCard from './AppCard';
import IframeHost from './IframeHost';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

export default function PortalClient({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<{ plugin: ClientPlugin; url: string } | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.plugin.name.toLowerCase().includes(q) ||
        i.plugin.id.includes(q) ||
        (i.plugin.description || '').toLowerCase().includes(q)
    );
  }, [items, query]);

  // 分组
  const groups = useMemo(() => {
    return filtered.reduce<Record<string, Item[]>>((acc, i) => {
      (acc[i.plugin.category] = acc[i.plugin.category] || []).push(i);
      return acc;
    }, {});
  }, [filtered]);

  // iframe 模式：顶栏 + 侧栏 + iframe
  if (active) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TopBar />
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <Sidebar
            plugins={items.map((i) => i.plugin)}
            currentId={active.plugin.id}
            onPick={(p) => {
              const found = items.find((i) => i.plugin.id === p.id);
              if (found) setActive(found);
            }}
            onHome={() => setActive(null)}
          />
          <main style={{ flex: 1, padding: 'var(--mei-space-4)', minHeight: 0 }}>
            <IframeHost url={active.url} name={active.plugin.name} />
          </main>
        </div>
      </div>
    );
  }

  // 门户模式：顶栏 + 分组卡片网格
  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar onSearch={setQuery} />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--mei-space-8) var(--mei-space-6)' }}>
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
          统一门户 · {items.length} 个应用 · 点击卡片进入
        </p>

        {Object.entries(groups).map(([cat, list]) => (
          <section key={cat} style={{ marginBottom: 'var(--mei-space-8)' }}>
            <h2
              style={{
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                color: 'var(--mei-text-faint)',
                margin: '0 0 var(--mei-space-4)',
              }}
            >
              {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 'var(--mei-space-4)',
              }}
            >
              {list.map(({ plugin, url }) => (
                <AppCard
                  key={plugin.id}
                  plugin={plugin}
                  url={url}
                  onClick={() => setActive({ plugin, url })}
                />
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--mei-space-8)',
              color: 'var(--mei-text-muted)',
            }}
          >
            没有匹配「{query}」的应用
          </div>
        )}
      </main>
    </div>
  );
}
