import { NextResponse } from 'next/server';
import { getLibrariesWithPasswords, getLibraryById, updateLibrary } from '@/lib/db';
import { requireAuth, verifyAuth, isUnlocked, getActiveHiddenId } from '@/lib/auth';

// GET /api/settings — returns info about all libraries (public; 不返回密码本体，仅 hasPassword)
export async function GET(request: Request) {
  try {
    const unlocked = isUnlocked(request);
    const libraries = getLibrariesWithPasswords()
      .filter(l => !l.hidden || unlocked)
      .map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }));
    const authedLibraryId = verifyAuth(request);

    return NextResponse.json({
      libraries,
      authenticatedLibraryId: authedLibraryId,
      unlocked,
      activeHiddenId: getActiveHiddenId(request),
    });
  } catch (error) {
    console.error('Failed to get settings:', error);
    return NextResponse.json({ error: 'Failed to get settings' }, { status: 500 });
  }
}

// PUT /api/settings — update current library settings (requires auth)
export async function PUT(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;
  try {
    const body = await request.json();
    const { name, password } = body;
    const ok = updateLibrary(libraryId, { name, password });
    if (!ok) {
      return NextResponse.json({ error: 'Library not found' }, { status: 404 });
    }
    const library = getLibraryById(libraryId);
    return NextResponse.json({
      libraryId: library!.id,
      name: library!.name,
      hasPassword: !!library!.password,
    });
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
