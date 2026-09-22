import { NextResponse } from 'next/server';
import { searchNovels, createNovel } from '@/lib/db';
import { requireSiteAccess, requireSiteWriteAccess } from "@/lib/auth";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const siteResult = requireSiteAccess(request, params.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const keyword = (params.get("q") || "").trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(params.get("limit")) || 20));
    // SQL LIKE + LIMIT：避免 JS 层全量加载后 filter+slice
    if (keyword) {
      return NextResponse.json(searchNovels(libraryId, keyword, limit));
    }
    const novels = searchNovels(libraryId, "", limit);
    return NextResponse.json(novels);
  } catch (error) {
    console.error('Failed to fetch novels:', error);
    return NextResponse.json({ error: 'Failed to fetch novels' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const siteResult = requireSiteWriteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const body = await request.json();
    const { title, slug, author, description, cover_url, icon, iconColor, icon_color, category, tags, status } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const novel = createNovel(libraryId, { title, slug, author, description, cover_url, icon, iconColor: iconColor ?? icon_color, category, tags: tags || [], status });
    return NextResponse.json(novel, { status: 201 });
  } catch (error) {
    console.error('Failed to create novel:', error);
    return NextResponse.json({ error: 'Failed to create novel' }, { status: 500 });
  }
}
