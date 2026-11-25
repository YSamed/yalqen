import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readingUrl } from '../../shared/reading-list.js';
import { parseGroupParents, pruneGroupParents, tabGroupName } from '../../shared/tab-groups.js';
import { MAX_SPACES, workspaceIcon, type SpaceView, type WorkspaceSummary } from '../../shared/workspaces.js';
import { spaceFrameTheme, type FrameTheme } from '../../shared/frame-theme.js';
import type { SavedWindow, SavedTab } from '../tabs/persistence.js';

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  savedAt: number;
  window: SavedWindow;
  isolated?: boolean;
  profile?: string;
  theme?: FrameTheme;
}
interface ProfileFile {
  default: string | null;
  known: string[];
}
export interface SpaceProfile {
  id: string;
  spaceIds: string[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isProfileId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const profileOf = (entry: Workspace): string | null => entry.profile ?? (entry.isolated === true ? entry.id : null);
const SPACE_FILE_FORMAT = 'yalqen-space';
const MAX_SPACE_FILE_BYTES = 2 * 1024 * 1024;
export interface SpaceFile {
  name: string;
  icon: string | null;
  isolated: boolean;
  window: SavedWindow;
  theme?: FrameTheme;
  isDefault?: boolean;
}
export function spacePartition(id: string, isolated: boolean): string | null {
  return isolated && UUID.test(id) ? `persist:space-${id}` : null;
}
export function spaceFileText({ name, icon, isolated, window, theme, isDefault }: SpaceFile): string | null {
  const snapshot = workspaceSnapshot(window, true);
  return (
    snapshot &&
    JSON.stringify({
      format: SPACE_FILE_FORMAT,
      version: 1,
      name,
      icon,
      isolated,
      theme,
      ...(isDefault && { default: true }),
      window: snapshot,
    })
  );
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
  if (!name || !window) return null;
  const theme = spaceFrameTheme(file.theme);
  return {
    name,
    icon: workspaceIcon(file.icon),
    isolated: file.isolated === true,
    window,
    ...(theme && { theme }),
    ...(file.default === true && { isDefault: true }),
  };
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
  private readonly profileFile: string;
  private profileState: ProfileFile = { default: null, known: [] };
  constructor(
    directory: string,
    private readonly forgetPartition: (partition: string) => void = () => {},
  ) {
    this.file = path.join(directory, 'workspaces.json');
    this.profileFile = path.join(directory, 'space-profiles.json');
    try {
      const value = JSON.parse(fs.readFileSync(this.profileFile, 'utf8')) as Partial<ProfileFile>;
      this.profileState = {
        default: isProfileId(value.default) ? value.default : null,
        known: Array.isArray(value.known) ? [...new Set(value.known.filter(isProfileId))].slice(0, 200) : [],
      };
    } catch {}
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
            ...(isProfileId(entry.profile) && { profile: entry.profile }),
            ...(spaceFrameTheme(entry.theme) && { theme: spaceFrameTheme(entry.theme) }),
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
    return this.entries
      .toSorted((a, b) => a.savedAt - b.savedAt)
      .map(({ id, name, icon, theme }) => ({ id, name, icon, ...(theme && { theme }) }));
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
  profile(id: string): string | null {
    if (id === '') return this.profileState.default;
    const entry = this.entries.find((item) => item.id === id);
    return entry ? profileOf(entry) : null;
  }
  partition(id: string): string | null {
    const profile = this.profile(id);
    return profile && spacePartition(profile, true);
  }
  storedPartitions(): string[] {
    const ids = new Set([
      ...this.profileState.known,
      ...(this.profileState.default ? [this.profileState.default] : []),
      ...this.entries.flatMap((item) => [
        ...(item.isolated !== undefined ? [item.id] : []),
        ...(item.profile ? [item.profile] : []),
      ]),
    ]);
    return [...ids].flatMap((id) => spacePartition(id, true) ?? []);
  }
  profiles(): SpaceProfile[] {
    const byProfile = new Map<string, string[]>();
    const use = (profile: string | null, spaceId: string) => {
      if (profile) byProfile.set(profile, [...(byProfile.get(profile) ?? []), spaceId]);
    };
    use(this.profileState.default, '');
    for (const entry of this.entries.toSorted((a, b) => a.savedAt - b.savedAt)) use(profileOf(entry), entry.id);
    return [...byProfile].map(([id, spaceIds]) => ({ id, spaceIds }));
  }
  isolated(id: string): boolean {
    return this.profile(id) !== null;
  }
  setIsolated(id: string, isolated: boolean): boolean {
    return this.setProfile(id, isolated ? (this.profile(id) ?? (id === '' ? 'new' : id)) : null);
  }
  setProfile(id: string, profile: string | null | 'new'): boolean {
    const known = profile === null || profile === 'new' || profile === id;
    if (!known && !this.profiles().some((item) => item.id === profile)) return false;
    const next = profile === 'new' ? randomUUID() : profile;
    if (id === '') {
      if (!this.saveProfiles({ ...this.profileState, default: next })) return false;
    } else {
      const entry = this.entries.find((item) => item.id === id);
      if (!entry) return false;
      const { profile: _old, ...rest } = entry;
      const own = next === entry.id;
      const updated: Workspace = {
        ...rest,
        ...((own || entry.isolated !== undefined) && { isolated: own }),
        ...(next && { profile: next }),
      };
      if (!this.replace(this.entries.map((item) => (item === entry ? updated : item)))) return false;
    }
    if (next && !this.profileState.known.includes(next))
      this.saveProfiles({ ...this.profileState, known: [...this.profileState.known, next] });
    return true;
  }
  exportText(id: string, window: SavedWindow | null): string | null {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return null;
    const { name, icon, theme } = entry;
    return spaceFileText({ name, icon, isolated: profileOf(entry) !== null, window: window ?? entry.window, theme });
  }
  importText(text: string): string | null {
    const file = parseSpaceFile(text);
    if (!file) return null;
    let name = file.name;
    for (let n = 2; this.entries.some((item) => item.name === name); n++) name = `${file.name.slice(0, 70)} ${n}`;
    return this.add(name, file.window, {
      icon: file.icon,
      ...(file.isolated && { isolated: true }),
      ...(file.theme && { theme: file.theme }),
    });
  }
  setTheme(id: string, value: unknown): boolean {
    if (!this.entries.some((item) => item.id === id)) return false;
    const theme = spaceFrameTheme(value);
    return this.replace(
      this.entries.map((item) => {
        if (item.id !== id) return item;
        const { theme: _previous, ...rest } = item;
        return theme ? { ...rest, theme } : rest;
      }),
    );
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
    this.forgetUnused([profileOf(entry), entry.isolated !== undefined ? entry.id : null]);
    return true;
  }
  private forgetUnused(candidates: (string | null)[]): void {
    const used = new Set(this.profiles().map((item) => item.id));
    const unused = [...new Set(candidates)].filter((id): id is string => !!id && !used.has(id));
    if (unused.length === 0) return;
    this.saveProfiles({ ...this.profileState, known: this.profileState.known.filter((id) => !unused.includes(id)) });
    for (const id of unused) {
      const partition = spacePartition(id, true);
      if (partition) this.forgetPartition(partition);
    }
  }
  private saveProfiles(state: ProfileFile): boolean {
    const temp = `${this.profileFile}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.profileFile), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(temp, this.profileFile);
      this.profileState = state;
      return true;
    } catch {
      return false;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  private add(
    name: unknown,
    window: SavedWindow,
    extra: Pick<Workspace, 'icon' | 'isolated' | 'theme'> = { icon: null },
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
