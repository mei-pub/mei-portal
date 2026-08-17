import { NextResponse } from 'next/server';
import { getLibraryById } from '@/lib/db';
import { isUnlocked, applyUnlockCookie, authCookieHeader } from '@/lib/auth';

// POST /api/auth/open-hidden — 打开指定隐藏书架（需已在蜘蛛纸牌输入主密码解锁）
// 会话级激活：书架保持 hidden 不变，unlock cookie 切换为该书架 id，
// 同一时间只允许一个隐藏书架打开（打开新的自动收回旧的）。
export async function POST(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const libraryId = parseInt(body?.libraryId);
    if (!libraryId || isNaN(libraryId)) {
      return NextResponse.json({ error: 'Library ID is required' }, { status: 400 });
    }
    const library = getLibraryById(libraryId);
    if (!library) {
      return NextResponse.json({ error: 'Library not found' }, { status: 404 });
    }
    if (!library.hidden) {
      return NextResponse.json({ error: 'Library is not hidden' }, { status: 400 });
    }

    const res = NextResponse.json({
      success: true,
      libraryId: library.id,
      libraryName: library.name,
      unlocked: true,
    });
    // auth cookie 指向该书架（访问权由 unlock cookie 的激活态维持）
    res.headers.append('Set-Cookie', authCookieHeader(library.id, ''));
    applyUnlockCookie(res, library.id);
    return res;
  } catch (error) {
    console.error('Failed to open hidden library:', error);
    return NextResponse.json({ error: 'Failed to open hidden library' }, { status: 500 });
  }
}
