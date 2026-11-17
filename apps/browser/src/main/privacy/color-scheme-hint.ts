const HINT = 'Sec-CH-Prefers-Color-Scheme';

export function withColorSchemeHint(headers: Record<string, string>, dark: boolean): Record<string, string> {
  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== HINT.toLowerCase()) rewritten[key] = value;
  }
  rewritten[HINT] = dark ? '"dark"' : '"light"';
  return rewritten;
}
