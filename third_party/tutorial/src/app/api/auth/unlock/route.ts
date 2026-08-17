import { NextResponse } from 'next/server';
import { isMasterPassword, applyUnlockOnlyCookie } from '@/lib/auth';

// POST /api/auth/unlock — 主密码解锁（不激活任何隐藏书架，解锁 ≠ 打开）
// 用于门户登录自动解锁（login-proxy 适配器）与管理页内联解锁；
// 蜘蛛纸牌输主密码仍走 /api/auth/login 昵称模式（解锁并激活第一个隐藏书架，解锁即读）。
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!isMasterPassword(password)) {
      return NextResponse.json({ error: 'Invalid master password' }, { status: 401 });
    }
    const res = NextResponse.json({ success: true, unlocked: true, active: false });
    applyUnlockOnlyCookie(res);
    return res;
  } catch (error) {
    console.error('Auth unlock failed:', error);
    return NextResponse.json({ error: 'Unlock failed' }, { status: 500 });
  }
}
