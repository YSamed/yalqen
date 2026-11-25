import fs from 'node:fs';
import type { Extension, Session } from 'electron';
import { JsonFile } from '../storage/json-file.js';

export type InstalledDetails = { reason: 'install' } | { reason: 'update'; previousVersion: string };

export function installedDetails(previous: string | undefined, version: string): InstalledDetails | null {
  if (previous === version) return null;
  return previous === undefined ? { reason: 'install' } : { reason: 'update', previousVersion: previous };
}

// Electron never fires chrome.runtime.onInstalled, and extensions such as Bitwarden set their defaults there.
// Extensions installed before this record existed get "install" once, since they never had it.
export class InstallEvents {
  private readonly versions: Record<string, string>;
  private readonly store: JsonFile;

  constructor(
    session: Session,
    file: string,
    private readonly dispatch: (extensionId: string, details: InstalledDetails) => void,
  ) {
    this.store = new JsonFile(file, 'extension-versions');
    this.versions = this.read(file);
    session.extensions.on('extension-loaded', (_event, extension) => this.loaded(extension));
    for (const extension of session.extensions.getAllExtensions()) this.loaded(extension);
  }

  forget(extensionId: string): void {
    if (!(extensionId in this.versions)) return;
    delete this.versions[extensionId];
    this.store.schedule(() => this.versions);
  }

  private loaded(extension: Extension): void {
    const details = installedDetails(this.versions[extension.id], extension.version);
    if (!details) return;
    this.versions[extension.id] = extension.version;
    this.store.schedule(() => this.versions);
    this.dispatch(extension.id, details);
  }

  private read(file: string): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}
