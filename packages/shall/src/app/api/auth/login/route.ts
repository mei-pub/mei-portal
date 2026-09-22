import { NextRequest, NextResponse } from 'next/server';
import { initUserIfNeeded, verifyLogin, setSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// 登录失败限流（单用户系统，进程内计数即可）：
// 同一来源 IP 10 分钟内连续失败 ≥5 次后返回 429，防止对唯一账户做密码爆破。
// 成功登录即清零；重启进程自然重置。
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : '') || req.headers.get('x-real-ip') || 'local';
}

function isRateLimited(key: string): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now > entry.resetAt) {
    loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export async function POST(req: NextRequest) {
  initUserIfNeeded();
  const key = clientKey(req);
  if (isRateLimited(key)) {
    return NextResponse.json({ ok: false, error: '尝试次数过多，请 10 分钟后再试' }, { status: 429 });
  }
  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!verifyLogin(username, password)) {
    recordFailure(key);
    return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
  }
  loginFailures.delete(key);
  setSession();
  const res = NextResponse.json({ ok: true, username });
  // tutorial 管理解锁：门户会话即解锁（解锁 cookie 与 mei-auth 同生命周期）。
  // 子域名部署（MEI_COOKIE_DOMAIN）时带 Domain 与 mei-auth 一致跨子域生效
  const cookieDomain = process.env.MEI_COOKIE_DOMAIN
    ? ` Domain=${process.env.MEI_COOKIE_DOMAIN};`
    : '';
  res.headers.append(
    'Set-Cookie',
    `mei-unlock=1; Path=/; Max-Age=2592000; SameSite=Lax;${cookieDomain}`,
  );
  return res;
}
