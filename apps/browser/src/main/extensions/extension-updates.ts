import type { Manifest } from './extension-manifest.js';

export const EXTENSION_FIRST_CHECK_MS = 60_000;
export const EXTENSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MAX_UPDATE_MANIFEST_BYTES = 256 * 1024;

export function versionParts(version: unknown): number[] | null {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts.every((part) => part <= 65535) ? parts : null;
}

export function newerVersion(candidate: unknown, installed: unknown): boolean {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 4; index++) {
    const difference = (next[index] ?? 0) - (current[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function permissions(manifest: Manifest, optional = false): Set<string> {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  if (optional)
    return new Set([...strings(manifest.optional_permissions), ...strings(manifest.optional_host_permissions)]);
  const matches = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.flatMap((script) => strings(script?.matches))
    : [];
  return new Set([...strings(manifest.permissions), ...strings(manifest.host_permissions), ...matches]);
}

// Conservative: a changed host pattern needs approval even when it may be a narrower grant.
export function addedPermissions(previous: Manifest, next: Manifest): string[] {
  const granted = permissions(previous);
  const previousOptional = permissions(previous, true);
  return [
    ...new Set([
      ...[...permissions(next)].filter((permission) => !granted.has(permission)),
      ...[...permissions(next, true)].filter(
        (permission) => !granted.has(permission) && !previousOptional.has(permission),
      ),
    ]),
  ];
}

export function updateManifestUrl(id: string, version: string, chromeVersion: string): string {
  const query = new URLSearchParams({
    prodversion: chromeVersion,
    acceptformat: 'crx3',
    x: `id=${id}&v=${version}&uc`,
  });
  return `https://clients2.google.com/service/update2/crx?${query}`;
}

interface StoreUpdate {
  version: string;
  url: string;
  sha256: string;
}

// The store returns a small, flat Omaha XML document. Accept just its app/updatecheck
// subset; never expand DTDs or entities. Only a Google HTTPS package URL is accepted.
export function parseStoreUpdate(xml: string, id: string, installed: string): StoreUpdate | null {
  if (Buffer.byteLength(xml) > MAX_UPDATE_MANIFEST_BYTES || /<!/i.test(xml)) throw new Error('Invalid update manifest');
  const attributes = (text: string): Record<string, string> => {
    const found: Record<string, string> = {};
    for (const match of text.matchAll(/([\w:-]+)\s*=\s*(['"])(.*?)\2/gs)) {
      const name = match[1]!;
      if (Object.hasOwn(found, name)) throw new Error('Duplicate update attribute');
      found[name] = match[3]!.replace(/&amp;/g, '&');
    }
    return found;
  };
  for (const app of xml.matchAll(/<app\b([^>]*)>([\s\S]*?)<\/app\s*>/g)) {
    const entry = attributes(app[1]!);
    if (entry.appid !== id) continue;
    const check = /<updatecheck\b([^>]*)\/?\s*>/.exec(app[2]!);
    if (!check) throw new Error('Missing update response');
    const update = attributes(check[1]!);
    if (update.status === 'noupdate') return null;
    if (update.status !== 'ok' || !versionParts(update.version)) throw new Error('Invalid update response');
    if (!newerVersion(update.version, installed)) return null;
    const url = new URL(update.codebase!);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !(url.hostname === 'clients2.googleusercontent.com' || url.hostname === 'clients2.google.com') ||
      !/^[a-f\d]{64}$/i.test(update.hash_sha256 ?? '')
    )
      throw new Error('Invalid update package');
    return { version: update.version!, url: url.href, sha256: update.hash_sha256! };
  }
  throw new Error('Missing extension update');
}

export async function readUpdateManifest(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty update response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPDATE_MANIFEST_BYTES) throw new Error('Update manifest too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
