export const MUSIC_BASE = '/music';

export function resolveRoute(pathname, search = '', hash = '') {
  if (hash.startsWith('#/')) {
    const [hashPath, hashQuery] = hash.slice(1).split('?');
    const path = hashPath || '/search';
    return { path, params: new URLSearchParams(hashQuery || '') };
  }

  const path = pathname.startsWith(MUSIC_BASE)
    ? pathname.slice(MUSIC_BASE.length) || '/search'
    : pathname || '/search';
  return { path, params: new URLSearchParams(search || '') };
}

export function canonicalUrl(path, params = new URLSearchParams()) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const query = params.toString();
  return `${MUSIC_BASE}${normalizedPath}${query ? `?${query}` : ''}`;
}

export function pushRoute(path, params = new URLSearchParams()) {
  window.history.pushState(null, '', canonicalUrl(path, params));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function replaceRoute(path, params = new URLSearchParams()) {
  window.history.replaceState(null, '', canonicalUrl(path, params));
}

export function migrateLegacyHashRoute() {
  if (!window.location.hash.startsWith('#/')) return;
  const { path, params } = resolveRoute(window.location.pathname, window.location.search, window.location.hash);
  replaceRoute(path, params);
}
