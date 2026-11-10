import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readingUrl } from '../../shared/reading-list.js';
import type { Favorite } from '../../shared/types.js';

const MAX_FAVORITES = 24;
const MAX_FILE_BYTES = 1024 * 1024;

function favorite(value: unknown): Favorite | null {
  const entry = value as Partial<Favorite> | null;
  const url = readingUrl(entry?.url);
  if (!url) return null;
  return {
    url,
    title: (typeof entry?.title === 'string' && entry.title.slice(0, 200)) || url,
    faviconUrl: readingUrl(entry?.faviconUrl),
  };
}

export class FavoriteStore {
  readonly file: string;
  private entries: Favorite[] = [];

  constructor(directory: string) {
    this.file = path.join(directory, 'favorites.json');
    try {
      if (fs.statSync(this.file).size > MAX_FILE_BYTES) return;
      const values: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(values)) return;
      for (const value of values) {
        const entry = favorite(value);
        if (entry && !this.has(entry.url) && this.entries.length < MAX_FAVORITES) this.entries.push(entry);
      }
    } catch {}
  }

  list(): Favorite[] {
    return this.entries;
  }

  has(url: string): boolean {
    return this.entries.some((entry) => entry.url === url);
  }

  toggle(page: Favorite): boolean {
    const entry = favorite(page);
    if (!entry) return false;
    if (this.has(entry.url)) return this.remove(entry.url);
    return this.entries.length < MAX_FAVORITES && this.replace([...this.entries, entry]);
  }

  remove(url: string): boolean {
    return this.has(url) && this.replace(this.entries.filter((entry) => entry.url !== url));
  }

  private replace(entries: Favorite[]): boolean {
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
