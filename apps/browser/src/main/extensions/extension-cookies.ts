import type { Cookie, Cookies, CookiesSetDetails } from 'electron';

export interface ExtensionGrant {
  permissions: readonly string[];
  hosts: readonly string[];
}

export function extensionGrant(manifest: unknown): ExtensionGrant {
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const { permissions, host_permissions: hosts } = (manifest ?? {}) as Record<string, unknown>;
  const all = strings(permissions);
  return {
    permissions: all,
    hosts: [
      ...strings(hosts),
      ...all.filter((permission) => permission.includes('://') || permission === '<all_urls>'),
    ],
  };
}

export function hostPermitted(patterns: readonly string[], url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  const hostname = target.hostname.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern === '<all_urls>') return true;
    const match = /^(\*|https?):\/\/([^/]*)\//.exec(pattern);
    if (!match) return false;
    const [, scheme, host] = match;
    if (scheme !== '*' && `${scheme}:` !== target.protocol) return false;
    const wanted = host!.toLowerCase();
    if (wanted === '*' || wanted === hostname) return true;
    return wanted.startsWith('*.') && (hostname === wanted.slice(2) || hostname.endsWith(wanted.slice(1)));
  });
}

export function cookieUrl(cookie: Pick<Cookie, 'domain' | 'path' | 'secure'>): string {
  const host = (cookie.domain ?? '').replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`;
}

const CAUSES: Record<string, string> = {
  inserted: 'explicit',
  explicit: 'explicit',
  overwrite: 'overwrite',
  expired: 'expired',
  evicted: 'evicted',
  'expired-overwrite': 'expired_overwrite',
};

export function chromeCookieChange(
  cookie: Cookie,
  cause: string,
  removed: boolean,
): { cookie: Cookie & { storeId: string }; cause: string; removed: boolean } | null {
  const chromeCause = CAUSES[cause];
  return chromeCause ? { cookie: chromeCookie(cookie), cause: chromeCause, removed } : null;
}

function chromeCookie(cookie: Cookie): Cookie & { storeId: string } {
  return { ...cookie, storeId: '0' };
}

function details(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid cookie details');
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Cookie ${name} must be a string`);
  return value;
}

function optionalText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : text(value, name);
}

// Chrome's cookies API, limited to the hosts the extension may access, as Chrome limits it.
export async function callCookies(
  cookies: Cookies,
  grant: ExtensionGrant,
  method: unknown,
  raw: unknown,
): Promise<unknown> {
  if (!grant.permissions.includes('cookies')) throw new Error('The "cookies" permission is required');
  const allowed = (url: string) => hostPermitted(grant.hosts, url);
  const permittedUrl = (value: unknown) => {
    const url = text(value, 'url');
    if (!allowed(url)) throw new Error(`No host permission for cookies at url: "${url}"`);
    return url;
  };
  const input = details(raw);
  switch (method) {
    case 'get': {
      const url = permittedUrl(input.url);
      const found = await cookies.get({ url, name: text(input.name, 'name') });
      const [best] = found.sort((a, b) => (b.path ?? '').length - (a.path ?? '').length);
      return best ? chromeCookie(best) : null;
    }
    case 'getAll': {
      const filter = {
        url: input.url === undefined ? undefined : permittedUrl(input.url),
        name: optionalText(input.name, 'name'),
        domain: optionalText(input.domain, 'domain'),
        path: optionalText(input.path, 'path'),
        ...(typeof input.secure === 'boolean' ? { secure: input.secure } : {}),
        ...(typeof input.session === 'boolean' ? { session: input.session } : {}),
      };
      const found = await cookies.get(filter);
      return found.filter((cookie) => allowed(cookieUrl(cookie))).map(chromeCookie);
    }
    case 'set': {
      const url = permittedUrl(input.url);
      const name = optionalText(input.name, 'name') ?? '';
      const set: CookiesSetDetails = { url, name, value: optionalText(input.value, 'value') ?? '' };
      const domain = optionalText(input.domain, 'domain');
      if (domain !== undefined) set.domain = domain;
      const path = optionalText(input.path, 'path');
      if (path !== undefined) set.path = path;
      if (typeof input.secure === 'boolean') set.secure = input.secure;
      if (typeof input.httpOnly === 'boolean') set.httpOnly = input.httpOnly;
      if (typeof input.expirationDate === 'number') set.expirationDate = input.expirationDate;
      if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(String(input.sameSite)))
        set.sameSite = input.sameSite as CookiesSetDetails['sameSite'];
      await cookies.set(set);
      const stored = await cookies.get({ url, name });
      return stored[0] ? chromeCookie(stored[0]) : null;
    }
    case 'remove': {
      const url = permittedUrl(input.url);
      const name = text(input.name, 'name');
      await cookies.remove(url, name);
      return { url, name, storeId: '0' };
    }
    case 'getAllCookieStores':
      return [{ id: '0', tabIds: [] }];
    default:
      throw new Error(`Unsupported cookies method: ${String(method)}`);
  }
}
