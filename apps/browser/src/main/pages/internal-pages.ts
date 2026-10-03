import fs from 'node:fs';
import path from 'node:path';
import { protocol, type Session } from 'electron';
import { getLocale, t, type MessageKey } from '../../shared/i18n.js';
import { INTERNAL_SCHEME } from '../../shared/types.js';
import type { HistoryEntry } from '../library/history.js';
import { serveBookmarks, type BookmarksPageAssets } from './bookmarks-page.js';
import { serveDownloads, type DownloadsPageAssets, type DownloadsPageSource } from './downloads-page.js';
import { serveHistory } from './history-page.js';
import { escapeHtml, fillSlot } from './html.js';
import { serveNewTab, type NewTabAssets, type NewTabSources } from './new-tab-page.js';
import { htmlResponse, notFound } from './responses.js';
import type { Bookmark, BookmarkFolder } from '../library/bookmarks.js';

const SETTINGS_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
const CONTROLS_MARKER = '__YALQEN_CONTROLS_SLOT__';
const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export interface InternalPageFiles {
  newTab: string;
  newTabScript: string;
  history: string;
  downloads: string;
  bookmarks: string;
  settings: string;
}

export interface InternalPageSources extends NewTabSources {
  visits: (query: string) => HistoryEntry[];
  downloads: DownloadsPageSource;
  bookmarks: (query: string) => { folders: BookmarkFolder[]; bookmarks: Bookmark[] };
}

export interface InternalPages {
  newTab: NewTabAssets;
  history: string;
  downloads: DownloadsPageAssets;
  bookmarks: BookmarksPageAssets;
  settings: { template: string; asset: (name: string) => Buffer<ArrayBuffer> | null };
}

// The locale is fixed for the whole run, so page templates are translated once when loaded.
export function localizePage(page: string): string {
  return page
    .replace('<html lang="en">', `<html lang="${getLocale()}">`)
    .replace(/\{\{([\w.]+)\}\}/g, (_match, key: string) => escapeHtml(t(key as MessageKey)));
}

export function loadInternalPages(files: InternalPageFiles): InternalPages {
  const publicDir = path.dirname(files.newTab);
  const controlsCss = fs.readFileSync(path.join(publicDir, 'controls.css'), 'utf8');
  const readPage = (file: string) =>
    localizePage(fillSlot(fs.readFileSync(file, 'utf8'), CONTROLS_MARKER, controlsCss));
  const readScript = (page: string, name: string) => fs.readFileSync(path.join(path.dirname(page), name), 'utf8');
  const settingsAssets = path.join(path.dirname(files.settings), 'assets');
  const assetCache = new Map<string, Buffer<ArrayBuffer>>();
  return {
    newTab: {
      template: readPage(files.newTab),
      script: fs.readFileSync(files.newTabScript, 'utf8'),
      mark: fs.readFileSync(path.join(publicDir, 'newtab-mark.png')),
    },
    history: readPage(files.history),
    downloads: { template: readPage(files.downloads), script: readScript(files.downloads, 'downloads.js') },
    bookmarks: { template: readPage(files.bookmarks), script: readScript(files.bookmarks, 'bookmarks.js') },
    settings: {
      template: localizePage(fs.readFileSync(files.settings, 'utf8')),
      asset: (name) => {
        const cached = assetCache.get(name);
        if (cached) return cached;
        try {
          const content = fs.readFileSync(path.join(settingsAssets, name));
          assetCache.set(name, content);
          return content;
        } catch {
          return null;
        }
      },
    },
  };
}

function serveSettings(pathname: string, settings: InternalPages['settings']): Response {
  if (!pathname.startsWith('/assets/')) return htmlResponse(settings.template, SETTINGS_CSP);
  const name = pathname.slice('/assets/'.length);
  const type = ASSET_TYPES[path.extname(name)];
  if (!type || name !== path.basename(name)) return notFound();
  const content = settings.asset(name);
  return content ? new Response(content, { headers: { 'content-type': type } }) : notFound();
}

export function serveInternalPages(session: Session, pages: InternalPages, sources: InternalPageSources): void {
  session.protocol.handle(INTERNAL_SCHEME, (request) => {
    const url = new URL(request.url);
    switch (url.host) {
      case 'settings':
        return serveSettings(url.pathname, pages.settings);
      case 'newtab':
        return serveNewTab(url, pages.newTab, sources);
      case 'downloads':
        return serveDownloads(url, pages.downloads, sources.downloads, request.signal);
      case 'history':
        return serveHistory(url, pages.history, sources.visits);
      case 'bookmarks':
        return serveBookmarks(url, pages.bookmarks, sources.bookmarks);
      default:
        return notFound();
    }
  });
}
