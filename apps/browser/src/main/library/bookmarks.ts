import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { t } from '../../shared/i18n.js';
import type { ImportSource } from './browser-import.js';
import { JsonFile } from '../storage/json-file.js';
import { searchKey } from '../address-bar/suggestions.js';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  createdAt: number;
}

export interface BookmarkFolder {
  id: string;
  title: string;
  createdAt: number;
  parentId: string | null;
}

export interface ImportedBookmark {
  title: string;
  url: string;
  folder: string | null;
  createdAt: number | null;
  folderPath?: readonly string[];
}

export interface ImportedBookmarkFolder {
  title: string;
  createdAt: number | null;
  path?: readonly string[];
}

interface SavedBookmarks {
  version: 1 | 2;
  folders: BookmarkFolder[];
  bookmarks: Bookmark[];
}

const MAX_TITLE = 200;
const MENU_TITLE = 60;
const MAX_FOLDER_DEPTH = 127;
const MAX_BULK_BOOKMARKS = 1000;

export function canBookmark(url: string): boolean {
  try {
    return ['https:', 'http:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function cleanTitle(title: string, fallback: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || fallback;
}

export class BookmarkStore {
  readonly file: string;
  private readonly json: JsonFile;
  private folderList: BookmarkFolder[] = [];
  private bookmarkList: Bookmark[] = [];
  private urls: Set<string> | null = null;
  private suggestionList: readonly Readonly<Pick<Bookmark, 'title' | 'url'>>[] | null = null;
  private readonly searchTexts = new WeakMap<Bookmark, { title: string; url: string; text: string }>();

  constructor(directory: string) {
    this.file = path.join(directory, 'bookmarks.json');
    this.json = new JsonFile(this.file, 'bookmarks');
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SavedBookmarks;
      if (data.version !== 1 && data.version !== 2) return;
      const seenFolders = new Set<string>();
      this.folderList = (Array.isArray(data.folders) ? data.folders : [])
        .filter(
          (folder) =>
            typeof folder?.id === 'string' &&
            folder.id.length > 0 &&
            !seenFolders.has(folder.id) &&
            typeof folder.title === 'string' &&
            Number.isFinite(folder.createdAt) &&
            !!seenFolders.add(folder.id),
        )
        .map((folder) => ({ ...folder, parentId: typeof folder.parentId === 'string' ? folder.parentId : null }));
      const folderIds = new Set(this.folderList.map((folder) => folder.id));
      for (const folder of this.folderList) {
        if (!folderIds.has(folder.parentId ?? '') || folder.parentId === folder.id) folder.parentId = null;
      }
      const byId = new Map(this.folderList.map((folder) => [folder.id, folder]));
      for (const folder of this.folderList) {
        const ancestors = new Set([folder.id]);
        let parent = folder.parentId;
        while (parent) {
          if (ancestors.has(parent) || ancestors.size >= MAX_FOLDER_DEPTH) {
            folder.parentId = null;
            break;
          }
          ancestors.add(parent);
          parent = byId.get(parent)?.parentId ?? null;
        }
      }
      this.bookmarkList = (Array.isArray(data.bookmarks) ? data.bookmarks : [])
        .filter(
          (bookmark) =>
            typeof bookmark?.id === 'string' &&
            typeof bookmark.title === 'string' &&
            typeof bookmark.url === 'string' &&
            canBookmark(bookmark.url) &&
            Number.isFinite(bookmark.createdAt),
        )
        .map((bookmark) => ({
          ...bookmark,
          folderId: folderIds.has(bookmark.folderId ?? '') ? bookmark.folderId : null,
        }));
    } catch {}
  }

  folders(): BookmarkFolder[] {
    return this.folderList.map((folder) => ({ ...folder }));
  }

  bookmarks(query = ''): Bookmark[] {
    const term = searchKey(query.trim()).slice(0, 200);
    return this.bookmarkList
      .filter((bookmark) => {
        if (!term) return true;
        let cached = this.searchTexts.get(bookmark);
        if (!cached || cached.title !== bookmark.title || cached.url !== bookmark.url) {
          cached = {
            title: bookmark.title,
            url: bookmark.url,
            text: searchKey(`${bookmark.title} ${bookmark.url}`),
          };
          this.searchTexts.set(bookmark, cached);
        }
        return cached.text.includes(term);
      })
      .map((bookmark) => ({ ...bookmark }));
  }

  // Suggestions read only title/address snapshots. Reuse them while bookmarks are
  // unchanged, and freeze both levels so callers cannot modify store data.
  suggestions(): readonly Readonly<Pick<Bookmark, 'title' | 'url'>>[] {
    this.suggestionList ??= Object.freeze(this.bookmarkList.map(({ title, url }) => Object.freeze({ title, url })));
    return this.suggestionList;
  }

  has(url: string): boolean {
    this.urls ??= new Set(this.bookmarkList.map((bookmark) => bookmark.url));
    return this.urls.has(url);
  }

  find(url: string): Bookmark | undefined {
    const bookmark = this.bookmarkList.find((item) => item.url === url);
    return bookmark && { ...bookmark };
  }

  add(url: string, title: string): Bookmark | null {
    if (!canBookmark(url)) return null;
    const existing = this.find(url);
    if (existing) return existing;
    const bookmark: Bookmark = {
      id: randomUUID(),
      title: cleanTitle(title, url),
      url,
      folderId: null,
      createdAt: Date.now(),
    };
    this.bookmarkList.push(bookmark);
    this.save();
    return { ...bookmark };
  }

  remove(id: string): void {
    const before = this.bookmarkList.length;
    this.bookmarkList = this.bookmarkList.filter((bookmark) => bookmark.id !== id);
    if (this.bookmarkList.length !== before) this.save();
  }

  rename(id: string, title: string): void {
    const bookmark = this.bookmarkList.find((item) => item.id === id);
    if (!bookmark) return;
    bookmark.title = cleanTitle(title, bookmark.url);
    this.save();
  }

  edit(id: string, title: string, url: string): boolean {
    const bookmark = this.bookmarkList.find((item) => item.id === id);
    if (!bookmark || !canBookmark(url) || this.bookmarkList.some((item) => item.id !== id && item.url === url))
      return false;
    bookmark.title = cleanTitle(title, url);
    bookmark.url = url;
    this.save();
    return true;
  }

  moveMany(ids: readonly string[], folderId: string | null): boolean {
    if (
      !ids.length ||
      ids.length > MAX_BULK_BOOKMARKS ||
      (folderId !== null && !this.folderList.some((folder) => folder.id === folderId))
    )
      return false;
    const chosen = new Set(ids);
    let changed = false;
    for (const bookmark of this.bookmarkList)
      if (chosen.has(bookmark.id) && bookmark.folderId !== folderId) {
        bookmark.folderId = folderId;
        changed = true;
      }
    if (changed) this.save();
    return changed;
  }

  removeMany(ids: readonly string[]): boolean {
    if (!ids.length || ids.length > MAX_BULK_BOOKMARKS) return false;
    const chosen = new Set(ids);
    const before = this.bookmarkList.length;
    this.bookmarkList = this.bookmarkList.filter((bookmark) => !chosen.has(bookmark.id));
    if (before === this.bookmarkList.length) return false;
    this.save();
    return true;
  }

  move(id: string, folderId: string | null): void {
    const bookmark = this.bookmarkList.find((item) => item.id === id);
    if (!bookmark) return;
    bookmark.folderId = this.folderList.some((folder) => folder.id === folderId) ? folderId : null;
    this.save();
  }

  addFolder(title: string, parentId: string | null = null): BookmarkFolder | null {
    if (!this.validParent(null, parentId)) return null;
    const folder: BookmarkFolder = {
      id: randomUUID(),
      title: cleanTitle(title, t('bookmarks.newFolder')),
      createdAt: Date.now(),
      parentId,
    };
    this.folderList.push(folder);
    this.save();
    return { ...folder };
  }

  renameFolder(id: string, title: string): void {
    const folder = this.folderList.find((item) => item.id === id);
    if (!folder) return;
    folder.title = cleanTitle(title, folder.title);
    this.save();
  }

  private validParent(id: string | null, parentId: string | null): boolean {
    if (parentId === null) return true;
    const byId = new Map(this.folderList.map((folder) => [folder.id, folder]));
    if (!byId.has(parentId)) return false;
    const seen = new Set<string>();
    let parent: string | null = parentId;
    while (parent) {
      if (parent === id || seen.has(parent) || seen.size >= MAX_FOLDER_DEPTH - 1) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    // Moving an entire branch must leave room for its deepest descendant.
    if (id) {
      const paths = bookmarkFolderPaths(this.folderList);
      for (const folder of this.folderList) {
        const path = paths.get(folder.id) ?? [];
        const position = path.findIndex((item) => item.id === id);
        if (position >= 0 && seen.size + path.length - position > MAX_FOLDER_DEPTH) return false;
      }
    }
    return true;
  }

  moveFolder(id: string, parentId: string | null): boolean {
    const folder = this.folderList.find((item) => item.id === id);
    if (!folder || !this.validParent(id, parentId) || folder.parentId === parentId) return false;
    folder.parentId = parentId;
    this.save();
    return true;
  }

  removeFolder(id: string): void {
    const parentId = this.folderList.find((folder) => folder.id === id)?.parentId ?? null;
    const before = this.folderList.length;
    this.folderList = this.folderList.filter((folder) => folder.id !== id);
    if (this.folderList.length === before) return;
    for (const bookmark of this.bookmarkList) {
      if (bookmark.folderId === id) bookmark.folderId = parentId;
    }
    for (const folder of this.folderList) if (folder.parentId === id) folder.parentId = parentId;
    this.save();
  }

  // Imports only add: known addresses are skipped and folders with the same title are reused.
  importBookmarks(
    items: readonly ImportedBookmark[],
    importedFolders: readonly ImportedBookmarkFolder[] = [],
  ): { bookmarks: number; folders: number } {
    const urls = new Set(this.bookmarkList.map((bookmark) => bookmark.url));
    const folderIds = new Map<string, string>();
    for (const folder of this.folderList) {
      const key = JSON.stringify([folder.parentId, folder.title]);
      if (!folderIds.has(key)) folderIds.set(key, folder.id);
    }
    const before = { bookmarks: this.bookmarkList.length, folders: this.folderList.length };
    const now = Date.now();
    const ensureFolder = (segments: readonly string[], createdAt = now): string | null => {
      let parentId: string | null = null;
      for (const [index, name] of segments.slice(0, MAX_FOLDER_DEPTH).entries()) {
        const title = cleanTitle(name, t('bookmarks.newFolder'));
        const key = JSON.stringify([parentId, title]);
        let id = folderIds.get(key);
        if (!id) {
          id = randomUUID();
          folderIds.set(key, id);
          this.folderList.push({ id, title, parentId, createdAt: index === segments.length - 1 ? createdAt : now });
        }
        parentId = id;
      }
      return parentId;
    };
    for (const folder of importedFolders) ensureFolder(folder.path ?? [folder.title], folder.createdAt ?? now);
    for (const item of items) {
      if (!canBookmark(item.url) || urls.has(item.url)) continue;
      urls.add(item.url);
      const folderId = ensureFolder(item.folderPath ?? (item.folder !== null ? [item.folder] : []));
      this.bookmarkList.push({
        id: randomUUID(),
        title: cleanTitle(item.title, item.url),
        url: item.url,
        folderId,
        createdAt: item.createdAt ?? now,
      });
    }
    const added = {
      bookmarks: this.bookmarkList.length - before.bookmarks,
      folders: this.folderList.length - before.folders,
    };
    if (added.bookmarks > 0 || added.folders > 0) this.save();
    return added;
  }

  saveNow(): void {
    this.json.flush();
  }

  private save(): void {
    this.urls = null;
    this.suggestionList = null;
    this.json.schedule((): SavedBookmarks => ({ version: 2, folders: this.folderList, bookmarks: this.bookmarkList }));
  }
}

export function bookmarkFolderPaths(folders: readonly BookmarkFolder[]): Map<string, readonly BookmarkFolder[]> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, readonly BookmarkFolder[]>();
  for (const folder of folders) {
    const path: BookmarkFolder[] = [];
    const seen = new Set<string>();
    let current: BookmarkFolder | undefined = folder;
    while (current && !seen.has(current.id) && path.length < MAX_FOLDER_DEPTH) {
      seen.add(current.id);
      path.push(current);
      current = byId.get(current.parentId ?? '');
    }
    paths.set(folder.id, path.reverse());
  }
  return paths;
}

export function bookmarkFoldersByParent(folders: readonly BookmarkFolder[]): Map<string | null, BookmarkFolder[]> {
  const ids = new Set(folders.map((folder) => folder.id));
  const groups = new Map<string | null, BookmarkFolder[]>();
  for (const folder of folders) {
    const parent = ids.has(folder.parentId ?? '') ? folder.parentId : null;
    const group = groups.get(parent);
    if (group) group.push(folder);
    else groups.set(parent, [folder]);
  }
  return groups;
}

export function bookmarksByFolder(bookmarks: readonly Bookmark[]): Map<string | null, Bookmark[]> {
  const groups = new Map<string | null, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const group = groups.get(bookmark.folderId);
    if (group) group.push(bookmark);
    else groups.set(bookmark.folderId, [bookmark]);
  }
  return groups;
}

export function runBookmarksCommand(store: BookmarkStore, command: string, params: URLSearchParams): boolean {
  const id = params.get('id') ?? '';
  const title = params.get('title') ?? '';
  switch (command) {
    case 'new-folder':
      return store.addFolder(title, params.get('parent') || null) !== null;
    case 'rename':
      if (params.has('url')) return store.edit(id, title, params.get('url') ?? '');
      store.rename(id, title);
      return true;
    case 'move':
      store.move(id, params.get('folder') || null);
      return true;
    case 'move-many':
      return store.moveMany(params.getAll('id'), params.get('folder') || null);
    case 'remove-many':
      return store.removeMany(params.getAll('id'));
    case 'move-folder':
      return store.moveFolder(id, params.get('parent') || null);
    case 'remove':
      store.remove(id);
      return true;
    case 'rename-folder':
      store.renameFolder(id, title);
      return true;
    case 'remove-folder':
      store.removeFolder(id);
      return true;
    default:
      return false;
  }
}

export function menuTitle(title: string): string {
  return title.length > MENU_TITLE ? `${title.slice(0, MENU_TITLE - 1)}…` : title;
}

interface BookmarksMenuActions {
  open(url: string): void;
  showAll(): void;
  // Without a file, the user picks one.
  importFrom(file?: string): void;
}

export function bookmarksMenuTemplate(
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
  actions: BookmarksMenuActions,
  importSources: readonly ImportSource[] = [],
): MenuItemConstructorOptions[] {
  const groups = bookmarksByFolder(bookmarks);
  const item = (bookmark: Bookmark): MenuItemConstructorOptions => ({
    label: menuTitle(bookmark.title),
    click: () => actions.open(bookmark.url),
  });
  const folderGroups = bookmarkFoldersByParent(folders);
  const seen = new Set<string>();
  const folderMenu = (folder: BookmarkFolder, depth = 0): MenuItemConstructorOptions => {
    seen.add(folder.id);
    const entries =
      depth >= MAX_FOLDER_DEPTH
        ? []
        : (folderGroups.get(folder.id) ?? [])
            .filter((child) => !seen.has(child.id))
            .map((child) => folderMenu(child, depth + 1));
    entries.push(...(groups.get(folder.id) ?? []).map(item));
    return {
      label: menuTitle(folder.title),
      submenu: entries.length ? entries : [{ label: t('bookmarks.menuEmpty'), enabled: false }],
    };
  };
  const inFolders = (folderGroups.get(null) ?? []).map((folder) => folderMenu(folder));
  const loose = (groups.get(null) ?? []).map(item);
  const entries = [...inFolders, ...loose];
  return [
    ...(entries.length > 0 ? entries : [{ label: t('bookmarks.menuNone'), enabled: false }]),
    { type: 'separator' },
    { label: t('bookmarks.menuAll'), click: actions.showAll },
    {
      label: t('bookmarks.menuImport'),
      submenu: [
        ...importSources.map((source): MenuItemConstructorOptions => ({
          label: menuTitle(source.label),
          click: () => actions.importFrom(source.file),
        })),
        ...(importSources.length > 0 ? [{ type: 'separator' as const }] : []),
        { label: t('bookmarks.menuImportFile'), click: () => actions.importFrom() },
      ],
    },
  ];
}
