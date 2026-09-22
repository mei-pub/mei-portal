import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { getPanelConfig, normalizeConfig, savePanelConfig } from '@/lib/panel-store';
import {
  buildS3Request,
  buildWebdavRequest,
  validateRemoteBackupConfig,
  type RemoteBackupTarget,
} from '@/lib/remote-backup';

export const dynamic = 'force-dynamic';

// 云端备份是同步交互（设置页等待响应），上游不可达时必须有超时兜底，
// 否则 WebDAV/S3 服务挂起会让该请求（及页面按钮）永久停留
const REMOTE_TIMEOUT_MS = 30 * 1000;

export async function POST(request: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }

  let body: {
    direction?: 'export' | 'import';
    target?: RemoteBackupTarget;
    config?: Record<string, unknown>;
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
  const invalid = validateRemoteBackupConfig(body.target, body.config as never);
  if (invalid) return NextResponse.json({ ok: false, error: invalid.message, field: invalid.field }, { status: 400 });

  try {
    const config = body.target === 'webdav'
      ? buildWebdavRequest(body.config as never, body.direction === 'export' ? 'PUT' : 'GET', Buffer.from(JSON.stringify(getPanelConfig())))
      : buildS3Request(body.config as never, body.direction === 'export' ? 'PUT' : 'GET', Buffer.from(JSON.stringify(getPanelConfig())));
    const res = await fetch(config.url, {
      method: body.direction === 'export' ? 'PUT' : 'GET',
      headers: config.headers,
      body: config.body,
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`远端请求失败：HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
    }

    if (body.direction === 'export') {
      return NextResponse.json({ ok: true, message: '已备份到云端' });
    }

    const raw = Buffer.from(await res.arrayBuffer()).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('云端备份文件不是有效的 JSON 配置');
    }
    const next = normalizeConfig(parsed);
    savePanelConfig(next);
    return NextResponse.json({ ok: true, message: '已从云端恢复', config: next });
  } catch (error) {
    console.error('Remote panel backup failed:', error);
    return NextResponse.json({ ok: false, error: (error as Error).message || '云端备份失败' }, { status: 500 });
  }
}
