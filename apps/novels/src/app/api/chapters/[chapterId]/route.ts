import { NextResponse } from 'next/server';
import { getChapterById, updateChapter, deleteChapter } from '@/lib/db';
import { requireSiteAccess } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { chapterId } = await params;
    const chapter = getChapterById(parseInt(chapterId), libraryId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    return NextResponse.json(chapter);
  } catch (error) {
    console.error('Failed to fetch chapter:', error);
    return NextResponse.json({ error: 'Failed to fetch chapter' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { chapterId } = await params;
    const body = await request.json();
    const { title, content, chapter_order } = body;
    const ok = updateChapter(parseInt(chapterId), libraryId, { title, content, chapter_order });
    if (!ok) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Chapter updated successfully' });
  } catch (error) {
    console.error('Failed to update chapter:', error);
    return NextResponse.json({ error: 'Failed to update chapter' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { chapterId } = await params;
    const ok = deleteChapter(parseInt(chapterId), libraryId);
    if (!ok) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Chapter deleted successfully' });
  } catch (error) {
    console.error('Failed to delete chapter:', error);
    return NextResponse.json({ error: 'Failed to delete chapter' }, { status: 500 });
  }
}
