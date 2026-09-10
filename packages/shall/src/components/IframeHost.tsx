'use client';
// iframe 宿主 —— 嵌入上游应用，全屏占满主区
//
// 加载态刻意做成「非阻断」：早期版本用全屏遮罩盖住 iframe，应用其实已经在逐步渲染，
// 却要等 onLoad 才揭开，观感上就是好几秒白屏。现在只在顶部走一条细进度条，
// 应用内容边加载边显示；只有久久不出内容时才升级为可重试的提示条。
import { useEffect, useRef, useState } from 'react';

export default function IframeHost({ url, name, appId }: { url: string; name: string; appId?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // 本次加载是否已完成（onLoad 或 ready postMessage 任一先到即算完成）
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

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
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

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
            onClick={() => {
              // 触发重载：重置状态并由 effect 重新计时（同源 iframe 直接 reload）
              try {
                ref.current?.contentWindow?.location.reload();
              } catch {
                /* 跨域兜底：走 reloadTick 触发 src 重挂 */
              }
              setReloadTick((t) => t + 1);
            }}
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
        src={url}
        title={name}
        data-mei-app={appId}
        onLoad={() => {
          loadedRef.current = true;
          setLoading(false);
          setError(false);
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
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--mei-danger)',
          }}
        >
          加载失败，请检查应用是否已启动
        </div>
      )}
      <style>{`@keyframes mei-spin{to{transform:rotate(360deg)}}
/* 进度条推进曲线：先快后慢，停在 92% 等真正加载完成后整条消失，
   避免「跑到 100% 却还没好」的割裂感 */
@keyframes mei-load-bar{0%{width:0}18%{width:38%}55%{width:72%}100%{width:92%}}`}</style>
    </div>
  );
}
