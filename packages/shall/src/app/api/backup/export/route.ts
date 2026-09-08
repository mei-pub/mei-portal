import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { BACKUP_SCOPES, type BackupScope } from '@/lib/backup-scopes';
import { buildBackupZip, type BrowserData } from '@/lib/data-backup';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  let body: { scopes?: unknown; browserData?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }
  const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter((s): s is BackupScope =>
    BACKUP_SCOPES.includes(s as BackupScope),
  );
  if (scopes.length === 0) {
    return NextResponse.json({ ok: false, error: '请至少选择一个备份范围' }, { status: 400 });
  }
  const browserData: BrowserData =
    body.browserData && typeof body.browserData === 'object' ? (body.browserData as BrowserData) : {};
  try {
    const buf = buildBackupZip({ scopes, browserData });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="mei-portal-backup-${date}.zip"`,
      },
    });
  } catch (error) {
    console.error('Backup export failed:', error);
    return NextResponse.json({ ok: false, error: '备份导出失败' }, { status: 500 });
  }
}
