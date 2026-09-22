import { NextResponse } from 'next/server';
import { requireSiteAccess } from "@/lib/auth";
import { exportLibrary } from '@/lib/backup';

export async function POST(request: Request) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;

  try {
    const data = exportLibrary(libraryId);

    // Return as downloadable JSON
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="novels-backup-${data.exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error('Failed to export library:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
