import { NextRequest, NextResponse } from 'next/server';
import { isLoggedIn, changePassword, changeUsername } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  const { oldPassword, newPassword, newUsername } = await req.json();
  // 修改账户名（可单独提交）
  if (newUsername !== undefined) {
    if (!changeUsername(oldPassword || '', String(newUsername))) {
      return NextResponse.json({ ok: false, error: '旧密码错误或账户名不合法（2-32 位字母/数字/-/_）' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, relogin: true });
  }
  if (!newPassword || newPassword.length < 4) {
    return NextResponse.json({ ok: false, error: '新密码至少 4 位' }, { status: 400 });
  }
  if (!changePassword(oldPassword || '', newPassword)) {
    return NextResponse.json({ ok: false, error: '旧密码错误' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, relogin: true });
}
