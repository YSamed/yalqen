import fs from 'node:fs';
import path from 'node:path';
import { protocol, type Session } from 'electron';
import { displayHost } from '../shared/hosts.js';
import { getLocale, t, type MessageKey } from '../shared/i18n.js';
import { HISTORY_URL, INTERNAL_SCHEME, NEW_TAB_URL } from '../shared/types.js';
import { renderBookmarks, type Bookmark, type BookmarkFolder } from './bookmarks.js';
import type { ChangeFeed } from './change-feed.js';
import { renderDownloads, type DownloadEntry } from './downloads.js';
import type { HistoryEntry } from './history.js';
import { escapeHtml } from './html.js';
import type { AddressSuggestion } from '../shared/types.js';
import { searchFieldMarkup } from './search-field-markup.js';
import type { RecentPage } from './tabs.js';

const INTERNAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:";
const DOWNLOADS_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'";
const NEW_TAB_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; script-src 'self'; connect-src 'self'";
const SETTINGS_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
const PINNED_MARKER = '__YALQEN_PINNED_SLOT__';
const WELCOME_MARKER = '__YALQEN_WELCOME_SLOT__';
const TIPS_MARKER = '__YALQEN_TIPS_SLOT__';
const REPO_PROMPT_MARKER = '__YALQEN_REPO_PROMPT_SLOT__';
const HISTORY_MARKER = '__YALQEN_HISTORY_SLOT__';
const DOWNLOADS_MARKER = '__YALQEN_DOWNLOADS_SLOT__';
const BOOKMARKS_MARKER = '__YALQEN_BOOKMARKS_SLOT__';
const CONTROLS_MARKER = '__YALQEN_CONTROLS_SLOT__';
const FORGET_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>';
const SMALL_FORGET_ICON = FORGET_ICON.replace('width="14" height="14"', 'width="11" height="11"');
// toLocaleDateString builds a new formatter per call, which made a full history page block the main process.
let dateFormats: { locale: string; day: Intl.DateTimeFormat; time: Intl.DateTimeFormat } | undefined;
function getDateFormats() {
  const locale = getLocale();
  if (dateFormats?.locale !== locale) {
    dateFormats = {
      locale,
      day: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    };
  }
  return dateFormats;
}

export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function renderPinned(pages: RecentPage[]): string {
  if (pages.length === 0) return '';
  const items = pages
    .map((page) => {
      const host = displayHost(page.url);
      const icon = page.faviconUrl?.startsWith('https:')
        ? `<img src="${escapeHtml(page.faviconUrl)}" alt="" width="24" height="24" />`
        : `<span class="letter">${escapeHtml(host.charAt(0).toLocaleUpperCase(getLocale()))}</span>`;
      return `<li><a href="${escapeHtml(page.url)}" title="${escapeHtml(page.title || host)}"><span class="tile">${icon}</span><span class="name">${escapeHtml(host)}</span></a></li>`;
    })
    .join('');
  return `<nav class="pinned" aria-label="${t('internalPages.pinned')}"><ul>${items}</ul></nav>`;
}

function renderWelcome(): string {
  return `<section class="welcome" aria-labelledby="welcome-title">
    <h1 id="welcome-title">${t('internalPages.welcomeTitle')}</h1>
    <p>${t('internalPages.welcomeText')}</p>
  </section>`;
}

function renderTips(): string {
  return `<ul class="tips" aria-label="${t('internalPages.tips')}">
    <li><strong>${t('internalPages.tipTabsTitle')}</strong><small>${t('internalPages.tipTabsText')}</small></li>
    <li><strong>${t('internalPages.tipPinTitle')}</strong><small>${t('internalPages.tipPinText')}</small></li>
    <li><strong>${t('internalPages.tipAdsTitle')}</strong><small>${t('internalPages.tipAdsText')}</small></li>
  </ul>`;
}

function renderRepoPrompt(): string {
  return `<aside class="repo-prompt" aria-labelledby="repo-prompt-title">
    <a class="icon-btn sm tone-muted repo-prompt-close" href="${NEW_TAB_URL}repo?action=close" aria-label="${t('internalPages.close')}">${SMALL_FORGET_ICON}</a>
    <strong id="repo-prompt-title">${t('internalPages.repoTitle')}</strong>
    <p>${t('internalPages.repoText')}</p>
    <div class="repo-prompt-actions">
      <a class="btn primary" href="${NEW_TAB_URL}repo?action=star">${t('internalPages.repoStar')}</a>
      <a class="btn ghost" href="${NEW_TAB_URL}repo?action=later">${t('internalPages.repoLater')}</a>
    </div>
  </aside>`;
}

export function renderHistory(entries: HistoryEntry[], query: string): string {
  const search = query.trim().slice(0, 200);
  const form = searchFieldMarkup({
    action: HISTORY_URL,
    label: t('internalPages.searchHistory'),
    valueHtml: escapeHtml(search),
    autofocus: true,
  });
  if (entries.length === 0) {
    const message = search ? t('internalPages.noMatchingPages') : t('internalPages.noHistory');
    return `${form}<p class="empty">${message}</p>`;
  }
  const formats = getDateFormats();
  let previousDay = '';
  const rows = entries
    .map((entry) => {
      const visitedAt = new Date(entry.visitedAt);
      const day = formats.day.format(visitedAt);
      const heading = day === previousDay ? '' : `<li class="day"><h2>${escapeHtml(day)}</h2></li>`;
      previousDay = day;
      const time = formats.time.format(visitedAt);
      const host = displayHost(entry.url);
      const remove = `${HISTORY_URL}delete?id=${encodeURIComponent(entry.id)}`;
      return `${heading}<li><time>${escapeHtml(time)}</time><a class="visit" href="${escapeHtml(entry.url)}"><strong>${escapeHtml(entry.title || host)}</strong><span>${escapeHtml(host)}</span></a><a class="icon-btn tone-muted remove" href="${escapeHtml(remove)}" aria-label="${t('internalPages.removeFromHistoryNamed', { title: escapeHtml(entry.title || host) })}" title="${t('internalPages.removeFromHistory')}">${FORGET_ICON}</a></li>`;
    })
    .join('');
  const clear = search
    ? ''
    : `<a class="clear" href="${HISTORY_URL}confirm-clear">${t('internalPages.clearAllHistory')}</a>`;
  return `${form}<div class="results"><div class="summary"><span>${t('internalPages.visitCount', { count: entries.length })}</span>${clear}</div><ol>${rows}</ol></div>`;
}

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export interface InternalPageFiles {
  newTab: string;
  newTabScript: string;
  history: string;
  downloads: string;
  bookmarks: string;
  settings: string;
}

export interface InternalPageSources {
  pinned: () => RecentPage[];
  visits: (query: string) => HistoryEntry[];
  downloads: { list: () => DownloadEntry[]; changes: ChangeFeed };
  bookmarks: (query: string) => { folders: BookmarkFolder[]; bookmarks: Bookmark[] };
  showWelcome: () => boolean;
  showRepoPrompt: () => boolean;
  suggestions: (query: string) => AddressSuggestion[];
}

export interface InternalPages {
  newTab: string;
  newTabScript: string;
  newTabMark: Buffer<ArrayBuffer>;
  history: string;
  downloads: string;
  downloadsScript: string;
  bookmarks: string;
  settings: string;
  settingsAsset: (name: string) => Buffer<ArrayBuffer> | null;
}

// A string replacement would expand `$&`, `` $` `` and similar patterns found in page titles.
export function fillSlot(page: string, marker: string, content: string): string {
  return page.replace(marker, () => content);
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
  const settingsAssets = path.join(path.dirname(files.settings), 'assets');
  const assetCache = new Map<string, Buffer<ArrayBuffer>>();
  return {
    newTab: readPage(files.newTab),
    newTabScript: fs.readFileSync(files.newTabScript, 'utf8'),
    newTabMark: fs.readFileSync(path.join(publicDir, 'newtab-mark.png')),
    history: readPage(files.history),
    downloads: readPage(files.downloads),
    downloadsScript: fs.readFileSync(path.join(path.dirname(files.downloads), 'downloads.js'), 'utf8'),
    bookmarks: readPage(files.bookmarks),
    settings: localizePage(fs.readFileSync(files.settings, 'utf8')),
    settingsAsset: (name) => {
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
  };
}

const notFound = () => new Response('Not found', { status: 404 });

function html(body: string, csp: string, noStore = true): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
      ...(noStore ? { 'cache-control': 'no-store' } : {}),
    },
  });
}

function script(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function serveSettings(pathname: string, pages: InternalPages): Response {
  if (!pathname.startsWith('/assets/')) return html(pages.settings, SETTINGS_CSP);
  const name = pathname.slice('/assets/'.length);
  const type = ASSET_TYPES[path.extname(name)];
  if (!type || name !== path.basename(name)) return notFound();
  const content = pages.settingsAsset(name);
  return content ? new Response(content, { headers: { 'content-type': type } }) : notFound();
}

function serveHistory(pathname: string, query: string, pages: InternalPages, sources: InternalPageSources): Response {
  let content: string;
  if (pathname === '/') {
    content = renderHistory(sources.visits(query), query);
  } else if (pathname === '/confirm-clear') {
    content = `<div class="confirm"><h2>${t('internalPages.confirmClearTitle')}</h2><p>${t('internalPages.confirmClearText')}</p><div class="confirm-actions"><a class="btn lg tonal" href="${HISTORY_URL}">${t('internalPages.cancel')}</a><a class="btn lg danger" href="${HISTORY_URL}clear">${t('internalPages.clearHistory')}</a></div></div>`;
  } else {
    return notFound();
  }
  return html(fillSlot(pages.history, HISTORY_MARKER, content), INTERNAL_CSP);
}

function serveDownloads(
  url: URL,
  pages: InternalPages,
  sources: InternalPageSources,
  signal?: AbortSignal,
): Response | Promise<Response> {
  const { list, changes } = sources.downloads;
  switch (url.pathname) {
    case '/downloads.js':
      return script(pages.downloadsScript);
    case '/changes': {
      const since = Number(url.searchParams.get('since'));
      return changes
        .next(since, undefined, signal)
        .then((version) =>
          Response.json(
            { version, ...(version !== since && { html: renderDownloads(list()) }) },
            { headers: { 'cache-control': 'no-store' } },
          ),
        );
    }
    case '/': {
      const content = `<div id="downloads" data-version="${changes.version}">${renderDownloads(list())}</div>`;
      return html(fillSlot(pages.downloads, DOWNLOADS_MARKER, content), DOWNLOADS_CSP);
    }
    default:
      return notFound();
  }
}

function serveNewTab(url: URL, pages: InternalPages, sources: InternalPageSources): Response {
  switch (url.pathname) {
    case '/suggestions.js':
      return script(pages.newTabScript);
    case '/mark.png':
      return new Response(pages.newTabMark, {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' },
      });
    case '/suggestions':
      return Response.json(sources.suggestions(url.searchParams.get('q') ?? ''), {
        headers: { 'cache-control': 'no-store' },
      });
    case '/': {
      const welcomeVisible = sources.showWelcome();
      const slots: [string, string][] = [
        [WELCOME_MARKER, welcomeVisible ? renderWelcome() : ''],
        [PINNED_MARKER, renderPinned(sources.pinned())],
        [TIPS_MARKER, welcomeVisible ? renderTips() : ''],
        [REPO_PROMPT_MARKER, !welcomeVisible && sources.showRepoPrompt() ? renderRepoPrompt() : ''],
      ];
      const body = slots.reduce((page, [marker, content]) => fillSlot(page, marker, content), pages.newTab);
      return html(body, NEW_TAB_CSP, false);
    }
    default:
      return notFound();
  }
}

export function serveInternalPages(session: Session, pages: InternalPages, sources: InternalPageSources): void {
  session.protocol.handle(INTERNAL_SCHEME, (request) => {
    const url = new URL(request.url);
    switch (url.host) {
      case 'settings':
        return serveSettings(url.pathname, pages);
      case 'newtab':
        return serveNewTab(url, pages, sources);
      case 'downloads':
        return serveDownloads(url, pages, sources, request.signal);
      case 'history':
        return serveHistory(url.pathname, url.searchParams.get('q') ?? '', pages, sources);
      case 'bookmarks': {
        if (url.pathname !== '/') return notFound();
        const query = url.searchParams.get('q') ?? '';
        const data = sources.bookmarks(query);
        return html(
          fillSlot(pages.bookmarks, BOOKMARKS_MARKER, renderBookmarks(data.folders, data.bookmarks, query)),
          INTERNAL_CSP,
        );
      }
      default:
        return notFound();
    }
  });
}
