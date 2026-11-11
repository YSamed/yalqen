import { readingUrl } from './reading-list';

export const LIVE_FOLDER_KINDS = ['feed', 'releases', 'commits', 'tags'] as const;
export type LiveFolderKind = (typeof LIVE_FOLDER_KINDS)[number];

export const MAX_FEED_ITEMS = 30;
const MAX_TITLE = 200;
const MAX_ID = 512;
const MAX_BLOCK = 20_000;

export interface FeedItem {
  id: string;
  title: string;
  url: string;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

export interface LiveFolderView {
  id: string;
  title: string;
  collapsed: boolean;
  failed: boolean;
  unread: number;
  items: { id: string; title: string; unread: boolean }[];
}

export function isLiveFolderKind(value: unknown): value is LiveFolderKind {
  return (LIVE_FOLDER_KINDS as readonly unknown[]).includes(value);
}

export function liveFolderName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
}

export function feedSourceUrl(value: unknown): string | null {
  const url = readingUrl(value);
  return url?.startsWith('https://') ? url : null;
}

export function liveFolderSource(kind: LiveFolderKind, input: unknown): { url: string; name: string } | null {
  if (typeof input !== 'string') return null;
  if (kind === 'feed') {
    const url = feedSourceUrl(input.trim());
    return url ? { url, name: '' } : null;
  }
  const match = /^(?:https:\/\/github\.com\/)?([\w.-]{1,100})\/([\w.-]{1,100})\/?$/.exec(input.trim());
  if (!match || match.slice(1).some((part) => /^\.+$/.test(part))) return null;
  return { url: `https://github.com/${match[1]}/${match[2]}/${kind}.atom`, name: `${match[1]}/${match[2]}` };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (_match, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

function plain(raw: string): string {
  const text = raw
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part, index) => (index % 2 ? part.slice(9, -3) : decode(part)))
    .join('');
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}

function element(block: string, name: string): string {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(block)?.[1] ?? '';
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes);
  return match ? (match[1] ?? match[2]) : null;
}

function blocks(xml: string, tag: string): string[] {
  const lower = xml.replace(/[A-Z]/g, (char) => char.toLowerCase());
  const found: string[] = [];
  for (let from = 0; found.length < MAX_FEED_ITEMS * 2;) {
    const start = lower.indexOf(`<${tag}`, from);
    if (start < 0) break;
    if (!/[\s>]/.test(lower[start + tag.length + 1] ?? '')) {
      from = start + 1;
      continue;
    }
    const end = lower.indexOf(`</${tag}`, start);
    if (end < 0) break;
    found.push(xml.slice(start, Math.min(end, start + MAX_BLOCK)));
    from = end;
  }
  return found;
}

function itemUrl(block: string, base: string): string | null {
  for (const match of block.matchAll(/<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link\s*>)/gi)) {
    const rel = attribute(match[1], 'rel');
    if (rel !== null && rel.toLowerCase() !== 'alternate') continue;
    const href = attribute(match[1], 'href');
    try {
      const url = readingUrl(new URL(href !== null ? decode(href) : plain(match[2] ?? ''), base).href);
      if (url) return url;
    } catch {}
  }
  return null;
}

export function parseFeed(text: string, base: string): ParsedFeed | null {
  if (!/<(?:rss|feed|rdf:rdf)[\s>]/i.test(text.slice(0, 8192))) return null;
  const list = blocks(text, 'item');
  const entries = list.length > 0 ? list : blocks(text, 'entry');
  const first = text.search(/<(?:item|entry)[\s>]/i);
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  for (const block of entries) {
    const url = itemUrl(block, base);
    if (!url) continue;
    const id = (plain(element(block, 'guid') || element(block, 'id')) || url).slice(0, MAX_ID);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title: plain(element(block, 'title')) || url, url });
    if (items.length >= MAX_FEED_ITEMS) break;
  }
  return { title: plain(element(text.slice(0, first < 0 ? MAX_BLOCK : Math.min(first, MAX_BLOCK)), 'title')), items };
}
