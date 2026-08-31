import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { BACKUP_SCOPES, type BackupMode, type BackupScope } from '@/lib/backup-scopes';
import { buildBackupZip, restoreBackupZip, type BrowserData } from '@/lib/data-backup';
import {
  buildS3Request,
  buildWebdavRequest,
  validateRemoteBackupConfig,
  type RemoteBackupTarget,
  type S3BackupConfig,
  type WebdavBackupConfig,
} from '@/lib/remote-backup';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  let body: {
    direction?: 'export' | 'import';
    target?: RemoteBackupTarget;
    config?: Record<string, unknown>;
    scopes?: unknown;
    browserData?: unknown;
    mode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }
  if (body.direction !== 'export' && body.direction !== 'import') {
    return NextResponse.json({ ok: false, error: 'direction 必须是 export 或 import' }, { status: 400 });
  }
  if (body.target !== 'webdav' && body.target !== 's3') {
    return NextResponse.json({ ok: false, error: 'target 必须是 webdav 或 s3' }, { status: 400 });
  }
  const invalid = validateRemoteBackupConfig(body.target, body.config);
  if (invalid) {
    return NextResponse.json({ ok: false, error: invalid.message, field: invalid.field }, { status: 400 });
  }
  const mode: BackupMode = body.mode === 'merge' ? 'merge' : 'replace';

  try {
    if (body.direction === 'export') {
      const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter((s): s is BackupScope =>
        BACKUP_SCOPES.includes(s as BackupScope),
      );
      if (scopes.length === 0) {
        return NextResponse.json({ ok: false, error: '请至少选择一个备份范围' }, { status: 400 });
      }
      const browserData: BrowserData =
        body.browserData && typeof body.browserData === 'object' ? (body.browserData as BrowserData) : {};
      const zip = buildBackupZip({ scopes, browserData });
      const req =
        body.target === 'webdav'
          ? buildWebdavRequest(body.config as unknown as WebdavBackupConfig, 'PUT', zip, 'application/zip')
          : buildS3Request(body.config as unknown as S3BackupConfig, 'PUT', zip, 'application/zip');
      const res = await fetch(req.url, { method: 'PUT', headers: req.headers, body: req.body });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`远端请求失败：HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
      }
      return NextResponse.json({ ok: true, message: `已备份到 ${body.target === 'webdav' ? 'WebDAV' : 'S3'}（${(zip.length / 1024).toFixed(1)} KB）` });
    }

    const req =
      body.target === 'webdav'
        ? buildWebdavRequest(body.config as unknown as WebdavBackupConfig, 'GET', Buffer.alloc(0))
        : buildS3Request(body.config as unknown as S3BackupConfig, 'GET', Buffer.alloc(0));
    const res = await fetch(req.url, { method: 'GET', headers: req.headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`远端请求失败：HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
    }
    const raw = Buffer.from(await res.arrayBuffer());
    const result = restoreBackupZip(raw, mode);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Remote backup failed:', error);
    return NextResponse.json({ ok: false, error: (error as Error).message || '云端备份失败' }, { status: 500 });
  }
}
