import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WebAppInfo } from '../../shared/web-apps.js';
import { webAppContains } from '../../shared/web-apps.js';
import { readingUrl } from '../../shared/reading-list.js';
import { tabGroupName } from '../../shared/tab-groups.js';
import { passwordOrigin } from '../privacy/passwords.js';
export type WebAppManifest = Omit<WebAppInfo, 'id'>;
function secureUrl(value: unknown): string | null {
  const url = readingUrl(value);
  return url && passwordOrigin(url) ? url : null;
}
function validate(value: unknown): WebAppManifest | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as WebAppManifest,
    name = tabGroupName(item.name),
    startUrl = secureUrl(item.startUrl),
    scope = secureUrl(item.scope),
    manifestId = secureUrl(item.manifestId);
  if (
    !name ||
    !startUrl ||
    !scope ||
    !manifestId ||
    new URL(manifestId).origin !== new URL(startUrl).origin ||
    !webAppContains(scope, startUrl)
  )
    return null;
  const scopeUrl = new URL(scope);
  scopeUrl.search = '';
  scopeUrl.hash = '';
  const identity = new URL(manifestId);
  identity.hash = '';
  return { name, startUrl, scope: scopeUrl.href, manifestId: identity.href };
}
export function parseWebAppManifest(value: unknown, pageUrl: string): WebAppManifest | null {
  if (!value || typeof value !== 'object' || !secureUrl(pageUrl)) return null;
  const result = value as {
    data?: unknown;
    url?: unknown;
    errors?: unknown;
    manifest?: {
      name?: unknown;
      shortName?: unknown;
      display?: unknown;
      id?: unknown;
      startUrl?: unknown;
      scope?: unknown;
    };
  };
  if (
    typeof result.data !== 'string' ||
    !result.data ||
    result.data.length > 1024 * 1024 ||
    !secureUrl(result.url) ||
    !result.manifest ||
    !['kStandalone', 'kMinimalUi', 'kFullscreen'].includes(String(result.manifest.display))
  )
    return null;
  const manifest = result.manifest;
  const valid = validate({
    name: manifest.name ?? manifest.shortName,
    manifestId: manifest.id,
    startUrl: manifest.startUrl,
    scope: manifest.scope,
  });
  return valid && new URL(valid.startUrl).origin === new URL(pageUrl).origin ? valid : null;
}
export class WebAppStore {
  readonly file: string;
  private entries: WebAppInfo[] = [];
  constructor(directory: string) {
    this.file = path.join(directory, 'web-apps.json');
    try {
      if (fs.statSync(this.file).size > 1024 * 1024) return;
      const values: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(values)) return;
      for (const value of values.slice(0, 50)) {
        const manifest = validate(value),
          id = value?.id;
        if (
          manifest &&
          typeof id === 'string' &&
          id.length <= 128 &&
          !this.entries.some((item) => item.id === id || item.manifestId === manifest.manifestId)
        )
          this.entries.push({ id, ...manifest });
      }
    } catch {}
  }
  list(): WebAppInfo[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
  install(value: WebAppManifest): WebAppInfo | null {
    const manifest = validate(value);
    if (!manifest) return null;
    const existing = this.entries.find((item) => item.manifestId === manifest.manifestId);
    if (existing) return { ...existing };
    if (this.entries.length >= 50) return null;
    const entry = { id: randomUUID(), ...manifest };
    return this.replace([...this.entries, entry]) ? { ...entry } : null;
  }
  remove(id: string): boolean {
    return this.entries.some((item) => item.id === id) && this.replace(this.entries.filter((item) => item.id !== id));
  }
  private replace(entries: WebAppInfo[]): boolean {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
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
