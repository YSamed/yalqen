import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MAX_FEED_ITEMS,
  feedSourceUrl,
  liveFolderName,
  parseFeed,
  type LiveFolderView,
  type ParsedFeed,
} from '../../shared/live-folders.js';
import { readingUrl } from '../../shared/reading-list.js';
import { JsonFile } from '../storage/json-file.js';

export const MAX_LIVE_FOLDERS = 20;
export const REFRESH_INTERVAL_MS = 30 * 60_000;
const FIRST_REFRESH_DELAY_MS = 15_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

interface LiveItem {
  id: string;
  title: string;
  url: string;
  unread: boolean;
}

interface LiveFolder {
  id: string;
  name: string;
  url: string;
  collapsed: boolean;
  failed: boolean;
  refreshedAt: number;
  items: LiveItem[];
}

interface SavedLiveFolders {
  version: 1;
  folders: LiveFolder[];
}

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

function item(value: unknown): LiveItem | null {
  const entry = value as Partial<LiveItem> | null;
  const url = readingUrl(entry?.url);
  if (!url || !text(entry?.id, 512) || typeof entry?.title !== 'string' || entry.title.length > 200) return null;
  return { id: entry.id, title: entry.title, url, unread: entry.unread === true };
}

function folder(value: unknown): LiveFolder | null {
  const entry = value as Partial<LiveFolder> | null;
  const url = feedSourceUrl(entry?.url);
  if (!url || !text(entry?.id, 128)) return null;
  const items = Array.isArray(entry.items) ? entry.items.slice(0, MAX_FEED_ITEMS).map(item) : [];
  return {
    id: entry.id,
    name: liveFolderName(entry.name),
    url,
    collapsed: entry.collapsed === true,
    failed: false,
    refreshedAt: typeof entry.refreshedAt === 'number' && entry.refreshedAt > 0 ? entry.refreshedAt : 0,
    items: items.filter((next): next is LiveItem => next !== null),
  };
}

export class LiveFolderStore {
  readonly file: string | null;
  private readonly json: JsonFile | null;
  private folders: LiveFolder[] = [];

  constructor(directory: string | null) {
    this.file = directory === null ? null : path.join(directory, 'live-folders.json');
    this.json = this.file === null ? null : new JsonFile(this.file, 'live-folders');
    if (this.file === null) return;
    try {
      if (fs.statSync(this.file).size > MAX_FILE_BYTES) return;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SavedLiveFolders>;
      if (data.version !== 1 || !Array.isArray(data.folders)) return;
      const ids = new Set<string>();
      for (const value of data.folders.slice(0, MAX_LIVE_FOLDERS)) {
        const next = folder(value);
        if (next && !ids.has(next.id)) {
          ids.add(next.id);
          this.folders.push(next);
        }
      }
    } catch {}
  }

  ids(): string[] {
    return this.folders.map((next) => next.id);
  }

  url(id: string): string | null {
    return this.find(id)?.url ?? null;
  }

  view(): LiveFolderView[] {
    return this.folders.map((next) => ({
      id: next.id,
      title: next.name || new URL(next.url).hostname,
      collapsed: next.collapsed,
      failed: next.failed,
      unread: next.items.filter((entry) => entry.unread).length,
      items: next.collapsed ? [] : next.items.map(({ id, title, unread }) => ({ id, title, unread })),
    }));
  }

  add(source: { url: string; name: string }): string | null {
    const existing = this.folders.find((next) => next.url === source.url);
    if (existing) return existing.id;
    if (this.folders.length >= MAX_LIVE_FOLDERS) return null;
    const id = randomUUID();
    this.folders.push({
      id,
      name: source.name,
      url: source.url,
      collapsed: false,
      failed: false,
      refreshedAt: 0,
      items: [],
    });
    this.save();
    return id;
  }

  remove(id: string): boolean {
    if (!this.find(id)) return false;
    this.folders = this.folders.filter((next) => next.id !== id);
    this.save();
    return true;
  }

  toggle(id: string): boolean {
    const target = this.find(id);
    if (!target) return false;
    target.collapsed = !target.collapsed;
    this.save();
    return true;
  }

  open(id: string, itemId: string): string | null {
    const target = this.find(id)?.items.find((entry) => entry.id === itemId);
    if (!target) return null;
    if (target.unread) {
      target.unread = false;
      this.save();
    }
    return target.url;
  }

  readAll(id: string): boolean {
    const target = this.find(id);
    if (!target) return false;
    for (const entry of target.items) entry.unread = false;
    this.save();
    return true;
  }

  // The first refresh only sets the baseline, so a new folder does not start with every item unread.
  update(id: string, feed: ParsedFeed | null, now = Date.now()): void {
    const target = this.find(id);
    if (!target) return;
    target.failed = feed === null;
    if (feed) {
      const known = new Map(target.items.map((entry) => [entry.id, entry]));
      target.items = feed.items.map((entry) => ({
        ...entry,
        unread: known.get(entry.id)?.unread ?? target.refreshedAt > 0,
      }));
      target.refreshedAt = now;
      if (!target.name) target.name = liveFolderName(feed.title);
    }
    this.save();
  }

  saveNow(): void {
    this.json?.flush(() => this.snapshot());
  }

  private find(id: string): LiveFolder | undefined {
    return this.folders.find((next) => next.id === id);
  }

  private snapshot(): SavedLiveFolders {
    return { version: 1, folders: this.folders };
  }

  private save(): void {
    this.json?.schedule(() => this.snapshot());
  }
}

export type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchFeed(fetchUrl: FeedFetch, url: string): Promise<ParsedFeed | null> {
  try {
    const response = await fetchUrl(url, {
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' },
    });
    // Redirects are followed, so the final address must be checked as well.
    if (!response.ok || !response.body || (response.url && !response.url.startsWith('https://'))) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return parseFeed(Buffer.concat(chunks).toString('utf8'), response.url || url);
  } catch {
    return null;
  }
}

interface RefresherHost {
  store: LiveFolderStore;
  fetch: FeedFetch;
  changed(): void;
}

export class LiveFolderRefresher {
  private readonly running = new Set<string>();

  constructor(private readonly host: RefresherHost) {}

  async refresh(ids: string[] = this.host.store.ids()): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const url = this.host.store.url(id);
        if (!url || this.running.has(id)) return;
        this.running.add(id);
        try {
          this.host.store.update(id, await fetchFeed(this.host.fetch, url));
          this.host.changed();
        } finally {
          this.running.delete(id);
        }
      }),
    );
  }

  start(): () => void {
    const first = setTimeout(() => void this.refresh(), FIRST_REFRESH_DELAY_MS);
    const timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }
}
