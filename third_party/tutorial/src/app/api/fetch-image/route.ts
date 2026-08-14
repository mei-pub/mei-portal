import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// GET /api/fetch-image?url=xxx - 服务端代理下载图片，返回 base64
export async function GET(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Only http/https URLs allowed' }, { status: 400 });
    }

    // Fetch the image server-side (bypasses CORS)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(imageUrl, {
      signal: controller.signal,
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
    const bytes = await res.arrayBuffer();

    // Limit to 5MB
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 413 });
    }

    // Determine MIME type
    const mime = contentType.split(';')[0] || 'image/png';
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Not an image' }, { status: 400 });
    }

    const base64 = Buffer.from(bytes).toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    return NextResponse.json({ dataUrl });
  } catch (error) {
    console.error('Failed to fetch image:', error);
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}
