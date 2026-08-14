import { getLibraryById, getHiddenLibraries } from './db';
import { NextResponse } from 'next/server';

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
function parseAuthToken(request: Request): { libraryId: number; password: string } | null {
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
 * Verify auth from request cookies against library password.
 * Returns the authenticated libraryId or null.
 * 主密码解锁（mei-unlock cookie）可无密码直接进入隐藏书架。
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
  // 主密码解锁：对隐藏书架授予主权限
  if (isUnlocked(request)) {
    const hidden = getHiddenLibraries();
    if (hidden.length > 0) return hidden[0].id;
  }
  return null;
}

/**
 * Whether the request carries the master unlock cookie.
 */
export function isUnlocked(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie') || '';
  return cookieHeader
    .split(';')
    .map(s => s.trim())
    .some(s => s.startsWith(UNLOCK_COOKIE + '=') && s.slice(UNLOCK_COOKIE.length + 1) === '1');
}

/**
 * Set the master unlock cookie on a response (7 days).
 */
export function applyUnlockCookie(res: NextResponse): NextResponse {
  res.headers.append('Set-Cookie', `${UNLOCK_COOKIE}=1; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`);
  return res;
}

/**
 * Clear the master unlock cookie.
 */
export function clearUnlockCookie(res: NextResponse): NextResponse {
  res.headers.append('Set-Cookie', `${UNLOCK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
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
