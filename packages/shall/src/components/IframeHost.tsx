'use client';
// iframe 宿主 —— 嵌入上游应用，全屏占满主区
import { useEffect, useRef, useState } from 'react';

export default function IframeHost({ url, name }: { url: string; name: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const t = setTimeout(() => {
      // 若 iframe 长时间未上报 ready（跨域可能收不到），仍解除 loading
      setLoading(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [url]);

  // 监听 iframe 上报 ready
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data || {};
      if (d.source === 'mei-iframe' && d.type === 'ready') {
        setLoading(false);
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
