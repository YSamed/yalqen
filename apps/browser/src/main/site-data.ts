import type { Cookie, MenuItemConstructorOptions, Session } from 'electron';
import { getLocale, t } from '../shared/i18n.js';

export interface StorageUsage {
  localStorage: number;
  indexedDb: number;
  cacheStorage: number;
  serviceWorkers: number;
}

export interface SiteData {
  cookies: number;
  storage: StorageUsage | null;
}

export interface SiteDataActions {
  clearCookies(): void;
  clearSiteData(): void;
}

// Runs in an isolated world, so the page cannot change what it reports about itself.
export const MEASURE_STORAGE_SCRIPT = `(async () => {
  let localStorageBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      localStorageBytes += (key.length + (localStorage.getItem(key) ?? '').length) * 2;
    }
  } catch {}
  let details = null;
  try {
    details = navigator.storage ? (await navigator.storage.estimate()).usageDetails ?? {} : null;
  } catch {}
  return { localStorage: localStorageBytes, details };
})()`;

function bytes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function parseStorageUsage(raw: unknown): StorageUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { localStorage, details } = raw as { localStorage?: unknown; details?: unknown };
  const usage = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {};
  return {
    localStorage: bytes(localStorage),
    indexedDb: bytes(usage.indexedDB),
    cacheStorage: bytes(usage.caches),
    serviceWorkers: bytes(usage.serviceWorkerRegistrations),
  };
}

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(value: number): string {
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  const digits = unit === 0 || size >= 100 ? 0 : 1;
  return `${size.toLocaleString(getLocale(), { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

export function cookieUrl(cookie: Pick<Cookie, 'domain' | 'path' | 'secure'>): string {
  const host = (cookie.domain ?? '').replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`;
}

export function cookiesForHost<T extends Pick<Cookie, 'domain' | 'hostOnly'>>(
  cookies: readonly T[],
  host: string,
): T[] {
  return cookies.filter((cookie) => {
    const domain = (cookie.domain ?? '').replace(/^\./, '').toLowerCase();
    return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
  });
}

export function siteDataItems(data: SiteData, actions: SiteDataActions): MenuItemConstructorOptions[] {
  const { storage } = data;
  const localLabel = t('siteData.localStorage');
  const sizes: [string, number][] = storage
    ? [
        [localLabel, storage.localStorage],
        ['IndexedDB', storage.indexedDb],
        [t('siteData.cacheStorage'), storage.cacheStorage],
        ['Service worker', storage.serviceWorkers],
      ]
    : [];
  return [
    { type: 'separator' },
    { label: t('siteData.cookies', { count: data.cookies }), enabled: false },
    ...sizes
      .filter(([label, size]) => size > 0 || label === localLabel)
      .map(([label, size]): MenuItemConstructorOptions => ({
        label: t('siteData.usage', { label, size: formatBytes(size) }),
        enabled: false,
      })),
    ...(storage ? [] : [{ label: t('siteData.unmeasurable'), enabled: false }]),
    { label: t('siteData.deleteCookies'), enabled: data.cookies > 0, click: actions.clearCookies },
    { label: t('siteData.clear'), click: actions.clearSiteData },
  ];
}

// Clearing by origin leaves cookies set on a parent domain, so those are removed one by one.
export async function clearSiteData(browsing: Session, origin: string): Promise<void> {
  const cookies = cookiesForHost(await browsing.cookies.get({}), new URL(origin).hostname);
  await Promise.allSettled([
    browsing.clearStorageData({ origin }),
    ...cookies.map((cookie) => browsing.cookies.remove(cookieUrl(cookie), cookie.name)),
  ]);
}
