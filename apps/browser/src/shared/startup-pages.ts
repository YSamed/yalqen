// Only explicit web addresses are used for automatic navigation. Executable schemes,
// local files and URLs containing credentials are not accepted by these settings.
export function webPageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function sanitizeStartupUrls(value: unknown[]): string[] {
  return [...new Set(value.slice(0, 100).flatMap((url) => webPageUrl(url) ?? []))].slice(0, 20);
}
export function startupPages(behavior: string, urls: readonly string[], resume: boolean): string[] {
  return behavior === 'pages' && !resume ? [...urls] : [];
}
