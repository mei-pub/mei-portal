import { NextResponse } from "next/server";
import { createVolume, updateVolume, deleteVolume, getNovelById, getNovelBySlug } from "@/lib/db";
function resolveNovelId(idOrSlug: string, libraryId: number): number | null {
  const n = Number(idOrSlug);
  const novel = Number.isInteger(n) && String(n) === idOrSlug ? getNovelById(n, libraryId) : getNovelBySlug(idOrSlug, libraryId);
  return novel ? novel.id : null;
}
import { requireSiteAccess } from "@/lib/auth";

// POST - 创建分卷
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;

  try {
    const { id } = await params;
    const novelId = resolveNovelId(id, libraryId);
    if (!novelId) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    const novel = getNovelById(novelId, libraryId);
    if (!novel) {
      return NextResponse.json({ error: "Novel not found" }, { status: 404 });
    }

    const body = await request.json();
    const { title, position } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Volume title is required" }, { status: 400 });
    }

    const volume = createVolume(novelId, libraryId, title.trim(), position || 0);
    return NextResponse.json(volume, { status: 201 });
  } catch (error) {
    console.error("Create volume error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT - 更新分卷
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;

  try {
    const { id } = await params;
    const novelId = resolveNovelId(id, libraryId);
    if (!novelId) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }

    const body = await request.json();
    const { id: volumeId, title, position } = body;

    if (!volumeId || !title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Volume ID and title are required" }, { status: 400 });
    }

    const volume = updateVolume(volumeId, novelId, libraryId, title.trim(), position || 0);
    if (!volume) {
      return NextResponse.json({ error: "Volume not found" }, { status: 404 });
    }

    return NextResponse.json(volume);
  } catch (error) {
    console.error("Update volume error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE - 删除分卷
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;

  try {
    const { id } = await params;
    const novelId = resolveNovelId(id, libraryId);
    if (!novelId) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const volumeId = parseInt(searchParams.get("volumeId") || "");

    if (!volumeId || isNaN(volumeId)) {
      return NextResponse.json({ error: "Invalid volume ID" }, { status: 400 });
    }

    const success = deleteVolume(volumeId, novelId, libraryId);
    if (!success) {
      return NextResponse.json({ error: "Volume not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete volume error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
