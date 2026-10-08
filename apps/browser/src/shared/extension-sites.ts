import type { ExtensionSiteAccess } from './types.js';

// Chromium host match patterns apply to all ports of a scheme/hostname pair.
// Keep that scope explicit instead of storing an origin the engine cannot enforce.
export function extensionSite(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

export function parseExtensionAccess(value: unknown): ExtensionSiteAccess | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { mode, sites } = value as { mode?: unknown; sites?: unknown };
  if (!['all', 'sites', 'click'].includes(String(mode)) || !Array.isArray(sites) || sites.length > 100) return null;
  if (mode !== 'sites') return { mode: mode as 'all' | 'click', sites: [] };
  const normalized = sites.map(extensionSite);
  if (normalized.some((site) => site === null)) return null;
  return { mode: 'sites', sites: [...new Set(normalized as string[])].sort() };
}
