import { displayHost } from '../../shared/hosts.js';
import { getLocale, t } from '../../shared/i18n.js';
import { ARCHIVE_URL } from '../../shared/types.js';
import type { SavedTab } from '../tabs/persistence.js';
import { escapeHtml, fillSlot } from './html.js';
import { PAGE_CSP, htmlResponse, notFound } from './responses.js';

const ARCHIVE_MARKER = '__YALQEN_ARCHIVE_SLOT__';

export function renderArchive(tabs: readonly SavedTab[]): string {
  if (tabs.length === 0) return `<p class="empty">${t('archivePage.empty')}</p>`;
  const time = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  const rows = tabs
    .toReversed()
    .map((tab) => {
      const host = displayHost(tab.url);
      const title = escapeHtml(tab.title || host);
      const restore = `${ARCHIVE_URL}restore?id=${encodeURIComponent(tab.id)}`;
      const closed = tab.closedAt ? `<time>${escapeHtml(time.format(tab.closedAt))}</time>` : '';
      return `<li>${closed}<a class="visit" href="${escapeHtml(restore)}" aria-label="${escapeHtml(t('archivePage.restore', { title: tab.title || host }))}"><strong>${title}</strong><span>${escapeHtml(host)}</span></a></li>`;
    })
    .join('');
  return `<div class="results"><div class="summary"><span>${t('archivePage.count', { count: tabs.length })}</span></div><ol>${rows}</ol></div>`;
}

export function serveArchive(url: URL, template: string, tabs: readonly SavedTab[]): Response {
  if (url.pathname !== '/') return notFound();
  return htmlResponse(fillSlot(template, ARCHIVE_MARKER, renderArchive(tabs)), PAGE_CSP);
}
