import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { canBookmark, menuTitle, type BookmarkStore, type ImportedBookmark } from './bookmarks.js';
import { isWebUrl, MAX_VISITS, type HistoryStore, type ImportedVisit } from './history.js';

export interface ImportSource {
  label: string;
  file: string;
}

export interface ParsedBookmarks {
  bookmarks: ImportedBookmark[];
  skipped: number;
}

export interface BookmarkImportResult {
  bookmarks: number;
  folders: number;
  skipped: number;
}

export interface HistoryImportResult {
  visits: number;
  skipped: number;
}

interface ChromiumHistoryRow {
  url?: unknown;
  title?: unknown;
  last_visit_time?: unknown;
}

const APP_SUPPORT = path.join(os.homedir(), 'Library/Application Support');
const CHROMIUM_BROWSERS = [
  ['Chrome', 'Google/Chrome'],
  ['Brave', 'BraveSoftware/Brave-Browser'],
  ['Edge', 'Microsoft Edge'],
] as const;
const PROFILE_DIR = /^(Default|Profile \d+)$/;
const CHROMIUM_ROOTS = ['bookmark_bar', 'other', 'synced'] as const;
// Milliseconds between 1601-01-01 (WebKit epoch) and 1970-01-01.
const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000;

interface ChromiumNode {
  type?: unknown;
  name?: unknown;
  url?: unknown;
  date_added?: unknown;
  children?: unknown;
}

export function webkitTimeToUnixMs(value: unknown): number | null {
  const micros =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? Number(value) : 0;
  const ms = Math.floor(micros / 1000) - WEBKIT_EPOCH_OFFSET_MS;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// Yalqen folders are flat, so a nested source folder becomes one `Parent / Child` folder.
export function folderTitle(segments: readonly string[]): string | null {
  return (
    segments
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' / ') || null
  );
}

export function parseChromiumBookmarks(data: unknown): ParsedBookmarks {
  const roots = (data as { roots?: unknown } | null)?.roots;
  if (!roots || typeof roots !== 'object') throw new SyntaxError('Not a Chromium bookmarks file');
  const bookmarks: ImportedBookmark[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const walk = (nodes: unknown, folders: readonly string[]): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes as (ChromiumNode | null)[]) {
      const name = typeof node?.name === 'string' ? node.name : '';
      if (node?.type === 'folder') {
        walk(node.children, [...folders, name]);
      } else if (node?.type === 'url') {
        const url = typeof node.url === 'string' ? node.url : '';
        if (!canBookmark(url) || seen.has(url)) {
          skipped++;
          continue;
        }
        seen.add(url);
        bookmarks.push({
          title: name,
          url,
          folder: folderTitle(folders),
          createdAt: webkitTimeToUnixMs(node.date_added),
        });
      }
    }
  };
  for (const root of CHROMIUM_ROOTS) walk((roots as Record<string, ChromiumNode | undefined>)[root]?.children, []);
  return { bookmarks, skipped };
}

// Profiles of installed Chromium browsers that contain `fileName` (e.g. `Bookmarks`, `History`).
export function chromiumProfiles(fileName: string, appSupport = APP_SUPPORT): ImportSource[] {
  return CHROMIUM_BROWSERS.flatMap(([browser, dir]) => {
    const root = path.join(appSupport, dir);
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return [];
    }
    const profiles = entries
      .filter((entry) => PROFILE_DIR.test(entry) && fs.existsSync(path.join(root, entry, fileName)))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (profiles.length === 0) return [];
    const names = profileNames(root);
    return profiles.map((entry) => ({
      label: `${browser} — ${names[entry] ?? entry}`,
      file: path.join(root, entry, fileName),
    }));
  });
}

function profileNames(root: string): Record<string, string> {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8'));
    const cache: Record<string, { name?: unknown }> = state?.profile?.info_cache ?? {};
    const names: Record<string, string> = {};
    for (const [entry, info] of Object.entries(cache)) {
      if (typeof info?.name === 'string' && info.name.trim()) names[entry] = info.name.trim();
    }
    return names;
  } catch {
    return {};
  }
}

export async function importChromiumBookmarks(store: BookmarkStore, file: string): Promise<BookmarkImportResult> {
  const parsed = parseChromiumBookmarks(JSON.parse(await fs.promises.readFile(file, 'utf8')));
  const added = store.importBookmarks(parsed.bookmarks);
  return { ...added, skipped: parsed.skipped + parsed.bookmarks.length - added.bookmarks };
}

// Chromium keeps one row per address with its latest visit; hidden rows are subframes the user never opened.
const CHROMIUM_HISTORY_QUERY = 'SELECT url, title, last_visit_time FROM urls WHERE hidden = 0';

export function parseChromiumHistory(rows: readonly ChromiumHistoryRow[]): ImportedVisit[] {
  return rows
    .map((row) => ({
      url: typeof row.url === 'string' ? row.url : '',
      title: typeof row.title === 'string' ? row.title : '',
      visitedAt: webkitTimeToUnixMs(row.last_visit_time),
    }))
    .filter((visit): visit is ImportedVisit => visit.visitedAt !== null && isWebUrl(visit.url))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_VISITS);
}

// The source browser may be running and writing, so SQLite only ever opens a private copy.
async function querySqliteCopy(file: string, query: string): Promise<unknown[]> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yalqen-sqlite-'));
  try {
    const copy = path.join(dir, 'source.sqlite');
    await fs.promises.copyFile(file, copy);
    for (const suffix of ['-wal', '-journal']) {
      await fs.promises.copyFile(file + suffix, copy + suffix).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load SQLite only when importing
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    // Not read-only: a journal copied mid-write must be rolled back, and that only touches the copy.
    const db = new DatabaseSync(copy, { readBigInts: true });
    try {
      return db.prepare(query).all();
    } catch (error) {
      // SQLITE_ERROR (missing table or column) and SQLITE_NOTADB mean some other kind of file.
      const errcode = (error as { errcode?: unknown } | null)?.errcode;
      throw errcode === 1 || errcode === 26 ? new SyntaxError('Unexpected database') : error;
    } finally {
      db.close();
    }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

export async function importChromiumHistory(store: HistoryStore, file: string): Promise<HistoryImportResult> {
  const visits = parseChromiumHistory((await querySqliteCopy(file, CHROMIUM_HISTORY_QUERY)) as ChromiumHistoryRow[]);
  const added = store.importVisits(visits);
  return { visits: added, skipped: visits.length - added };
}

export function historyImportMenu(
  sources: readonly ImportSource[],
  importFrom: (file?: string) => void,
): MenuItemConstructorOptions {
  return {
    label: 'Geçmişi içe aktar',
    submenu: [
      ...sources.map((source): MenuItemConstructorOptions => ({
        label: menuTitle(source.label),
        click: () => importFrom(source.file),
      })),
      ...(sources.length > 0 ? [{ type: 'separator' as const }] : []),
      { label: 'History dosyası seç…', click: () => importFrom() },
    ],
  };
}

export function importErrorMessage(error: unknown, kind = 'Yer imi'): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') return `${kind} dosyası bulunamadı.`;
  if (code === 'EACCES' || code === 'EPERM') {
    return "Dosyayı okuma izni yok. Sistem Ayarları > Gizlilik ve Güvenlik > Tam Disk Erişimi bölümünden Yalqen'e izin verebilirsiniz.";
  }
  if (error instanceof SyntaxError) {
    return `Bu dosya Chrome, Brave ya da Edge ${kind.toLocaleLowerCase('tr')} dosyası değil.`;
  }
  if (code === 'ERR_SQLITE_ERROR') return `${kind} dosyası okunamadı. Tarayıcıyı kapatıp yeniden deneyin.`;
  return error instanceof Error ? error.message : String(error);
}
