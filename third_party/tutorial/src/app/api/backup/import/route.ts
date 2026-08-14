import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { importLibrary } from '@/lib/backup';
import type { ExportData } from '@/lib/backup';

export async function POST(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const libraryId = authResult;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.endsWith('.json')) {
      return NextResponse.json({ error: 'Only JSON files are supported' }, { status: 400 });
    }

    const text = await file.text();
    let data: ExportData;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON file' }, { status: 400 });
    }

    if (!data.novels || !Array.isArray(data.novels)) {
      return NextResponse.json({ error: 'Invalid backup format' }, { status: 400 });
    }

    const result = importLibrary(libraryId, data);

    return NextResponse.json({
      message: `Successfully imported ${result.imported} novels`,
      ...result,
    });
  } catch (error) {
    console.error('Failed to import library:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
