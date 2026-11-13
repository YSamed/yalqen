import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ExtensionSiteAccess } from '../../shared/types.js';
import { extensionSite } from '../../shared/extension-sites.js';
import { t } from '../../shared/i18n.js';
import { extensionIdOfKey } from './chrome-web-store.js';
import type { Manifest } from './extension-manifest.js';

function intersect(pattern: string, site: string): string | null {
  const selected = new URL(site);
  if (pattern === '<all_urls>') return `${selected.protocol}//${selected.hostname}/*`;
  const match = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!match) return null;
  const [, scheme, host, route] = match;
  if (scheme !== '*' && `${scheme}:` !== selected.protocol) return null;
  const hostname = selected.hostname.toLowerCase();
  const requested = host!.toLowerCase();
  if (
    requested !== '*' &&
    requested !== hostname &&
    !(requested.startsWith('*.') && (hostname === requested.slice(2) || hostname.endsWith(`.${requested.slice(2)}`)))
  )
    return null;
  return `${selected.protocol}//${hostname}${route}`;
}

function hostPattern(value: string): boolean {
  return value === '<all_urls>' || /^(\*|[a-z]+):\/\//i.test(value);
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function restrictedManifest(
  original: Manifest,
  access: ExtensionSiteAccess,
  temporarySites: readonly string[] = [],
): Manifest {
  if (access.mode === 'all') return { ...original };
  const sites =
    access.mode === 'sites'
      ? access.sites
      : temporarySites.map(extensionSite).filter((site): site is string => site !== null);
  const narrow = (patterns: unknown) => [
    ...new Set(strings(patterns).flatMap((pattern) => sites.flatMap((site) => intersect(pattern, site) ?? []))),
  ];
  const permissions = (value: unknown) =>
    strings(value).flatMap((permission) =>
      permission === 'activeTab' ? [] : hostPattern(permission) ? narrow([permission]) : [permission],
    );
  const result: Manifest = { ...original };
  for (const key of ['permissions', 'optional_permissions'])
    if (key in original) result[key] = permissions(original[key]);
  for (const key of ['host_permissions', 'optional_host_permissions'])
    if (key in original) result[key] = narrow(original[key]);
  if (Array.isArray(original.content_scripts))
    result.content_scripts = original.content_scripts.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const script = value as Manifest;
      const matches = narrow(script.matches);
      return matches.length ? [{ ...script, matches }] : [];
    });
  return result;
}

// Chromium derives an unpacked extension's id from the raw bytes of the resolved path. Two details
// have to match exactly or the id is wrong and the extension refuses to load:
// - Byte encoding is platform dependent: base::FilePath::StringType is char16_t on Windows
//   (UTF-16LE) and char on POSIX (UTF-8). Hashing UTF-8 everywhere breaks Windows.
// - Windows uppercases the drive letter before hashing (`c:\...` and `C:\...` are the same id) while
//   directory case is preserved. realpathSync keeps whatever case it was handed.
export function resolvedExtensionPath(directory: string): string {
  const resolved = path.resolve(directory);
  return process.platform === 'win32' ? resolved.replace(/^[a-z]:/, (drive) => drive.toUpperCase()) : resolved;
}

// base64 of the same bytes the id is derived from, so the id stays stable when an extension moves
// between the direct directory and a restricted runtime copy.
function pathBytes(directory: string): Buffer {
  return Buffer.from(resolvedExtensionPath(directory), process.platform === 'win32' ? 'utf16le' : 'utf8');
}

export function extensionIdentity(directory: string, manifest: Manifest): { id: string; key: string } {
  const key =
    typeof manifest.key === 'string' && manifest.key.trim() ? manifest.key : pathBytes(directory).toString('base64');
  return { id: extensionIdOfKey(Buffer.from(key, 'base64')), key };
}

export function runtimeExtensionPath(root: string, directory: string): string {
  return path.join(root, createHash('sha256').update(resolvedExtensionPath(directory)).digest('hex'));
}

export function prepareRestrictedExtension(root: string, directory: string, manifest: Manifest): string {
  const target = runtimeExtensionPath(root, directory);
  if (target.startsWith(resolvedExtensionPath(directory) + path.sep))
    throw new Error(t('extensions.accessPackageFailed'));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(t('extensions.accessPackageFailed'));
  validatePackage(directory);
  const staging = `${target}.${randomUUID()}.tmp`;
  try {
    fs.cpSync(directory, staging, { recursive: true, dereference: false });
    validatePackage(staging);
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    return target;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function validatePackage(directory: string): void {
  let bytes = 0;
  let files = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new Error(t('extensions.accessPackageFailed'));
    if (++files > 50_000 || (bytes += info.isFile() ? info.size : 0) > 128 * 1024 * 1024)
      throw new Error(t('extensions.accessPackageFailed'));
    if (info.isDirectory()) for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
  }
}
