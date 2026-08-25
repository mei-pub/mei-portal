export function buildHealthUrl(endpoint: string, healthPath: string, base: string | URL): string {
  const target = `${endpoint || ''}${healthPath || '/'}`;
  try {
    return new URL(target, base).toString();
  } catch {
    return target;
  }
}
