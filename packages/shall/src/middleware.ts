// Strips trailing slashes from app resource paths to prevent Next.js 308 redirects.
// nginx sends document requests for /music/, /tv/, etc. to the Shell via 418.
// Without this middleware, Next.js would 308-redirect /music/ -> /music,
// causing an unnecessary extra round trip. We rewrite internally instead.
import { NextRequest, NextResponse } from 'next/server';

const APP_PREFIXES = [
  '/tv', '/music', '/downloads', '/disks', '/draw', '/tools', '/link', '/novels',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only strip trailing slash for known app prefixes (root or deeper paths)
  // e.g. /music/ -> /music, /music/search/ -> /music/search
  // But NOT / (root) or /api/ (API routes)
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const stripped = pathname.replace(/\/+$/, '');
    const isAppPath = APP_PREFIXES.some(
      (prefix) => stripped === prefix || stripped.startsWith(prefix + '/')
    );
    if (isAppPath) {
      const url = req.nextUrl.clone();
      url.pathname = stripped;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except API routes, _next/static, _next/image, favicon
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
