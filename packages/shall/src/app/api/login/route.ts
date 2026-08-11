import { NextRequest, NextResponse } from 'next/server';
import { attemptLogin, getPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (getPassword() === '' || attemptLogin(password || '')) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 });
}
