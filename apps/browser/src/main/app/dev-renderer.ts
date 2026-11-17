import path from 'node:path';
import type { WebContents } from 'electron';

const DEV_SERVER_VARIABLE = 'YALQEN_DEV_SERVER_URL';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function devServerOrigin(): string | null {
  const value = process.env[DEV_SERVER_VARIABLE]?.trim();
  if (!value) return null;
  try {
    const url = new URL(value.endsWith('/') ? value : `${value}/`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not an http address');
    if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error('not a loopback address');
    return url.href;
  } catch {
    throw new Error(`${DEV_SERVER_VARIABLE} is not a loopback http address: ${value}`);
  }
}

export function devRendererUrl(page: string, query: Record<string, string> = {}): string | null {
  const origin = devServerOrigin();
  if (!origin) return null;
  const url = new URL(path.basename(page), origin);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.href;
}

export function loadRenderer(contents: WebContents, page: string, query: Record<string, string> = {}): Promise<void> {
  const dev = devRendererUrl(page, query);
  return dev ? contents.loadURL(dev) : contents.loadFile(page, { query });
}
