const BASE_PATH = '/tv';

function firstHeaderValue(value: string | null): string {
  return (value || '').split(',')[0].trim();
}

export function getPublicProxyBase(headers: Headers, requestUrl: string): string {
  let fallback: URL;
  try {
    fallback = new URL(requestUrl);
  } catch {
    return `${BASE_PATH}/api/proxy`;
  }

  const host = firstHeaderValue(headers.get('x-forwarded-host')) || firstHeaderValue(headers.get('host'));
  const protocol =
    firstHeaderValue(headers.get('x-forwarded-proto')).replace(/:$/, '') ||
    fallback.protocol.replace(':', '');

  if (!host) return `${fallback.origin}${BASE_PATH}/api/proxy`;

  try {
    const publicOrigin = new URL(`${protocol}://${host}`);
    return `${publicOrigin.origin}${BASE_PATH}/api/proxy`;
  } catch {
    return `${fallback.origin}${BASE_PATH}/api/proxy`;
  }
}
