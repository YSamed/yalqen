import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ProfilesView } from '../../shared/types.js';

export const DEFAULT_PROFILE_ID = 'default';
export const PROFILE_FLAG = '--yalqen-profile=';
const MAX_PROFILES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
interface Profile {
  id: string;
  name: string;
}
interface Registry {
  defaultId: string;
  profiles: Profile[];
}

export class ProfileError extends Error {
  constructor(readonly kind: 'invalid-name' | 'missing' | 'busy' | 'protected' | 'failed') {
    super(kind);
  }
}

export function profileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && name.length <= 80 && [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    ? name
    : null;
}

export function profileArguments(args: readonly string[], id: string): string[] {
  return [...args.filter((arg) => !arg.startsWith(PROFILE_FLAG)), `${PROFILE_FLAG}${id}`];
}

export function initializeProfile(
  registry: ProfileRegistry,
  args: readonly string[],
  host: {
    setPath(name: 'userData' | 'sessionData', directory: string): void;
    requestSingleInstanceLock(data: Record<string, string>): boolean;
  },
): { profile: Profile; primary: boolean } {
  return registry.activate(args, (directory, profileId) => {
    host.setPath('userData', directory);
    host.setPath('sessionData', directory);
    return host.requestSingleInstanceLock({ profileId });
  });
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

// Processes share only metadata. SQLite transactions serialize activation, creation and
// deletion so a profile cannot start while another process removes its data directory.
export class ProfileRegistry {
  readonly file: string;
  private readonly db: DatabaseSync;
  private runtime: { id: string; token: string } | null = null;
  constructor(
    readonly root: string,
    defaultName: string,
  ) {
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, 'browser-profiles.sqlite');
    this.db = new DatabaseSync(this.file);
    fs.chmodSync(this.file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=2000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtimes (profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE, pid INTEGER NOT NULL, token TEXT NOT NULL);`);
    this.locked(() => {
      this.db.prepare('INSERT OR IGNORE INTO profiles VALUES (?, ?)').run(DEFAULT_PROFILE_ID, defaultName);
      this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('defaultId', DEFAULT_PROFILE_ID);
    });
  }

  view(currentId: string): ProfilesView {
    return this.locked(() => {
      const data = this.read();
      return {
        currentId,
        profiles: data.profiles.map((profile) => ({
          ...profile,
          active: profile.id === currentId,
          default: profile.id === data.defaultId,
          running: this.isRunning(profile.id),
        })),
      };
    });
  }

  activate(
    args: readonly string[],
    acquire: (directory: string, id: string) => boolean,
  ): { profile: Profile; primary: boolean } {
    return this.locked(() => {
      const data = this.read();
      const flags = args.filter((arg) => arg.startsWith(PROFILE_FLAG));
      if (flags.length > 1) throw new ProfileError('missing');
      const id = flags[0]?.slice(PROFILE_FLAG.length) ?? data.defaultId;
      const profile = data.profiles.find((entry) => entry.id === id);
      if (!profile) throw new ProfileError('missing');
      const directory = this.directory(id);
      fs.mkdirSync(directory, { recursive: true });
      const primary = acquire(directory, id);
      if (primary) {
        const token = randomUUID();
        this.db.prepare('INSERT OR REPLACE INTO runtimes VALUES (?, ?, ?)').run(id, process.pid, token);
        this.runtime = { id, token };
      }
      return { profile: { ...profile }, primary };
    });
  }

  create(value: unknown): Profile {
    return this.locked(() => {
      const name = profileName(value);
      if (!name) throw new ProfileError('invalid-name');
      const data = this.read();
      if (data.profiles.length >= MAX_PROFILES) throw new ProfileError('busy');
      const profile = { id: randomUUID(), name };
      fs.mkdirSync(this.directory(profile.id), { recursive: true });
      this.db.prepare('INSERT INTO profiles VALUES (?, ?)').run(profile.id, name);
      return { ...profile };
    });
  }

  rename(id: unknown, value: unknown): void {
    this.locked(() => {
      const name = profileName(value);
      if (!name) throw new ProfileError('invalid-name');
      const profile = this.read().profiles.find((entry) => entry.id === id);
      if (!profile) throw new ProfileError('missing');
      this.db.prepare('UPDATE profiles SET name=? WHERE id=?').run(name, profile.id);
    });
  }

  makeDefault(id: unknown): void {
    this.locked(() => {
      const profile = this.read().profiles.find((entry) => entry.id === id);
      if (!profile) throw new ProfileError('missing');
      this.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(profile.id, 'defaultId');
    });
  }

  remove(id: unknown, currentId: string): void {
    this.locked(() => {
      if (id === DEFAULT_PROFILE_ID || id === currentId) throw new ProfileError('protected');
      const data = this.read();
      const profile = data.profiles.find((entry) => entry.id === id);
      if (!profile) throw new ProfileError('missing');
      if (this.isRunning(profile.id)) throw new ProfileError('busy');
      fs.rmSync(this.directory(profile.id), { recursive: true, force: true });
      if (data.defaultId === profile.id)
        this.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(DEFAULT_PROFILE_ID, 'defaultId');
      this.db.prepare('DELETE FROM profiles WHERE id=?').run(profile.id);
    });
  }

  release(): void {
    const runtime = this.runtime;
    if (!runtime) return;
    this.locked(() => {
      this.db.prepare('DELETE FROM runtimes WHERE profile_id=? AND token=?').run(runtime.id, runtime.token);
    });
    this.runtime = null;
  }

  // Keep the PID record until the process exits. Clearing it in will-quit would let
  // another profile delete storage while Chromium is still flushing its session.
  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  directory(id: string): string {
    if (id === DEFAULT_PROFILE_ID) return this.root;
    if (!UUID.test(id)) throw new ProfileError('missing');
    const directory = path.join(this.root, 'profiles', id);
    for (const parent of [path.dirname(directory), directory]) {
      try {
        if (fs.lstatSync(parent).isSymbolicLink()) throw new ProfileError('failed');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return directory;
  }

  private isRunning(id: string): boolean {
    const row = this.db.prepare('SELECT pid FROM runtimes WHERE profile_id=?').get(id);
    return alive(Number(row?.pid ?? 0));
  }

  private read(): Registry {
    const profiles = this.db.prepare('SELECT id, name FROM profiles ORDER BY rowid').all() as unknown as Profile[];
    const defaultId = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('defaultId')?.value;
    if (
      profiles.length > MAX_PROFILES ||
      typeof defaultId !== 'string' ||
      !profiles.every(
        (entry) => (entry.id === DEFAULT_PROFILE_ID || UUID.test(entry.id)) && profileName(entry.name) === entry.name,
      ) ||
      !profiles.some(({ id }) => id === DEFAULT_PROFILE_ID) ||
      !profiles.some(({ id }) => id === defaultId)
    )
      throw new ProfileError('failed');
    return { defaultId, profiles };
  }

  private locked<T>(run: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
    } catch {
      throw new ProfileError('busy');
    }
    try {
      const value = run();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
