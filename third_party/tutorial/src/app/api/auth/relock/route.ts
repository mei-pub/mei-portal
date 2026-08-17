import { NextResponse } from 'next/server';
import { getLibraries, getLibraryById } from '@/lib/db';
import {
  clearUnlockCookie,
  isUnlocked,
  getActiveHiddenId,
  parseAuthToken,
  authCookieHeader,
  clearAuthCookieHeader,
} from '@/lib/auth';

// POST /api/auth/relock — 重新隐藏已打开的隐藏书架（收回访问权）
// 清除 unlock cookie 激活态；若当前会话正停留在隐藏书架上，则回落到第一个公开书架（无则登出）。
export async function POST(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const activeHiddenId = getActiveHiddenId(request);
    const current = parseAuthToken(request);
    const currentLibrary = current ? getLibraryById(current.libraryId) : null;

    const res = NextResponse.json({ success: true, relockedId: activeHiddenId });
    clearUnlockCookie(res);

    // 当前会话停在隐藏书架上 → 回落第一个公开书架（无则清空 auth）
    const stayingOnHidden =
      (activeHiddenId !== null && current?.libraryId === activeHiddenId) ||
      (currentLibrary?.hidden ?? false);
    if (stayingOnHidden) {
      const fallback = getLibraries().find(l => !l.hidden && l.id !== activeHiddenId);
      if (fallback) {
        res.headers.append('Set-Cookie', authCookieHeader(fallback.id, ''));
      } else {
        res.headers.append('Set-Cookie', clearAuthCookieHeader());
      }
    }
    return res;
  } catch (error) {
    console.error('Failed to relock hidden library:', error);
    return NextResponse.json({ error: 'Failed to relock hidden library' }, { status: 500 });
  }
}
