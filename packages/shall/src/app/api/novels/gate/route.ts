import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TUTORIAL = process.env.TUTORIAL_INTERNAL_URL || 'http://127.0.0.1:3001';

// POST /api/novels/gate — 隐秘站点开启/关闭（首页搜索框 open:/close: 命令）
// 代理到 tutorial /novels/api/gate，并透传 ns-open cookie 回浏览器
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  try {
    const res = await fetch(`${TUTORIAL}/novels/api/gate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    const out = NextResponse.json(data, { status: res.status });
    // 透传 Set-Cookie（ns-open 更新）
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const c of setCookies) {
      out.headers.append('Set-Cookie', c);
    }
    return out;
  } catch {
    return NextResponse.json({ error: '小说服务暂不可用' }, { status: 502 });
  }
}
