import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TUTORIAL = process.env.TUTORIAL_INTERNAL_URL || 'http://127.0.0.1:3001';

// GET /api/novels/sites — 可见小说站点列表（顶栏「小说阅读」面板数据源）
// 转发浏览器的 ns-open cookie，由 tutorial 判定隐秘站点可见性
export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${TUTORIAL}/novels/api/sites`, {
      headers: { Cookie: request.headers.get('cookie') || '' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json([], { status: 200 });
    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
