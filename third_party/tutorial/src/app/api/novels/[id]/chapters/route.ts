import { NextResponse } from 'next/server';
import { getChaptersByNovelId, createChapter } from '@/lib/db';
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
    const chapters = getChaptersByNovelId(parseInt(id), libraryId);
    return NextResponse.json(chapters);
  } catch (error) {
    console.error('Failed to fetch chapters:', error);
    return NextResponse.json({ error: 'Failed to fetch chapters' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, content, chapter_order } = body;

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 });
    }

    const chapter = createChapter({
      novel_id: parseInt(id),
      library_id: libraryId,
      title,
      content,
      chapter_order: chapter_order || 0,
    });

    return NextResponse.json(chapter, { status: 201 });
  } catch (error) {
    console.error('Failed to create chapter:', error);
    return NextResponse.json({ error: 'Failed to create chapter' }, { status: 500 });
  }
}
