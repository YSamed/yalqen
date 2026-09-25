import { buildSearchUrl, type SearchEngine } from './search.js';

// Anything else that parses as "scheme:rest" (e.g. "localhost:3000") is treated as a host.
const EXPLICIT_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:', 'data:', 'view-source:']);

/** Turns address bar input into a URL: explicit URLs, bare hosts, or a search. */
export function resolveInput(input: string, engine: SearchEngine): string {
  const text = input.trim();
  if (text === '') return 'about:blank';

  if (/^[a-z][a-z\d+\-.]*:/i.test(text) && !/\s/.test(text)) {
    try {
      const url = new URL(text);
      if (EXPLICIT_SCHEMES.has(url.protocol)) return url.toString();
    } catch {
      // Fall through to host or search handling.
    }
  }

  const looksLikeHost =
    !/\s/.test(text) && (/^localhost(:\d+)?(\/|$)/i.test(text) || /^[^/]+\.[^/]+/.test(text));
  if (looksLikeHost) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(text);
    try {
      return new URL(`${isLocal ? 'http' : 'https'}://${text}`).toString();
    } catch {
      // Fall through to search.
    }
  }

  return buildSearchUrl(engine, text);
}
