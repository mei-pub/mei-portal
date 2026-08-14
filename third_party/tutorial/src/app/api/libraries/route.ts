import { NextResponse } from 'next/server';
import { getLibraries, createLibrary, deleteLibrary, getLibraryById } from '@/lib/db';
import { requireAuth, isUnlocked } from '@/lib/auth';

// GET /api/libraries — list libraries (public info only; 隐藏书架需解锁可见)
export async function GET(request: Request) {
  try {
    const unlocked = isUnlocked(request);
    const libraries = getLibraries().filter(l => !l.hidden || unlocked);
    return NextResponse.json(libraries);
  } catch (error) {
    console.error('Failed to fetch libraries:', error);
    return NextResponse.json({ error: 'Failed to fetch libraries' }, { status: 500 });
  }
}

// POST /api/libraries — create a new library (requires auth)
export async function POST(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body = await request.json();
    const { name, password } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
    }

    const library = createLibrary({ name: name.trim(), password: password || '' });
    return NextResponse.json({ id: library.id, name: library.name }, { status: 201 });
  } catch (error) {
    console.error('Failed to create library:', error);
    return NextResponse.json({ error: 'Failed to create library' }, { status: 500 });
  }
}

// DELETE /api/libraries — delete a library (requires auth)
export async function DELETE(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '');

    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Invalid library ID' }, { status: 400 });
    }

    // Prevent deleting the last library
    const libraries = getLibraries();
    if (libraries.length <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last library' }, { status: 400 });
    }

    const ok = deleteLibrary(id);
    if (!ok) {
      return NextResponse.json({ error: 'Library not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete library:', error);
    return NextResponse.json({ error: 'Failed to delete library' }, { status: 500 });
  }
}
