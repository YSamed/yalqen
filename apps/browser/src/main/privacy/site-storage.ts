import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDomain } from 'tldts';
import type { Cookie, Session, WebContents } from 'electron';
import type { SiteStorageView } from '../../shared/site-storage.js';
import { JsonFile } from '../storage/json-file.js';
import { withDebugger } from '../devtools/page-debugger.js';

const MAX_ORIGINS = 20_000;
const PAGE_SIZE = 20;
export function storageOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
export function storageDomain(host: string): string {
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

// Retain origins, not URLs or titles, so clearing browsing history does not hide existing storage.
export class StorageOrigins {
  private origins = new Set<string>();
  private readonly json: JsonFile;
  constructor(directory: string) {
    const file = path.join(directory, 'site-origins.json');
    this.json = new JsonFile(file, 'site-origins');
    try {
      if (fs.statSync(file).size > 8 * 1024 * 1024) return;
      const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data))
        for (const value of data.slice(0, MAX_ORIGINS)) {
          const origin = storageOrigin(value);
          if (origin) this.origins.add(origin);
        }
    } catch {}
  }
  remember(value: unknown): void {
    const origin = storageOrigin(value);
    if (!origin || this.origins.has(origin) || this.origins.size >= MAX_ORIGINS) return;
    this.origins.add(origin);
    this.json.schedule(() => [...this.origins]);
  }
  list(): string[] {
    return [...this.origins];
  }
  clear(): void {
    this.origins.clear();
    this.json.flush(() => []);
  }
  saveNow(): void {
    this.json.flush();
  }
}

// Chromium's quota database discovers dormant IndexedDB/cache/service-worker origins.
// Open read-only; if a future engine changes the schema, the observed-origin index still works.
export function quotaOrigins(directory: string | null): { origins: string[]; limited: boolean } {
  if (!directory) return { origins: [], limited: false };
  const origins = new Set<string>();
  let limited = false;
  for (const relative of ['WebStorage/QuotaManager', 'QuotaManager']) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path.join(directory, relative), { readOnly: true, timeout: 100 });
      const rows = db.prepare('SELECT DISTINCT storage_key FROM buckets LIMIT ?').all(MAX_ORIGINS + 1);
      limited ||= rows.length > MAX_ORIGINS;
      for (const row of rows.slice(0, MAX_ORIGINS)) {
        // Serialized storage keys start with their origin; partition metadata follows '^'.
        const origin = storageOrigin(typeof row.storage_key === 'string' ? row.storage_key.split('^')[0] : null);
        if (origin) origins.add(origin);
      }
    } catch {
      /* Older versions use the root path; an incompatible schema falls back to the origin index. */
    } finally {
      db?.close();
    }
  }
  return { origins: [...origins].slice(0, MAX_ORIGINS), limited: limited || origins.size > MAX_ORIGINS };
}
interface Group {
  domain: string;
  origins: Set<string>;
  cookies: number;
}
export function storageGroups(
  origins: readonly string[],
  cookies: readonly Pick<Cookie, 'domain' | 'secure'>[],
): Group[] {
  const groups = new Map<string, Group>();
  const group = (host: string) => {
    const domain = storageDomain(host);
    let entry = groups.get(domain);
    if (!entry) groups.set(domain, (entry = { domain, origins: new Set(), cookies: 0 }));
    return entry;
  };
  for (const value of origins) {
    const origin = storageOrigin(value);
    if (origin) group(new URL(origin).hostname).origins.add(origin);
  }
  for (const cookie of cookies) {
    const host = (cookie.domain ?? '').replace(/^\./, '');
    const origin = storageOrigin(`https://${host}/`);
    if (!origin) continue;
    const entry = group(new URL(origin).hostname);
    entry.cookies++;
    entry.origins.add(origin);
    if (!cookie.secure) entry.origins.add(`http://${new URL(origin).host}`);
  }
  return [...groups.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

export class SiteStorageManager {
  constructor(
    private readonly browsing: Session,
    private readonly index: StorageOrigins,
    private readonly history: () => readonly string[],
  ) {}
  async groups(): Promise<{ groups: Group[]; limited: boolean }> {
    const quota = quotaOrigins(this.browsing.getStoragePath());
    const known = this.index.list();
    const candidates = [...known, ...quota.origins, ...this.history()];
    const origins = [...new Set(candidates.flatMap((value) => storageOrigin(value) ?? []))];
    return {
      groups: storageGroups(origins.slice(0, MAX_ORIGINS), await this.browsing.cookies.get({})),
      limited: quota.limited || known.length >= MAX_ORIGINS || origins.length > MAX_ORIGINS,
    };
  }
  async view(contents: WebContents, query: string, offset: number): Promise<SiteStorageView> {
    const { groups, limited } = await this.groups();
    const filtered = groups.filter((group) => group.domain.includes(query.toLowerCase()));
    const page = filtered.slice(offset, offset + PAGE_SIZE);
    const sites = await withDebugger(contents, async () => {
      const result = [];
      for (const group of page) {
        let databaseBytes: number | null = 0;
        for (const origin of group.origins) {
          try {
            const value = await contents.debugger.sendCommand('Storage.getUsageAndQuota', { origin });
            if (typeof value.usage !== 'number' || !Number.isFinite(value.usage) || value.usage < 0)
              throw Error('usage');
            databaseBytes += Math.round(value.usage);
          } catch {
            databaseBytes = null;
            break;
          }
        }
        result.push({ domain: group.domain, origins: group.origins.size, cookies: group.cookies, databaseBytes });
      }
      return result;
    });
    return { sites, total: filtered.length, offset, more: offset + sites.length < filtered.length, limited };
  }
  async clear(domain: string | null, allowed: () => boolean = () => true): Promise<boolean> {
    const options: Electron.ClearDataOptions = {
      dataTypes: ['cookies', 'indexedDB', 'localStorage', 'serviceWorkers', 'fileSystems', 'backgroundFetch', 'cache'],
      originMatchingMode: 'origin-in-all-contexts',
    };
    if (domain !== null) {
      const { groups } = await this.groups();
      const group = groups.find((group) => group.domain === domain);
      if (!group) return false;
      options.origins = [...group.origins];
    }
    if (!allowed()) return false;
    await this.browsing.clearData(options);
    // Electron's cache data type includes both network cache and partitioned CacheStorage.
    if (!options.origins) this.index.clear();
    return true;
  }
}
