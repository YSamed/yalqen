import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import {
  canBookmark,
  menuTitle,
  type BookmarkStore,
  type ImportedBookmark,
  type ImportedBookmarkFolder,
} from './bookmarks.js';
import { isWebUrl, MAX_VISITS, type HistoryStore, type ImportedVisit } from './history.js';
import { t } from '../../shared/i18n.js';

export interface ImportSource {
  label: string;
  file: string;
}

interface ParsedBookmarks {
  bookmarks: ImportedBookmark[];
  folders: ImportedBookmarkFolder[];
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
const FIREFOX_PLACES = 'places.sqlite';
// Root guids from Firefox's Bookmarks.sys.mjs. The tags root (`tags________`) holds tags, not bookmarks.
const FIREFOX_ROOTS = ['toolbar_____', 'menu________', 'unfiled_____', 'mobile______'] as const;
const FIREFOX_BOOKMARK = 1;
const FIREFOX_FOLDER = 2;

interface ChromiumNode {
  type?: unknown;
  name?: unknown;
  url?: unknown;
  date_added?: unknown;
  children?: unknown;
}

interface FirefoxBookmarkRow {
  id?: unknown;
  type?: unknown;
  parent?: unknown;
  title?: unknown;
  guid?: unknown;
  dateAdded?: unknown;
  url?: unknown;
}

interface FirefoxHistoryRow {
  url?: unknown;
  title?: unknown;
  last_visit_date?: unknown;
}

interface FirefoxProfile {
  name: string;
  dir: string;
}

function microsToUnixMs(value: unknown, epochOffsetMs: number): number | null {
  const micros =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? Number(value) : 0;
  const ms = Math.floor(micros / 1000) - epochOffsetMs;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function webkitTimeToUnixMs(value: unknown): number | null {
  return microsToUnixMs(value, WEBKIT_EPOCH_OFFSET_MS);
}

// Firefox counts microseconds from 1970-01-01, unlike Chromium.
export function firefoxTimeToUnixMs(value: unknown): number | null {
  return microsToUnixMs(value, 0);
}

// The legacy display label is retained; structured paths preserve actual nesting.
function folderTitle(segments: readonly string[]): string | null {
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
  const importedFolders: ImportedBookmarkFolder[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const walk = (nodes: unknown, folders: readonly string[]): void => {
    if (!Array.isArray(nodes) || folders.length >= 128) return;
    for (const node of nodes as (ChromiumNode | null)[]) {
      const name = typeof node?.name === 'string' ? node.name : '';
      if (node?.type === 'folder') {
        if (folders.length >= 127) continue;
        const segments = [...folders, name.trim() || t('bookmarks.newFolder')];
        importedFolders.push({
          title: segments.join(' / '),
          path: segments,
          createdAt: webkitTimeToUnixMs(node.date_added),
        });
        walk(node.children, segments);
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
          folderPath: folders.filter((segment) => segment.trim()),
          createdAt: webkitTimeToUnixMs(node.date_added),
        });
      }
    }
  };
  for (const root of CHROMIUM_ROOTS) walk((roots as Record<string, ChromiumNode | undefined>)[root]?.children, []);
  return { bookmarks, folders: importedFolders, skipped };
}

// Profiles of installed Chromium browsers that contain `fileName` (e.g. `Bookmarks`, `History`).
export function chromiumProfiles(fileName: string, appSupport = APP_SUPPORT): ImportSource[] {
  if (process.platform !== 'darwin') return [];
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
  let parsed: ParsedBookmarks;
  try {
    parsed = parseChromiumBookmarks(JSON.parse(await fs.promises.readFile(file, 'utf8')));
  } catch {
    parsed = { bookmarks: [], folders: [], skipped: 0 };
  }
  const added = store.importBookmarks(parsed.bookmarks, parsed.folders);
  return { ...added, skipped: parsed.skipped + parsed.bookmarks.length - added.bookmarks };
}

export async function importBookmarkFile(store: BookmarkStore, file: string): Promise<BookmarkImportResult> {
  if (isFirefoxPlaces(file)) return importFirefoxBookmarks(store, file);
  const { readBookmarkFile, parseBookmarkHtml } = await import('./bookmark-html.js');
  const text = await readBookmarkFile(file);
  let parsed: ParsedBookmarks;
  if (text.trimStart().startsWith('<')) {
    parsed = await parseBookmarkHtml(text);
  } else {
    try {
      parsed = parseChromiumBookmarks(JSON.parse(text));
    } catch {
      parsed = { bookmarks: [], folders: [], skipped: 0 };
    }
  }
  const added = store.importBookmarks(parsed.bookmarks, parsed.folders);
  return { ...added, skipped: parsed.skipped + parsed.bookmarks.length - added.bookmarks };
}

// Chromium keeps one row per address with its latest visit; hidden rows are subframes the user never opened.
// SQLite sorts newest first so reading can stop at the history cap; rowid keeps the source order at equal times.
const CHROMIUM_HISTORY_QUERY =
  'SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC, rowid';

type RowOrder = 'any' | 'newest-first';

export function parseChromiumHistory(rows: Iterable<ChromiumHistoryRow>, order: RowOrder = 'any'): ImportedVisit[] {
  return newestWebVisits(rows, (row) => webkitTimeToUnixMs(row.last_visit_time), order);
}

function newestWebVisits<Row extends { url?: unknown; title?: unknown }>(
  rows: Iterable<Row>,
  visitedAt: (row: Row) => number | null,
  sourceOrder: RowOrder,
): ImportedVisit[] {
  type Candidate = { visit: ImportedVisit; order: number };
  const newest: Candidate[] = [];
  // The oldest retained visit is first; at equal times the last source row is
  // replaced first, preserving the stable order of the original full-array sort.
  const compare = (a: Candidate, b: Candidate) => a.visit.visitedAt - b.visit.visitedAt || b.order - a.order;
  const siftDown = (start: number): void => {
    let parent = start;
    for (;;) {
      const left = parent * 2 + 1;
      if (left >= newest.length) return;
      const right = left + 1;
      const child = right < newest.length && compare(newest[right], newest[left]) < 0 ? right : left;
      if (compare(newest[parent], newest[child]) <= 0) return;
      [newest[parent], newest[child]] = [newest[child], newest[parent]];
      parent = child;
    }
  };
  let heap = false;
  let order = 0;
  for (const row of rows) {
    if (sourceOrder === 'newest-first' && newest.length === MAX_VISITS) break;
    const time = visitedAt(row);
    if (time === null) continue;
    if (newest.length === MAX_VISITS) {
      // Small histories only need the final sort. Larger sources retain at most
      // MAX_VISITS candidates instead of materializing and sorting every row.
      if (!heap) {
        for (let index = Math.floor(newest.length / 2) - 1; index >= 0; index--) siftDown(index);
        heap = true;
      }
      // A later source row also loses an equal-time tie. Discard it before URL
      // parsing and allocation once it cannot enter the retained results.
      if (time <= newest[0].visit.visitedAt) continue;
    }
    const url = typeof row.url === 'string' ? row.url : '';
    if (!isWebUrl(url)) continue;
    const candidate = {
      visit: { url, title: typeof row.title === 'string' ? row.title : '', visitedAt: time },
      order: order++,
    };
    if (newest.length < MAX_VISITS) {
      newest.push(candidate);
      continue;
    }
    newest[0] = candidate;
    siftDown(0);
  }
  return newest.sort((a, b) => compare(b, a)).map(({ visit }) => visit);
}

// The source browser may be running and writing, so SQLite only ever opens a private copy.
async function querySqliteCopy<Result>(
  file: string,
  query: string,
  read: (rows: Iterable<Record<string, unknown>>) => Result,
): Promise<Result> {
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
      return read(db.prepare(query).iterate());
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
  const visits = await querySqliteCopy(file, CHROMIUM_HISTORY_QUERY, (rows) =>
    parseChromiumHistory(rows, 'newest-first'),
  );
  const added = store.importVisits(visits);
  return { visits: added, skipped: visits.length - added };
}

// Only `[ProfileN]` sections list profiles; `[Install…]` and `[BackgroundTasksProfiles]` point at them again.
export function parseFirefoxProfiles(ini: string, root: string): FirefoxProfile[] {
  const profiles: Record<string, string>[] = [];
  let section: Record<string, string> | null = null;
  for (const line of ini.split(/\r?\n/).map((text) => text.trim())) {
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = /^Profile\d+$/.test(header[1]) ? {} : null;
      if (section) profiles.push(section);
    } else if (section && line.includes('=')) {
      const at = line.indexOf('=');
      section[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return profiles
    .filter((profile) => profile.Path)
    .map((profile) => ({
      name: profile.Name || path.basename(profile.Path),
      dir: profile.IsRelative === '1' ? path.join(root, profile.Path) : profile.Path,
    }));
}

// Each Firefox profile keeps bookmarks and history together in one places.sqlite.
export function firefoxProfiles(appSupport = APP_SUPPORT): ImportSource[] {
  const root = path.join(appSupport, 'Firefox');
  let ini: string;
  try {
    ini = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8');
  } catch {
    return [];
  }
  return parseFirefoxProfiles(ini, root)
    .map(({ name, dir }) => ({ label: `Firefox — ${name}`, file: path.join(dir, FIREFOX_PLACES) }))
    .filter((source) => fs.existsSync(source.file));
}

export function isFirefoxPlaces(file: string): boolean {
  return path.basename(file) === FIREFOX_PLACES;
}

const FIREFOX_BOOKMARKS_QUERY = `SELECT b.id, b.type, b.parent, b.title, b.guid, b.dateAdded, p.url
  FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`;

export function parseFirefoxBookmarks(rows: readonly FirefoxBookmarkRow[]): ParsedBookmarks {
  const children = new Map<string, FirefoxBookmarkRow[]>();
  for (const row of rows) {
    const siblings = children.get(String(row.parent));
    if (siblings) siblings.push(row);
    else children.set(String(row.parent), [row]);
  }
  const bookmarks: ImportedBookmark[] = [];
  const importedFolders: ImportedBookmarkFolder[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const visited = new Set<string>();
  const walk = (id: string, folders: readonly string[]): void => {
    if (visited.has(id) || folders.length >= 128) return;
    visited.add(id);
    for (const row of children.get(id) ?? []) {
      const title = typeof row.title === 'string' ? row.title : '';
      const type = Number(row.type);
      if (type === FIREFOX_FOLDER) {
        if (folders.length >= 127) continue;
        const segments = [...folders, title.trim() || t('bookmarks.newFolder')];
        importedFolders.push({
          title: segments.join(' / '),
          path: segments,
          createdAt: firefoxTimeToUnixMs(row.dateAdded),
        });
        walk(String(row.id), segments);
      } else if (type === FIREFOX_BOOKMARK) {
        const url = typeof row.url === 'string' ? row.url : '';
        if (!canBookmark(url) || seen.has(url)) {
          skipped++;
          continue;
        }
        seen.add(url);
        bookmarks.push({
          title,
          url,
          folder: folderTitle(folders),
          folderPath: folders.filter((segment) => segment.trim()),
          createdAt: firefoxTimeToUnixMs(row.dateAdded),
        });
      }
    }
  };
  for (const guid of FIREFOX_ROOTS) {
    const root = rows.find((row) => row.guid === guid);
    if (root) walk(String(root.id), []);
  }
  return { bookmarks, folders: importedFolders, skipped };
}

export async function importFirefoxBookmarks(store: BookmarkStore, file: string): Promise<BookmarkImportResult> {
  const parsed = await querySqliteCopy(file, FIREFOX_BOOKMARKS_QUERY, (rows) => parseFirefoxBookmarks([...rows]));
  const added = store.importBookmarks(parsed.bookmarks, parsed.folders);
  return { ...added, skipped: parsed.skipped + parsed.bookmarks.length - added.bookmarks };
}

// Hidden rows are frames and redirect sources that Firefox leaves out of its own history.
const FIREFOX_HISTORY_QUERY =
  'SELECT url, title, last_visit_date FROM moz_places WHERE hidden = 0 ORDER BY last_visit_date DESC, rowid';

export function parseFirefoxHistory(rows: Iterable<FirefoxHistoryRow>, order: RowOrder = 'any'): ImportedVisit[] {
  return newestWebVisits(rows, (row) => firefoxTimeToUnixMs(row.last_visit_date), order);
}

export async function importFirefoxHistory(store: HistoryStore, file: string): Promise<HistoryImportResult> {
  const visits = await querySqliteCopy(file, FIREFOX_HISTORY_QUERY, (rows) =>
    parseFirefoxHistory(rows, 'newest-first'),
  );
  const added = store.importVisits(visits);
  return { visits: added, skipped: visits.length - added };
}

export function historyImportMenu(
  sources: readonly ImportSource[],
  importFrom: (file?: string) => void,
): MenuItemConstructorOptions {
  return {
    label: t('browserImport.historyMenu'),
    submenu: [
      ...sources.map((source): MenuItemConstructorOptions => ({
        label: menuTitle(source.label),
        click: () => importFrom(source.file),
      })),
      ...(sources.length > 0 ? [{ type: 'separator' as const }] : []),
      { label: t('browserImport.historyMenuFile'), click: () => importFrom() },
    ],
  };
}

export function importErrorMessage(error: unknown, kind: 'bookmarks' | 'history' = 'bookmarks'): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') {
    return t(kind === 'history' ? 'browserImport.historyNotFound' : 'browserImport.bookmarksNotFound');
  }
  if (code === 'EACCES' || code === 'EPERM') return t('browserImport.noPermission');
  if (error instanceof SyntaxError) {
    return t(kind === 'history' ? 'browserImport.historyUnsupported' : 'browserImport.bookmarksUnsupported');
  }
  if (code === 'ERR_SQLITE_ERROR') {
    return t(kind === 'history' ? 'browserImport.historyUnreadable' : 'browserImport.bookmarksUnreadable');
  }
  return error instanceof Error ? error.message : String(error);
}
