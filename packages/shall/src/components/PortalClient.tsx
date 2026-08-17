'use client';
// 门户首页：亮色卡片网格，点击直接跳转到应用子路径（顶栏由各应用自身注入）
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlugin } from '@/lib/categories';
import { CATEGORY_LABELS } from '@/lib/categories';
import TopBar from './TopBar';
import AppCard from './AppCard';
import { isSwitchable, isAppEnabled } from '@/lib/app-toggles';

interface Item {
  plugin: ClientPlugin;
  url: string;
}

interface ResolvedItem extends Item {
  disabled?: boolean;
}

export default function PortalClient({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [enabledTick, setEnabledTick] = useState(0);

  // 应用开关变化时刷新（TopBar 下拉切换后 reload，此处兜底）
  useEffect(() => {
    const onStore = () => setEnabledTick((t) => t + 1);
    window.addEventListener('storage', onStore);
    return () => window.removeEventListener('storage', onStore);
  }, []);

  // 单镜像模式：url 已是子路径（/novels /link），直接用 items
  // 多容器模式：用浏览器 hostname 重建子域名 url
  const [rootDomain, setRootDomain] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MEI_MODE === 'single') return; // 单镜像直接用 items
    const rd = (window as unknown as { __MEI_ROOT_DOMAIN__?: string }).__MEI_ROOT_DOMAIN__;
    setRootDomain(rd || window.location.hostname);
  }, []);

  const resolvedItems = useMemo<ResolvedItem[]>(() => {
    let base: ResolvedItem[] = items;
    if (process.env.NEXT_PUBLIC_MEI_MODE !== 'single' && rootDomain) {
      base = items.map((i) => ({
        ...i,
        url: `${window.location.protocol}//${i.plugin.subdomainPrefix || i.plugin.id}.${rootDomain}`,
      }));
    }
    // 应用开关：可开关且被关闭的应用 → 卡片置灰不可点击
    // 蜘蛛纸牌（spider）为框架级独立入口，始终保留，用于输入密码解锁隐藏书架
    return base.map((i) => {
      const disabled = isSwitchable(i.plugin.id) && !isAppEnabled(i.plugin.id);
      return disabled ? { ...i, disabled: true } : i;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rootDomain, enabledTick]);

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
    return filtered.reduce<Record<string, ResolvedItem[]>>((acc, i) => {
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
          maxWidth: 1280,
          margin: '0 auto',
          padding: 'var(--mei-space-5) var(--mei-space-5) var(--mei-space-8)',
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: '0 0 var(--mei-space-1)',
            background: 'var(--mei-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          欢迎来到 mei-allin
        </h1>
        <p style={{ color: 'var(--mei-text-muted)', margin: '0 0 var(--mei-space-5)', fontSize: 13 }}>
          统一门户 · {resolvedItems.length} 个应用 · 点击卡片进入
        </p>

        {Object.entries(groups).map(([cat, list]) => (
          <section key={cat} style={{ marginBottom: 'var(--mei-space-6)' }}>
            <h2 className="mei-section-title">
              {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
            </h2>
            <div className="mei-card-grid">
              {list.map(({ plugin, url, disabled }) =>
                disabled ? (
                  <div key={plugin.id} style={{ textDecoration: 'none' }}>
                    <AppCard plugin={plugin} url={url} disabled onClick={() => {}} />
                  </div>
                ) : (
                  <a key={plugin.id} href={url} style={{ textDecoration: 'none' }}>
                    <AppCard plugin={plugin} url={url} onClick={() => {}} />
                  </a>
                )
              )}
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
