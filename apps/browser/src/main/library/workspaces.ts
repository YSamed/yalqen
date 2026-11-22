import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readingUrl } from '../../shared/reading-list.js';
import { parseGroupParents, pruneGroupParents, tabGroupName } from '../../shared/tab-groups.js';
import { MAX_SPACES, workspaceIcon, type SpaceView, type WorkspaceSummary } from '../../shared/workspaces.js';
import type { SavedWindow, SavedTab } from '../tabs/persistence.js';

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  savedAt: number;
  window: SavedWindow;
  isolated?: boolean;
}
const SPACE_FILE_FORMAT = 'yalqen-space';
const MAX_SPACE_FILE_BYTES = 2 * 1024 * 1024;
export interface SpaceFile {
  name: string;
  icon: string | null;
  isolated: boolean;
  window: SavedWindow;
}
export function spacePartition(id: string, isolated: boolean): string | null {
  return isolated && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    ? `persist:space-${id}`
    : null;
}
export function spaceFileText({ name, icon, isolated, window }: SpaceFile): string | null {
  const snapshot = workspaceSnapshot(window, true);
  return snapshot && JSON.stringify({ format: SPACE_FILE_FORMAT, version: 1, name, icon, isolated, window: snapshot });
}
export function parseSpaceFile(text: string): SpaceFile | null {
  if (Buffer.byteLength(text) > MAX_SPACE_FILE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const file = value as Record<string, unknown>;
  if (file.format !== SPACE_FILE_FORMAT || file.version !== 1) return null;
  const name = tabGroupName(file.name);
  const window = workspaceSnapshot(file.window as SavedWindow, true);
  return name && window ? { name, icon: workspaceIcon(file.icon), isolated: file.isolated === true, window } : null;
}
export function workspaceSnapshot(value: SavedWindow, allowEmpty = false): SavedWindow | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.tabs) || value.tabs.length > 500) return null;
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
  if ((!tabs.length && !allowEmpty) || tabs.length > 200) return null;
  const groups = new Set(tabs.flatMap((tab) => (tab.group ? [tab.group] : [])));
  if (groups.size > 50) return null;
  return {
    tabs,
    activeTabId: ids.get(value.activeTabId ?? '') ?? tabs[0]?.id ?? null,
    collapsedGroups: Array.isArray(value.collapsedGroups)
      ? value.collapsedGroups.filter((name) => groups.has(name)).slice(0, 50)
      : [],
    groupParents: Object.fromEntries(pruneGroupParents(parseGroupParents(value.groupParents), groups)),
  };
}
export class WorkspaceStore {
  readonly file: string;
  private entries: Workspace[] = [];
  constructor(
    directory: string,
    private readonly forgetPartition: (partition: string) => void = () => {},
  ) {
    this.file = path.join(directory, 'workspaces.json');
    try {
      if (fs.statSync(this.file).size > 8 * 1024 * 1024) return;
      const values: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(values)) return;
      for (const value of values.slice(0, MAX_SPACES)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as Workspace,
          name = tabGroupName(entry.name),
          window = workspaceSnapshot(entry.window, true);
        if (
          name &&
          window &&
          typeof entry.id === 'string' &&
          entry.id.length <= 128 &&
          Number.isFinite(entry.savedAt) &&
          !this.entries.some((item) => item.id === entry.id || item.name === name)
        )
          this.entries.push({
            id: entry.id,
            name,
            icon: workspaceIcon(entry.icon),
            window,
            savedAt: entry.savedAt,
            ...(typeof entry.isolated === 'boolean' && { isolated: entry.isolated }),
          });
      }
    } catch {}
  }
  list(): WorkspaceSummary[] {
    return this.entries.map(({ id, name, icon, savedAt, window }) => ({
      id,
      name,
      icon,
      savedAt,
      count: window.tabs.length,
    }));
  }
  spaces(): SpaceView[] {
    return this.entries.toSorted((a, b) => a.savedAt - b.savedAt).map(({ id, name, icon }) => ({ id, name, icon }));
  }
  save(name: unknown, window: SavedWindow): boolean {
    const snapshot = workspaceSnapshot(window);
    return !!snapshot && this.add(name, snapshot) !== null;
  }
  create(name: unknown): string | null {
    return this.add(name, { activeTabId: null, tabs: [] });
  }
  open(id: string): SavedWindow | null {
    const entry = this.entries.find((item) => item.id === id);
    return entry ? workspaceSnapshot(entry.window, true) : null;
  }
  partition(id: string): string | null {
    const entry = this.entries.find((item) => item.id === id);
    return entry ? spacePartition(entry.id, entry.isolated === true) : null;
  }
  storedPartitions(): string[] {
    return this.entries.flatMap((item) => spacePartition(item.id, item.isolated !== undefined) ?? []);
  }
  isolated(id: string): boolean {
    return this.entries.some((item) => item.id === id && item.isolated === true);
  }
  setIsolated(id: string, isolated: boolean): boolean {
    return (
      this.entries.some((item) => item.id === id) &&
      this.replace(this.entries.map((item) => (item.id === id ? { ...item, isolated } : item)))
    );
  }
  exportText(id: string, window: SavedWindow | null): string | null {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return null;
    const { name, icon } = entry;
    return spaceFileText({ name, icon, isolated: entry.isolated === true, window: window ?? entry.window });
  }
  importText(text: string): string | null {
    const file = parseSpaceFile(text);
    if (!file) return null;
    let name = file.name;
    for (let n = 2; this.entries.some((item) => item.name === name); n++) name = `${file.name.slice(0, 70)} ${n}`;
    return this.add(name, file.window, { icon: file.icon, ...(file.isolated && { isolated: true }) });
  }
  setIcon(id: string, icon: unknown): boolean {
    const valid = workspaceIcon(icon);
    return (
      !!valid &&
      this.entries.some((item) => item.id === id) &&
      this.replace(this.entries.map((item) => (item.id === id ? { ...item, icon: valid } : item)))
    );
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
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || !this.replace(this.entries.filter((item) => item !== entry))) return false;
    const partition = spacePartition(entry.id, entry.isolated !== undefined);
    if (partition) this.forgetPartition(partition);
    return true;
  }
  private add(
    name: unknown,
    window: SavedWindow,
    extra: Pick<Workspace, 'icon' | 'isolated'> = { icon: null },
  ): string | null {
    const valid = tabGroupName(name);
    if (!valid || this.entries.length >= MAX_SPACES || this.entries.some((item) => item.name === valid)) return null;
    const id = randomUUID();
    return this.replace([{ id, name: valid, window, savedAt: Date.now(), ...extra }, ...this.entries]) ? id : null;
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
