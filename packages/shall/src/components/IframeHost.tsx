'use client';
// iframe 宿主 —— 嵌入上游应用，全屏占满主区
// 8 秒未上报 ready 时不再无声隐藏 loading，改为顶部非阻断提示条（应用可能仍在启动）
import { useEffect, useRef, useState } from 'react';

export default function IframeHost({ url, name }: { url: string; name: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setSlow(false);
    setError(false);
    const t = setTimeout(() => {
      // 长时间未 ready（跨域可能收不到 postMessage）：解除全屏 loading，改提示条
      setLoading(false);
      setSlow(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [url, reloadTick]);

  // 监听 iframe 上报 ready
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data || {};
      if (d.source === 'mei-iframe' && d.type === 'ready') {
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
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: 'var(--mei-text-muted)',
            zIndex: 1,
            background: 'var(--mei-bg)',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '3px solid var(--mei-border)',
              borderTopColor: 'var(--mei-primary)',
              animation: 'mei-spin 0.8s linear infinite',
            }}
          />
          <div>正在加载 {name}…</div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--mei-primary-soft)' }}
          >
            在新窗口打开 ↗
          </a>
        </div>
      )}
      {slow && !loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
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
        onLoad={() => {
          setLoading(false);
          setError(false);
        }}
        onError={() => setError(true)}
        allow="clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'var(--mei-bg)',
          borderRadius: 'var(--mei-radius)',
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
      <style>{`@keyframes mei-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
