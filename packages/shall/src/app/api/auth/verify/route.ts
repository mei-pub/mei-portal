import { NextRequest, NextResponse } from 'next/server';

import { getUsername, getUserId, isPortalTokenValid } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// 统一身份鉴权端点：所有子应用的鉴权模块都调这里校验主应用登录态。
// 凭据来源（按优先级）：Cookie mei-auth → Authorization Bearer → X-API-Key → ?token=
// 返回 200 {ok, username, uid} 或 401。子应用侧应带短 TTL 缓存以降低回调频率。

function extractCredential(req: NextRequest): string | undefined {
  const cookieHeader = req.headers.get('cookie') || '';
  const fromCookie = /(?:^|;\s*)mei-auth=([^;]+)/.exec(cookieHeader)?.[1];
  if (fromCookie) return decodeURIComponent(fromCookie);

  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();

  const apiKey = req.headers.get('x-api-key');
  if (apiKey) return apiKey.trim();

  const token = req.nextUrl.searchParams.get('token');
  if (token) return token.trim();

  return undefined;
}

export async function GET(req: NextRequest) {
  const credential = extractCredential(req);
  if (!isPortalTokenValid(credential)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    username: getUsername(),
    uid: getUserId(),
  });
}
