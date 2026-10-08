import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readingUrl, type ReadingEntry } from '../../shared/reading-list.js';
import { searchKey } from '../address-bar/suggestions.js';

const MAX_ENTRIES = 1000;
export class ReadingListStore {
  readonly file: string;
  private entries: ReadingEntry[] = [];
  constructor(directory: string) {
    this.file = path.join(directory, 'reading-list.json');
    try {
      if (fs.statSync(this.file).size > 4 * 1024 * 1024) return;
      const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data)) return;
      const ids = new Set<string>(),
        urls = new Set<string>();
      for (const value of data.slice(0, MAX_ENTRIES)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as ReadingEntry,
          url = readingUrl(entry.url);
        if (
          !url ||
          typeof entry.id !== 'string' ||
          entry.id.length > 128 ||
          ids.has(entry.id) ||
          urls.has(url) ||
          typeof entry.title !== 'string' ||
          entry.title.length > 512 ||
          typeof entry.read !== 'boolean' ||
          !Number.isFinite(entry.addedAt) ||
          entry.addedAt < 0
        )
          continue;
        ids.add(entry.id);
        urls.add(url);
        this.entries.push({ id: entry.id, url, title: entry.title, read: entry.read, addedAt: entry.addedAt });
      }
    } catch {}
  }
  list(query = '', status = 'all'): ReadingEntry[] {
    const term = searchKey(query.trim().slice(0, 200));
    return this.entries
      .filter(
        (entry) =>
          (status === 'all' || entry.read === (status === 'read')) &&
          searchKey(`${entry.title} ${entry.url}`).includes(term),
      )
      .map((entry) => ({ ...entry }));
  }
  add(value: unknown, title: unknown): boolean {
    const url = readingUrl(value);
    if (!url || typeof title !== 'string') return false;
    if (this.entries.some((entry) => entry.url === url)) return true;
    if (this.entries.length >= MAX_ENTRIES) return false;
    return this.replace([
      {
        id: randomUUID(),
        url,
        title: title.replace(/\s+/g, ' ').trim().slice(0, 512) || url,
        read: false,
        addedAt: Date.now(),
      },
      ...this.entries,
    ]);
  }
  setRead(id: string, read: boolean): boolean {
    if (!this.entries.some((entry) => entry.id === id)) return false;
    return this.replace(this.entries.map((entry) => (entry.id === id ? { ...entry, read } : entry)));
  }
  remove(id: string): boolean {
    if (!this.entries.some((entry) => entry.id === id)) return false;
    return this.replace(this.entries.filter((entry) => entry.id !== id));
  }
  private replace(entries: ReadingEntry[]): boolean {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
      fs.renameSync(temp, this.file);
      this.entries = entries;
      return true;
    } catch {
      return false;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}
export function saveReadingPage(
  store: ReadingListStore,
  page: { url: string; title: string; isPrivate: boolean; developer: boolean },
): boolean {
  return !page.isPrivate && !page.developer && store.add(page.url, page.title);
}
