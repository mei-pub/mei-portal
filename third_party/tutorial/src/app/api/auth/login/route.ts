import { NextResponse } from 'next/server';
import { getLibraryById, getLibrariesWithPasswords } from '@/lib/db';
import { buildAuthToken, isMasterPassword, applyUnlockCookie } from '@/lib/auth';

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
          const token = buildAuthToken(lib.id, lib.password);
          const res = NextResponse.json({ matched: true, success: true, libraryId: lib.id, libraryName: lib.name });
          res.headers.append(
            'Set-Cookie',
            `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`
          );
          return res;
        }
      }
      // 主密码解锁：昵称==主密码 → 静默下发解锁 cookie，继续游戏（matched:false）
      if (isMasterPassword(nickname)) {
        const res = NextResponse.json({ matched: false, unlocked: true });
        applyUnlockCookie(res);
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

    // 主密码打开隐藏书架
    if (library.hidden && isMasterPassword(password)) {
      const res = NextResponse.json({ success: true, libraryId: library.id, libraryName: library.name, unlocked: true });
      applyUnlockCookie(res);
      return res;
    }

    // No password set on library = always allowed
    if (!library.password) {
      const token = buildAuthToken(library.id, '');
      const res = NextResponse.json({ success: true, libraryId: library.id, libraryName: library.name });
      res.headers.append('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`);
      return res;
    }

    if (password !== library.password) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Set auth cookie (valid for 7 days)
    const token = buildAuthToken(library.id, password);
    const res = NextResponse.json({ success: true, libraryId: library.id, libraryName: library.name });
    res.headers.append(
      'Set-Cookie',
      `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`
    );
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
