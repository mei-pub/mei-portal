import { NextResponse } from 'next/server';
import { clearUnlockCookie, isUnlocked } from '@/lib/auth';

// POST /api/auth/relock — 退出站点管理（清除主密码解锁态）
// 隐秘站点的开启/关闭由 /api/gate 独立管理，与此无关
export async function POST(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  const res = NextResponse.json({ success: true });
  clearUnlockCookie(res);
  return res;
}
