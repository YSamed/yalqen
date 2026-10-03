import { hostOf } from '../../shared/hosts.js';
import { t } from '../../shared/i18n.js';
import { DOWNLOADS_URL } from '../../shared/types.js';
import type { ChangeFeed } from '../library/change-feed.js';
import { downloadCommands, downloadStatus, isActive, type DownloadEntry } from '../library/downloads.js';
import { escapeHtml, fillSlot } from './html.js';
import { htmlResponse, notFound, scriptResponse } from './responses.js';

const DOWNLOADS_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'";
const DOWNLOADS_MARKER = '__YALQEN_DOWNLOADS_SLOT__';

export interface DownloadsPageAssets {
  template: string;
  script: string;
}

export interface DownloadsPageSource {
  list: () => DownloadEntry[];
  changes: ChangeFeed;
}

export function renderDownloads(entries: readonly DownloadEntry[]): string {
  if (entries.length === 0) return `<p class="empty">${t('downloads.empty')}</p>`;
  const rows = entries
    .map((entry) => {
      const commands = downloadCommands(entry)
        .map(
          ([action, label]) =>
            `<a class="btn tonal" href="${DOWNLOADS_URL}${action}?id=${encodeURIComponent(entry.id)}">${label}</a>`,
        )
        .join('');
      return (
        `<li class="${entry.state}"><div class="file"><strong>${escapeHtml(entry.filename)}</strong>` +
        `<span>${escapeHtml(downloadStatus(entry))} · ${escapeHtml(hostOf(entry.url) ?? entry.url)}</span></div>` +
        `<div class="commands">${commands}</div></li>`
      );
    })
    .join('');
  const finished = entries.some((entry) => !isActive(entry));
  const clear = finished ? `<a class="clear" href="${DOWNLOADS_URL}clear">${t('downloads.clearList')}</a>` : '';
  return `<div class="summary"><span>${t('downloads.count', { count: entries.length })}</span>${clear}</div><ol>${rows}</ol>`;
}

export function serveDownloads(
  url: URL,
  assets: DownloadsPageAssets,
  { list, changes }: DownloadsPageSource,
  signal?: AbortSignal,
): Response | Promise<Response> {
  switch (url.pathname) {
    case '/downloads.js':
      return scriptResponse(assets.script);
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
      return htmlResponse(fillSlot(assets.template, DOWNLOADS_MARKER, content), DOWNLOADS_CSP);
    }
    default:
      return notFound();
  }
}
