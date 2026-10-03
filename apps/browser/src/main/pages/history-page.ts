import { displayHost } from '../../shared/hosts.js';
import { getLocale, t, type MessageKey } from '../../shared/i18n.js';
import { HISTORY_URL } from '../../shared/types.js';
import type { HistoryEntry } from '../library/history.js';
import { FORGET_ICON, escapeHtml, fillSlot } from './html.js';
import { PAGE_CSP, htmlResponse, notFound } from './responses.js';
import { searchFieldMarkup } from './search-field-markup.js';

const HISTORY_MARKER = '__YALQEN_HISTORY_SLOT__';

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

// Splits a message around one parameter so a long list can reuse the translation for every row.
function messageAround(key: MessageKey, param: string): (value: string) => string {
  const [before, after = ''] = t(key, { [param]: '\u0000' }).split('\u0000');
  return (value) => `${before}${value}${after}`;
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
  const removeLabel = messageAround('internalPages.removeFromHistoryNamed', 'title');
  const removeTitle = t('internalPages.removeFromHistory');
  let previousDay = '';
  let dayStart = Infinity;
  let dayEnd = -Infinity;
  const rows = entries
    .map((entry) => {
      const visitedAt = new Date(entry.visitedAt);
      let heading = '';
      // Formatting the day for every row dominated the page; it only changes at local midnight.
      if (entry.visitedAt < dayStart || entry.visitedAt >= dayEnd) {
        const [year, month, date] = [visitedAt.getFullYear(), visitedAt.getMonth(), visitedAt.getDate()];
        dayStart = new Date(year, month, date).getTime();
        dayEnd = new Date(year, month, date + 1).getTime();
        const day = formats.day.format(visitedAt);
        if (day !== previousDay) heading = `<li class="day"><h2>${escapeHtml(day)}</h2></li>`;
        previousDay = day;
      }
      const time = formats.time.format(visitedAt);
      const host = displayHost(entry.url);
      const title = escapeHtml(entry.title || host);
      const remove = `${HISTORY_URL}delete?id=${encodeURIComponent(entry.id)}`;
      return `${heading}<li><time>${escapeHtml(time)}</time><a class="visit" href="${escapeHtml(entry.url)}"><strong>${title}</strong><span>${escapeHtml(host)}</span></a><a class="icon-btn tone-muted remove" href="${escapeHtml(remove)}" aria-label="${removeLabel(title)}" title="${removeTitle}">${FORGET_ICON}</a></li>`;
    })
    .join('');
  const clear = search
    ? ''
    : `<a class="clear" href="${HISTORY_URL}confirm-clear">${t('internalPages.clearAllHistory')}</a>`;
  return `${form}<div class="results"><div class="summary"><span>${t('internalPages.visitCount', { count: entries.length })}</span>${clear}</div><ol>${rows}</ol></div>`;
}

function renderConfirmClear(): string {
  return `<div class="confirm"><h2>${t('internalPages.confirmClearTitle')}</h2><p>${t('internalPages.confirmClearText')}</p><div class="confirm-actions"><a class="btn lg tonal" href="${HISTORY_URL}">${t('internalPages.cancel')}</a><a class="btn lg danger" href="${HISTORY_URL}clear">${t('internalPages.clearHistory')}</a></div></div>`;
}

export function serveHistory(url: URL, template: string, visits: (query: string) => HistoryEntry[]): Response {
  let content: string;
  if (url.pathname === '/') {
    const query = url.searchParams.get('q') ?? '';
    content = renderHistory(visits(query), query);
  } else if (url.pathname === '/confirm-clear') {
    content = renderConfirmClear();
  } else {
    return notFound();
  }
  return htmlResponse(fillSlot(template, HISTORY_MARKER, content), PAGE_CSP);
}
