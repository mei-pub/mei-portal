import { NextResponse } from 'next/server';
import { updateLibrary, getLibraryById } from '@/lib/db';
import { requireSiteAccess } from '@/lib/auth';

// GET /api/settings?site={slug} — 站点信息（需站点可访问）
export async function GET(request: Request) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get('site'));
  if (siteResult instanceof NextResponse) return siteResult;
  const site = siteResult;
  return NextResponse.json({
    slug: site.slug,
    name: site.name,
    type: site.type,
    hasPassword: !!site.password,
  });
}

// PUT /api/settings?site={slug} — 更新站点（需站点可访问）
// 可改显示名称；隐秘站点可改开启密码；类型不可改
export async function PUT(request: Request) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get('site'));
  if (siteResult instanceof NextResponse) return siteResult;
  const site = siteResult;
  try {
    const body = await request.json();
    const updates: { name?: string; password?: string } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: '站点名称不能为空' }, { status: 400 });
      updates.name = name;
    }
    if (body.password !== undefined) {
      if (site.type !== 'secret') {
        return NextResponse.json({ error: '普通站点没有密码' }, { status: 400 });
      }
      const pw = String(body.password);
      if (!pw) return NextResponse.json({ error: '开启密码不能为空' }, { status: 400 });
      updates.password = pw;
    }
    const ok = updateLibrary(site.id, updates);
    if (!ok) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const fresh = getLibraryById(site.id)!;
    return NextResponse.json({ slug: fresh.slug, name: fresh.name, type: fresh.type, hasPassword: !!fresh.password });
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
