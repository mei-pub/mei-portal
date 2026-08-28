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

/** 同时保活的 iframe 上限：超过后淘汰最久未访问的那个（当前应用永不淘汰） */
const MAX_LIVE_FRAMES = 4;

export default function AppFrame() {
  const searchParams = useSearchParams();
  const appId = searchParams.get('app') || '';
  const rawPath = searchParams.get('path') || '';
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  // 已经打开过的应用：保留各自的 iframe，切回时直接显示，不重新加载。
  // 只记录「首次进入该应用时的 src」，后续同应用内的路径变化由子应用自己的路由处理，
  // 否则每次回写 URL 都会换 src、把 iframe 打回重新加载。
  const [mounted, setMounted] = useState<Array<{ appId: string; src: string }>>([]);
  // 访问顺序（LRU 淘汰用）。不能靠给 mounted 排序来表达顺序：
  // 数组顺序变化会让 React 搬动 DOM 节点，iframe 一被移动就会重新加载。
  const orderRef = useRef<string[]>([]);
  // 上一次「路由级」导航目标，用于区分真实跳转与 URL 回写
  const navKeyRef = useRef('');

  const plugin = plugins.find((p) => p.id === appId) || null;
  const targetPath = rawPath || plugin?.url || '';
  // src 直接由当前 URL 推导，不经过 state：
  // 走 state 的话，同一轮渲染里保活列表读到的还是上一个应用的 src，
  // 新挂的 iframe 会装错应用（表现为切到 B 却加载出 A）。
  const desiredSrc = targetPath ? embedUrl(targetPath) : '';
  const pluginsRef = useRef<Plugin[]>([]);
  pluginsRef.current = plugins;

  useEffect(() => {
    fetch('/api/plugins', { credentials: 'include' })
      .then((r) => r.json())
      .then((list) => setPlugins(Array.isArray(list) ? list : []))
      .catch(() => setPlugins([]));
  }, []);

  // 维护保活列表：当前应用没挂过就追加一个 iframe，挂过则复用现有的
  useEffect(() => {
    if (!appId || !desiredSrc) return;
    orderRef.current = [...orderRef.current.filter((a) => a !== appId), appId];
    setMounted((prev) => {
      if (prev.some((m) => m.appId === appId)) return prev;
      const next = [...prev, { appId, src: desiredSrc }];
      if (next.length <= MAX_LIVE_FRAMES) return next;
      // 按访问顺序淘汰最久未用的（当前应用除外），避免无限堆积后台 iframe
      const victim = orderRef.current.find((a) => a !== appId && next.some((m) => m.appId === a));
      return victim ? next.filter((m) => m.appId !== victim) : next;
    });
  }, [appId, desiredSrc]);

  // 深链跳转：目标应用已在保活列表里时，把它的 iframe 导到请求的路径。
  // 顶栏切换应用给的是应用根路径，这种情况只切显示、不打断该应用的现场
  // （否则保活就没意义了：每次切回都把应用打回首页并重启一遍）。
  useEffect(() => {
    if (!appId || !desiredSrc) return;
    const key = `${appId}|${desiredSrc}`;
    if (navKeyRef.current === key) return;
    navKeyRef.current = key;
    if (!rawPath) return;
    const rootPath = plugin?.url || '';
    if (rootPath && samePath(rawPath, rootPath)) return;
    const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-mei-app="${appId}"]`);
    if (!frame) return; // 首次挂载：src 已经是目标路径
    try {
      const loc = frame.contentWindow?.location;
      if (!loc) return;
      if (samePath(`${loc.pathname}${loc.hash}`, rawPath)) return;
      loc.replace(desiredSrc);
    } catch {
      /* 跨域应用：忽略 */
    }
  }, [appId, desiredSrc, rawPath, plugin?.url]);

  // 预热：顶栏按钮悬停时提前挂目标应用的隐藏 iframe。
  // 用户真正点击时资源已在下载或已就绪，切换接近瞬时。
  // 只挂应用根路径（悬停时还不知道用户要去哪个内页），后续深链由上面的 effect 导航。
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data || {};
      if (d.source !== 'mei-topbar' || d.type !== 'prefetch-app') return;
      const id = String(d.app || '');
      if (!id || id === appId) return;
      const target = pluginsRef.current.find((p) => p.id === id);
      if (!target?.url || /^https?:\/\//i.test(target.url)) return;
      const src = embedUrl(target.url);
      setMounted((prev) => {
        if (prev.some((m) => m.appId === id)) return prev;
        // 预热不进 orderRef：没被真正访问过的应用应当最先被淘汰
        const next = [...prev, { appId: id, src }];
        if (next.length <= MAX_LIVE_FRAMES) return next;
        const victim =
          next.find((m) => m.appId !== appId && m.appId !== id && !orderRef.current.includes(m.appId))?.appId ||
          orderRef.current.find((a) => a !== appId && next.some((m) => m.appId === a));
        return victim ? next.filter((m) => m.appId !== victim) : next;
      });
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [appId]);

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
    if (!appId) return;
    const timer = setInterval(() => {
      // 保活模式下页面里有多个 iframe，必须取当前应用那一个，
      // 否则会把后台应用的路径回写到地址栏。
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-mei-app="${appId}"]`);
      if (!frame) return;
      let inner = '';
      try {
        const loc = frame.contentWindow?.location;
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
  }, [appId]);

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
      {mounted.length === 0 && (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--mei-text-muted)' }}>正在准备应用…</div>
      )}
      {/* 保活：每个访问过的应用各占一个常驻 iframe，只切换显示，不卸载。
          切回已加载过的应用因此是瞬时的，不再重跑一遍应用启动。 */}
      {mounted.map((m) => {
        const active = m.appId === appId;
        return (
          <div
            key={m.appId}
            style={{
              position: 'absolute',
              inset: 0,
              // 用 visibility 而非 display:none：display 变化会让部分应用重排/丢掉
              // 滚动位置，visibility + zIndex 能完整保留后台应用的渲染状态
              visibility: active ? 'visible' : 'hidden',
              zIndex: active ? 1 : 0,
              pointerEvents: active ? 'auto' : 'none',
            }}
            aria-hidden={!active}
          >
            <IframeHost
              url={m.src}
              appId={m.appId}
              name={plugins.find((p) => p.id === m.appId)?.name || m.appId}
            />
          </div>
        );
      })}
    </div>
  );
}
