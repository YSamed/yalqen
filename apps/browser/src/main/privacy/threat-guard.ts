import { randomUUID } from 'node:crypto';
import type { OnBeforeRequestListenerDetails, WebContents } from 'electron';
import { INTERNAL_SCHEME } from '../../shared/types.js';
import type { LocalThreatLists } from './threat-lists.js';

export const PROCEED_THREAT_URL = `${INTERNAL_SCHEME}://proceed-threat/`;
const TOKEN_LIFETIME_MS = 5 * 60 * 1000;
interface Warning {
  url: string;
  token: string;
  createdAt: number;
}

function address(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

// Grants are bound to one contents and exact page URL, kept only in memory.
export class ThreatGuard {
  private readonly warnings = new WeakMap<WebContents, Warning>();
  private readonly allowed = new WeakMap<WebContents, string>();
  constructor(private readonly lists: LocalThreatLists) {}

  navigating(contents: WebContents, url: string): void {
    // The internal command starts a navigation before will-navigate validates its token.
    if (url.startsWith(PROCEED_THREAT_URL)) return;
    if (this.allowed.get(contents) !== address(url)) this.allowed.delete(contents);
    if (this.warnings.get(contents)?.url !== address(url)) this.warnings.delete(contents);
  }

  blocked(details: OnBeforeRequestListenerDetails): boolean {
    const contents = details.webContents;
    if (contents && details.resourceType === 'mainFrame' && this.allowed.get(contents) !== address(details.url))
      this.allowed.delete(contents);
    if (!this.lists.domain(details.url)) return false;
    if (!contents || contents.isDestroyed()) return true;
    const grant = this.allowed.get(contents);
    if (grant) {
      if (details.resourceType === 'mainFrame') {
        if (address(details.url) === grant) return false;
        this.allowed.delete(contents);
      } else if (address(contents.getURL()) === grant && new URL(details.url).origin === new URL(grant).origin)
        return false;
    }
    if (details.resourceType === 'mainFrame')
      this.warnings.set(contents, { url: address(details.url), token: randomUUID(), createdAt: Date.now() });
    return true;
  }

  warning(contents: WebContents, url: string): Warning | null {
    const warning = this.warnings.get(contents);
    return warning && warning.url === address(url) && Date.now() - warning.createdAt < TOKEN_LIFETIME_MS
      ? warning
      : null;
  }

  proceed(contents: WebContents, token: string, currentUrl: string): string | null {
    const warning = this.warning(contents, currentUrl);
    if (!warning || warning.token !== token) return null;
    this.warnings.delete(contents);
    this.allowed.set(contents, warning.url);
    return warning.url;
  }
}
