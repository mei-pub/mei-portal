import { NextResponse } from 'next/server';
import { isUnlocked } from '@/lib/auth';
import { exportZipBuffer, importZipBuffer } from '@/lib/backup-admin';
import { webdavPut, webdavGet, s3Put, s3Get, type WebdavConfig, type S3Config } from '@/lib/remote';

// POST /api/admin/backup/remote — WebDAV / S3 同步（需主密码解锁）
// { direction: 'export' | 'import', target: 'webdav' | 's3', config: {...} }
export async function POST(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { direction, target, config } = body as { direction: 'export' | 'import'; target: 'webdav' | 's3'; config: WebdavConfig & S3Config };
    if (!direction || !target || !config) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    if (direction === 'export') {
      const zip = exportZipBuffer();
      if (target === 'webdav') {
        await webdavPut(config, zip);
      } else {
        await s3Put(config, zip);
      }
      return NextResponse.json({ success: true, message: `已同步到 ${target === 'webdav' ? 'WebDAV' : 'S3'}（${(zip.length / 1024).toFixed(1)} KB）` });
    }

    // import：从远端拉回 zip 并合并导入
    const zip = target === 'webdav' ? await webdavGet(config) : await s3Get(config);
    const result = importZipBuffer(zip);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Remote backup failed:', error);
    return NextResponse.json({ error: (error as Error).message || '同步失败' }, { status: 500 });
  }
}
