import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { DefaultTreeAdapterMap } from 'parse5';
import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../pages/html.js';
import {
  bookmarksByFolder,
  canBookmark,
  type Bookmark,
  type BookmarkFolder,
  type ImportedBookmark,
  type ImportedBookmarkFolder,
} from './bookmarks.js';

export const MAX_BOOKMARK_FILE_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 500_000;
const MAX_DEPTH = 128;
type Node = DefaultTreeAdapterMap['node'];

export interface ParsedHtmlBookmarks {
  bookmarks: ImportedBookmark[];
  folders: ImportedBookmarkFolder[];
  skipped: number;
}

function secondsToMs(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const milliseconds = Number(value) * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 8_640_000_000_000_000
    ? milliseconds
    : null;
}

function textContent(node: Node): string {
  const parts: string[] = [];
  const stack = [node];
  while (stack.length) {
    const item = stack.pop()!;
    if ('value' in item) parts.push(item.value);
    else if ('childNodes' in item && !('tagName' in item && ['script', 'style', 'template'].includes(item.tagName))) {
      for (let index = item.childNodes.length - 1; index >= 0; index--) stack.push(item.childNodes[index]);
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

// HTML is parsed as data: no page is loaded and no scripts, images or network requests run.
export async function parseBookmarkHtml(html: string): Promise<ParsedHtmlBookmarks> {
  if (Buffer.byteLength(html, 'utf8') > MAX_BOOKMARK_FILE_BYTES)
    throw new RangeError(t('browserImport.bookmarksTooLarge'));
  const { parse } = await import('parse5');
  const document = parse(html);
  const result: ParsedHtmlBookmarks = { bookmarks: [], folders: [], skipped: 0 };
  const urls = new Set<string>();
  const folderTitles = new Set<string>();
  interface Context {
    segments: string[];
    pending: string | null;
    depth: number;
  }
  const stack: { node: Node; context: Context | null }[] = [{ node: document, context: null }];
  let lists = 0;
  let visited = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    const node = entry.node;
    let context = entry.context;
    if (++visited > MAX_NODES) throw new RangeError(t('browserImport.bookmarksTooLarge'));
    if ('tagName' in node) {
      if (['script', 'style', 'template'].includes(node.tagName)) continue;
      if (node.tagName === 'dl') {
        lists++;
        const segments = context?.pending ? [...context.segments, context.pending] : (context?.segments ?? []);
        if (context) context.pending = null;
        context = { segments, pending: null, depth: (context?.depth ?? 0) + 1 };
        if (context.depth > MAX_DEPTH) throw new RangeError(t('browserImport.bookmarksTooLarge'));
      } else if (context && node.tagName === 'h3') {
        const title = textContent(node) || t('bookmarks.newFolder');
        context.pending = title;
        const fullTitle = [...context.segments, title].join(' / ');
        if (!folderTitles.has(fullTitle)) {
          folderTitles.add(fullTitle);
          result.folders.push({
            title: fullTitle,
            createdAt: secondsToMs(node.attrs.find((attr) => attr.name === 'add_date')?.value),
          });
        }
        continue;
      } else if (context && node.tagName === 'a') {
        const url = node.attrs.find((attr) => attr.name === 'href')?.value.trim() ?? '';
        if (!canBookmark(url) || urls.has(url)) result.skipped++;
        else {
          urls.add(url);
          result.bookmarks.push({
            title: textContent(node),
            url,
            folder: context.segments.join(' / ') || null,
            createdAt: secondsToMs(node.attrs.find((attr) => attr.name === 'add_date')?.value),
          });
        }
        continue;
      }
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--)
        stack.push({ node: node.childNodes[index], context });
    }
  }
  if (!lists) throw new SyntaxError('Not a bookmarks HTML file');
  return result;
}

export function exportBookmarkHtml(folders: readonly BookmarkFolder[], bookmarks: readonly Bookmark[]): string {
  const groups = bookmarksByFolder(bookmarks);
  const date = (milliseconds: number) => Math.max(0, Math.floor(milliseconds / 1000));
  const link = (bookmark: Bookmark) =>
    `    <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${date(bookmark.createdAt)}">${escapeHtml(bookmark.title)}</A>`;
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  for (const folder of folders) {
    lines.push(`    <DT><H3 ADD_DATE="${date(folder.createdAt)}">${escapeHtml(folder.title)}</H3>`, '    <DL><p>');
    for (const bookmark of groups.get(folder.id) ?? [])
      if (canBookmark(bookmark.url)) lines.push(`    ${link(bookmark)}`);
    lines.push('    </DL><p>');
  }
  const folderIds = new Set(folders.map((folder) => folder.id));
  for (const bookmark of bookmarks) {
    if ((bookmark.folderId === null || !folderIds.has(bookmark.folderId)) && canBookmark(bookmark.url))
      lines.push(link(bookmark));
  }
  lines.push('</DL><p>', '');
  return lines.join('\n');
}

export async function writeBookmarkHtml(
  file: string,
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, exportBookmarkHtml(folders, bookmarks), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

// Bounded reads also cover files replaced or enlarged after the chooser opens.
export async function readBookmarkFile(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    if ((await handle.stat()).size > MAX_BOOKMARK_FILE_BYTES)
      throw new RangeError(t('browserImport.bookmarksTooLarge'));
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_BOOKMARK_FILE_BYTES + 1 - bytes));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > MAX_BOOKMARK_FILE_BYTES) throw new RangeError(t('browserImport.bookmarksTooLarge'));
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/^\uFEFF/, '');
  } finally {
    await handle.close();
  }
}
