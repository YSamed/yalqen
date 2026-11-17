import path from 'node:path';
import type { WebContents } from 'electron';

// The window interface and its overlays are the only pages Vite can serve, because main reads the
// internal `yalqen://` pages and the settings template off disk itself.
const DEV_SERVER_VARIABLE = 'YALQEN_DEV_SERVER_URL';

function devServerOrigin(): string | null {
  const value = process.env[DEV_SERVER_VARIABLE]?.trim();
  if (!value) return null;
  try {
    // A trailing slash is required so `new URL(name, base)` keeps the origin's path rather than
    // dropping the last segment.
    const url = new URL(value.endsWith('/') ? value : `${value}/`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not an http address');
    return url.href;
  } catch {
    throw new Error(`${DEV_SERVER_VARIABLE} is not an http address: ${value}`);
  }
}

export function devServerEnabled(): boolean {
  return devServerOrigin() !== null;
}

// Names the page the way Vite does: its file name at the root of the dev server's own root.
export function devRendererUrl(page: string, query: Record<string, string> = {}): string | null {
  const origin = devServerOrigin();
  if (!origin) return null;
  const url = new URL(path.basename(page), origin);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.href;
}

// Loads a renderer page from the dev server when one is running, and from the build otherwise, so
// the production path keeps its exact `loadFile` behaviour and query handling.
export function loadRenderer(contents: WebContents, page: string, query: Record<string, string> = {}): Promise<void> {
  const dev = devRendererUrl(page, query);
  return dev ? contents.loadURL(dev) : contents.loadFile(page, { query });
}
