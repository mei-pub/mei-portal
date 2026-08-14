import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { exportLibrary } from '@/lib/backup';

export async function POST(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;

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
