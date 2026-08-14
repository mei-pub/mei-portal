import { NextRequest, NextResponse } from 'next/server';
import { initUserIfNeeded, verifyLogin, setSession } from '@/lib/auth';
import { proxyLoginAll } from '@/lib/login-proxy';

export const dynamic = 'force-dynamic';

// 子应用 cookie 持久化：给 session 级 cookie 加 Max-Age，避免浏览器关闭后丢失
// mei-auth 有 30 天 Max-Age，子应用 cookie 也应对齐，保证登录态穿透不失效
const SUBAPP_COOKIE_MAX_AGE = 30 * 24 * 3600; // 30 天

function persistCookie(cookie: string): string {
  // 已有 Max-Age 或 Expires 的 cookie 不处理
  if (/max-age=/i.test(cookie) || /expires=/i.test(cookie)) return cookie;
  // 追加 Max-Age 和 Path=/（确保全域名共享）
  let c = cookie;
  if (!/path=/i.test(c)) c += '; Path=/';
  c += `; Max-Age=${SUBAPP_COOKIE_MAX_AGE}`;
  return c;
}

export async function POST(req: NextRequest) {
  initUserIfNeeded();
  const { username, password } = await req.json();
  if (!verifyLogin(username || '', password || '')) {
    return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
  }
  setSession();
  // 代理登录各应用，收集 set-cookie 透传给浏览器（同源共享）
  const results = await proxyLoginAll(username, password);
  // token 类应用的凭证存入 session（供 /api/auth/me 返回给顶栏注入 localStorage）
  const tokens: Record<string, string> = {};
  for (const r of results) {
    if (r.token) tokens[r.appId] = r.token;
  }
  if (Object.keys(tokens).length > 0) {
    const { setSessionTokens } = await import('@/lib/auth');
    setSessionTokens(tokens);
  }
  const res = NextResponse.json({ ok: true, username, apps: results.map(r => ({ id: r.appId, success: r.success })) });
  for (const r of results) {
    for (const c of r.cookies) {
      // 持久化子应用 cookie：加 Max-Age 防止浏览器关闭后登录态丢失
      res.headers.append('Set-Cookie', persistCookie(c));
    }
  }
  return res;
}
