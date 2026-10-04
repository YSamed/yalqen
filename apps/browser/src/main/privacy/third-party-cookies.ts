import type { Session } from 'electron';
import { getDomain } from 'tldts';

export function siteOf(url: string, domains?: Map<string, string>): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(protocol) || hostname === '') return null;
    const cached = domains?.get(hostname);
    if (cached !== undefined) return cached;
    // Hosted tenants (for example alice.github.io and bob.github.io) are separate
    // sites, even though their provider's suffix is in the PSL's private section.
    const site = getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
    if (domains) {
      // Bound retention even when a page requests many distinct hosts.
      if (domains.size >= 256) domains.delete(domains.keys().next().value!);
      domains.set(hostname, site);
    }
    return site;
  } catch {
    return null;
  }
}

export function headerValues(headers: Record<string, string | string[]> | undefined, name: string): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) values.push(...(Array.isArray(value) ? value : [value]));
  }
  return values;
}

export function requestCookieNames(header: string): string[] {
  return header
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter(Boolean);
}

export function responseCookieNames(setCookies: readonly string[]): string[] {
  return setCookies.map((cookie) => cookie.split(';')[0].split('=')[0].trim()).filter(Boolean);
}

const blocking = new WeakSet<Session>();

// webRequest listeners route every request of the session through the main process,
// so they are attached only while blocking is on.
export function setThirdPartyCookieBlocking(session: Session, enabled: boolean): void {
  if (blocking.has(session) === enabled) return;
  const { webRequest } = session;
  if (!enabled) {
    blocking.delete(session);
    webRequest.onBeforeSendHeaders(null);
    webRequest.onCompleted(null);
    webRequest.onErrorOccurred(null);
    return;
  }
  blocking.add(session);
  const existing = new Map<number, Set<string>>();
  const domains = new Map<string, string>();
  const pages = new WeakMap<Electron.WebContents, { url: string; site: string | null }>();
  const pageOf = (details: { webContents?: Electron.WebContents | null }) => {
    const contents = details.webContents;
    if (!contents || contents.isDestroyed()) return null;
    const url = contents.getURL();
    if (!url) return null;
    let page = pages.get(contents);
    if (page?.url !== url) {
      page = { url, site: siteOf(url, domains) };
      pages.set(contents, page);
    }
    return page;
  };

  webRequest.onBeforeSendHeaders((details, callback) => {
    // Redirects keep the request id; classification belongs to the current hop.
    existing.delete(details.id);
    const page = details.resourceType === 'mainFrame' ? null : pageOf(details);
    const request = page ? siteOf(details.url, domains) : null;
    if (!page || request === null || request === page.site) {
      callback({});
      return;
    }
    const requestHeaders = { ...details.requestHeaders };
    const sent = new Set<string>();
    for (const key of Object.keys(requestHeaders)) {
      if (key.toLowerCase() !== 'cookie') continue;
      for (const name of requestCookieNames(requestHeaders[key])) sent.add(name);
      delete requestHeaders[key];
    }
    existing.set(details.id, sent);
    callback({ requestHeaders });
  });
  webRequest.onCompleted((details) => {
    const sent = existing.get(details.id);
    existing.delete(details.id);
    if (!sent) return;
    for (const name of responseCookieNames(headerValues(details.responseHeaders, 'set-cookie'))) {
      if (!sent.has(name)) void session.cookies.remove(details.url, name);
    }
  });
  webRequest.onErrorOccurred((details) => existing.delete(details.id));
}
