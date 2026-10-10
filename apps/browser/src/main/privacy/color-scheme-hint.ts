const HINT = 'Sec-CH-Prefers-Color-Scheme';

// Chromium sends this hint only after a site asked for it in a previous response, so the first
// load of a server-themed site such as Google would render light while the browser is dark.
export function withColorSchemeHint(headers: Record<string, string>, dark: boolean): Record<string, string> {
  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== HINT.toLowerCase()) rewritten[key] = value;
  }
  rewritten[HINT] = dark ? '"dark"' : '"light"';
  return rewritten;
}
