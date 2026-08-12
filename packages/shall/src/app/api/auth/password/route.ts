import { NextRequest, NextResponse } from 'next/server';
import { isLoggedIn, changePassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  const { oldPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 4) {
    return NextResponse.json({ ok: false, error: '新密码至少 4 位' }, { status: 400 });
  }
  if (!changePassword(oldPassword || '', newPassword)) {
    return NextResponse.json({ ok: false, error: '旧密码错误' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
