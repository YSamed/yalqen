import { storageDomain } from '../privacy/site-storage.js';

const MAX_DOMAINS = 100;

export function sanitizeIconDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, MAX_DOMAINS)
        .filter((domain): domain is string => typeof domain === 'string' && domain.length <= 253),
    ),
  ];
}

// History is newest first, so each domain gets the icon from its most recent visit that had one.
export function siteIcons(
  entries: readonly { url: string; faviconUrl?: string }[],
  domains: readonly string[],
): Record<string, string> {
  const wanted = new Set(domains);
  const icons: Record<string, string> = {};
  let found = 0;
  for (const entry of entries) {
    if (found === wanted.size) break;
    if (!entry.faviconUrl?.startsWith('https:')) continue;
    let host: string;
    try {
      host = new URL(entry.url).hostname;
    } catch {
      continue;
    }
    const domain = storageDomain(host);
    if (!wanted.has(domain) || icons[domain]) continue;
    icons[domain] = entry.faviconUrl;
    found++;
  }
  return icons;
}
