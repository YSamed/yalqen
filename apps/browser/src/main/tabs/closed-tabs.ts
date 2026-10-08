import fs from 'node:fs';
import path from 'node:path';
import type { NavigationEntry } from 'electron';
import { JsonFile } from '../storage/json-file.js';
import { trimHistory, type SavedHistory, type SavedTab } from './persistence.js';

export const MAX_CLOSED_TABS = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGE_STATE = 64 * 1024;
const PROTOCOLS = new Set([
  'http:',
  'https:',
  'file:',
  'about:',
  'yalqen:',
  'chrome-extension:',
  'data:',
  'view-source:',
]);
function validUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    return PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
function history(value: unknown): SavedHistory | null {
  if (!value || typeof value !== 'object') return null;
  const { entries, index } = value as Record<string, unknown>;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 13 || !Number.isInteger(index)) return null;
  if ((index as number) < 0 || (index as number) >= entries.length) return null;
  const clean: NavigationEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !validUrl(entry.url) || typeof entry.title !== 'string') return null;
    if (
      entry.pageState !== undefined &&
      (typeof entry.pageState !== 'string' || entry.pageState.length > MAX_PAGE_STATE)
    )
      return null;
    clean.push({
      url: entry.url,
      title: entry.title.slice(0, 4096),
      ...(entry.pageState !== undefined && { pageState: entry.pageState }),
    });
  }
  return { entries: clean, index: index as number };
}
function sanitize(value: unknown): SavedTab | null {
  if (!value || typeof value !== 'object') return null;
  const tab = value as Record<string, unknown>;
  if (tab.isPrivate === true || tab.private === true || tab.developer === true) return null;
  if (typeof tab.id !== 'string' || tab.id.length > 128 || !validUrl(tab.url) || typeof tab.title !== 'string')
    return null;
  if (typeof tab.closedAt !== 'number' || !Number.isFinite(tab.closedAt) || tab.closedAt < 0) return null;
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title.slice(0, 4096),
    faviconUrl: validUrl(tab.faviconUrl) ? tab.faviconUrl : null,
    pinnedUrl: null,
    closedAt: tab.closedAt,
    history: history(tab.history),
  };
}

// Shared by normal windows of one persistent profile; private/developer tabs never enter it.
export class ClosedTabStore {
  readonly tabs: SavedTab[] = [];
  readonly file: string;
  private readonly json: JsonFile;
  constructor(directory: string) {
    this.file = path.join(directory, 'closed-tabs.json');
    this.json = new JsonFile(this.file, 'closed-tabs');
    try {
      if (fs.statSync(this.file).size > MAX_FILE_BYTES) return;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      if (data.version === 1 && Array.isArray(data.tabs))
        this.tabs.push(...data.tabs.slice(-MAX_CLOSED_TABS).flatMap((tab) => sanitize(tab) ?? []));
    } catch {}
  }
  changed(): void {
    this.json.schedule(() => this.snapshot());
  }
  clearSince(since: number): void {
    const keep = this.tabs.filter((tab) => (tab.closedAt ?? 0) < since);
    this.tabs.splice(0, this.tabs.length, ...keep);
    this.changed();
    this.saveNow();
  }
  saveNow(): void {
    this.json.flush();
  }
  private snapshot(): unknown {
    return {
      version: 1,
      tabs: this.tabs
        .slice(-MAX_CLOSED_TABS)
        .flatMap((tab) => sanitize({ ...tab, history: tab.history && trimHistory(tab.history) }) ?? []),
    };
  }
}
