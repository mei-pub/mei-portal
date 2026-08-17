import { NextResponse } from 'next/server';
import { getHiddenLibraries, getLibraryById } from './db';

const AUTH_COOKIE = 'auth-token';
const UNLOCK_COOKIE = 'mei-unlock';

/**
 * Master password from env; falls back to MEI_ADMIN_PASSWORD.
 * Empty/undefined = unlock feature disabled.
 */
export function getMasterPassword(): string {
  return process.env.MEI_HIDDEN_LIBRARY_PASSWORD || process.env.MEI_ADMIN_PASSWORD || '';
}

export function isMasterPassword(pw: string | undefined): boolean {
  if (!pw) return false;
  const master = getMasterPassword();
  return !!master && pw === master;
}

/**
 * Parse auth token from cookie: format is {libraryId}:{password}
 */
export function parseAuthToken(request: Request): { libraryId: number; password: string } | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(AUTH_COOKIE + '='));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(AUTH_COOKIE.length + 1));
  const sepIdx = token.indexOf(':');
  if (sepIdx === -1) return null;
  const libraryId = parseInt(token.slice(0, sepIdx));
  const password = token.slice(sepIdx + 1);
  if (isNaN(libraryId)) return null;
  return { libraryId, password };
}

/**
 * Build auth cookie value: {libraryId}:{password}
 */
export function buildAuthToken(libraryId: number, password: string): string {
  return `${libraryId}:${password}`;
}

/**
 * Read the raw unlock cookie value ('' = absent).
 * 新语义：值为当前激活的隐藏书架 id；旧值 '1' 表示未指定（回落第一个隐藏书架）。
 */
function readUnlockValue(request: Request): string {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(UNLOCK_COOKIE + '='));
  return match ? decodeURIComponent(match.slice(UNLOCK_COOKIE.length + 1)) : '';
}

/**
 * 当前激活（已打开）的隐藏书架 id：cookie 值对应书架必须存在且仍处于隐藏状态。
 * 同一时间仅允许一个隐藏书架打开（cookie 只存一个 id）。
 */
export function getActiveHiddenId(request: Request): number | null {
  const value = readUnlockValue(request);
  if (!value) return null;
  const hidden = getHiddenLibraries();
  if (hidden.length === 0) return null;
  if (value === '1') return hidden[0].id; // 旧值兼容
  const id = parseInt(value);
  if (isNaN(id)) return null;
  const lib = getLibraryById(id);
  return lib && lib.hidden ? id : null;
}

/**
 * Whether the request carries the master unlock cookie.
 */
export function isUnlocked(request: Request): boolean {
  return readUnlockValue(request) !== '';
}

/**
 * Verify auth from request cookies against library password.
 * Returns the authenticated libraryId or null.
 * 主密码解锁（mei-unlock cookie 记录激活的隐藏书架 id）可无密码直接进入该隐藏书架。
 */
export function verifyAuth(request: Request): number | null {
  const parsed = parseAuthToken(request);
  if (parsed) {
    const library = getLibraryById(parsed.libraryId);
    if (!library) return null;
    // No password set on library = open access for that library
    if (!library.password) return parsed.libraryId;
    if (parsed.password === library.password) return parsed.libraryId;
  }
  // 主密码解锁：授予当前激活的隐藏书架访问权
  return getActiveHiddenId(request);
}

/**
 * Set the master unlock cookie on a response (7 days).
 * value: 激活的隐藏书架 id；缺省 '1'（回落第一个隐藏书架，兼容旧语义）。
 */
export function applyUnlockCookie(res: NextResponse, libraryId?: number): NextResponse {
  const value = libraryId ? String(libraryId) : '1';
  res.headers.append('Set-Cookie', `${UNLOCK_COOKIE}=${value}; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`);
  return res;
}

/**
 * Clear the master unlock cookie.
 */
export function clearUnlockCookie(res: NextResponse): NextResponse {
  // 同时给 Max-Age=0 与 Expires=epoch，确保各类客户端（含 curl）都删除 cookie
  res.headers.append(
    'Set-Cookie',
    `${UNLOCK_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  );
  return res;
}

/**
 * Create a 401 Unauthorized response.
 */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Check auth and return 401 if unauthorized.
 * Returns the authenticated libraryId, or a 401 NextResponse.
 */
export function requireAuth(request: Request): number | NextResponse {
  const libraryId = verifyAuth(request);
  if (libraryId === null) {
    return unauthorizedResponse();
  }
  return libraryId;
}

/**
 * Build a Set-Cookie header for the auth token (7 days).
 */
export function authCookieHeader(libraryId: number, password: string): string {
  const token = buildAuthToken(libraryId, password);
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`;
}

/**
 * Build a Set-Cookie header that clears the auth token.
 */
export function clearAuthCookieHeader(): string {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}
