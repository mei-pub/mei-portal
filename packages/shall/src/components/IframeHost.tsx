'use client';
// iframe 宿主 —— 嵌入上游应用，全屏占满主区
//
// 加载态刻意做成「非阻断」：早期版本用全屏遮罩盖住 iframe，应用其实已经在逐步渲染，
// 却要等 onLoad 才揭开，观感上就是好几秒白屏。现在只在顶部走一条细进度条，
// 应用内容边加载边显示；只有久久不出内容时才升级为可重试的提示条。
import { useEffect, useRef, useState } from 'react';

// 同源子应用内部导航即时上报外壳：包一层 history.pushState/replaceState 与
// popstate，导航当拍 postMessage 通知外壳回写地址栏（AppFrame 的 inner-path
// 分支）。ready 时注入一次，幂等；跨域 iframe eval 会抛 SecurityError，静默
// 失败后由外壳 1.2s 轮询兜底。（门内历史回调以 bind 固定 this，保 Router 兼容）
const INNER_NAV_HOOK = [
  "if (!window.__meiInnerNav) {",
  "  window.__meiInnerNav = true;",
  "  var __meiNotify = function () {",
  "    try {",
  "      parent.postMessage({ source: 'mei-iframe', type: 'inner-path', path: window.location.pathname + window.location.search + window.location.hash }, window.location.origin);",
  "    } catch (e) {}",
  "  };",
  "  ['pushState', 'replaceState'].forEach(function (k) {",
  "    var orig = window.history[k].bind(window.history);",
  "    window.history[k] = function () {",
  "      var r = orig.apply(null, arguments);",
  "      __meiNotify();",
  "      return r;",
  "    };",
  "  });",
  "  window.addEventListener('popstate', __meiNotify);",
  "}",
].join('\n');

export default function IframeHost({ url, name, appId }: { url: string; name: string; appId?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // 本次加载是否已完成（onLoad 或 ready postMessage 任一先到即算完成）
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // 同源子应用内部导航即时上报外壳：注入 history hook（幂等）。
  // 触发时机有二：iframe onLoad（所有普通加载的中点）+ ready postMessage（子
  // 应用主动建立时）。此前只在 ready 分支注入，但普通 Vite 子应用并不主动
  // 发 ready，导致 hook 从未注入、外壳回写退回 1200ms 轮询（地址延迟一拍）。
  const injectInnerNavHook = () => {
    try {
      const w = ref.current?.contentWindow;
      const host = w as unknown as {
        __meiInnerNav?: boolean;
        eval?: (code: string) => void;
      };
      if (w && host.__meiInnerNav !== true && typeof host.eval === 'function') {
        host.eval(INNER_NAV_HOOK);
      }
    } catch {
      /* 跨域：忽略，轮询兜底 */
    }
  };

  useEffect(() => {
    loadedRef.current = false;
    setLoading(true);
    setSlow(false);
    setError(false);
    const t = setTimeout(() => {
      // 仅在确实未完成加载时提示（已完成则什么都不做）
      if (!loadedRef.current) {
        setSlow(true);
      }
    }, 8000);
    return () => clearTimeout(t);
  }, [url, reloadTick]);

  // 监听 iframe 上报 ready（保活模式下页面里有多个 iframe，
  // 必须校验消息来自自己的 iframe，否则任一后台应用 ready 都会清掉本 host 的加载态）
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.source !== ref.current?.contentWindow) return;
      const d = ev.data || {};
      if (d.source === 'mei-iframe' && d.type === 'ready') {
        loadedRef.current = true;
        setLoading(false);
        setSlow(false);
        // ready 兜底注入（多数子应用不主动发 ready，onLoad 分支才是主路径）
        injectInnerNavHook();
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 重试：reload() 在跨域 iframe 上会抛 SecurityError，且无论哪种情况都必须
  // 重新挂载 iframe 才能真正重载（src 不变时仅 effect 重跑不会触发重新加载）。
  // key={reloadTick} 让 React 卸载旧 iframe、按原 src 挂新的（不污染 URL 回写）。
  const retry = () => {
    try {
      ref.current?.contentWindow?.location.reload();
    } catch {
      /* 跨域：reload 不可达，仅靠 key 重挂 */
    }
    setReloadTick((t) => t + 1);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {loading && (
        // 顶部细进度条：不遮挡 iframe，应用可以边加载边显示内容。
        // 宽度用动画持续推进但永远不到 100%，加载完成即整体消失。
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            zIndex: 2,
            overflow: 'hidden',
            pointerEvents: 'none',
            background: 'transparent',
          }}
          role="progressbar"
          aria-label={`正在加载 ${name}`}
        >
          <div
            style={{
              height: '100%',
              background: 'var(--mei-primary)',
              animation: 'mei-load-bar 2.4s ease-out forwards',
            }}
          />
        </div>
      )}
      {slow && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 3,
            padding: '6px 12px',
            fontSize: 12,
            color: 'var(--mei-text-muted)',
            background: 'var(--mei-surface)',
            borderBottom: '1px solid var(--mei-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>{name} 加载较慢，应用可能仍在启动…</span>
          <button
            onClick={retry}
            style={{
              border: '1px solid var(--mei-border)',
              background: 'transparent',
              color: 'var(--mei-text)',
              borderRadius: 'var(--mei-radius-full)',
              padding: '2px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        key={reloadTick}
        src={url}
        title={name}
        data-mei-app={appId}
        onLoad={() => {
          loadedRef.current = true;
          setLoading(false);
          setError(false);
          // 加载完成即注入内部导航上报 hook：此后子应用 SPA 的 pushState/
          // replaceState/popstate 当拍 postMessage 回写外壳地址栏
          injectInnerNavHook();
        }}
        onError={() => setError(true)}
        allow="clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          // 全屏铺满：圆角会在四角露出外壳底色，形成与应用背景不一致的缺口；
          // 背景也交给应用自己（外壳底色一旦透出就是撞色）。
          background: 'transparent',
          borderRadius: 0,
          display: 'block',
        }}
      />
      {error && (
        // onError 在 iframe 上几乎不会触发（网络错误发生在文档内部），
        // 一旦触发也只做顶部轻提示，不用全屏遮罩盖住可能仍在渲染的内容
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 3,
            padding: '6px 12px',
            fontSize: 12,
            color: 'var(--mei-danger)',
            background: 'var(--mei-surface)',
            borderBottom: '1px solid var(--mei-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>检测到 {name} 加载异常，应用可能不可用</span>
          <button
            onClick={retry}
            style={{
              border: '1px solid var(--mei-border)',
              background: 'transparent',
              color: 'var(--mei-text)',
              borderRadius: 'var(--mei-radius-full)',
              padding: '2px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )}
      <style>{`@keyframes mei-spin{to{transform:rotate(360deg)}}
/* 进度条推进曲线：先快后慢，停在 92% 等真正加载完成后整条消失，
   避免「跑到 100% 却还没好」的割裂感 */
@keyframes mei-load-bar{0%{width:0}18%{width:38%}55%{width:72%}100%{width:92%}}`}</style>
    </div>
  );
}
