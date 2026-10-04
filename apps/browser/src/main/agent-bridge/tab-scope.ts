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
