export interface SpaceRule {
  host: string;
  path: string;
  space: string;
}

export const MAX_SPACE_RULES = 50;
const MAX_PATH = 200;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function ruleHost(value: unknown): string | null {
  if (typeof value !== 'string' || /[\s/:@?#\\%]/.test(value.trim())) return null;
  try {
    const host = new URL(`https://${value.trim()}`).hostname.replace(/\.$/, '');
    return host.length <= 253 && HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

function rulePath(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/\/+$/, '');
  if (path === '') return '';
  return path.startsWith('/') && path.length <= MAX_PATH && !/[\s?#]/.test(path) ? path : null;
}

export function normalizeSpaceRule(value: unknown): SpaceRule | null {
  const rule = value as Partial<Record<keyof SpaceRule, unknown>> | null;
  const host = ruleHost(rule?.host),
    path = rulePath(rule?.path),
    space = rule?.space;
  return host && path !== null && typeof space === 'string' && space.length <= 128 ? { host, path, space } : null;
}

export function sanitizeSpaceRules(values: readonly unknown[]): SpaceRule[] {
  const rules = new Map<string, SpaceRule>();
  for (const value of values) {
    const rule = normalizeSpaceRule(value);
    if (rule && !rules.has(rule.host + rule.path)) rules.set(rule.host + rule.path, rule);
    if (rules.size === MAX_SPACE_RULES) break;
  }
  return [...rules.values()];
}

// The most specific rule wins, so the order of the list never matters.
export function spaceForUrl(rules: readonly SpaceRule[], url: string, spaces: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  let best: SpaceRule | null = null;
  for (const rule of rules) {
    const hostMatches = host === rule.host || host.endsWith(`.${rule.host}`);
    const pathMatches =
      rule.path === '' || parsed.pathname === rule.path || parsed.pathname.startsWith(`${rule.path}/`);
    if (!hostMatches || !pathMatches || !spaces.includes(rule.space)) continue;
    const longer = rule.path.length - (best?.path.length ?? -1) || rule.host.length - (best?.host.length ?? -1);
    if (longer > 0) best = rule;
  }
  return best?.space ?? null;
}
