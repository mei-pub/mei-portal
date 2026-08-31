import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { restoreBackupZip } from '@/lib/data-backup';

export const dynamic = 'force-dynamic';

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
    const buf = Buffer.from(await file.arrayBuffer());
    const mode = modeRaw === 'merge' ? 'merge' : 'replace';
    const result = restoreBackupZip(buf, mode);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Backup import failed:', error);
    return NextResponse.json({ ok: false, error: (error as Error).message || '备份导入失败' }, { status: 500 });
  }
}
