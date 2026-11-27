import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readingUrl } from '../../shared/reading-list.js';
import { parseGroupParents, pruneGroupParents, tabGroupName } from '../../shared/tab-groups.js';
import { DEFAULT_SPACE_ID, MAX_SPACES, workspaceIcon } from '../../shared/workspaces.js';
import { spaceFrameTheme } from '../../shared/frame-theme.js';
import type { SavedWindow } from '../tabs/persistence.js';
import { workspaceSnapshot, type SyncedSpace } from './workspaces.js';

export const SYNC_DIRECTORY = 'Yalqen Sync';
const SYNC_FORMAT = 'yalqen-sync';
const MAX_SYNC_FILE_BYTES = 4 * 1024 * 1024;
const PUSH_DELAY_MS = 1500;
const POLL_MS = 30_000;
const MAX_PINS = 200;
const MAX_TOMBSTONES = 200;

export interface SyncedPin {
  url: string;
  title: string;
  group: string | null;
}
export interface SyncedPins {
  tabs: SyncedPin[];
  groupParents: Record<string, string>;
}
export interface SyncState {
  settings: Record<string, unknown>;
  spaces: SyncedSpace[];
  pins: Record<string, SyncedPins>;
}
interface SyncFile {
  device: string;
  savedAt: number;
  state: SyncState;
  deleted: string[];
}
interface SyncMeta {
  device: string;
  folder: string | null;
  since: number;
  hash: string | null;
  spaceIds: string[];
  deleted: string[];
}

const isSpaceId = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 128;
const tombstones = (ids: string[], alive: ReadonlySet<string>): string[] =>
  [...new Set(ids)].filter((id) => !alive.has(id)).slice(-MAX_TOMBSTONES);

export function pinsOf(saved: SavedWindow): SyncedPins {
  const tabs = saved.tabs.flatMap((tab) =>
    tab.pinnedUrl ? [{ url: tab.pinnedUrl, title: tab.title, group: tab.group ?? null }] : [],
  );
  const used = tabs.flatMap((tab) => (tab.group ? [tab.group] : []));
  return { tabs, groupParents: Object.fromEntries(pruneGroupParents(parseGroupParents(saved.groupParents), used)) };
}

export function pinsWindow(pins: SyncedPins): SavedWindow | null {
  return workspaceSnapshot(
    {
      activeTabId: null,
      tabs: pins.tabs.map((pin, index) => ({
        id: String(index),
        url: pin.url,
        title: pin.title,
        faviconUrl: null,
        pinnedUrl: pin.url,
        group: pin.group,
        history: null,
      })),
      groupParents: pins.groupParents,
    },
    true,
  );
}

// Titles change while pages load, so they never count as a change; otherwise two Macs would trade pins forever.
export function samePins(a: SyncedPins, b: SyncedPins): boolean {
  const shape = ({ tabs, groupParents }: SyncedPins) =>
    JSON.stringify([tabs.map(({ url, group }) => [url, group]), Object.entries(groupParents).sort()]);
  return shape(a) === shape(b);
}

export function stateHash(state: SyncState): string {
  const pins = Object.entries(state.pins)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { tabs, groupParents }]) => [
      id,
      tabs.map(({ url, group }) => [url, group]),
      Object.entries(groupParents).sort(),
    ]);
  return createHash('sha256')
    .update(JSON.stringify([state.settings, state.spaces, pins]))
    .digest('hex');
}

function parsePins(value: unknown): SyncedPins | null {
  if (!value || typeof value !== 'object') return null;
  const { tabs, groupParents } = value as Record<string, unknown>;
  if (!Array.isArray(tabs) || tabs.length > MAX_PINS) return null;
  const pins = tabs.flatMap((tab: Record<string, unknown> | null) => {
    const url = readingUrl(tab?.url);
    return url
      ? [
          {
            url,
            title: typeof tab?.title === 'string' ? tab.title.slice(0, 512) : url,
            group: tabGroupName(tab?.group),
          },
        ]
      : [];
  });
  const used = pins.flatMap((pin) => (pin.group ? [pin.group] : []));
  return { tabs: pins, groupParents: Object.fromEntries(pruneGroupParents(parseGroupParents(groupParents), used)) };
}

function parseSpace(value: unknown): SyncedSpace | null {
  if (!value || typeof value !== 'object') return null;
  const space = value as Record<string, unknown>;
  const name = tabGroupName(space.name);
  if (!isSpaceId(space.id) || !name) return null;
  if (typeof space.savedAt !== 'number' || !Number.isFinite(space.savedAt)) return null;
  const theme = spaceFrameTheme(space.theme);
  return {
    id: space.id,
    name,
    icon: workspaceIcon(space.icon),
    isolated: space.isolated === true,
    savedAt: space.savedAt,
    ...(theme && { theme }),
  };
}

export function parseSyncFile(text: string): SyncFile | null {
  if (Buffer.byteLength(text) > MAX_SYNC_FILE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const file = value as Record<string, unknown>;
  if (file.format !== SYNC_FORMAT || file.version !== 1) return null;
  if (typeof file.device !== 'string' || typeof file.savedAt !== 'number' || !Number.isFinite(file.savedAt))
    return null;
  const state = file.state as Record<string, unknown> | null;
  if (!state || typeof state !== 'object') return null;
  const settings = state.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const spaces = Array.isArray(state.spaces)
    ? state.spaces
        .slice(0, MAX_SPACES)
        .flatMap((space) => parseSpace(space) ?? [])
        .filter((space, index, all) => all.findIndex((other) => other.id === space.id) === index)
    : [];
  const known = new Set([DEFAULT_SPACE_ID, ...spaces.map((space) => space.id)]);
  const pins: Record<string, SyncedPins> = {};
  if (state.pins && typeof state.pins === 'object')
    for (const [id, value] of Object.entries(state.pins as Record<string, unknown>)) {
      const parsed = known.has(id) ? parsePins(value) : null;
      if (parsed) pins[id] = parsed;
    }
  return {
    device: file.device,
    savedAt: file.savedAt,
    state: { settings: settings as Record<string, unknown>, spaces, pins },
    deleted: Array.isArray(file.deleted) ? file.deleted.filter(isSpaceId).slice(0, MAX_TOMBSTONES) : [],
  };
}

export function syncFileText(device: string, savedAt: number, state: SyncState, deleted: string[] = []): string {
  return JSON.stringify({ format: SYNC_FORMAT, version: 1, device, savedAt, state, deleted });
}

export function newestRemote(files: SyncFile[], device: string, since: number): SyncFile | null {
  return files.reduce<SyncFile | null>(
    (best, file) =>
      file.device !== device && file.savedAt > since && (!best || file.savedAt > best.savedAt) ? file : best,
    null,
  );
}

export interface FolderSyncOptions {
  directory: string;
  folder(): string | null;
  collect(): SyncState | null;
  apply(state: SyncState, removableSpaces: ReadonlySet<string>): boolean;
  now?(): number;
}

export class FolderSync {
  private meta: SyncMeta;
  private readonly metaFile: string;
  private ready = false;
  private timer: NodeJS.Timeout | null = null;
  private poll: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;

  constructor(private readonly options: FolderSyncOptions) {
    this.metaFile = path.join(options.directory, 'folder-sync.json');
    this.meta = this.readMeta();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private readMeta(): SyncMeta {
    try {
      const value = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) as Partial<SyncMeta>;
      if (typeof value.device === 'string' && /^[0-9a-f-]{36}$/.test(value.device))
        return {
          device: value.device,
          folder: typeof value.folder === 'string' ? value.folder : null,
          since: Number.isFinite(value.since) ? value.since! : 0,
          hash: typeof value.hash === 'string' ? value.hash : null,
          spaceIds: Array.isArray(value.spaceIds) ? value.spaceIds.filter(isSpaceId) : [],
          deleted: Array.isArray(value.deleted) ? value.deleted.filter(isSpaceId).slice(-MAX_TOMBSTONES) : [],
        };
    } catch {}
    return { device: randomUUID(), folder: null, since: 0, hash: null, spaceIds: [], deleted: [] };
  }

  private saveMeta(meta: SyncMeta): void {
    this.meta = meta;
    const temp = `${this.metaFile}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.metaFile), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(meta), { mode: 0o600 });
      fs.renameSync(temp, this.metaFile);
    } catch (error) {
      console.warn('[sync] could not save sync state:', error);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  private syncDirectory(): string | null {
    const folder = this.options.folder();
    return folder ? path.join(folder, SYNC_DIRECTORY) : null;
  }

  // A folder seen for the first time is read before anything is written, so a new Mac never pushes its empty sidebar over the other one.
  start(): void {
    this.stop();
    const directory = this.syncDirectory();
    if (!directory) return;
    if (this.meta.folder !== this.options.folder())
      this.saveMeta({ ...this.meta, folder: this.options.folder(), since: 0, hash: null, spaceIds: [], deleted: [] });
    try {
      fs.mkdirSync(directory, { recursive: true });
      this.watcher = fs.watch(directory, () => this.check());
      this.watcher.on('error', () => this.watcher?.close());
    } catch (error) {
      console.warn('[sync] could not watch the sync folder:', error);
    }
    this.poll = setInterval(() => this.check(), POLL_MS);
    this.poll.unref?.();
    this.check();
    this.ready = true;
    this.push();
  }

  stop(): void {
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
    this.watcher?.close();
    this.timer = this.poll = this.watcher = null;
  }

  changed(): void {
    if (!this.ready) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), PUSH_DELAY_MS);
  }

  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.push();
  }

  // shortcut: reads run on the main process, so a cloud file still downloading can stall them briefly; move to fs.promises if that shows up.
  private readRemotes(directory: string): SyncFile[] {
    let names: string[];
    try {
      names = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      try {
        const file = path.join(directory, name);
        if (fs.statSync(file).size > MAX_SYNC_FILE_BYTES) return [];
        return parseSyncFile(fs.readFileSync(file, 'utf8')) ?? [];
      } catch {
        return [];
      }
    });
  }

  check(): void {
    const directory = this.syncDirectory();
    if (!directory) return;
    const remote = newestRemote(this.readRemotes(directory), this.meta.device, this.meta.since);
    // Only Spaces another Mac deleted on purpose go; one merely missing from its file may not have reached it yet.
    if (!remote || !this.options.apply(remote.state, new Set(remote.deleted))) return;
    const local = this.options.collect();
    const spaceIds = (local ?? remote.state).spaces.map((space) => space.id);
    this.saveMeta({
      ...this.meta,
      since: remote.savedAt,
      hash: local && stateHash(local),
      spaceIds,
      deleted: tombstones([...this.meta.deleted, ...remote.deleted], new Set(spaceIds)),
    });
  }

  push(): void {
    this.timer = null;
    const directory = this.syncDirectory();
    const state = directory && this.ready ? this.options.collect() : null;
    if (!directory || !state) return;
    const hash = stateHash(state);
    if (hash === this.meta.hash) return;
    const savedAt = Math.max(this.now(), this.meta.since + 1);
    const spaceIds = state.spaces.map((space) => space.id);
    const deleted = tombstones([...this.meta.deleted, ...this.meta.spaceIds], new Set(spaceIds));
    const file = path.join(directory, `${this.meta.device}.json`);
    const temp = path.join(directory, `.${this.meta.device}.${randomUUID()}.tmp`);
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temp, syncFileText(this.meta.device, savedAt, state, deleted), { mode: 0o600 });
      fs.renameSync(temp, file);
      this.saveMeta({ ...this.meta, since: savedAt, hash, spaceIds, deleted });
    } catch (error) {
      console.warn('[sync] could not write the sync file:', error);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}
