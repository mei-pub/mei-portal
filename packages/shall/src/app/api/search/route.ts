import { NextRequest, NextResponse } from 'next/server';

import { initUserIfNeeded, isLoggedIn, getSessionTokens, getPortalToken } from '@/lib/auth';
import { _bindGetSessionTokens, _bindGetPortalToken, parseDiskType, parseDiskSourceFilters, parseSearchQuery, searchServerGroups } from '@/lib/unified-search';

// Bind the real token getter and portal-token getter (API route runs in Next.js)
_bindGetSessionTokens(getSessionTokens);
_bindGetPortalToken(getPortalToken);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  initUserIfNeeded();
  if (!isLoggedIn()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = parseSearchQuery(new URL(request.url).searchParams);
  if (!parsed.query) {
    return NextResponse.json({ error: 'q is required' }, { status: 400 });
  }

  const groups = await searchServerGroups({
    query: parsed.query,
    scope: parsed.scope,
    limit: parsed.limit,
    offset: parsed.offset,
    diskType: parseDiskType(new URL(request.url).searchParams.get('diskType')),
    diskSources: parseDiskSourceFilters(new URL(request.url).searchParams),
    cookie: request.headers.get('cookie') || '',
  });

  return NextResponse.json(
    { query: parsed.query, scope: parsed.scope, groups },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
