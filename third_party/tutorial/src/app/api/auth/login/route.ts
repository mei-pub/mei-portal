import { NextResponse } from 'next/server';
import { getHiddenLibraries, getLibraryById, getLibrariesWithPasswords } from '@/lib/db';
import { buildAuthToken, isMasterPassword, applyUnlockCookie, authCookieHeader } from '@/lib/auth';

const AUTH_COOKIE = 'auth-token';

// POST /api/auth/login — verifies library+password and sets auth cookie
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Mode 1: Nickname login — match against all library passwords, or master unlock
    if (body.nickname !== undefined) {
      const nickname: string = body.nickname;
      if (!nickname) {
        return NextResponse.json({ matched: false });
      }
      const libs = getLibrariesWithPasswords();
      for (const lib of libs) {
        if (lib.password && lib.password === nickname) {
          const res = NextResponse.json({ matched: true, success: true, libraryId: lib.id, libraryName: lib.name });
          res.headers.append('Set-Cookie', authCookieHeader(lib.id, lib.password));
          return res;
        }
      }
      // 主密码解锁：昵称==主密码 → 静默下发解锁 cookie（激活第一个隐藏书架），继续游戏（matched:false）
      if (isMasterPassword(nickname)) {
        const res = NextResponse.json({ matched: false, unlocked: true });
        const firstHidden = getHiddenLibraries()[0];
        // 同时下发 auth cookie：nginx 对无 auth-token 的浏览器会整体替换 Cookie 头（丢失 mei-unlock），
        // 让浏览器持有 auth-token 后即可原样透传全部 cookie
        res.headers.append('Set-Cookie', authCookieHeader(firstHidden ? firstHidden.id : 1, ''));
        applyUnlockCookie(res, firstHidden?.id);
        return res;
      }
      // No match — not a password, treat as normal game nickname
      return NextResponse.json({ matched: false });
    }

    // Mode 2: Library + password login
    const { libraryId, password } = body;

    if (!libraryId) {
      return NextResponse.json({ error: 'Library ID is required' }, { status: 400 });
    }

    const library = getLibraryById(parseInt(libraryId));
    if (!library) {
      return NextResponse.json({ error: 'Library not found' }, { status: 404 });
    }

    // 主密码打开隐藏书架：同时下发 auth cookie（激活态由 unlock cookie 记录）
    if (library.hidden && isMasterPassword(password)) {
      const res = NextResponse.json({ success: true, libraryId: library.id, libraryName: library.name, unlocked: true });
      res.headers.append('Set-Cookie', authCookieHeader(library.id, ''));
      applyUnlockCookie(res, library.id);
      return res;
    }

    // No password set on library = always allowed
    if (!library.password) {
      const res = NextResponse.json({ success: true, libraryId: library.id, libraryName: library.name });
      res.headers.append('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(buildAuthToken(library.id, ''))}; Path=/; SameSite=Lax`);
      return res;
    }

    if (password !== library.password) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Set auth cookie (valid for 7 days)
    const res = NextResponse.json({ success: true, libraryId: library.id, libraryName: library.name });
    res.headers.append('Set-Cookie', authCookieHeader(library.id, password));
    return res;
  } catch (error) {
    console.error('Auth login failed:', error);
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}

// POST /api/auth/logout — clears auth cookie
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.headers.append('Set-Cookie', `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  return res;
}
