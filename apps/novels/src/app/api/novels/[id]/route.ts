import { NextResponse } from 'next/server';
import { updateNovel, deleteNovel, getNovelById, getNovelBySlug } from '@/lib/db';
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
    const novel = resolveNovel(id, libraryId);
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
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, slug, author, description, cover_url, icon, iconColor, icon_color, category, tags, status, rating } = body;
    const target = resolveNovel(id, libraryId);
    if (!target) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    const ok = updateNovel(target.id, libraryId, { title, slug, author, description, cover_url, icon, iconColor: iconColor ?? icon_color, category, tags: tags || [], status, rating });
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
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { id } = await params;
    const target = resolveNovel(id, libraryId);
    const ok = target ? deleteNovel(target.id, libraryId) : false;
    if (!ok) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Novel deleted successfully' });
  } catch (error) {
    console.error('Failed to delete novel:', error);
    return NextResponse.json({ error: 'Failed to delete novel' }, { status: 500 });
  }
}
