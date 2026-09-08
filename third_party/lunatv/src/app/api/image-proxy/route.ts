import { NextResponse } from 'next/server';

import { fetchBufferWithDoh } from '@/lib/doh-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 图片代理（服务端不做图片字节缓存）。
 * - 参数：u=base64url(encodeURIComponent(url))（推荐，前端 processImageUrl 生成）；
 *   兼容旧 url= 明文形式。外网明文 HTTP 链路的 URL 过滤会 RST 请求行含
 *   「://被墙主机名」（lain.bgm.tv / api.bgm.tv）的请求，故必须走 u= 编码形式
 * - 豆瓣图床（img*.doubanio.com）：直连快，但对固定 IP 高并发抓图有间歇性反爬
 *   （随机 403）→ 快速重试一次 + 回落 cmliussss 图片 CDN
 * - Bangumi 图床（lain.bgm.tv）：DNS 污染阻断（解析到无关 IP），普通 fetch 永远超时
 *   → 经 DoH 解析真实 IP 后竞速直连；doh-fetch 内置 keep-alive 连接复用、
 *     已知好 IP 记忆与同 host 并发收敛，批量封面只握手一次、后续毫秒级
 * 慢的根因在传输层解决，浏览器端另配半年强缓存头即可。
 */

const FALLBACK_HOST = 'https://img.doubanio.cmliussss.net';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

interface ImagePayload {
  buf: Buffer;
  contentType: string;
}

/** 按上游域分流：bgm 图床走 DoH 直连；豆瓣直连 + 重试 + CDN 回落 */
async function fetchWithFallback(url: string): Promise<ImagePayload> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid image URL');
  }

  // Bangumi 图床（lain.bgm.tv）被 DNS 污染阻断：统一 https 后经 DoH 直连
  if (/(^|\.)bgm\.tv$/.test(parsed.hostname)) {
    const httpsUrl = url.replace(/^http:\/\//i, 'https://');
    const httpsParsed = new URL(httpsUrl);
    const buf = await fetchBufferWithDoh(
      httpsParsed.hostname,
      httpsParsed.pathname + httpsParsed.search,
      { 'User-Agent': UA },
      20000
    );
    return { buf, contentType: 'image/jpeg' };
  }

  // 豆瓣图床：间歇性 403 反爬 → 快速重试一次自身，再回落 cmliussss 图 CDN
  const candidates = [url];
  if (/^img\d*\.doubanio\.com$/.test(parsed.hostname)) {
    candidates.push(url.replace(parsed.origin, FALLBACK_HOST));
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetchImageOnce(candidate);
        if (response.ok) return response;
        errors.push(`${candidate.slice(0, 70)}: HTTP ${response.status}`);
        // 404 是图片本身不存在，重试/换源无意义
        if (response.status === 404) break;
      } catch (error) {
        errors.push(`${candidate.slice(0, 70)}: ${(error as Error).message}`);
      }
      if (attempt === 0) {
        // 随机小退避后重试，错开并发限流
        await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
      }
    }
  }
  throw new Error(`图片获取失败 → ${errors.join('; ')}`);
}

async function fetchImageOnce(url: string): Promise<ImagePayload & { ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Referer: 'https://movie.douban.com/',
        'User-Agent': UA,
      },
    });
    const buf = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok && buf.byteLength > 0,
      status: response.status,
      buf,
      contentType: response.headers.get('content-type') || 'image/jpeg',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // u=base64url(encodeURIComponent(url))：外网明文 HTTP 链路的 URL 过滤会 RST
  // 请求行里含「://被墙主机名」（lain.bgm.tv 等）的请求，编码后不携带明文上游 URL
  const encoded = searchParams.get('u');
  let imageUrl = searchParams.get('url');
  if (encoded) {
    try {
      imageUrl = decodeURIComponent(
        Buffer.from(
          encoded.replace(/-/g, '+').replace(/_/g, '/'),
          'base64'
        ).toString('utf8')
      );
    } catch {
      return NextResponse.json({ error: 'Invalid encoded image URL' }, { status: 400 });
    }
  }

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  try {
    const { buf, contentType } = await fetchWithFallback(imageUrl);

    const headers = new Headers();
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000'); // 浏览器缓存半年
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Error fetching image', details: (error as Error).message },
      { status: 502 }
    );
  }
}
