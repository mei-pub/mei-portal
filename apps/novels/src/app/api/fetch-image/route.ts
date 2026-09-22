import { NextResponse } from 'next/server';
import { promises as dns } from 'dns';
import { requireSiteAccess } from "@/lib/auth";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/** 判断 IP 是否为私网/保留地址（防 SSRF） */
function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true;
  // IPv4（含 IPv4-mapped IPv6）
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6：唯一本地 fc00::/7、link-local fe80::/10、保留段一律拒绝
  const lower = ip.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  return false;
}

/** 校验目标地址：仅 http/https，且解析出的所有 IP 都不得是私网/保留地址 */
async function assertSafeRemote(rawUrl: string): Promise<URL> {
  const parsedUrl = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http/https URLs allowed');
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // 无点 hostname（localhost、内网主机名等）与 IP 字面量直接判
  if (!hostname.includes('.') && !hostname.includes(':')) throw new Error('Private host not allowed');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Private host not allowed');
  }
  const targets = [hostname];
  // IP 字面量不再做 DNS 解析
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && !hostname.includes(':')) {
    try {
      const addrs = await dns.lookup(hostname, { all: true });
      targets.push(...addrs.map((a) => a.address));
    } catch {
      throw new Error('Cannot resolve host');
    }
  }
  if (targets.some((t) => isPrivateIp(t))) {
    throw new Error('Private host not allowed');
  }
  return parsedUrl;
}

// GET /api/fetch-image?url=xxx - 服务端代理下载图片，返回 base64
export async function GET(request: Request) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    // Validate URL（含 SSRF 防护：拒绝私网/保留地址）
    try {
      await assertSafeRemote(imageUrl);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid URL' }, { status: 400 });
    }

    // Fetch the image server-side (bypasses CORS)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NovelBot/1.0)',
        'Accept': 'image/*,*/*',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get('content-type') || '';

    // 先看 Content-Length，超限直接拒绝，不下载 body（N5）
    const declaredLength = Number(res.headers.get('content-length') || '0');
    if (declaredLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 413 });
    }

    // 流式读取，边读边限长：即使上游虚报/缺失 Content-Length 也不会把超大文件读进内存
    const reader = res.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: 'Empty response body' }, { status: 502 });
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 413 });
      }
      chunks.push(value);
    }

    // Determine MIME type
    const mime = contentType.split(';')[0] || 'image/png';
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Not an image' }, { status: 400 });
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    return NextResponse.json({ dataUrl });
  } catch (error) {
    console.error('Failed to fetch image:', error);
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}
