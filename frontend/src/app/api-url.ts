export const railwayApiBase = 'https://real-estate-platform-production-17ac.up.railway.app/api';

export function buildApiUrl(path: string, hostname = getBrowserHostname()): string {
  const normalizedPath = path.replace(/^\/+/, '');

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `/api/${normalizedPath}`;
  }

  return `${railwayApiBase}/${normalizedPath}`;
}

function getBrowserHostname(): string {
  const maybeWindow = globalThis as typeof globalThis & { window?: { location?: { hostname?: string } } };
  return maybeWindow.window?.location?.hostname ?? 'localhost';
}
