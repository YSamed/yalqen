import { isDevelopmentHost } from '../../shared/hosts.js';

interface ScopeCandidate {
  url: string;
  isPrivate: boolean;
}

export function isInScope(tab: ScopeCandidate, allowedOrigins: readonly string[] = []): boolean {
  if (tab.isPrivate) return false;
  let parsed: URL;
  try {
    parsed = new URL(tab.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return isDevelopmentHost(parsed.hostname) || allowedOrigins.includes(parsed.origin);
}

export function normalizeOrigin(input: string): string | null {
  try {
    const parsed = new URL(input.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const MAX_AGENT_ORIGINS = 20;

export function sanitizeAgentOrigins(values: readonly unknown[]): string[] {
  const origins = values.map((value) => (typeof value === 'string' ? normalizeOrigin(value) : null));
  return [...new Set(origins.filter((origin) => origin !== null))].slice(0, MAX_AGENT_ORIGINS);
}

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

// A project sees the tabs of origins it claimed. Until it claims one, it sees every tab no other
// project in the window claimed, so a window with a single project works as before.
export function projectIncludes(
  claimed: ReadonlySet<string>,
  claimedByOthers: readonly ReadonlySet<string>[],
  url: string,
): boolean {
  const origin = originOf(url);
  if (!origin) return false;
  if (claimed.size > 0) return claimed.has(origin);
  return !claimedByOthers.some((origins) => origins.has(origin));
}
