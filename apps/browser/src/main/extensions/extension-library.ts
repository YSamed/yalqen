import fs from 'node:fs';
import { app, type NativeImage } from 'electron';
import { t } from '../../shared/i18n.js';
import type { ExtensionBridgeEvent } from '../../shared/extension-bridge.js';
import { isWebUrl, type HistoryEntry, type HistoryStore } from '../library/history.js';
import type { Bookmark, BookmarkFolder, BookmarkStore } from '../library/bookmarks.js';
import type { DownloadManager } from '../library/download-manager.js';
import { isActive, type DownloadEntry, type DownloadStore } from '../library/downloads.js';

export type LibraryNamespace = 'history' | 'bookmarks' | 'downloads';

export interface LibraryStores {
  history: HistoryStore;
  bookmarks: BookmarkStore;
  downloads: DownloadStore;
  downloadManager: DownloadManager;
  bookmarksChanged(): void;
}

interface LibraryEvents {
  wants(permission: LibraryNamespace): boolean;
  emit(permission: LibraryNamespace, name: ExtensionBridgeEvent, args: unknown[]): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HISTORY_RESULTS = 100;
const ROOT_ID = '0';
const BAR_ID = '1';
const MAX_BULK = 1000;

type Details = Record<string, unknown>;
const details = (value: unknown): Details => (typeof value === 'object' && value !== null ? (value as Details) : {});
const optionalString = (value: unknown) => (typeof value === 'string' ? value : undefined);
const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export function historyItems(all: readonly HistoryEntry[], matches: readonly HistoryEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of all) counts.set(entry.url, (counts.get(entry.url) ?? 0) + 1);
  const items = new Map<string, Record<string, unknown>>();
  for (const entry of matches) {
    if (items.has(entry.url)) continue;
    items.set(entry.url, {
      id: entry.id,
      url: entry.url,
      title: entry.title,
      lastVisitTime: entry.visitedAt,
      visitCount: counts.get(entry.url) ?? 1,
      typedCount: 0,
    });
  }
  return [...items.values()];
}

export function searchHistory(
  all: readonly HistoryEntry[],
  matches: readonly HistoryEntry[],
  query: unknown,
  now: number,
) {
  const { startTime, endTime, maxResults } = details(query);
  const start = time(startTime) ?? now - DAY_MS;
  const end = time(endTime) ?? Infinity;
  const limit =
    Number.isInteger(maxResults) && (maxResults as number) > 0 ? (maxResults as number) : DEFAULT_HISTORY_RESULTS;
  const inRange = matches.filter((entry) => entry.visitedAt >= start && entry.visitedAt < end);
  return historyItems(all, inRange).slice(0, limit);
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded: number;
  children?: BookmarkNode[];
}

// Chrome's tree has a fixed root ("0") over the bookmarks bar ("1"); Yalqen's top level maps to the bar.
export function bookmarkNodes(
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
): Map<string, BookmarkNode> {
  const nodes = new Map<string, BookmarkNode>([
    [ROOT_ID, { id: ROOT_ID, title: '', dateAdded: 0 }],
    [BAR_ID, { id: BAR_ID, parentId: ROOT_ID, index: 0, title: t('toolbar.bookmarks'), dateAdded: 0 }],
  ]);
  const used = new Map<string, number>();
  const place = (parentId: string) => {
    const index = used.get(parentId) ?? 0;
    used.set(parentId, index + 1);
    return index;
  };
  for (const folder of folders) {
    const parentId = folder.parentId ?? BAR_ID;
    nodes.set(folder.id, {
      id: folder.id,
      parentId,
      index: place(parentId),
      title: folder.title,
      dateAdded: folder.createdAt,
    });
  }
  for (const bookmark of bookmarks) {
    const parentId = bookmark.folderId ?? BAR_ID;
    nodes.set(bookmark.id, {
      id: bookmark.id,
      parentId,
      index: place(parentId),
      title: bookmark.title,
      url: bookmark.url,
      dateAdded: bookmark.createdAt,
    });
  }
  return nodes;
}

export function bookmarkTree(nodes: ReadonlyMap<string, BookmarkNode>, id: string): BookmarkNode {
  const node = nodes.get(id);
  if (!node) throw new Error("Can't find bookmark for id.");
  if (node.url !== undefined) return { ...node };
  const children = [...nodes.values()]
    .filter((child) => child.parentId === id)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((child) => bookmarkTree(nodes, child.id));
  return { ...node, children };
}

type Change = [ExtensionBridgeEvent, unknown[]];

export function bookmarkChanges(
  before: ReadonlyMap<string, BookmarkNode>,
  after: ReadonlyMap<string, BookmarkNode>,
): Change[] {
  const changes: Change[] = [];
  for (const [id, node] of after) {
    const old = before.get(id);
    if (!old) {
      changes.push(['bookmarks.onCreated', [id, node]]);
      continue;
    }
    if (old.title !== node.title || old.url !== node.url)
      changes.push([
        'bookmarks.onChanged',
        [id, { title: node.title, ...(node.url !== undefined ? { url: node.url } : {}) }],
      ]);
    if (old.parentId !== node.parentId)
      changes.push([
        'bookmarks.onMoved',
        [id, { parentId: node.parentId, index: node.index, oldParentId: old.parentId, oldIndex: old.index }],
      ]);
  }
  for (const [id, node] of before) {
    // Chrome reports only the top of a removed subtree.
    if (after.has(id) || (node.parentId && !after.has(node.parentId) && before.has(node.parentId))) continue;
    changes.push(['bookmarks.onRemoved', [id, { parentId: node.parentId, index: node.index, node }]]);
  }
  return changes;
}

export function chromeDownload(entry: DownloadEntry, id: number, exists: boolean) {
  const state = entry.state === 'completed' ? 'complete' : isActive(entry) ? 'in_progress' : 'interrupted';
  const error =
    entry.state === 'cancelled'
      ? 'USER_CANCELED'
      : entry.state === 'blocked'
        ? 'FILE_BLOCKED'
        : entry.state === 'interrupted'
          ? 'NETWORK_FAILED'
          : undefined;
  return {
    id,
    url: entry.url,
    finalUrl: entry.url,
    referrer: '',
    filename: entry.savePath,
    incognito: false,
    danger: entry.state === 'blocked' ? 'file' : 'safe',
    mime: '',
    startTime: new Date(entry.startedAt).toISOString(),
    state,
    paused: entry.state === 'paused',
    canResume: entry.state === 'paused',
    ...(error ? { error } : {}),
    bytesReceived: entry.receivedBytes,
    totalBytes: entry.totalBytes,
    fileSize: state === 'complete' ? entry.totalBytes || entry.receivedBytes : entry.totalBytes,
    exists,
  };
}

type ChromeDownload = ReturnType<typeof chromeDownload>;
const DOWNLOAD_DELTA_KEYS = [
  'state',
  'paused',
  'canResume',
  'error',
  'danger',
  'filename',
  'totalBytes',
  'fileSize',
] as const;

export function downloadChanges(
  before: ReadonlyMap<number, ChromeDownload>,
  after: ReadonlyMap<number, ChromeDownload>,
): Change[] {
  const changes: Change[] = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old) {
      changes.push(['downloads.onCreated', [item]]);
      // A download that ends inside one diff still owes listeners the state change Chrome would report.
      if (item.state !== 'in_progress')
        changes.push(['downloads.onChanged', [{ id, state: { previous: 'in_progress', current: item.state } }]]);
      continue;
    }
    const delta: Record<string, unknown> = {};
    for (const key of DOWNLOAD_DELTA_KEYS) {
      const previous = (old as Record<string, unknown>)[key];
      const current = (item as Record<string, unknown>)[key];
      if (previous !== current) delta[key] = { previous, ...(current !== undefined ? { current } : {}) };
    }
    if (Object.keys(delta).length > 0) changes.push(['downloads.onChanged', [{ id, ...delta }]]);
  }
  for (const id of before.keys()) if (!after.has(id)) changes.push(['downloads.onErased', [id]]);
  return changes;
}

export function matchesDownload(item: ChromeDownload, query: unknown): boolean {
  const { id, url, filename, state, paused, query: terms } = details(query);
  if (id !== undefined && item.id !== id) return false;
  if (url !== undefined && item.url !== url) return false;
  if (filename !== undefined && item.filename !== filename) return false;
  if (state !== undefined && item.state !== state) return false;
  if (paused !== undefined && item.paused !== paused) return false;
  const text = `${item.url} ${item.filename}`.toLowerCase();
  for (const term of Array.isArray(terms) ? terms : []) {
    if (typeof term !== 'string' || !term) continue;
    const excluded = term.startsWith('-');
    if (text.includes((excluded ? term.slice(1) : term).toLowerCase()) === excluded) return false;
  }
  return true;
}

export function downloadRequest(options: unknown) {
  const { url, filename, method, headers } = details(options);
  if (typeof url !== 'string') throw new Error('Download url is required');
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:', 'data:'].includes(protocol)) throw new Error(`Cannot download ${protocol} urls`);
  if (method !== undefined && method !== 'GET') throw new Error('Only GET downloads are supported');
  if (
    filename !== undefined &&
    (typeof filename !== 'string' || /(^|[\\/])\.\.([\\/]|$)/.test(filename) || /^([\\/]|[A-Za-z]:)/.test(filename))
  )
    throw new Error('Invalid filename');
  const pairs = Array.isArray(headers) ? headers.map(details) : [];
  const record = Object.fromEntries(
    pairs
      .filter(({ name, value }) => typeof name === 'string' && typeof value === 'string')
      .map(({ name, value }) => [name, value]),
  ) as Record<string, string>;
  return { url, filename: filename ?? null, headers: Object.keys(record).length > 0 ? record : undefined };
}

export class ExtensionLibrary {
  private historySeen: Map<string, string> | null = null;
  private bookmarksSeen: Map<string, BookmarkNode> | null = null;
  private downloadsSeen: Map<number, ChromeDownload> | null = null;
  private readonly downloadIds = new Map<string, number>();
  private nextDownloadId = 1;
  private readonly pending = new Set<LibraryNamespace>();

  constructor(
    private readonly stores: LibraryStores,
    private readonly events: LibraryEvents,
  ) {
    stores.history.onChange = () => this.schedule('history');
    stores.bookmarks.onChange = () => this.schedule('bookmarks');
    stores.downloadManager.onChange = () => this.schedule('downloads');
    for (const namespace of ['history', 'bookmarks', 'downloads'] as const) this.diff(namespace);
  }

  call(namespace: LibraryNamespace, method: string, args: unknown[], permissions: readonly string[]): unknown {
    if (namespace === 'history') return this.history(method, args);
    if (namespace === 'bookmarks') return this.bookmarks(method, args);
    return this.downloads(method, args, permissions);
  }

  // Coalesce bursts (an import, a create followed by a move) into one diff.
  private schedule(namespace: LibraryNamespace): void {
    if (this.pending.has(namespace)) return;
    this.pending.add(namespace);
    setImmediate(() => {
      this.pending.delete(namespace);
      const changes = this.diff(namespace);
      if (changes.length > 0 && this.events.wants(namespace))
        for (const [name, args] of changes) this.events.emit(namespace, name, args);
    });
  }

  private diff(namespace: LibraryNamespace): Change[] {
    if (namespace === 'history') return this.historyChanges();
    return namespace === 'bookmarks' ? this.bookmarkDiff() : this.downloadDiff();
  }

  private historyChanges(): Change[] {
    const entries = this.stores.history.list();
    const now = new Map(entries.map((entry) => [entry.id, entry.url]));
    const before = this.historySeen;
    this.historySeen = now;
    if (!before) return [];
    const added = entries.filter((entry) => !before.has(entry.id));
    const changes: Change[] = historyItems(entries, added).map((item) => ['history.onVisited', [item]]);
    const urls = new Set([...now.values()]);
    const removed = [...new Set([...before].filter(([id]) => !now.has(id)).map(([, url]) => url))].filter(
      (url) => !urls.has(url),
    );
    if (entries.length === 0 && before.size > 0)
      changes.push(['history.onVisitRemoved', [{ allHistory: true, urls: [] }]]);
    else if (removed.length > 0) changes.push(['history.onVisitRemoved', [{ allHistory: false, urls: removed }]]);
    return changes;
  }

  private history(method: string, args: unknown[]): unknown {
    const store = this.stores.history;
    const [query] = args;
    const { text, url, title } = details(query);
    switch (method) {
      case 'search':
        return searchHistory(store.list(), store.list(optionalString(text) ?? ''), query, Date.now());
      case 'getVisits': {
        if (typeof url !== 'string') throw new Error('url is required');
        const visits = store.list().filter((entry) => entry.url === url);
        return visits.map((entry) => ({
          id: visits[0].id,
          visitId: entry.id,
          visitTime: entry.visitedAt,
          referringVisitId: '0',
          transition: 'link',
          isLocal: true,
        }));
      }
      case 'addUrl':
        if (typeof url !== 'string' || !isWebUrl(url)) throw new Error('Url is invalid.');
        store.visit(url, optionalString(title) ?? '');
        return undefined;
      case 'deleteUrl':
        if (typeof url !== 'string') throw new Error('url is required');
        store.removeUrl(url);
        return undefined;
      case 'deleteRange': {
        const { startTime, endTime } = details(query);
        const start = time(startTime);
        const end = time(endTime);
        if (start === undefined || end === undefined) throw new Error('startTime and endTime are required');
        store.removeRange(start, end);
        return undefined;
      }
      case 'deleteAll':
        store.clear();
        return undefined;
    }
    throw new Error(`Unsupported history method: ${method}`);
  }

  private nodes(): Map<string, BookmarkNode> {
    return bookmarkNodes(this.stores.bookmarks.folders(), this.stores.bookmarks.bookmarks());
  }

  private bookmarkDiff(): Change[] {
    const now = this.nodes();
    const before = this.bookmarksSeen;
    this.bookmarksSeen = now;
    return before ? bookmarkChanges(before, now) : [];
  }

  // shortcut: index is ignored on create and move; a duplicate url returns the existing bookmark where the user keeps it (Yalqen keeps urls unique).
  private bookmarks(method: string, args: unknown[]): unknown {
    const store = this.stores.bookmarks;
    const [first, second] = args;
    const nodes = this.nodes();
    const node = (id: unknown) => {
      const found = typeof id === 'string' ? nodes.get(id) : undefined;
      if (!found) throw new Error("Can't find bookmark for id.");
      return found;
    };
    const plain = ({ children: _children, ...rest }: BookmarkNode) => rest;
    const editable = (id: unknown) => {
      const found = node(id);
      if (found.id === ROOT_ID || found.id === BAR_ID) throw new Error("Can't modify the root bookmark folders.");
      return found;
    };
    const folderId = (parentId: unknown): string | null => {
      if (parentId === undefined || parentId === BAR_ID) return null;
      const parent = node(parentId);
      if (parent.id === ROOT_ID) throw new Error("Can't modify the root bookmark folders.");
      if (parent.url !== undefined) throw new Error('Parameter "parentId" does not specify a folder.');
      return parent.id;
    };
    const changed = <T>(value: T): T => {
      this.stores.bookmarksChanged();
      return value;
    };
    const fresh = (id: string) => plain(this.nodes().get(id)!);
    switch (method) {
      case 'get':
        return (Array.isArray(first) ? first : [first]).map((id) => plain(node(id)));
      case 'getChildren':
        return (bookmarkTree(nodes, node(first).id).children ?? []).map(plain);
      case 'getTree':
        return [bookmarkTree(nodes, ROOT_ID)];
      case 'getSubTree':
        return [bookmarkTree(nodes, node(first).id)];
      case 'getRecent': {
        const count = Number.isInteger(first) && (first as number) > 0 ? (first as number) : 0;
        if (!count) throw new Error('numberOfItems cannot be less than 1.');
        return [...nodes.values()]
          .filter((item) => item.url !== undefined)
          .sort((a, b) => b.dateAdded - a.dateAdded)
          .slice(0, count);
      }
      case 'search': {
        const { query, url, title } = typeof first === 'string' ? { query: first } : details(first);
        const urlMatch = typeof url === 'string' ? url : undefined;
        const titleMatch = typeof title === 'string' ? title : undefined;
        return store
          .bookmarks(optionalString(query) ?? '')
          .filter(
            (item) =>
              (urlMatch === undefined || item.url === urlMatch) &&
              (titleMatch === undefined || item.title === titleMatch),
          )
          .map((item) => plain(nodes.get(item.id)!));
      }
      case 'create': {
        const { parentId, title, url } = details(first);
        const parent = folderId(parentId);
        const name = optionalString(title) ?? '';
        if (url === undefined) {
          const folder = store.addFolder(name, parent);
          if (!folder) throw new Error('Could not create the folder.');
          return changed(fresh(folder.id));
        }
        const existing = typeof url === 'string' ? store.find(url) : undefined;
        if (existing) return fresh(existing.id);
        const bookmark = typeof url === 'string' ? store.add(url, name) : null;
        if (!bookmark) throw new Error('Invalid URL.');
        if (parent !== null) store.move(bookmark.id, parent);
        return changed(fresh(bookmark.id));
      }
      case 'update': {
        const target = editable(first);
        const { title, url } = details(second);
        if (target.url === undefined) {
          if (url !== undefined) throw new Error("Can't set URL of a bookmark folder.");
          if (typeof title === 'string') store.renameFolder(target.id, title);
        } else if (typeof url === 'string') {
          if (!store.edit(target.id, optionalString(title) ?? target.title, url)) throw new Error('Invalid URL.');
        } else if (typeof title === 'string') store.rename(target.id, title);
        return changed(fresh(target.id));
      }
      case 'move': {
        const target = editable(first);
        const parent = folderId(details(second).parentId ?? target.parentId);
        if (target.url !== undefined) store.move(target.id, parent);
        else if (
          parent !== (target.parentId === BAR_ID ? null : target.parentId) &&
          !store.moveFolder(target.id, parent)
        )
          throw new Error("Can't move a folder into its own subtree.");
        return changed(fresh(target.id));
      }
      case 'remove':
      case 'removeTree': {
        const target = editable(first);
        if (target.url !== undefined) {
          store.remove(target.id);
          return changed(undefined);
        }
        const tree = bookmarkTree(nodes, target.id);
        if (method === 'remove' && tree.children?.length)
          throw new Error("Can't remove non-empty folder (use recursive to force).");
        const bookmarkIds: string[] = [];
        const folderIds: string[] = [];
        const walk = (item: BookmarkNode) => {
          if (item.url !== undefined) bookmarkIds.push(item.id);
          else {
            for (const child of item.children ?? []) walk(child);
            folderIds.push(item.id);
          }
        };
        walk(tree);
        for (let start = 0; start < bookmarkIds.length; start += MAX_BULK)
          store.removeMany(bookmarkIds.slice(start, start + MAX_BULK));
        for (const id of folderIds) store.removeFolder(id);
        return changed(undefined);
      }
    }
    throw new Error(`Unsupported bookmarks method: ${method}`);
  }

  private downloadId(id: string): number {
    let numeric = this.downloadIds.get(id);
    if (numeric === undefined) {
      numeric = this.nextDownloadId++;
      this.downloadIds.set(id, numeric);
    }
    return numeric;
  }

  private visibleDownloads(): DownloadEntry[] {
    return this.stores.downloads.list().filter((entry) => !entry.private);
  }

  private downloadDiff(): Change[] {
    const now = new Map(
      this.visibleDownloads().map((entry) => {
        const id = this.downloadId(entry.id);
        return [id, chromeDownload(entry, id, entry.state === 'completed')] as const;
      }),
    );
    const before = this.downloadsSeen;
    this.downloadsSeen = now;
    return before ? downloadChanges(before, now) : [];
  }

  private async downloads(method: string, args: unknown[], permissions: readonly string[]): Promise<unknown> {
    const manager = this.stores.downloadManager;
    const [first, second] = args;
    const entries = this.visibleDownloads();
    const items = () =>
      entries.map((entry) =>
        chromeDownload(entry, this.downloadId(entry.id), entry.state === 'completed' && fs.existsSync(entry.savePath)),
      );
    const entry = (id: unknown) => {
      const found = entries.find((item) => this.downloadIds.get(item.id) === id);
      if (!found) throw new Error('Invalid download id');
      return found;
    };
    const actions = manager.actions(() => {});
    switch (method) {
      case 'download': {
        const { url, filename, headers } = downloadRequest(first);
        const id = await manager.download(url, filename, headers);
        if (!id) throw new Error('Download canceled');
        return this.downloadId(id);
      }
      case 'search': {
        const { limit } = details(first);
        const matches = items().filter((item) => matchesDownload(item, first));
        return Number.isInteger(limit) && (limit as number) > 0 ? matches.slice(0, limit as number) : matches;
      }
      case 'pause':
      case 'resume':
      case 'cancel':
      case 'show':
        actions[method](entry(first).id);
        return undefined;
      case 'open':
        if (!permissions.includes('downloads.open')) throw new Error('Missing downloads.open permission');
        actions.open(entry(first).id);
        return undefined;
      case 'showDefaultFolder':
        actions.openFolder();
        return undefined;
      case 'erase': {
        const erased = items()
          .filter((item) => item.state !== 'in_progress' && matchesDownload(item, first))
          .map((item) => item.id);
        for (const id of erased) this.stores.downloads.remove(entry(id).id);
        manager.changed();
        return erased;
      }
      case 'getFileIcon': {
        const { size } = details(second);
        const icon: NativeImage = await app.getFileIcon(entry(first).savePath, {
          size: size === 16 ? 'small' : 'normal',
        });
        return icon.toDataURL();
      }
      case 'setShelfEnabled':
      case 'setUiOptions':
        return undefined;
    }
    throw new Error(`Unsupported downloads method: ${method}`);
  }
}
