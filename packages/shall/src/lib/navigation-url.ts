const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const DEFAULT_PORT = '7777';

function firstHeaderValue(value: string | null | undefined): string {
  return (value || '').split(',')[0].trim();
}

export function getPublicOrigin(
  host: string | null | undefined,
  forwardedProto?: string | null
): URL | null {
  const publicHost = firstHeaderValue(host);
  if (!publicHost) return null;

  const protocol = firstHeaderValue(forwardedProto).replace(/:$/, '') || 'http';
  try {
    return new URL(`${protocol}://${publicHost}`);
  } catch {
    return null;
  }
}

export function getKnownPublicOrigins(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isKnownPublicOrigin(url: URL, current: URL, knownOrigins: string[]): boolean {
  if (url.origin === current.origin) return true;
  return knownOrigins.some((origin) => {
    try {
      return url.origin === new URL(origin).origin;
    } catch {
      return false;
    }
  });
}

function isLegacyBuiltinPortalUrl(url: URL, current: URL, knownOrigins: string[]): boolean {
  if (isKnownPublicOrigin(url, current, knownOrigins)) return true;

  // Old single-image builds persisted loopback:7777 and same-host:7777 URLs.
  // Explicit same-host ports such as 8080 are custom services and must survive.
  if (LOCAL_HOSTNAMES.has(url.hostname) && url.port === DEFAULT_PORT) return true;
  if (url.hostname === current.hostname && (url.port === '' || url.port === DEFAULT_PORT)) {
    return true;
  }
  return false;
}

export function normalizeBuiltinUrl(
  url: string,
  current: URL | null,
  knownOrigins: string[] = []
): string {
  if (!current || !/^https?:\/\//i.test(url)) return url;

  try {
    const parsed = new URL(url);
    if (!isLegacyBuiltinPortalUrl(parsed, current, knownOrigins)) return url;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export function normalizeBuiltinItemUrls<
  T extends { items?: Array<{ builtin?: string; url: string }> }
>(config: T, current: URL | null, knownOrigins: string[] = []): T {
  if (!current || !config.items?.length) return config;

  return {
    ...config,
    items: config.items.map((item) =>
      item.builtin
        ? { ...item, url: normalizeBuiltinUrl(item.url, current, knownOrigins) }
        : item
    ),
  };
}
