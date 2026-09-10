import { NextResponse } from 'next/server';
import { isUnlocked } from '@/lib/auth';
import { exportSqliteBuffer, exportZipBuffer, importSqliteBuffer, importZipBuffer } from '@/lib/backup-admin';

// GET /api/admin/backup?format=zip|sqlite — 全量导出（需主密码解锁）
export async function GET(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  const format = new URL(request.url).searchParams.get('format') || 'zip';
  try {
    if (format === 'sqlite') {
      const buf = exportSqliteBuffer();
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/x-sqlite3',
          'Content-Disposition': `attachment; filename="novels-backup-${Date.now()}.db"`,
        },
      });
    }
    const buf = exportZipBuffer();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="novels-backup-${Date.now()}.zip"`,
      },
    });
  } catch (error) {
    console.error('Backup export failed:', error);
    return NextResponse.json({ error: '导出失败' }, { status: 500 });
  }
}

// POST /api/admin/backup — 导入 zip / SQLite 文件（multipart，需主密码解锁；合并模式，幂等去重）
export async function POST(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: '未选择文件' }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const isZip = /\.zip$/i.test(file.name) || (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b);
    const result = isZip ? importZipBuffer(buf) : importSqliteBuffer(buf);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Backup import failed:', error);
    return NextResponse.json({ error: `导入失败: ${(error as Error).message}` }, { status: 500 });
  }
}
