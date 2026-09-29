import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { JsonFile, LAZY_SAVE_DELAY_MS } from './json-file.js';
import { indexHistory, type HistoryIndex } from './suggestions.js';
import { withoutHash } from './url.js';

const MAX_VISITS = 5000;
// Pages that keep retitling themselves (unread counters, clocks) would otherwise rewrite the
// history file for as long as they stay open; like Chrome, only a visit's first titles are kept.
export const MAX_TITLE_CHANGES = 5;

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  faviconUrl?: string;
}

export class HistoryStore {
  private readonly file: string;
  private entries: HistoryEntry[] = [];
  private readonly json: JsonFile;
  private cachedIndex: HistoryIndex | null = null;
  private readonly titleChanges = new WeakMap<HistoryEntry, number>();

  constructor(directory: string) {
    this.file = path.join(directory, 'history.json');
    this.json = new JsonFile(this.file, 'history');
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) {
        this.entries = data.filter(isHistoryEntry).slice(0, MAX_VISITS);
      }
    } catch {}
  }

  list(query = ''): HistoryEntry[] {
    const term = query.trim().toLocaleLowerCase('tr').slice(0, 200);
    if (!term) return [...this.entries];
    return this.entries.filter((entry) => `${entry.title} ${entry.url}`.toLocaleLowerCase('tr').includes(term));
  }

  index(): HistoryIndex {
    this.cachedIndex ??= indexHistory(this.entries);
    return this.cachedIndex;
  }

  visit(url: string, title: string): string | null {
    if (!isWebUrl(url)) return null;
    const entry = { id: randomUUID(), url, title: title || url, visitedAt: Date.now() };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_VISITS) this.entries.length = MAX_VISITS;
    this.changed();
    return entry.id;
  }

  setTitle(id: string | null, title: string): void {
    if (!id || !title) return;
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || entry.title === title) return;
    const changes = this.titleChanges.get(entry) ?? 0;
    if (changes >= MAX_TITLE_CHANGES) return;
    this.titleChanges.set(entry, changes + 1);
    entry.title = title;
    this.changed(LAZY_SAVE_DELAY_MS);
  }

  setFavicon(id: string | null, faviconUrl: string): void {
    if (!id || !faviconUrl.startsWith('https:')) return;
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || entry.faviconUrl === faviconUrl) return;
    entry.faviconUrl = faviconUrl;
    this.changed(LAZY_SAVE_DELAY_MS);
  }

  remove(id: string): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    this.entries.splice(index, 1);
    this.changed();
  }

  clear(): void {
    this.entries = [];
    this.changed();
    this.saveNow();
  }

  clearSince(since: number): void {
    this.entries = since > 0 ? this.entries.filter((entry) => entry.visitedAt < since) : [];
    this.changed();
    this.saveNow();
  }

  saveNow(): void {
    this.json.flush();
  }

  private changed(delayMs?: number): void {
    this.cachedIndex = null;
    this.json.schedule(() => this.entries, delayMs);
  }
}

export function isSameVisit(previousUrl: string, nextUrl: string): boolean {
  return withoutHash(previousUrl) === withoutHash(nextUrl);
}

function isWebUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.url === 'string' &&
    isWebUrl(entry.url) &&
    typeof entry.title === 'string' &&
    typeof entry.visitedAt === 'number' &&
    Number.isFinite(entry.visitedAt) &&
    (entry.faviconUrl === undefined || typeof entry.faviconUrl === 'string')
  );
}
