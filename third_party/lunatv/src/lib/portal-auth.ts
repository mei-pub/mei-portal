import { NextRequest, NextResponse } from 'next/server';

// mei-allin 统一身份：lunatv 不再有独立用户体系。
// 鉴权 = 校验主应用会话（mei-auth cookie / Bearer），由门户 /api/auth/verify 裁决。
// 会话有效时把 lunatv 自己的 auth cookie 注入请求头，下游 API 路由的旧校验逻辑无需改动。

const SHELL_URL = process.env.MEI_SHELL_URL || 'http://127.0.0.1:3010';
const CACHE_TTL = 30 * 1000;
const NEGATIVE_TTL = 5 * 1000;

const verifyCache = new Map<string, { ok: boolean; exp: number }>();

async function isPortalSessionValid(credential: string): Promise<boolean> {
  const cached = verifyCache.get(credential);
  if (cached && cached.exp > Date.now()) return cached.ok;
  let ok = false;
  try {
    const res = await fetch(`${SHELL_URL}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  verifyCache.set(credential, { ok, exp: Date.now() + (ok ? CACHE_TTL : NEGATIVE_TTL) });
  return ok;
}

export async function isPortalSession(request: NextRequest): Promise<boolean> {
  const credential =
    request.cookies.get('mei-auth')?.value ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!credential) return false;
  return isPortalSessionValid(credential);
}

/** legacy auth cookie 值：与 lunatv 单密码登录后注入的格式一致（预编码，请求头注入用） */
export function legacyAuthCookieValue(): string | null {
  const password = process.env.PASSWORD || '';
  if (!password) return null;
  return encodeURIComponent(JSON.stringify({ role: 'owner', password }));
}

/** 浏览器下发用：原始 JSON（Next cookies.set 自带一次编码，浏览器端 decodeURIComponent 一次即得 JSON） */
export function legacyAuthCookieJson(): string | null {
  const password = process.env.PASSWORD || '';
  if (!password) return null;
  return JSON.stringify({ role: 'owner', password });
}

/** 会话有效时，把 lunatv 旧鉴权所需 cookie 注入请求头（仅服务端内部可见，不下发给浏览器） */
export function injectLegacyAuthCookie(request: NextRequest, headers: Headers): Headers {
  const value = legacyAuthCookieValue();
  if (!value) return headers;
  const prior = headers.get('cookie') || '';
  headers.set('cookie', prior ? `${prior}; auth=${value}` : `auth=${value}`);
  return headers;
}

export { NextRequest, NextResponse };
