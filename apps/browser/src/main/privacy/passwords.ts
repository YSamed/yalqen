import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PasswordsView, SubmittedCredential } from '../../shared/types.js';
import { JsonFile } from '../storage/json-file.js';

const MAX_USERNAME_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 4096;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface Cipher {
  available(): boolean;
  encrypt(text: string): string;
  decrypt(secret: string): string;
}

export type SaveOffer = 'save' | 'update';

interface SavedPassword {
  id: string;
  origin: string;
  username: string;
  secret: string;
  createdAt: number;
  updatedAt: number;
}

interface SavedPasswords {
  version: 1;
  passwords: SavedPassword[];
  neverSave: string[];
}

export function passwordOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return parsed.origin;
    return parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function sanitizeCredential(value: unknown): SubmittedCredential | null {
  if (typeof value !== 'object' || value === null) return null;
  const { username, password } = value as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const trimmed = username.trim();
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH || trimmed.length > MAX_USERNAME_LENGTH) {
    return null;
  }
  return { username: trimmed, password };
}

function sanitizeSaved(value: unknown): SavedPassword | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  const { id, origin, username, secret, createdAt, updatedAt } = entry;
  if (typeof id !== 'string' || typeof origin !== 'string' || passwordOrigin(origin) !== origin) return null;
  if (typeof username !== 'string' || typeof secret !== 'string' || secret.length === 0) return null;
  if (typeof createdAt !== 'number' || typeof updatedAt !== 'number') return null;
  return { id, origin, username, secret, createdAt, updatedAt };
}

export class PasswordStore {
  readonly file: string | null;
  private readonly json: JsonFile | null;
  private passwords: SavedPassword[] = [];
  private readonly never = new Set<string>();

  constructor(
    directory: string | null,
    private readonly cipher: Cipher,
  ) {
    this.file = directory === null ? null : path.join(directory, 'passwords.json');
    this.json = this.file === null ? null : new JsonFile(this.file, 'passwords');
    this.load();
  }

  offer(origin: string, credential: SubmittedCredential): SaveOffer | null {
    if (this.never.has(origin) || !this.cipher.available()) return null;
    const existing = this.find(origin, credential.username);
    if (!existing) return 'save';
    return this.decrypt(existing) === credential.password ? null : 'update';
  }

  save(origin: string, credential: SubmittedCredential, now = Date.now()): void {
    const secret = this.cipher.encrypt(credential.password);
    const existing = this.find(origin, credential.username);
    if (existing) {
      existing.secret = secret;
      existing.updatedAt = now;
    } else {
      this.passwords.push({
        id: randomUUID(),
        origin,
        username: credential.username,
        secret,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.persist();
  }

  saveManual(value: unknown): boolean {
    if (!value || typeof value !== 'object' || !this.cipher.available()) return false;
    const input = value as Record<string, unknown>;
    if (input.id !== null && typeof input.id !== 'string') return false;
    const existing = typeof input.id === 'string' ? this.passwords.find(({ id }) => id === input.id) : undefined;
    if (input.id !== null && !existing) return false;
    const origin = typeof input.url === 'string' ? passwordOrigin(input.url) : null;
    if (!origin || typeof input.username !== 'string' || typeof input.password !== 'string') return false;
    if (input.username.trim().length > MAX_USERNAME_LENGTH) return false;
    const credential = sanitizeCredential(input);
    if (!credential && (!existing || input.password !== '')) return false;
    const username = input.username.trim();
    if (this.passwords.some((entry) => entry !== existing && entry.origin === origin && entry.username === username))
      return false;
    const secret = credential ? this.cipher.encrypt(credential.password) : existing!.secret;
    const now = Date.now();
    if (existing) Object.assign(existing, { origin, username, secret, updatedAt: now });
    else this.passwords.push({ id: randomUUID(), origin, username, secret, createdAt: now, updatedAt: now });
    this.persist();
    this.saveNow();
    return true;
  }

  importCredentials(records: readonly (SubmittedCredential & { origin: string })[]): {
    added: number;
    skipped: number;
  } {
    if (!this.cipher.available()) throw new Error('Encrypted storage unavailable');
    const known = new Set(this.passwords.map(({ origin, username }) => JSON.stringify([origin, username])));
    const additions: SavedPassword[] = [];
    let skipped = 0;
    const now = Date.now();
    for (const record of records) {
      const credential = sanitizeCredential(record);
      const origin = passwordOrigin(record.origin);
      const key = JSON.stringify([origin, credential?.username]);
      if (!credential || !origin || known.has(key) || this.passwords.length + additions.length >= 10000) {
        skipped++;
        continue;
      }
      const secret = this.cipher.encrypt(credential.password);
      additions.push({
        id: randomUUID(),
        origin,
        ...{ username: credential.username },
        secret,
        createdAt: now,
        updatedAt: now,
      });
      known.add(key);
    }
    this.passwords.push(...additions);
    if (additions.length) {
      this.persist();
      this.saveNow();
    }
    return { added: additions.length, skipped };
  }

  exportCredentials(): (SubmittedCredential & { origin: string })[] {
    if (!this.cipher.available()) throw new Error('Encrypted storage unavailable');
    return this.passwords.map((entry) => {
      const password = this.decrypt(entry);
      if (password === null) throw new Error('A saved password could not be decrypted');
      return { origin: entry.origin, username: entry.username, password };
    });
  }

  neverSave(origin: string): void {
    this.never.add(origin);
    this.persist();
  }

  allowSaving(origin: string): void {
    if (this.never.delete(origin)) this.persist();
  }

  remove(id: string): void {
    const count = this.passwords.length;
    this.passwords = this.passwords.filter((entry) => entry.id !== id);
    if (this.passwords.length !== count) this.persist();
  }

  logins(origin: string): SubmittedCredential[] {
    return this.passwords
      .filter((entry) => entry.origin === origin)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap((entry) => {
        const password = this.decrypt(entry);
        return password === null ? [] : [{ username: entry.username, password }];
      });
  }

  choices(origin: string): { id: string; username: string }[] {
    if (!this.cipher.available()) return [];
    return this.passwords
      .filter((entry) => entry.origin === origin)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, username }) => ({ id, username }));
  }

  login(origin: string, id: string): SubmittedCredential | null {
    if (!this.cipher.available()) return null;
    const entry = this.passwords.find((candidate) => candidate.id === id && candidate.origin === origin);
    if (!entry) return null;
    const password = this.decrypt(entry);
    return password === null ? null : { username: entry.username, password };
  }

  reveal(id: string): string | null {
    const entry = this.passwords.find((candidate) => candidate.id === id);
    return entry ? this.decrypt(entry) : null;
  }

  view(): PasswordsView {
    return {
      available: this.cipher.available(),
      passwords: [...this.passwords]
        .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
        .map(({ id, origin, username, updatedAt }) => ({ id, origin, username, updatedAt })),
      neverSave: [...this.never].sort(),
    };
  }

  saveNow(): void {
    this.json?.flush();
  }

  private find(origin: string, username: string): SavedPassword | undefined {
    return this.passwords.find((entry) => entry.origin === origin && entry.username === username);
  }

  private decrypt(entry: SavedPassword): string | null {
    try {
      return this.cipher.decrypt(entry.secret);
    } catch {
      return null;
    }
  }

  private load(): void {
    if (this.file === null) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SavedPasswords;
      if (data.version !== 1) return;
      if (Array.isArray(data.passwords)) {
        this.passwords = data.passwords.flatMap((value) => sanitizeSaved(value) ?? []);
      }
      if (Array.isArray(data.neverSave)) {
        for (const origin of data.neverSave) {
          if (typeof origin === 'string' && passwordOrigin(origin) === origin) this.never.add(origin);
        }
      }
    } catch {}
  }

  private persist(): void {
    this.json?.schedule((): SavedPasswords => ({ version: 1, passwords: this.passwords, neverSave: [...this.never] }));
  }
}
