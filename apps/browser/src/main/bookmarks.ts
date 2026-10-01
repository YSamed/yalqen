import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { displayHost } from '../shared/hosts.js';
import { BOOKMARKS_URL } from '../shared/types.js';
import { JsonFile } from './json-file.js';
import { escapeHtml } from './html.js';
import { searchFieldMarkup } from './search-field-markup.js';
import { searchKey } from './suggestions.js';

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

interface SavedBookmarks {
  version: 1;
  folders: BookmarkFolder[];
  bookmarks: Bookmark[];
}

const MAX_TITLE = 200;
const MENU_TITLE = 60;

export function canBookmark(url: string): boolean {
  return /^(https?|file):/i.test(url);
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
    const folder: BookmarkFolder = { id: randomUUID(), title: cleanTitle(title, 'Yeni klasör'), createdAt: Date.now() };
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

  saveNow(): void {
    this.json.flush();
  }

  private save(): void {
    this.urls = null;
    this.suggestionList = null;
    this.json.schedule((): SavedBookmarks => ({ version: 1, folders: this.folderList, bookmarks: this.bookmarkList }));
  }
}

function bookmarksByFolder(bookmarks: readonly Bookmark[]): Map<string | null, Bookmark[]> {
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

function menuTitle(title: string): string {
  return title.length > MENU_TITLE ? `${title.slice(0, MENU_TITLE - 1)}…` : title;
}

export interface BookmarksMenuActions {
  open(url: string): void;
  showAll(): void;
}

export function bookmarksMenuTemplate(
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
  actions: BookmarksMenuActions,
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
      submenu: children.length > 0 ? children.map(item) : [{ label: 'Boş', enabled: false }],
    };
  });
  const loose = (groups.get(null) ?? []).map(item);
  const entries = [...inFolders, ...loose];
  return [
    ...(entries.length > 0 ? entries : [{ label: 'Henüz yer imi yok', enabled: false }]),
    { type: 'separator' },
    { label: 'Tüm yer imleri', click: actions.showAll },
  ];
}

export function renderBookmarks(
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
  query: string,
): string {
  const search = query.trim().slice(0, 200);
  const header =
    searchFieldMarkup({ action: BOOKMARKS_URL, label: 'Yer imlerinde ara', valueHtml: escapeHtml(search) }) +
    (search
      ? ''
      : `<form class="new-folder" action="${BOOKMARKS_URL}new-folder" method="get"><input class="field lg" name="title" placeholder="Yeni klasör adı" aria-label="Yeni klasör adı" required /><button class="btn lg primary">Klasör ekle</button></form>`);

  const folderOptions = (current: string | null) =>
    [
      `<option value=""${current === null ? ' selected' : ''}>Klasör yok</option>`,
      ...folders.map(
        (folder) =>
          `<option value="${escapeHtml(folder.id)}"${folder.id === current ? ' selected' : ''}>${escapeHtml(folder.title)}</option>`,
      ),
    ].join('');

  const row = (bookmark: Bookmark) => {
    const id = escapeHtml(bookmark.id);
    return (
      `<li><a class="visit" href="${escapeHtml(bookmark.url)}"><strong>${escapeHtml(bookmark.title)}</strong><span>${escapeHtml(displayHost(bookmark.url))}</span></a>` +
      `<details><summary>Düzenle</summary>` +
      `<form action="${BOOKMARKS_URL}rename" method="get"><input type="hidden" name="id" value="${id}" /><input class="field" name="title" value="${escapeHtml(bookmark.title)}" aria-label="Ad" required /><button class="btn tonal">Kaydet</button></form>` +
      (folders.length > 0
        ? `<form action="${BOOKMARKS_URL}move" method="get"><input type="hidden" name="id" value="${id}" /><select class="field" name="folder" aria-label="Klasör">${folderOptions(bookmark.folderId)}</select><button class="btn tonal">Taşı</button></form>`
        : '') +
      `<a class="danger" href="${BOOKMARKS_URL}remove?id=${encodeURIComponent(bookmark.id)}">Sil</a></details></li>`
    );
  };

  if (search) {
    return bookmarks.length === 0
      ? `${header}<p class="empty">Eşleşen yer imi bulunamadı.</p>`
      : `${header}<ol>${bookmarks.map(row).join('')}</ol>`;
  }
  if (bookmarks.length === 0 && folders.length === 0) {
    return `${header}<p class="empty">Henüz yer imi yok. Bir sayfayı eklemek için adres çubuğundaki yıldıza bas veya ⌘D kullan.</p>`;
  }
  const groups = bookmarksByFolder(bookmarks);
  const sections = folders.map((folder) => {
    const children = groups.get(folder.id) ?? [];
    return (
      `<section><div class="folder"><h2>${escapeHtml(folder.title)}</h2><details><summary>Düzenle</summary>` +
      `<form action="${BOOKMARKS_URL}rename-folder" method="get"><input type="hidden" name="id" value="${escapeHtml(folder.id)}" /><input class="field" name="title" value="${escapeHtml(folder.title)}" aria-label="Klasör adı" required /><button class="btn tonal">Kaydet</button></form>` +
      `<a class="danger" href="${BOOKMARKS_URL}remove-folder?id=${encodeURIComponent(folder.id)}">Klasörü sil</a></details></div>` +
      (children.length > 0 ? `<ol>${children.map(row).join('')}</ol>` : '<p class="empty-folder">Bu klasör boş.</p>') +
      '</section>'
    );
  });
  const loose = groups.get(null) ?? [];
  const looseSection = loose.length > 0 ? `<section><ol>${loose.map(row).join('')}</ol></section>` : '';
  return `${header}${sections.join('')}${looseSection}`;
}
