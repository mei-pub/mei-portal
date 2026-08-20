import { NextResponse } from 'next/server';
import { getLibraryBySlug, type Library } from './db';

// ─────────────────────────────────────────────
// 小说站点访问模型（2026-08 重构）
// - 普通站点（normal）：完全公开，无需任何凭证
// - 隐秘站点（secret）：需「开启」——ns-open cookie 记录 {slug: 开启密码}
//   开启入口：门户首页搜索框 open:{标识}:{密码} / close:{标识}:{密码}，
//   或站点页内的密码门控（均走 /novels/api/gate）
// - 站点管理（manage）：主密码解锁（mei-unlock cookie），与内容访问独立
// ─────────────────────────────────────────────

const OPEN_COOKIE = 'ns-open';
const UNLOCK_COOKIE = 'mei-unlock';

/** 解析 ns-open cookie：{ [slug]: password } */
export function parseOpenCookie(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(OPEN_COOKIE + '='));
  if (!match) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(match.slice(OPEN_COOKIE.length + 1)));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function buildOpenCookieValue(open: Record<string, string>): string {
  return `${OPEN_COOKIE}=${encodeURIComponent(JSON.stringify(open))}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`;
}

/** 站点是否已开启（普通站点恒 true；隐秘站点看 ns-open 里的密码是否匹配） */
export function isSiteOpen(request: Request, site: Library): boolean {
  if (site.type !== 'secret') return true;
  const open = parseOpenCookie(request);
  return open[site.slug] !== undefined && open[site.slug] === site.password;
}

/**
 * 解析并校验站点访问：返回 Library，或 404（不存在）/403（未开启）响应。
 * 内容类 API 统一走这里（?site={slug} 参数）。
 */
export function requireSiteAccess(request: Request, slug: string | null): Library | NextResponse {
  if (!slug) {
    return NextResponse.json({ error: '缺少 site 参数' }, { status: 400 });
  }
  const site = getLibraryBySlug(slug);
  if (!site) {
    return NextResponse.json({ error: '站点不存在' }, { status: 404 });
  }
  if (!isSiteOpen(request, site)) {
    return NextResponse.json({ error: '站点未开启' }, { status: 403 });
  }
  return site;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// ── 主密码（站点管理解锁，独立于内容访问） ──

export function getMasterPassword(): string {
  return process.env.MEI_HIDDEN_LIBRARY_PASSWORD || process.env.MEI_ADMIN_PASSWORD || '';
}

export function isMasterPassword(pw: string | undefined): boolean {
  if (!pw) return false;
  const master = getMasterPassword();
  return !!master && pw === master;
}

export function isUnlocked(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(UNLOCK_COOKIE + '='));
  return match ? decodeURIComponent(match.slice(UNLOCK_COOKIE.length + 1)) !== '' : false;
}

export function applyUnlockOnlyCookie(res: NextResponse): NextResponse {
  res.headers.append('Set-Cookie', `${UNLOCK_COOKIE}=1; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`);
  return res;
}

export function clearUnlockCookie(res: NextResponse): NextResponse {
  res.headers.append(
    'Set-Cookie',
    `${UNLOCK_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  );
  return res;
}
