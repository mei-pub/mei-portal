import { NextRequest, NextResponse } from 'next/server';

import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';

// 与 music-engine ALL_SOURCES 对齐（含 bilibili），否则启用该源的歌曲封面被 400 拒掉
const MUSIC_SOURCES = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'joox', 'bilibili', 'youtube']);

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { source: string; id: string } },
) {
  initUserIfNeeded();
  if (!isLoggedIn()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const source = decodeURIComponent(params.source || '');
  const id = decodeURIComponent(params.id || '');
  if (!MUSIC_SOURCES.has(source) || !id) {
    return NextResponse.json({ error: 'Invalid cover' }, { status: 400 });
  }

  const base = process.env.SOLARA_INTERNAL_URL || 'http://127.0.0.1:3005';
  // 统一身份：solara 鉴权模块直接校验主应用会话，透传浏览器 cookie 即可
  const cookie = request.headers.get('cookie') || '';

  const query = new URLSearchParams({ types: 'pic', id, source });
  const response = await fetch(`${base}/proxy?${query}`, {
    headers: { Cookie: cookie, Accept: 'image/*,application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.body) {
    return new NextResponse(null, { status: response.status || 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  return new NextResponse(response.body, { status: 200, headers });
}
