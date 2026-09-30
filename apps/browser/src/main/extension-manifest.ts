import path from 'node:path';

export type Manifest = Record<string, unknown>;
export type Messages = Record<string, string>;

export interface SavedExtension {
  path: string;
  enabled: boolean;
}

const MAX_EXTENSIONS = 100;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function sanitizeSavedExtensions(raw: unknown): SavedExtension[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_EXTENSIONS).flatMap((item) => {
    const entry = record(item);
    const directory = nonEmpty(entry?.path);
    if (!entry || !directory || !path.isAbsolute(directory) || seen.has(directory)) return [];
    seen.add(directory);
    return [{ path: directory, enabled: entry.enabled !== false }];
  });
}

function action(manifest: Manifest): Record<string, unknown> | null {
  return record(manifest.action) ?? record(manifest.browser_action) ?? record(manifest.page_action);
}

export function popupPage(manifest: Manifest): string | null {
  return nonEmpty(action(manifest)?.default_popup);
}

export function optionsPage(manifest: Manifest): string | null {
  return nonEmpty(record(manifest.options_ui)?.page) ?? nonEmpty(manifest.options_page);
}

export function actionTitle(manifest: Manifest, fallback: string): string {
  return nonEmpty(action(manifest)?.default_title) ?? fallback;
}

function sizedIcon(icons: Record<string, unknown> | null, size: number): string | null {
  const sized = Object.entries(icons ?? {})
    .flatMap(([key, file]) => {
      const pixels = Number(key);
      return Number.isFinite(pixels) && nonEmpty(file) ? [{ pixels, file: file as string }] : [];
    })
    .sort((a, b) => a.pixels - b.pixels);
  return (sized.find((icon) => icon.pixels >= size) ?? sized.at(-1))?.file ?? null;
}

export function iconFile(manifest: Manifest, size: number): string | null {
  const actionIcon = action(manifest)?.default_icon;
  return sizedIcon(record(manifest.icons), size) ?? nonEmpty(actionIcon) ?? sizedIcon(record(actionIcon), size) ?? null;
}

export function resolveInside(root: string, relative: string): string | null {
  const resolved = path.resolve(root, relative.replace(/^\/+/, ''));
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

export function extensionPage(baseUrl: string, page: string | null): string | null {
  if (!page) return null;
  try {
    return new URL(page.replace(/^\/+/, ''), baseUrl).toString();
  } catch {
    return null;
  }
}

export function parseMessages(raw: unknown): Messages {
  const messages: Messages = {};
  for (const [key, value] of Object.entries(record(raw) ?? {})) {
    const message = nonEmpty(record(value)?.message);
    if (message) messages[key.toLowerCase()] = message;
  }
  return messages;
}

export function localize(text: string, messages: Messages): string {
  return text.replace(/__MSG_(\w+)__/g, (match, key: string) => messages[key.toLowerCase()] ?? match);
}

export function manifestText(manifest: Manifest, key: string, messages: Messages): string {
  const value = manifest[key];
  return typeof value === 'string' ? localize(value, messages).trim() : '';
}

export function withManifestKey(text: string, key: string): string | null {
  try {
    const manifest = record(JSON.parse(text.replace(/^\uFEFF/, '')));
    if (!manifest) return null;
    return JSON.stringify({ key, ...manifest, ...(nonEmpty(manifest.key) ? {} : { key }) }, null, 2);
  } catch {
    return null;
  }
}
