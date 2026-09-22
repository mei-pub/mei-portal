import { NextResponse } from 'next/server';
import { getLibrariesWithPasswords, getLibraryBySlug, createLibrary, deleteLibrary, slugifySite } from '@/lib/db';
import { isUnlocked, isSiteOpen } from '@/lib/auth';

// GET /api/sites — 站点列表
// manage=1（需主密码解锁）：全部站点（含未开启的隐秘站点），供站点管理页使用
// 默认（公开）：普通站点 + 已开启的隐秘站点，供门户顶栏「小说阅读」面板与站点选择页使用
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = getLibrariesWithPasswords();
    if (searchParams.get('manage') === '1') {
      if (!isUnlocked(request)) {
        return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
      }
      return NextResponse.json(all.map(({ password, ...s }) => ({ ...s, hasPassword: !!password })));
    }
    const visible = all
      .filter((s) => s.type !== 'secret' || isSiteOpen(request, s))
      .map((s) => ({ slug: s.slug, name: s.name, type: s.type, icon: s.icon, iconColor: s.icon_color, description: s.description }));
    return NextResponse.json(visible);
  } catch (error) {
    console.error('Failed to fetch sites:', error);
    return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 });
  }
}

// POST /api/sites — 创建站点（需主密码解锁）
// 类型创建时指定、不可修改：普通站点不允许密码；隐秘站点必须设置开启密码
export async function POST(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = String(body?.name || '').trim();
    const type = body?.type === 'secret' ? 'secret' : 'normal';
    const password = String(body?.password || '');
    const slugInput = String(body?.slug || '').trim();

    if (!name) {
      return NextResponse.json({ error: '站点名称不能为空' }, { status: 400 });
    }
    if (type === 'secret' && !password) {
      return NextResponse.json({ error: '隐秘站点必须设置开启密码' }, { status: 400 });
    }
    const slug = slugifySite(slugInput || name);
    if (getLibraryBySlug(slug)) {
      return NextResponse.json({ error: `标识「${slug}」已被占用` }, { status: 409 });
    }
    const site = createLibrary({
      name, slug, type,
      password: type === 'secret' ? password : '',
      icon: String(body?.icon || ''),
      iconColor: String(body?.iconColor || ''),
      description: String(body?.description || ''),
    });
    const { password: _pw, ...pub } = site;
    return NextResponse.json({ ...pub, hasPassword: !!site.password }, { status: 201 });
  } catch (error) {
    console.error('Failed to create site:', error);
    return NextResponse.json({ error: 'Failed to create site' }, { status: 500 });
  }
}

// DELETE /api/sites?slug=xxx — 删除站点（需主密码解锁）
export async function DELETE(request: Request) {
  if (!isUnlocked(request)) {
    return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug') || '';
    const site = getLibraryBySlug(slug);
    if (!site) {
      return NextResponse.json({ error: '站点不存在' }, { status: 404 });
    }
    const all = getLibrariesWithPasswords();
    if (all.length <= 1) {
      return NextResponse.json({ error: '至少保留一个站点' }, { status: 400 });
    }
    const ok = deleteLibrary(site.id);
    if (!ok) {
      return NextResponse.json({ error: '删除失败' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete site:', error);
    return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 });
  }
}
