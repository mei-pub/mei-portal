import { NextResponse } from 'next/server';
import { isLoggedIn, getUserId } from '@/lib/auth';
import { DEFAULT_STATE, getMusicState, patchMusicState } from '@/lib/music-store';

export const dynamic = 'force-dynamic';

// 账户级音乐状态：播放列表 / 收藏 / 当前队列 / 播放进度 / 播放条收起态
// GET  → 当前账户状态（未登录返回默认值，前端回退纯 localStorage）
// PUT  → 部分更新（乐观并发：revision 落后返回 409 + 最新状态）
export async function GET() {
  if (!isLoggedIn()) {
    return NextResponse.json({ loggedIn: false, state: DEFAULT_STATE });
  }
  const uid = getUserId();
  if (!uid) {
    return NextResponse.json({ loggedIn: false, state: DEFAULT_STATE });
  }
  try {
    return NextResponse.json({ loggedIn: true, state: getMusicState(uid) });
  } catch (error) {
    console.error('Failed to read music state:', error);
    return NextResponse.json({ ok: false, error: '音乐状态读取失败' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  const uid = getUserId();
  if (!uid) {
    return NextResponse.json({ ok: false, error: '账户不可用' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const patch = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const result = patchMusicState(uid, patch);
    if (!result.ok) {
      return NextResponse.json({ ok: false, conflict: true, state: result.state }, { status: 409 });
    }
    return NextResponse.json({ ok: true, state: result.state });
  } catch (error) {
    console.error('Failed to save music state:', error);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}
