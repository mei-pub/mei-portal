export type PansouPage =
  | 'search'
  | 'status'
  | 'docs'
  | 'accounts'
  | 'qqpd'
  | 'gying'
  | 'panlian'
  | 'weibo';

export const DISKS_BASE = '/disks';

const PATH_TO_PAGE: Record<string, PansouPage> = {
  search: 'search',
  settings: 'status',
  status: 'status',
  config: 'status',
  api: 'docs',
  docs: 'docs',
  accounts: 'accounts',
  qqpd: 'qqpd',
  gying: 'gying',
  panlian: 'panlian',
  weibo: 'weibo',
};

const PAGE_TO_PATH: Record<PansouPage, string> = {
  search: 'search',
  status: 'settings',
  docs: 'api',
  accounts: 'accounts',
  qqpd: 'qqpd',
  gying: 'gying',
  panlian: 'panlian',
  weibo: 'weibo',
};

export interface ResolvedPansouRoute {
  page: PansouPage;
  params: URLSearchParams;
}

export function resolveRoute(pathname: string, search = ''): ResolvedPansouRoute {
  const params = new URLSearchParams(search);
  const suffix = pathname
    .replace(new RegExp(`^${DISKS_BASE}/?`), '')
    .replace(/\/+$/, '');
  const page = PATH_TO_PAGE[suffix || 'search'] || 'search';

  if (page === 'search') {
    const legacyView = params.get('view');
    if (legacyView === 'config') return { page: 'status', params };
    if (legacyView === 'api') return { page: 'docs', params };
  }

  return { page, params };
}

export function canonicalPath(page: PansouPage): string {
  return `${DISKS_BASE}/${PAGE_TO_PATH[page]}`;
}

export function pushPage(page: PansouPage, params = new URLSearchParams()) {
  const query = params.toString();
  window.history.pushState(null, '', `${canonicalPath(page)}${query ? `?${query}` : ''}`);
}
