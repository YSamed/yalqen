import fs from 'node:fs';
import path from 'node:path';
import type { NavigationEntry } from 'electron';
import type { TabId } from '../shared/types.js';
import { JsonFile } from './json-file.js';

export interface SavedHistory {
  entries: NavigationEntry[];
  index: number;
}

export const SAVED_ENTRIES_AROUND_ACTIVE = 6;

export type PersistChange = boolean | 'lazy';

export function trimHistory(history: SavedHistory, around = SAVED_ENTRIES_AROUND_ACTIVE): SavedHistory {
  const index = Math.min(Math.max(history.index, 0), history.entries.length - 1);
  const start = Math.max(0, index - around);
  const end = Math.min(history.entries.length, index + around + 1);
  return { entries: history.entries.slice(start, end), index: index - start };
}

export interface SavedTab {
  id: TabId;
  url: string;
  title: string;
  faviconUrl: string | null;
  pinnedUrl?: string | null;
  keepAlive?: boolean;
  history: SavedHistory | null;
}

export interface SavedWindow {
  activeTabId: TabId | null;
  tabs: SavedTab[];
}

export interface SavedSession {
  version: 2;
  windows: SavedWindow[];
  // Set when the browser restarts itself to install an update, so every tab comes back once
  // even when the startup setting would only keep pinned tabs.
  resume?: true;
}

// Without session restore only pinned tabs survive, reset to their pinned URL; a null activeTabId
// makes the restored window start on a new tab instead.
export function pinnedOnly(window: SavedWindow): SavedWindow {
  const tabs = window.tabs.flatMap((tab) => {
    const pinnedUrl = tab.pinnedUrl ?? (tab.keepAlive ? tab.url : null);
    return pinnedUrl ? [{ ...tab, url: pinnedUrl, pinnedUrl, keepAlive: undefined, history: null }] : [];
  });
  return { activeTabId: null, tabs };
}

function isSavedWindow(value: unknown): value is SavedWindow {
  const window = value as SavedWindow;
  return typeof window === 'object' && window !== null && Array.isArray(window.tabs);
}

export class SessionStore {
  private readonly file: string;
  private readonly json: JsonFile;
  private closed = false;

  constructor(directory: string) {
    this.file = path.join(directory, 'tabs.json');
    this.json = new JsonFile(this.file, 'session');
  }

  load(): SavedSession | null {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SavedSession | ({ version: 1 } & SavedWindow);
      if (data.version === 1) {
        return isSavedWindow(data)
          ? { version: 2, windows: [{ activeTabId: data.activeTabId ?? data.tabs[0]?.id ?? null, tabs: data.tabs }] }
          : null;
      }
      return data.version === 2 && Array.isArray(data.windows)
        ? { version: 2, windows: data.windows.filter(isSavedWindow), ...(data.resume === true && { resume: true }) }
        : null;
    } catch {
      return null;
    }
  }

  scheduleSave(snapshot: () => SavedSession, delayMs?: number): void {
    if (!this.closed) this.json.schedule(snapshot, delayMs);
  }

  saveNow(session: SavedSession): void {
    this.closed = true;
    this.json.flush(() => session);
  }
}
