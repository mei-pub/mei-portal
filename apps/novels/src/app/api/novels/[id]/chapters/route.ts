import { NextResponse } from 'next/server';
import { getChaptersByNovelId, createChapter, getNovelById, getNovelBySlug } from '@/lib/db';
function resolveNovel(idOrSlug: string, libraryId: number) {
  const n = Number(idOrSlug);
  if (Number.isInteger(n) && String(n) === idOrSlug) return getNovelById(n, libraryId);
  return getNovelBySlug(idOrSlug, libraryId);
}
import { requireSiteAccess } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { id } = await params;
    const target = resolveNovel(id, libraryId);
    if (!target) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    const chapters = getChaptersByNovelId(target.id, libraryId);
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
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, content, chapter_order } = body;

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 });
    }

    const chapter = createChapter({
      novel_id: resolveNovel(id, libraryId)!.id,
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
