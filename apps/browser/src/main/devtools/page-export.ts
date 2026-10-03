import { t } from '../../shared/i18n.js';

const MAX_NAME = 120;

export function pageFileName(title: string, url: string, extension: 'pdf' | 'png'): string {
  let name = title.trim();
  if (name === '' || name === url) {
    try {
      name = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      name = '';
    }
  }
  const safe = name
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_NAME)
    .trim();
  return `${safe || t('pageExport.fallbackFileName')}.${extension}`;
}

export function canViewSource(url: string): boolean {
  return /^(https?|file):/i.test(url);
}

export type AddressFormat = 'url' | 'markdown' | 'curl';

export function formatAddress(format: AddressFormat, url: string, title: string): string {
  switch (format) {
    case 'url':
      return url;
    case 'markdown': {
      const text = (title.trim() || url).replace(/[\\[\]]/g, '\\$&');
      return `[${text}](${url.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})`;
    }
    case 'curl':
      return `curl -L '${url.replace(/'/g, "'\\''")}'`;
  }
}

// Chromium cannot rasterize a texture taller or wider than this many device pixels.
const MAX_CAPTURE_PIXELS = 16384;

export function fullPageClip(
  content: { width: number; height: number },
  pixelRatio: number,
): { x: number; y: number; width: number; height: number; scale: number } {
  const limit = Math.floor(MAX_CAPTURE_PIXELS / Math.max(1, pixelRatio));
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Math.min(Math.ceil(content.width), limit)),
    height: Math.max(1, Math.min(Math.ceil(content.height), limit)),
    scale: 1,
  };
}
