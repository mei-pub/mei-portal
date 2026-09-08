import { NextRequest, NextResponse } from 'next/server';
import { initUserIfNeeded, verifyLogin, setSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// 统一身份改造：登录只发主应用会话（mei-auth）。
// 子应用不再各自登录 —— 它们的鉴权模块统一校验 mei-auth（/api/auth/verify）。
// tutorial 的管理解锁门（mei-unlock 存在性检查）由门户登录直接放行。
export async function POST(req: NextRequest) {
  initUserIfNeeded();
  const { username, password } = await req.json();
  if (!verifyLogin(username || '', password || '')) {
    return NextResponse.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
  }
  setSession();
  const res = NextResponse.json({ ok: true, username });
  // tutorial 管理解锁：门户会话即解锁（解锁 cookie 与 mei-auth 同生命周期）
  res.headers.append('Set-Cookie', 'mei-unlock=1; Path=/; Max-Age=2592000; SameSite=Lax');
  return res;
}
