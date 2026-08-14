import { NextResponse } from 'next/server';
import { setLibraryHidden } from '@/lib/db';
import { isUnlocked } from '@/lib/auth';

// PATCH /api/libraries/visibility — 隐藏/打开书架（需主密码解锁）
export async function PATCH(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { id, hidden } = body;
    const libraryId = parseInt(id);
    if (!libraryId || isNaN(libraryId)) {
      return NextResponse.json({ error: 'Invalid library ID' }, { status: 400 });
    }
    const ok = setLibraryHidden(libraryId, !!hidden);
    if (!ok) {
      return NextResponse.json({ error: 'Library not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, id: libraryId, hidden: !!hidden });
  } catch (error) {
    console.error('Failed to update library visibility:', error);
    return NextResponse.json({ error: 'Failed to update library visibility' }, { status: 500 });
  }
}
