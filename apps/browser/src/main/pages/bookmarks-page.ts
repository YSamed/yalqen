import { displayHost } from '../../shared/hosts.js';
import { t } from '../../shared/i18n.js';
import { BOOKMARKS_URL } from '../../shared/types.js';
import {
  bookmarksByFolder,
  bookmarkFolderPaths,
  bookmarkFoldersByParent,
  type Bookmark,
  type BookmarkFolder,
} from '../library/bookmarks.js';
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
  const paths = bookmarkFolderPaths(folders);
  const folderTitles = new Map(
    folders.map((folder) => [
      folder.id,
      (paths.get(folder.id) ?? [])
        .map((item) => item.title)
        .join(' / ')
        .slice(-800),
    ]),
  );
  const currentFolder = (folderId: string | null) => {
    const title = folderId === null ? undefined : folderTitles.get(folderId);
    return title === undefined
      ? `<option value="" selected>${t('bookmarks.noFolder')}</option>`
      : `<option value="${escapeHtml(folderId!)}" selected>${escapeHtml(title)}</option>`;
  };
  // The full tree exists once; editors clone it only when opened.
  const folderOptions = folders.length
    ? `<template id="folder-options"><option value="">${t('bookmarks.noFolder')}</option>${folders
        .map(
          (folder) =>
            `<option value="${escapeHtml(folder.id)}" data-ancestors="${escapeHtml(JSON.stringify((paths.get(folder.id) ?? []).slice(0, -1).map((item) => item.id)))}">${escapeHtml(folderTitles.get(folder.id) ?? folder.title)}</option>`,
        )
        .join('')}</template>`
    : '';
  const parentSelect = (parentId: string | null, exclude = '') =>
    `<select class="field" name="parent" aria-label="${t('bookmarks.parentFolder')}" data-folder-options data-exclude="${escapeHtml(exclude)}">${currentFolder(parentId)}</select>`;
  const header =
    `<div class="transfer"><a class="btn tonal" href="${BOOKMARKS_URL}import">${t('bookmarks.menuImport')}</a><a class="btn tonal" href="${BOOKMARKS_URL}export">${t('bookmarks.menuExport')}</a></div>` +
    searchFieldMarkup({ action: BOOKMARKS_URL, label: t('bookmarks.search'), valueHtml: escapeHtml(search) }) +
    (search
      ? ''
      : `<form class="new-folder" action="${BOOKMARKS_URL}new-folder" method="get"><input class="field lg" name="title" placeholder="${t('bookmarks.newFolderName')}" aria-label="${t('bookmarks.newFolderName')}" required />${folders.length ? parentSelect(null) : ''}<button class="btn lg primary">${t('bookmarks.addFolder')}</button></form>`) +
    (bookmarks.length
      ? `<form class="bulk" id="bulk-bookmarks" action="${BOOKMARKS_URL}move-many" method="get"><label><input type="checkbox" data-select-all />${t('bookmarks.selectAll')}</label><output data-selection-count>${t('bookmarks.selected', { count: 0 })}</output><select class="field" name="folder" aria-label="${t('bookmarks.folder')}"${folders.length ? ' data-folder-options' : ''}>${currentFolder(null)}</select><button class="btn tonal" data-bulk-action disabled>${t('bookmarks.moveSelected')}</button><button class="btn danger" formaction="${BOOKMARKS_URL}remove-many" data-bulk-action data-confirm="${escapeHtml(t('bookmarks.confirmDeleteSelected'))}" disabled>${t('bookmarks.deleteSelected')}</button></form>`
      : '');
  const row = (bookmark: Bookmark) => {
    const id = escapeHtml(bookmark.id);
    return (
      `<li><input type="checkbox" form="bulk-bookmarks" name="id" value="${id}" aria-label="${escapeHtml(t('bookmarks.selectBookmark', { title: bookmark.title }))}" data-bookmark-selection /><a class="visit" href="${escapeHtml(bookmark.url)}"><strong>${escapeHtml(bookmark.title)}</strong><span>${escapeHtml(displayHost(bookmark.url))}</span></a>` +
      `<details><summary>${t('bookmarks.edit')}</summary><form action="${BOOKMARKS_URL}rename" method="get"><input type="hidden" name="id" value="${id}" /><input class="field" name="title" value="${escapeHtml(bookmark.title)}" aria-label="${t('bookmarks.name')}" required /><input class="field" name="url" value="${escapeHtml(bookmark.url)}" aria-label="${t('bookmarks.address')}" required /><button class="btn tonal">${t('bookmarks.save')}</button></form>` +
      (folders.length
        ? `<form action="${BOOKMARKS_URL}move" method="get"><input type="hidden" name="id" value="${id}" /><select class="field" name="folder" aria-label="${t('bookmarks.folder')}" data-folder-options>${currentFolder(bookmark.folderId)}</select><button class="btn tonal">${t('bookmarks.move')}</button></form>`
        : '') +
      `<a class="danger" href="${BOOKMARKS_URL}remove?id=${encodeURIComponent(bookmark.id)}">${t('bookmarks.delete')}</a></details></li>`
    );
  };
  if (search)
    return `${header}${bookmarks.length ? `<ol>${bookmarks.map(row).join('')}</ol>` : `<p class="empty">${t('bookmarks.noMatches')}</p>`}${folderOptions}`;
  if (!bookmarks.length && !folders.length) return `${header}<p class="empty">${t('bookmarks.empty')}</p>`;
  const groups = bookmarksByFolder(bookmarks);
  const folderGroups = bookmarkFoldersByParent(folders);
  const sections: string[] = [];
  const seen = new Set<string>();
  const section = (folder: BookmarkFolder, depth: number) => {
    if (seen.has(folder.id) || depth >= 128) return;
    seen.add(folder.id);
    const children = groups.get(folder.id) ?? [];
    sections.push(
      `<section data-folder-id="${escapeHtml(folder.id)}" style="margin-left:${Math.min(depth, 8) * 12}px"><div class="folder"><h2>${escapeHtml(folderTitles.get(folder.id) ?? folder.title)}</h2><details><summary>${t('bookmarks.edit')}</summary>` +
        `<form action="${BOOKMARKS_URL}rename-folder" method="get"><input type="hidden" name="id" value="${escapeHtml(folder.id)}" /><input class="field" name="title" value="${escapeHtml(folder.title)}" aria-label="${t('bookmarks.folderName')}" required /><button class="btn tonal">${t('bookmarks.save')}</button></form>` +
        `<form action="${BOOKMARKS_URL}move-folder" method="get"><input type="hidden" name="id" value="${escapeHtml(folder.id)}" />${parentSelect(folder.parentId ?? null, folder.id)}<button class="btn tonal">${t('bookmarks.move')}</button></form>` +
        `<a class="danger" href="${BOOKMARKS_URL}remove-folder?id=${encodeURIComponent(folder.id)}">${t('bookmarks.deleteFolder')}</a></details></div>` +
        (children.length
          ? `<ol>${children.map(row).join('')}</ol>`
          : `<p class="empty-folder">${t('bookmarks.folderEmpty')}</p>`) +
        '</section>',
    );
    for (const child of folderGroups.get(folder.id) ?? []) section(child, depth + 1);
  };
  for (const folder of folderGroups.get(null) ?? []) section(folder, 0);
  const loose = groups.get(null) ?? [];
  return `${header}${sections.join('')}${loose.length ? `<section><ol>${loose.map(row).join('')}</ol></section>` : ''}${folderOptions}`;
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
