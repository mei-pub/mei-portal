// 远端同步：WebDAV（Basic Auth PUT/GET）与 S3 兼容对象存储（SigV4 签名 PUT/GET）
import crypto from 'node:crypto';

export interface WebdavConfig {
  url: string; // 完整文件地址，如 https://dav.example.com/backups/novels.zip
  username?: string;
  password?: string;
}

export interface S3Config {
  endpoint: string; // 如 https://s3.us-east-1.amazonaws.com 或 MinIO 地址
  region?: string;
  bucket: string;
  key: string; // 对象路径，如 backups/novels.zip
  accessKey: string;
  secretKey: string;
}

function webdavAuth(cfg: WebdavConfig): Record<string, string> {
  if (!cfg.username) return {};
  return { Authorization: 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password || ''}`).toString('base64') };
}

export async function webdavPut(cfg: WebdavConfig, data: Buffer): Promise<void> {
  const res = await fetch(cfg.url, { method: 'PUT', headers: { ...webdavAuth(cfg), 'Content-Type': 'application/zip' }, body: data as unknown as BodyInit });
  if (!res.ok) throw new Error(`WebDAV 上传失败: ${res.status}`);
}

export async function webdavGet(cfg: WebdavConfig): Promise<Buffer> {
  const res = await fetch(cfg.url, { headers: webdavAuth(cfg) });
  if (!res.ok) throw new Error(`WebDAV 下载失败: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── S3 SigV4（path-style，兼容 MinIO 等 S3 兼容存储）──

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function s3SignedRequest(cfg: S3Config, method: 'PUT' | 'GET', payload: Buffer | null): { url: string; headers: Record<string, string>; body?: BodyInit } {
  const region = cfg.region || 'us-east-1';
  const endpoint = cfg.endpoint.replace(/\/+$/, '');
  const host = new URL(endpoint).host;
  const uri = `/${cfg.bucket}/${cfg.key.split('/').map(encodeURIComponent).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload || '');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-type'] = 'application/zip';

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const out: Record<string, string> = { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
  delete out.host;
  return { url: `${endpoint}${uri}`, headers: out, body: payload ? (new Uint8Array(payload) as unknown as BodyInit) : undefined };
}

export async function s3Put(cfg: S3Config, data: Buffer): Promise<void> {
  const req = s3SignedRequest(cfg, 'PUT', data);
  const res = await fetch(req.url, { method: 'PUT', headers: req.headers, body: req.body });
  if (!res.ok) throw new Error(`S3 上传失败: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
}

export async function s3Get(cfg: S3Config): Promise<Buffer> {
  const req = s3SignedRequest(cfg, 'GET', null);
  const res = await fetch(req.url, { headers: req.headers });
  if (!res.ok) throw new Error(`S3 下载失败: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
