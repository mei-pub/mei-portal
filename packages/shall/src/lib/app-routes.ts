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

/**
 * 客户端导航承载地址：把应用资源路径包成 /app?app=<id>&path=<enc>。
 * 为什么必须走 /app 而不能直接 push 应用路径：nginx 以 Sec-Fetch-Dest 把
 * 应用路径的非 document 请求（Next 客户端路由的 RSC fetch 也算）直通到
 * 各应用，shell 的 RSC payload 永远拉不到 → Next 回退整页加载 → 常驻
 * 音乐引擎被销毁（表现为「切应用后音乐停了」）。/app 不是任何应用的
 * 前缀，全部请求类型都会落到 shell。地址栏仍由 AppFrame 的 URL 回写
 * effect 保持为规范的应用资源路径。
 */
export function appCarrierHref(path: string, plugins?: HostPluginRef[]): string | null {
  if (!path || /^https?:\/\//i.test(path)) return null;
  const parsed = parseAppRoute(path, plugins);
  if (!parsed) return null;
  const params = new URLSearchParams({ app: parsed.appId, path });
  return `/app?${params.toString()}`;
}

/** 承载页路由解析：/app?app=<id>&path=<应用内路径> → { appId, path } */
export function parseCarrierRoute(
  pathname: string,
  search: string,
  plugins?: HostPluginRef[]
): ParsedAppRoute | null {
  if (pathname !== '/app') return null;
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const appId = params.get('app') || '';
  const path = params.get('path') || '';
  if (!appId || !path) return null;
  const known = internalPlugins(plugins).some((plugin) => plugin.id === appId);
  if (!known) return null;
  const inner = parseAppRoute(path, plugins);
  if (!inner || inner.appId !== appId) return null;
  return inner;
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
