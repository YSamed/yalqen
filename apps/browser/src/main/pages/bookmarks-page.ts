import { displayHost } from '../../shared/hosts.js';
import { t } from '../../shared/i18n.js';
import { BOOKMARKS_URL } from '../../shared/types.js';
import { bookmarksByFolder, type Bookmark, type BookmarkFolder } from '../library/bookmarks.js';
import { escapeHtml, fillSlot } from './html.js';
import { PAGE_CSP, htmlResponse, notFound, scriptResponse } from './responses.js';
import { searchFieldMarkup } from './search-field-markup.js';

const BOOKMARKS_CSP = `${PAGE_CSP}; script-src 'self'`;
const BOOKMARKS_MARKER = '__YALQEN_BOOKMARKS_SLOT__';

export interface BookmarksPageAssets {
  template: string;
  script: string;
}

export function renderBookmarks(
  folders: readonly BookmarkFolder[],
  bookmarks: readonly Bookmark[],
  query: string,
): string {
  const search = query.trim().slice(0, 200);
  const header =
    searchFieldMarkup({ action: BOOKMARKS_URL, label: t('bookmarks.search'), valueHtml: escapeHtml(search) }) +
    (search
      ? ''
      : `<form class="new-folder" action="${BOOKMARKS_URL}new-folder" method="get"><input class="field lg" name="title" placeholder="${t('bookmarks.newFolderName')}" aria-label="${t('bookmarks.newFolderName')}" required /><button class="btn lg primary">${t('bookmarks.addFolder')}</button></form>`);

  const folderTitles = new Map(folders.map((folder) => [folder.id, folder.title]));
  // Each row lists only its own folder; bookmarks.js copies the full list in when the row is edited,
  // so the page stays proportional to bookmarks plus folders instead of their product.
  const folderOptions =
    folders.length > 0
      ? `<template id="folder-options"><option value="">${t('bookmarks.noFolder')}</option>${folders
          .map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.title)}</option>`)
          .join('')}</template>`
      : '';
  const currentFolder = (folderId: string | null) => {
    const title = folderId === null ? undefined : folderTitles.get(folderId);
    return title === undefined
      ? `<option value="" selected>${t('bookmarks.noFolder')}</option>`
      : `<option value="${escapeHtml(folderId!)}" selected>${escapeHtml(title)}</option>`;
  };

  const row = (bookmark: Bookmark) => {
    const id = escapeHtml(bookmark.id);
    return (
      `<li><a class="visit" href="${escapeHtml(bookmark.url)}"><strong>${escapeHtml(bookmark.title)}</strong><span>${escapeHtml(displayHost(bookmark.url))}</span></a>` +
      `<details><summary>${t('bookmarks.edit')}</summary>` +
      `<form action="${BOOKMARKS_URL}rename" method="get"><input type="hidden" name="id" value="${id}" /><input class="field" name="title" value="${escapeHtml(bookmark.title)}" aria-label="${t('bookmarks.name')}" required /><button class="btn tonal">${t('bookmarks.save')}</button></form>` +
      (folders.length > 0
        ? `<form action="${BOOKMARKS_URL}move" method="get"><input type="hidden" name="id" value="${id}" /><select class="field" name="folder" aria-label="${t('bookmarks.folder')}" data-folder-options>${currentFolder(bookmark.folderId)}</select><button class="btn tonal">${t('bookmarks.move')}</button></form>`
        : '') +
      `<a class="danger" href="${BOOKMARKS_URL}remove?id=${encodeURIComponent(bookmark.id)}">${t('bookmarks.delete')}</a></details></li>`
    );
  };

  if (search) {
    return bookmarks.length === 0
      ? `${header}<p class="empty">${t('bookmarks.noMatches')}</p>`
      : `${header}<ol>${bookmarks.map(row).join('')}</ol>${folderOptions}`;
  }
  if (bookmarks.length === 0 && folders.length === 0) {
    return `${header}<p class="empty">${t('bookmarks.empty')}</p>`;
  }
  const groups = bookmarksByFolder(bookmarks);
  const sections = folders.map((folder) => {
    const children = groups.get(folder.id) ?? [];
    return (
      `<section><div class="folder"><h2>${escapeHtml(folder.title)}</h2><details><summary>${t('bookmarks.edit')}</summary>` +
      `<form action="${BOOKMARKS_URL}rename-folder" method="get"><input type="hidden" name="id" value="${escapeHtml(folder.id)}" /><input class="field" name="title" value="${escapeHtml(folder.title)}" aria-label="${t('bookmarks.folderName')}" required /><button class="btn tonal">${t('bookmarks.save')}</button></form>` +
      `<a class="danger" href="${BOOKMARKS_URL}remove-folder?id=${encodeURIComponent(folder.id)}">${t('bookmarks.deleteFolder')}</a></details></div>` +
      (children.length > 0
        ? `<ol>${children.map(row).join('')}</ol>`
        : `<p class="empty-folder">${t('bookmarks.folderEmpty')}</p>`) +
      '</section>'
    );
  });
  const loose = groups.get(null) ?? [];
  const looseSection = loose.length > 0 ? `<section><ol>${loose.map(row).join('')}</ol></section>` : '';
  return `${header}${sections.join('')}${looseSection}${folderOptions}`;
}

export function serveBookmarks(
  url: URL,
  assets: BookmarksPageAssets,
  bookmarks: (query: string) => { folders: BookmarkFolder[]; bookmarks: Bookmark[] },
): Response {
  switch (url.pathname) {
    case '/bookmarks.js':
      return scriptResponse(assets.script);
    case '/': {
      const query = url.searchParams.get('q') ?? '';
      const data = bookmarks(query);
      const content = renderBookmarks(data.folders, data.bookmarks, query);
      return htmlResponse(fillSlot(assets.template, BOOKMARKS_MARKER, content), BOOKMARKS_CSP);
    }
    default:
      return notFound();
  }
}
