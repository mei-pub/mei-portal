// 主页配置的 WebDAV / S3 远端备份。
// 这里只保留纯校验与签名/请求构造，网络 IO 由 API route 注入 fetch，方便测试。
import crypto from 'node:crypto';

export type RemoteBackupTarget = 'webdav' | 's3';

export interface WebdavBackupConfig {
  url: string;
  username?: string;
  password?: string;
}

export interface S3BackupConfig {
  endpoint: string;
  region?: string;
  bucket: string;
  key: string;
  accessKey: string;
  secretKey: string;
}

export interface RemoteValidationError {
  field: string;
  message: string;
}

export function validateRemoteBackupConfig(
  target: RemoteBackupTarget,
  config: Partial<WebdavBackupConfig & S3BackupConfig> | undefined,
): RemoteValidationError | undefined {
  if (target !== 'webdav' && target !== 's3') {
    return { field: 'target', message: '备份目标必须是 WebDAV 或 S3' };
  }
  if (!config || typeof config !== 'object') return { field: 'target', message: '备份配置不完整' };

  if (target === 'webdav') {
    let url: URL;
    try {
      url = new URL(config.url || '');
    } catch {
      return { field: 'url', message: '请输入完整的 WebDAV 文件地址' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { field: 'url', message: 'WebDAV 地址必须使用 http/https' };
    }
    return undefined;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint || '');
  } catch {
    return { field: 'endpoint', message: '请输入完整的 S3 Endpoint' };
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    return { field: 'endpoint', message: 'S3 Endpoint 必须使用 http/https' };
  }
  if (!config.bucket?.trim()) return { field: 'bucket', message: '请输入 Bucket' };
  if (!config.key?.trim()) return { field: 'key', message: '请输入对象路径' };
  if (!config.accessKey?.trim()) return { field: 'accessKey', message: '请输入 Access Key' };
  if (!config.secretKey?.trim()) return { field: 'secretKey', message: '请输入 Secret Key' };
  return undefined;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function buildWebdavRequest(
  cfg: WebdavBackupConfig,
  method: 'GET' | 'PUT',
  payload: Buffer,
  contentType = 'application/json',
): { url: string; headers: Record<string, string>; body?: BodyInit } {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (cfg.username) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password || ''}`).toString('base64')}`;
  }
  return {
    url: cfg.url,
    headers,
    body: method === 'PUT' ? new Uint8Array(payload) : undefined,
  };
}

export function buildS3Request(
  cfg: S3BackupConfig,
  method: 'GET' | 'PUT',
  payload: Buffer,
  contentType = 'application/json',
): { url: string; headers: Record<string, string>; body?: BodyInit } {
  const region = cfg.region?.trim() || 'us-east-1';
  const endpoint = cfg.endpoint.replace(/\/+$/, '');
  const host = new URL(endpoint).host;
  const uri = `/${cfg.bucket}/${cfg.key.split('/').map(encodeURIComponent).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(method === 'PUT' ? payload : '');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-type'] = contentType;

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

  const outHeaders = { ...headers };
  delete outHeaders.host;
  outHeaders.Authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${endpoint}${uri}`,
    headers: outHeaders,
    body: method === 'PUT' ? new Uint8Array(payload) : undefined,
  };
}
