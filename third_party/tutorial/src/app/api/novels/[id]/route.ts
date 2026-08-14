import { NextResponse } from 'next/server';
import { getNovelById, updateNovel, deleteNovel } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;
  try {
    const { id } = await params;
    const novel = getNovelById(parseInt(id), libraryId);
    if (!novel) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    return NextResponse.json(novel);
  } catch (error) {
    console.error('Failed to fetch novel:', error);
    return NextResponse.json({ error: 'Failed to fetch novel' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, author, description, cover_url, category, tags, status, rating } = body;
    const ok = updateNovel(parseInt(id), libraryId, { title, author, description, cover_url, category, tags: tags || [], status, rating });
    if (!ok) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Novel updated successfully' });
  } catch (error) {
    console.error('Failed to update novel:', error);
    return NextResponse.json({ error: 'Failed to update novel' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;
  try {
    const { id } = await params;
    const ok = deleteNovel(parseInt(id), libraryId);
    if (!ok) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Novel deleted successfully' });
  } catch (error) {
    console.error('Failed to delete novel:', error);
    return NextResponse.json({ error: 'Failed to delete novel' }, { status: 500 });
  }
}
