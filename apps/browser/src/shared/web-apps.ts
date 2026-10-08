import { readingUrl } from './reading-list.js';
export interface WebAppInfo {
  id: string;
  manifestId: string;
  name: string;
  startUrl: string;
  scope: string;
}
export function webAppContains(scope: string, value: string): boolean {
  const safe = readingUrl(value);
  if (!safe) return false;
  try {
    const base = new URL(scope),
      url = new URL(safe);
    return base.origin === url.origin && url.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
}
