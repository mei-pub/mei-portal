import { NextResponse } from 'next/server';
import { getLibraryById, updateLibrary, setLibraryHidden } from '@/lib/db';
import { requireAuth, isUnlocked, authCookieHeader } from '@/lib/auth';

// PUT /api/libraries/update — 修改书架信息（名称 / 访问密码 / 隐藏状态）
// - 需已登录（任意书架会话即可）
// - 修改隐藏状态（公开⇄隐藏）需主密码解锁（与 visibility API 一致）
// - 修改当前会话所在书架的密码后，刷新 auth cookie 保持登录态
export async function PUT(request: Request) {
  const authResult = requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const currentLibraryId = authResult;
  try {
    const body = await request.json();
    const id = parseInt(body?.id);
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Library ID is required' }, { status: 400 });
    }
    const library = getLibraryById(id);
    if (!library) {
      return NextResponse.json({ error: 'Library not found' }, { status: 404 });
    }

    // 先校验，避免部分应用（隐藏状态未解锁时整体拒绝）
    const hiddenProvided = body.hidden !== undefined;
    const wantHidden = !!body.hidden;
    const hiddenChanged = hiddenProvided && wantHidden !== !!library.hidden;
    if (hiddenChanged && !isUnlocked(request)) {
      return NextResponse.json({ error: 'Master unlock required' }, { status: 403 });
    }

    const updates: { name?: string; password?: string } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json({ error: '书架名称不能为空' }, { status: 400 });
      }
      updates.name = name;
    }

    let passwordChanged = false;
    let newPassword = '';
    if (body.clearPassword === true) {
      updates.password = '';
      passwordChanged = true;
    } else if (typeof body.password === 'string' && body.password) {
      updates.password = body.password;
      passwordChanged = true;
      newPassword = body.password;
    }

    if (Object.keys(updates).length > 0) {
      updateLibrary(id, updates);
    }
    if (hiddenChanged) {
      setLibraryHidden(id, wantHidden);
    }

    const updated = getLibraryById(id)!;
    const res = NextResponse.json({
      success: true,
      library: {
        id: updated.id,
        name: updated.name,
        hidden: !!updated.hidden,
        hasPassword: !!updated.password,
      },
    });
    if (passwordChanged && id === currentLibraryId) {
      res.headers.append('Set-Cookie', authCookieHeader(id, newPassword));
    }
    return res;
  } catch (error) {
    console.error('Failed to update library:', error);
    return NextResponse.json({ error: 'Failed to update library' }, { status: 500 });
  }
}
