import fs from 'node:fs';
import path from 'node:path';

export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
export const BACKGROUND_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] as const;
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};
const FILE_NAME = /^new-tab-background-\d+\.(png|jpe?g|webp|gif|avif)$/;

export interface NewTabBackground {
  file: string;
  type: string;
}

export function isBackgroundFileName(value: unknown): value is string {
  return typeof value === 'string' && FILE_NAME.test(value);
}

export function saveBackground(directory: string, source: string, previous: string, now = Date.now()): string | null {
  const extension = path.extname(source).slice(1).toLowerCase();
  if (!(extension in CONTENT_TYPES)) return null;
  try {
    if (fs.statSync(source).size > MAX_BACKGROUND_BYTES) return null;
    const name = `new-tab-background-${now}.${extension}`;
    fs.copyFileSync(source, path.join(directory, name));
    if (previous !== name) removeBackground(directory, previous);
    return name;
  } catch {
    return null;
  }
}

export function removeBackground(directory: string, name: string): void {
  if (isBackgroundFileName(name)) fs.rmSync(path.join(directory, name), { force: true });
}

export function backgroundFile(directory: string, name: string): NewTabBackground | null {
  return isBackgroundFileName(name)
    ? { file: path.join(directory, name), type: CONTENT_TYPES[path.extname(name).slice(1)] }
    : null;
}

export function readBackground(background: NewTabBackground): Buffer<ArrayBuffer> | null {
  try {
    return fs.readFileSync(background.file);
  } catch {
    return null;
  }
}
