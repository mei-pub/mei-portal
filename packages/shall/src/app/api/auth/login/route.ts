import { NextRequest, NextResponse } from 'next/server';
import { initUserIfNeeded, verifyLogin, setSession } from '@/lib/auth';
import { proxyLoginAll } from '@/lib/login-proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  initUserIfNeeded();
  const { username, password } = await req.json();
  if (!verifyLogin(username || '', password || '')) {
    return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
  }
  setSession();
  // 代理登录各应用，收集 set-cookie 透传给浏览器（同源共享）
  const results = await proxyLoginAll(username, password);
  const res = NextResponse.json({ ok: true, username, apps: results.map(r => ({ id: r.appId, success: r.success })) });
  for (const r of results) {
    for (const c of r.cookies) {
      res.headers.append('Set-Cookie', c);
    }
  }
  return res;
}
