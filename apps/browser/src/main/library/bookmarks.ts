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
}

export interface ImportedBookmark {
  title: string;
  url: string;
  folder: string | null;
  createdAt: number | null;
}

export interface ImportedBookmarkFolder {
  title: string;
  createdAt: number | null;
}

interface SavedBookmarks {
  version: 1;
  folders: BookmarkFolder[];
  bookmarks: Bookmark[];
}

const MAX_TITLE = 200;
const MENU_TITLE = 60;

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
      if (data.version !== 1) return;
      this.folderList = (Array.isArray(data.folders) ? data.folders : []).filter(
        (folder) =>
          typeof folder?.id === 'string' && typeof folder.title === 'string' && Number.isFinite(folder.createdAt),
      );
      const folderIds = new Set(this.folderList.map((folder) => folder.id));
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

  move(id: string, folderId: string | null): void {
    const bookmark = this.bookmarkList.find((item) => item.id === id);
    if (!bookmark) return;
    bookmark.folderId = this.folderList.some((folder) => folder.id === folderId) ? folderId : null;
    this.save();
  }

  addFolder(title: string): BookmarkFolder {
    const folder: BookmarkFolder = {
      id: randomUUID(),
      title: cleanTitle(title, t('bookmarks.newFolder')),
      createdAt: Date.now(),
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

  removeFolder(id: string): void {
    const before = this.folderList.length;
    this.folderList = this.folderList.filter((folder) => folder.id !== id);
    if (this.folderList.length === before) return;
    for (const bookmark of this.bookmarkList) {
      if (bookmark.folderId === id) bookmark.folderId = null;
    }
    this.save();
  }

  // Imports only add: known addresses are skipped and folders with the same title are reused.
  importBookmarks(
    items: readonly ImportedBookmark[],
    importedFolders: readonly ImportedBookmarkFolder[] = [],
  ): { bookmarks: number; folders: number } {
    const urls = new Set(this.bookmarkList.map((bookmark) => bookmark.url));
    const folderIds = new Map<string, string>();
    for (const folder of this.folderList) if (!folderIds.has(folder.title)) folderIds.set(folder.title, folder.id);
    const before = { bookmarks: this.bookmarkList.length, folders: this.folderList.length };
    const now = Date.now();
    const ensureFolder = (name: string, createdAt = now): string => {
      const title = cleanTitle(name, t('bookmarks.newFolder'));
      let id = folderIds.get(title);
      if (!id) {
        id = randomUUID();
        folderIds.set(title, id);
        this.folderList.push({ id, title, createdAt });
      }
      return id;
    };
    for (const folder of importedFolders) ensureFolder(folder.title, folder.createdAt ?? now);
    for (const item of items) {
      if (!canBookmark(item.url) || urls.has(item.url)) continue;
      urls.add(item.url);
      let folderId: string | null = null;
      if (item.folder !== null) {
        folderId = ensureFolder(item.folder);
      }
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
    this.json.schedule((): SavedBookmarks => ({ version: 1, folders: this.folderList, bookmarks: this.bookmarkList }));
  }
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
      store.addFolder(title);
      return true;
    case 'rename':
      store.rename(id, title);
      return true;
    case 'move':
      store.move(id, params.get('folder') || null);
      return true;
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
  const inFolders = folders.map((folder): MenuItemConstructorOptions => {
    const children = groups.get(folder.id) ?? [];
    return {
      label: menuTitle(folder.title),
      submenu: children.length > 0 ? children.map(item) : [{ label: t('bookmarks.menuEmpty'), enabled: false }],
    };
  });
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
