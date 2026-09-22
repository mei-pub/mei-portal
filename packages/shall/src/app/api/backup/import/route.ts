import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { restoreBackupZip } from '@/lib/data-backup';

export const dynamic = 'force-dynamic';

/** 备份包大小上限：备份只含配置/列表类 JSON，10MB 已远超正常规模，防止恶意大包打爆内存 */
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const modeRaw = String(formData.get('mode') || 'replace');
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: '请选择备份文件' }, { status: 400 });
    }
    if (file.size > MAX_BACKUP_BYTES) {
      return NextResponse.json(
        { ok: false, error: `备份文件过大（上限 ${MAX_BACKUP_BYTES / 1024 / 1024}MB）` },
        { status: 413 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mode = modeRaw === 'merge' ? 'merge' : 'replace';
    const result = restoreBackupZip(buf, mode);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Backup import failed:', error);
    return NextResponse.json({ ok: false, error: (error as Error).message || '备份导入失败' }, { status: 500 });
  }
}
