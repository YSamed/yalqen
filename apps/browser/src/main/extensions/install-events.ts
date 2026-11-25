import fs from 'node:fs';
import type { Extension, Session } from 'electron';
import { JsonFile } from '../storage/json-file.js';

export type InstalledDetails = { reason: 'install' } | { reason: 'update'; previousVersion: string };

export function installedDetails(previous: string | undefined, version: string): InstalledDetails | null {
  if (previous === version) return null;
  return previous === undefined ? { reason: 'install' } : { reason: 'update', previousVersion: previous };
}

// Electron never fires chrome.runtime.onInstalled, and extensions such as Bitwarden set their defaults there.
export class InstallEvents {
  private readonly versions: Record<string, string>;
  private readonly store: JsonFile;
  // shortcut: the first launch with this file only records versions, and a reinstall of the same version sends nothing; forget the version on uninstall if an extension needs that.
  private readonly seeding: boolean;

  constructor(
    session: Session,
    file: string,
    private readonly dispatch: (extensionId: string, details: InstalledDetails) => void,
  ) {
    this.store = new JsonFile(file, 'extension-versions');
    this.seeding = !fs.existsSync(file);
    this.versions = this.read(file);
    session.extensions.on('extension-loaded', (_event, extension) => this.loaded(extension));
    for (const extension of session.extensions.getAllExtensions()) this.loaded(extension);
    if (this.seeding) this.store.schedule(() => this.versions);
  }

  private loaded(extension: Extension): void {
    const details = installedDetails(this.versions[extension.id], extension.version);
    if (!details) return;
    this.versions[extension.id] = extension.version;
    this.store.schedule(() => this.versions);
    if (!this.seeding) this.dispatch(extension.id, details);
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
