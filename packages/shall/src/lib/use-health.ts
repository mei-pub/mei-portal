'use client';
// 应用健康状态 —— 轮询 /api/health，门户卡片显示在线/离线徽标
import { useEffect, useState } from 'react';

export interface HealthMap {
  [appId: string]: { ok: boolean; ms: number; loading: boolean };
}

export function useHealth(intervalMs = 60000) {
  const [health, setHealth] = useState<HealthMap>({});

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        const map: HealthMap = {};
        for (const a of data.apps || []) {
          map[a.id] = { ok: a.ok, ms: a.ms, loading: false };
        }
        setHealth(map);
      } catch (e) {
        /* ignore */
      }
    }
    check();
    const t = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs]);

  return health;
}
