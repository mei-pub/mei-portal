import { NextResponse } from 'next/server';
import { getLibraryBySlug } from '@/lib/db';
import { parseOpenCookie, buildOpenCookieValue } from '@/lib/auth';

// POST /api/gate — 隐秘站点开启/关闭
// { action: 'open' | 'close', slug, password }
// open：校验开启密码，写入 ns-open cookie → 站点在「小说阅读」面板可见且路径可访问
// close：移除 ns-open 记录 → 站点在面板不可见且路径不可访问
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body?.action;
    const slug = String(body?.slug || '').trim();
    const password = String(body?.password || '');

    if (action !== 'open' && action !== 'close') {
      return NextResponse.json({ error: 'action 必须是 open 或 close' }, { status: 400 });
    }
    const site = getLibraryBySlug(slug);
    if (!site) {
      return NextResponse.json({ error: '站点不存在' }, { status: 404 });
    }
    if (site.type !== 'secret') {
      return NextResponse.json({ error: '普通站点无需开启/关闭' }, { status: 400 });
    }
    if (password !== site.password) {
      return NextResponse.json({ error: '开启密码错误' }, { status: 401 });
    }

    const open = parseOpenCookie(request);
    if (action === 'open') {
      open[site.slug] = site.password;
    } else {
      delete open[site.slug];
    }
    const res = NextResponse.json({ success: true, action, slug: site.slug, name: site.name });
    res.headers.append('Set-Cookie', buildOpenCookieValue(open));
    return res;
  } catch (error) {
    console.error('Gate failed:', error);
    return NextResponse.json({ error: '操作失败' }, { status: 500 });
  }
}
