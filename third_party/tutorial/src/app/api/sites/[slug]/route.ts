import { NextResponse } from 'next/server';
import { getLibraryBySlug, updateLibrary, slugifySite, getLibraryById } from '@/lib/db';
import { isUnlocked, isSiteOpen } from '@/lib/auth';

// GET /api/sites/{slug} — 站点公开信息（站点页门控判断用）
// accessible=false 时前端展示密码门控（隐秘站点未开启）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const site = getLibraryBySlug(slug);
  if (!site) {
    return NextResponse.json({ error: '站点不存在' }, { status: 404 });
  }
  return NextResponse.json({
    slug: site.slug,
    name: site.name,
    type: site.type,
    accessible: isSiteOpen(request, site),
  });
}

// PUT /api/sites/{slug} — 更新站点（需主密码解锁）
// 可改：显示名称、标识（改标识会使旧路径失效）、开启密码；类型不可改
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  const { slug } = await params;
  const site = getLibraryBySlug(slug);
  if (!site) {
    return NextResponse.json({ error: '站点不存在' }, { status: 404 });
  }
  try {
    const body = await request.json();
    if (body.type !== undefined && body.type !== site.type) {
      return NextResponse.json({ error: '站点类型创建后不可修改' }, { status: 400 });
    }
    const updates: { name?: string; slug?: string; password?: string } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: '站点名称不能为空' }, { status: 400 });
      updates.name = name;
    }
    if (body.slug !== undefined) {
      const nextSlug = slugifySite(String(body.slug));
      const conflict = getLibraryBySlug(nextSlug);
      if (conflict && conflict.id !== site.id) {
        return NextResponse.json({ error: `标识「${nextSlug}」已被占用` }, { status: 409 });
      }
      updates.slug = nextSlug;
    }
    if (site.type === 'secret' && body.password !== undefined) {
      const pw = String(body.password);
      if (!pw) return NextResponse.json({ error: '隐秘站点开启密码不能为空' }, { status: 400 });
      updates.password = pw;
    }
    updateLibrary(site.id, updates);
    const fresh = getLibraryById(site.id)!;
    const { password: _pw, ...pub } = fresh;
    return NextResponse.json({ ...pub, hasPassword: !!fresh.password });
  } catch (error) {
    console.error('Failed to update site:', error);
    return NextResponse.json({ error: 'Failed to update site' }, { status: 500 });
  }
}
