import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readingUrl } from '../../shared/reading-list.js';
import { tabGroupName } from '../../shared/tab-groups.js';
import type { WorkspaceSummary } from '../../shared/workspaces.js';
import type { SavedWindow, SavedTab } from '../tabs/persistence.js';

interface Workspace {
  id: string;
  name: string;
  savedAt: number;
  window: SavedWindow;
}
export function workspaceSnapshot(value: SavedWindow): SavedWindow | null {
  if (!value || !Array.isArray(value.tabs) || value.tabs.length > 500) return null;
  const ids = new Map<string, string>();
  const tabs: SavedTab[] = [];
  for (const entry of value.tabs) {
    const url = readingUrl(entry?.url);
    if (!url || typeof entry.id !== 'string' || ids.has(entry.id)) continue;
    const id = randomUUID();
    ids.set(entry.id, id);
    tabs.push({
      id,
      url,
      title: typeof entry.title === 'string' ? entry.title.slice(0, 512) : url,
      faviconUrl: null,
      pinnedUrl: readingUrl(entry.pinnedUrl),
      history: null,
      group: tabGroupName(entry.group),
    });
  }
  if (!tabs.length || tabs.length > 200) return null;
  const groups = new Set(tabs.flatMap((tab) => (tab.group ? [tab.group] : [])));
  if (groups.size > 50) return null;
  return {
    tabs,
    activeTabId: ids.get(value.activeTabId ?? '') ?? tabs[0].id,
    collapsedGroups: Array.isArray(value.collapsedGroups)
      ? value.collapsedGroups.filter((name) => groups.has(name)).slice(0, 50)
      : [],
  };
}
export class WorkspaceStore {
  readonly file: string;
  private entries: Workspace[] = [];
  constructor(directory: string) {
    this.file = path.join(directory, 'workspaces.json');
    try {
      if (fs.statSync(this.file).size > 8 * 1024 * 1024) return;
      const values: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(values)) return;
      for (const value of values.slice(0, 50)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as Workspace,
          name = tabGroupName(entry.name),
          window = workspaceSnapshot(entry.window);
        if (
          name &&
          window &&
          typeof entry.id === 'string' &&
          entry.id.length <= 128 &&
          Number.isFinite(entry.savedAt) &&
          !this.entries.some((item) => item.id === entry.id || item.name === name)
        )
          this.entries.push({ id: entry.id, name, window, savedAt: entry.savedAt });
      }
    } catch {}
  }
  list(): WorkspaceSummary[] {
    return this.entries.map(({ id, name, savedAt, window }) => ({ id, name, savedAt, count: window.tabs.length }));
  }
  save(name: unknown, window: SavedWindow): boolean {
    const valid = tabGroupName(name),
      snapshot = workspaceSnapshot(window);
    if (!valid || !snapshot || this.entries.length >= 50 || this.entries.some((item) => item.name === valid))
      return false;
    return this.replace([{ id: randomUUID(), name: valid, window: snapshot, savedAt: Date.now() }, ...this.entries]);
  }
  open(id: string): SavedWindow | null {
    const entry = this.entries.find((item) => item.id === id);
    return entry ? workspaceSnapshot(entry.window) : null;
  }
  rename(id: string, name: unknown): boolean {
    const valid = tabGroupName(name);
    if (
      !valid ||
      !this.entries.some((item) => item.id === id) ||
      this.entries.some((item) => item.id !== id && item.name === valid)
    )
      return false;
    return this.replace(this.entries.map((item) => (item.id === id ? { ...item, name: valid } : item)));
  }
  remove(id: string): boolean {
    return this.entries.some((item) => item.id === id) && this.replace(this.entries.filter((item) => item.id !== id));
  }
  private replace(entries: Workspace[]): boolean {
    const data = JSON.stringify(entries);
    if (Buffer.byteLength(data) > 8 * 1024 * 1024) return false;
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, data, { mode: 0o600 });
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
