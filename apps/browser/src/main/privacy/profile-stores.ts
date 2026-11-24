import fs from 'node:fs';
import path from 'node:path';
import { AutofillStore } from './autofill.js';
import { PasswordStore, type Cipher } from './passwords.js';
import { PermissionStore } from './permissions.js';

const SPACE_PARTITION = /^persist:space-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export interface ProfileData {
  passwords: PasswordStore;
  autofill: AutofillStore;
  permissions: PermissionStore;
}

export function partitionDataProfile(partition: string): string | null {
  return SPACE_PARTITION.exec(partition)?.[1] ?? null;
}

// A space profile with its own partition keeps its own passwords, cards and permissions; null is the shared default.
export class ProfileStores {
  private readonly cache = new Map<string, ProfileData>();

  constructor(
    private readonly root: string,
    private readonly cipher: Cipher,
    readonly shared: ProfileData,
  ) {}

  get(profile: string | null): ProfileData | null {
    if (profile === null) return this.shared;
    const cached = this.cache.get(profile);
    if (cached) return cached;
    const directory = this.directory(profile);
    if (!directory) return null;
    const data = {
      passwords: new PasswordStore(directory, this.cipher),
      autofill: new AutofillStore(directory, this.cipher),
      permissions: new PermissionStore(directory),
    };
    this.cache.set(profile, data);
    return data;
  }

  forget(profile: string): void {
    const directory = this.directory(profile);
    if (!directory) return;
    const data = this.cache.get(profile);
    this.cache.delete(profile);
    if (data) for (const store of [data.passwords, data.permissions]) store.saveNow();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  saveAll(): void {
    for (const data of [this.shared, ...this.cache.values()]) {
      data.passwords.saveNow();
      data.permissions.saveNow();
    }
  }

  private directory(profile: string): string | null {
    return partitionDataProfile(`persist:space-${profile}`) ? path.join(this.root, 'space-data', profile) : null;
  }
}
