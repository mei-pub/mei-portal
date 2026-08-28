'use client';
// 全局导航桥 —— 把同源跳转统一收敛为 Next 客户端路由切换。
//
// 为什么必须存在：常驻音乐播放条挂在根 layout 上，只有客户端路由切换才会保留它；
// 一旦发生整页加载，Audio 元素被销毁，播放就会中断（表现为「切应用后音乐停了」）。
// 子应用路径统一改写到承载页 /app，门户自身路径走 router.push。
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { appHostHref } from '@/lib/app-host';

export default function NavBridge() {
  const router = useRouter();

  useEffect(() => {
    let plugins: Array<{ id: string; url: string }> = [];
    fetch('/api/plugins', { credentials: 'include' })
      .then((r) => r.json())
      .then((list) => {
        plugins = Array.isArray(list) ? list.map((p) => ({ id: p.id, url: p.url })) : [];
      })
      .catch(() => {});

    function onClick(ev: MouseEvent) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const anchor = (ev.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#') || anchor.getAttribute('target') === '_blank') return;
      if (anchor.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const path = `${url.pathname}${url.search}${url.hash}`;
      const hosted = appHostHref(path, plugins);
      ev.preventDefault();
      router.push(hosted || path);
    }

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  return null;
}
