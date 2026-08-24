import { NextRequest, NextResponse } from 'next/server';
import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import { proxyLoginAll } from '@/lib/login-proxy';

export const dynamic = 'force-dynamic';

const SUBAPP_COOKIE_MAX_AGE = 30 * 24 * 3600;

function persistCookie(cookie: string): string {
  if (/max-age=/i.test(cookie) || /expires=/i.test(cookie)) return cookie;
  let c = cookie;
  if (!/path=/i.test(c)) c += '; Path=/';
  c += `; Max-Age=${SUBAPP_COOKIE_MAX_AGE}`;
  return c;
}

/**
 * POST /api/auth/repenetrate — 重新代理登录各子应用
 *
 * 场景：用户 Shell 会话（mei-auth cookie, 30天）仍在，但子应用 session cookie 已过期
 * （浏览器关闭后 session 级 cookie 丢失）。此时访问子应用会 401。
 * 顶栏 JS 在页面加载时调用此端点，用环境凭据重新登录各子应用并刷新 cookie。
 *
 * 仅对默认 admin 用户有效（子应用用 MEI_ADMIN_PASSWORD 初始化）。
 * 若用户改过子应用密码，此端点对该应用会失败（不影响其他应用）。
 */
export async function POST(req: NextRequest) {
  initUserIfNeeded();
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  // 可选：{ "app": "mei-link" } 只重登指定应用（nginx 子路径同步注入用，避免全量登录开销）
  let app: string | undefined;
  try {
    const b = await req.json();
    if (b && typeof b.app === 'string' && b.app) app = b.app;
  } catch { /* 无 body = 全量 */ }
  // 使用环境凭据重新登录各子应用
  const username = process.env.MEI_ADMIN_USER || 'admin';
  const password = process.env.MEI_ADMIN_PASSWORD || 'mei-allin';
  const results = await proxyLoginAll(username, password, app);
  if (app && results.length === 0) {
    return NextResponse.json({ ok: false, error: '未知应用' }, { status: 400 });
  }
  const tokens: Record<string, string> = {};
  for (const r of results) {
    if (r.token) tokens[r.appId] = r.token;
  }
  if (Object.keys(tokens).length > 0) {
    const { setSessionTokens } = await import('@/lib/auth');
    setSessionTokens(tokens);
  }
  const res = NextResponse.json({
    ok: results.length > 0 && results.every((r) => r.success),
    apps: results.map((r) => ({ id: r.appId, success: r.success })),
  });
  for (const r of results) {
    for (const c of r.cookies) {
      res.headers.append('Set-Cookie', persistCookie(c));
    }
  }
  return res;
}
