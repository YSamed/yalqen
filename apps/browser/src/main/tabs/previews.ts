import type { Session, WebContents } from 'electron';
import {
  calendarEvents,
  gmailFeedUrl,
  parseGmailFeed,
  previewKind,
  type CalendarChip,
  type PreviewContent,
} from '../../shared/previews.js';

export const PREVIEW_WORLD_ID = 1050;
const READ_TIMEOUT_MS = 2500;

export const CALENDAR_READ_SCRIPT = `(() => {
  const chips = [];
  for (const chip of document.querySelectorAll('[data-eventid]')) {
    const column = chip.closest('[data-datekey]');
    const description = chip.querySelector('.XuJrye');
    if (!column || !description) continue;
    const day = column.getBoundingClientRect();
    const box = chip.getBoundingClientRect();
    if (!(day.height > 0)) continue;
    const title =
      chip.querySelector('.I0UMhf')?.textContent ||
      (description.textContent || '').split(', ')[1] ||
      '';
    chips.push({
      id: chip.getAttribute('data-eventid') || '',
      dateKey: Number(column.getAttribute('data-datekey')),
      title: title.slice(0, 200),
      top: ((box.top - day.top) / day.height) * 1440,
      bottom: ((box.bottom - day.top) / day.height) * 1440,
    });
  }
  return { columns: document.querySelectorAll('[data-datekey]').length, chips: chips.slice(0, 200) };
})()`;

export const CALENDAR_OPEN_SCRIPT = (id: string) => `(() => {
  const chip = [...document.querySelectorAll('[data-eventid]')].find((node) => node.getAttribute('data-eventid') === ${JSON.stringify(id)});
  chip?.scrollIntoView({ block: 'center' });
  chip?.click();
  return Boolean(chip);
})()`;

function chipsFrom(read: unknown): CalendarChip[] | null {
  const { columns, chips: value } = (typeof read === 'object' && read !== null ? read : {}) as {
    columns?: unknown;
    chips?: unknown;
  };
  if (typeof columns !== 'number' || columns === 0 || !Array.isArray(value)) return null;
  return value.flatMap((item): CalendarChip[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, dateKey, title, top, bottom } = item as Record<string, unknown>;
    return typeof id === 'string' &&
      typeof title === 'string' &&
      [dateKey, top, bottom].every((value) => typeof value === 'number' && Number.isFinite(value))
      ? [{ id, title, dateKey: dateKey as number, top: top as number, bottom: bottom as number }]
      : [];
  });
}

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), READ_TIMEOUT_MS))]);
}

const FEED_SCRIPT = (url: string) =>
  `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then((response) => response.ok ? response.text() : '')`;

export interface PreviewTab {
  id: string | null;
  url: string;
  contents: WebContents | null;
}

export interface PreviewSources {
  session: Session;
  readInTab(contents: WebContents, code: string): Promise<unknown>;
}

async function mailPreview(tab: PreviewTab, sources: PreviewSources): Promise<PreviewContent> {
  const feed = gmailFeedUrl(tab.url);
  const fromSession = await withTimeout(
    sources.session
      .fetch(feed, { credentials: 'include', redirect: 'manual' })
      .then((response) => (response.ok ? response.text() : ''))
      .catch(() => ''),
    '',
  );
  let preview = parseGmailFeed(fromSession);
  if (!preview && tab.contents) {
    const fromPage = await withTimeout(
      sources.readInTab(tab.contents, FEED_SCRIPT(feed)).catch(() => ''),
      '',
    );
    preview = typeof fromPage === 'string' ? parseGmailFeed(fromPage) : null;
  }
  return preview ?? { kind: 'unavailable', site: 'mail' };
}

async function calendarPreview(tab: PreviewTab, sources: PreviewSources): Promise<PreviewContent> {
  if (!tab.contents) return { kind: 'unavailable', site: 'calendar' };
  const chips = chipsFrom(
    await withTimeout(
      sources.readInTab(tab.contents, CALENDAR_READ_SCRIPT).catch(() => null),
      null,
    ),
  );
  return chips
    ? { kind: 'calendar', events: calendarEvents(chips, Date.now()) }
    : { kind: 'unavailable', site: 'calendar' };
}

export function readPreview(tab: PreviewTab, sources: PreviewSources): Promise<PreviewContent> | null {
  const kind = previewKind(tab.url);
  if (kind === 'mail') return mailPreview(tab, sources);
  if (kind === 'calendar') return calendarPreview(tab, sources);
  return null;
}
