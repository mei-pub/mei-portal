// Canonical top-level app routes. The browser URL and the iframe URL use the
// same resource path; only the iframe adds meiEmbed=1.

export interface HostPluginRef {
  id: string;
  url: string;
}

export interface ParsedAppRoute {
  appId: string;
  path: string;
}

const FALLBACK_PLUGINS: HostPluginRef[] = [
  { id: 'lunatv', url: '/tv' },
  { id: 'solara', url: '/music' },
  { id: 'mediago', url: '/media' },
  { id: 'pansou', url: '/disks' },
  { id: 'ai-draw', url: '/draw' },
  { id: 'omni-tools', url: '/tools' },
  { id: 'mei-link', url: '/link' },
  { id: 'tutorial', url: '/novels' },
];

function normalizePrefix(prefix: string): string {
  return prefix.length > 1 ? prefix.replace(/\/+$/, '') || '/' : prefix;
}

function splitHref(href: string): { pathname: string; search: string; hash: string } {
  try {
    const url = new URL(href, 'http://mei.local');
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  } catch {
    const [beforeHash = '', hash = ''] = href.split('#');
    const [pathname = '', search = ''] = beforeHash.split('?');
    return { pathname, search: search ? `?${search}` : '', hash: hash ? `#${hash}` : '' };
  }
}

function internalPlugins(plugins?: HostPluginRef[]): HostPluginRef[] {
  return plugins?.length ? plugins : FALLBACK_PLUGINS;
}

function matchPlugin(
  pathname: string,
  plugins?: HostPluginRef[]
): HostPluginRef | null {
  return (
    internalPlugins(plugins).find((plugin) => {
      if (!plugin.url || /^https?:\/\//i.test(plugin.url)) return false;
      const prefix = normalizePrefix(plugin.url);
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }) || null
  );
}

export function isAppPath(path: string, plugins?: HostPluginRef[]): boolean {
  return matchPlugin(splitHref(path).pathname, plugins) !== null;
}

export function parseAppRoute(
  path: string,
  plugins?: HostPluginRef[]
): ParsedAppRoute | null {
  const { pathname, search, hash } = splitHref(path);
  const plugin = matchPlugin(pathname, plugins);
  if (!plugin) return null;
  return { appId: plugin.id, path: `${pathname}${search}${hash}` };
}

export function normalizeAppPath(path: string, plugins?: HostPluginRef[]): string {
  const { pathname, search, hash } = splitHref(path);
  const plugin = matchPlugin(pathname, plugins);
  if (!plugin) return path;
  const prefix = normalizePrefix(plugin.url);
  const normalized = pathname === `${prefix}/` ? prefix : pathname;
  return `${normalized}${search}${hash}`;
}

export function buildAppHref(
  path: string,
  plugins?: HostPluginRef[]
): string | null {
  if (!path || /^https?:\/\//i.test(path)) return null;
  const parsed = parseAppRoute(path, plugins);
  return parsed ? normalizeAppPath(path, plugins) : null;
}

export function legacyAppHostPath(
  href: string,
  plugins?: HostPluginRef[]
): string | null {
  const { pathname, search } = splitHref(href);
  if (pathname !== '/app') return null;
  const params = new URLSearchParams(search);
  const appId = params.get('app') || '';
  const innerPath = params.get('path') || '';
  if (!appId || !innerPath) return null;
  const known = internalPlugins(plugins).some((plugin) => plugin.id === appId);
  if (!known) return null;
  const parsed = parseAppRoute(innerPath, plugins);
  return parsed ? normalizeAppPath(innerPath, plugins) : null;
}

export function appendEmbedParam(path: string): string {
  const { pathname, search, hash } = splitHref(path);
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  params.set('meiEmbed', '1');
  return `${pathname}?${params.toString()}${hash}`;
}

export function sameAppPath(a: string, b: string): boolean {
  const left = splitHref(a);
  const right = splitHref(b);
  const normalizePath = (pathname: string) =>
    pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const normalizeQuery = (search: string) => {
    const params = new URLSearchParams(search.replace(/^\?/, ''));
    params.delete('meiEmbed');
    params.sort();
    return params.toString();
  };
  return (
    normalizePath(left.pathname) === normalizePath(right.pathname) &&
    normalizeQuery(left.search) === normalizeQuery(right.search) &&
    left.hash === right.hash
  );
}
