'use client';
// 应用承载外壳 —— 子应用以 iframe 呈现，外壳页面不卸载。
// 这是「跨应用连续播放」的基础：音频元素活在外壳里，切换应用只换 iframe src。
//
// 顶栏仍由唯一来源 /__shell/topbar.js 提供（本页注入，data-app 随当前应用变化）。
// 顶栏内的应用链接点击被本组件拦截为客户端切换，避免整页导航销毁播放引擎。
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import IframeHost from './IframeHost';

interface Plugin {
  id: string;
  name: string;
  url: string;
}

declare global {
  interface Window {
    /** topbar.js 的单例标记，注入后为 true */
    __meiTopbar?: boolean;
  }
}

/** iframe URL：统一带 meiEmbed=1，子应用内不再重复注入顶栏 */
function embedUrl(path: string): string {
  const [beforeHash, hash] = path.split('#');
  const [pathname, search] = beforeHash.split('?');
  const params = new URLSearchParams(search || '');
  params.set('meiEmbed', '1');
  return `${pathname || '/'}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

function samePath(a: string, b: string): boolean {
  const strip = (v: string) => v.replace(/\?[^#]*/, '').replace(/\/+$/, '');
  return strip(a) === strip(b);
}

export default function AppFrame() {
  const searchParams = useSearchParams();
  const appId = searchParams.get('app') || '';
  const rawPath = searchParams.get('path') || '';
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [frameSrc, setFrameSrc] = useState('');
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  const plugin = plugins.find((p) => p.id === appId) || null;
  const targetPath = rawPath || plugin?.url || '';

  useEffect(() => {
    fetch('/api/plugins', { credentials: 'include' })
      .then((r) => r.json())
      .then((list) => setPlugins(Array.isArray(list) ? list : []))
      .catch(() => setPlugins([]));
  }, []);

  // iframe src 只在目标应用/路径真正变化时更新，避免重挂导致子应用状态丢失
  useEffect(() => {
    if (!targetPath) return;
    setFrameSrc((prev) => (prev && samePath(prev, embedUrl(targetPath)) ? prev : embedUrl(targetPath)));
  }, [targetPath]);

  // 顶栏注入（唯一样式来源），data-app 随应用切换刷新高亮。
  // topbar.js 自带单例保护（window.__meiTopbar），二次挂载不会重新执行，
  // 因此每次挂载都必须显式解除 suppress 并同步当前应用，否则从门户主页
  // 返回承载页后顶栏会永久消失。
  useEffect(() => {
    if (!appId) return;
    if (!window.__meiTopbar) {
      if (!scriptRef.current) {
        const script = document.createElement('script');
        script.src = '/__shell/topbar.js';
        script.setAttribute('data-app', appId);
        document.head.appendChild(script);
        scriptRef.current = script;
      }
      return;
    }
    window.dispatchEvent(new CustomEvent('mei-topbar-suppress', { detail: { suppressed: false } }));
    window.dispatchEvent(new CustomEvent('mei-topbar-app', { detail: { app: appId } }));
    window.dispatchEvent(new Event('mei-topbar-rebuild'));
  }, [appId]);

  // 离开承载页（返回门户主页/设置页）时抑制注入式顶栏，避免与门户自身顶栏叠加
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent('mei-topbar-suppress', { detail: { suppressed: true } }));
    },
    []
  );

  // 子应用内部导航（hash 路由等）回写到外层 URL，保证刷新/分享可复原
  useEffect(() => {
    if (!frameSrc) return;
    const timer = setInterval(() => {
      const frame = document.querySelector('iframe');
      if (!frame) return;
      let inner = '';
      try {
        const loc = (frame as HTMLIFrameElement).contentWindow?.location;
        if (!loc) return;
        inner = `${loc.pathname}${loc.hash}`;
      } catch {
        return; // 跨域应用：忽略
      }
      if (!inner || !appId) return;
      const params = new URLSearchParams({ app: appId, path: inner });
      const next = `/app?${params.toString()}`;
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState(null, '', next);
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [frameSrc, appId]);

  if (!appId) {
    return (
      <div style={{ padding: 80, textAlign: 'center', color: 'var(--mei-text-muted)' }}>
        未指定应用，<a href="/" style={{ color: 'var(--mei-primary)' }}>返回主页</a>
      </div>
    );
  }

  // iframe 全屏铺满，外壳不再为悬浮胶囊挖留白。
  // 顶部避让改由 topbar.js 在子应用文档内部完成（body padding-top），
  // 这样露在胶囊后面的是应用自己的背景，不会拼出一条外壳底色的色带。
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {frameSrc ? (
        <IframeHost url={frameSrc} name={plugin?.name || appId} />
      ) : (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--mei-text-muted)' }}>正在准备应用…</div>
      )}
    </div>
  );
}
