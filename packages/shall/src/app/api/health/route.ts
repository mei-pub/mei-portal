import { NextResponse } from 'next/server';
import { getPlugins } from '@/lib/plugins';

export const dynamic = 'force-dynamic';

// 并发探活各应用内部 endpoint，返回状态汇总
export async function GET() {
  const plugins = getPlugins();
  const results = await Promise.all(
    plugins.map(async (p) => {
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(p.endpoint + (p.health?.path || '/'), {
          signal: ctrl.signal,
          redirect: 'manual',
        });
        clearTimeout(t);
        return {
          id: p.id,
          ok: res.status === (p.health?.expect || 200) || res.status < 500,
          status: res.status,
          ms: Date.now() - start,
        };
      } catch (e) {
        return { id: p.id, ok: false, status: 0, ms: Date.now() - start, error: String(e) };
      }
    })
  );
  return NextResponse.json({ apps: results });
}
