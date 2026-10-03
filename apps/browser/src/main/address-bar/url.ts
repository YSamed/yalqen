import { isDevelopmentHost } from '../../shared/hosts.js';
import { buildSearchUrl, type SearchEngine } from './search.js';

const EXPLICIT_SCHEMES = new Set([
  'http:',
  'https:',
  'file:',
  'about:',
  'data:',
  'view-source:',
  'yalqen:',
  'chrome-extension:',
]);

export function resolveInput(input: string, engine: SearchEngine): string {
  const text = input.trim();
  if (text === '') return 'about:blank';

  if (/^[a-z][a-z\d+\-.]*:/i.test(text) && !/\s/.test(text)) {
    try {
      const url = new URL(text);
      if (EXPLICIT_SCHEMES.has(url.protocol)) return url.toString();
    } catch {}
  }

  const host = /^:\d/.test(text) ? `localhost${text}` : text;
  const looksLikeHost =
    !/\s/.test(host) && (/^(localhost|\[[\da-f:]+\])(:\d+)?(\/|$)/i.test(host) || /^[^/]+\.[^/]+/.test(host));
  if (looksLikeHost) {
    try {
      const scheme = isDevelopmentHost(new URL(`http://${host}`).hostname) ? 'http' : 'https';
      return new URL(`${scheme}://${host}`).toString();
    } catch {}
  }

  return buildSearchUrl(engine, text);
}

export function withoutHash(url: string): string {
  return url.split('#')[0];
}
