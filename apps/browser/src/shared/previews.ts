import { validAnchor, validTheme, type TooltipTheme } from './tooltip.js';
import type { AnchorRect } from './types.js';
import type { MessageKey } from './locales/en.js';

// Hover previews: a glance at a site's unread mail or next events from its tab, without switching to it.
export type PreviewKind = 'mail' | 'calendar';

export interface MailMessage {
  from: string;
  subject: string;
  // Epoch milliseconds, or null when the feed gave no usable date.
  at: number | null;
  // The conversation in Gmail, which a click on the message opens.
  link: string | null;
}

export interface CalendarEvent {
  // The event chip's id in the Calendar page, which a click on the event opens.
  id: string;
  title: string;
  start: number;
  end: number;
}

export type PreviewContent =
  | { kind: 'mail'; unread: number; messages: MailMessage[] }
  | { kind: 'calendar'; events: CalendarEvent[] }
  // The data could not be read: the tab is not loaded, the user is signed out or the page changed.
  | { kind: 'unavailable'; site: PreviewKind };

export interface PreviewRequest {
  // The hovered tab, or null for a favourite, which is matched to an open tab by its site.
  tabId: string | null;
  url: string;
  anchor: AnchorRect;
  theme: TooltipTheme;
}

export const PREVIEW_MESSAGES = 3;
export const PREVIEW_EVENTS = 3;

export function previewKind(rawUrl: string): PreviewKind | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'mail.google.com' && url.pathname.startsWith('/mail/')) return 'mail';
  if (url.hostname === 'calendar.google.com' && url.pathname.startsWith('/calendar/')) return 'calendar';
  return null;
}

// Gmail serves the signed-in account's unread inbox as an Atom feed; the account index ("u/1") follows the tab.
export function gmailFeedUrl(rawUrl: string): string {
  const account = /^\/mail\/u\/(\d+)\//.exec(new URL(rawUrl).pathname)?.[1] ?? '0';
  return `https://mail.google.com/mail/u/${account}/feed/atom`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Only links back into Gmail are kept, since the preview opens them in a tab.
function gmailLink(entry: string): string | null {
  const href = /<link\b[^>]*\bhref="([^"]+)"/.exec(entry)?.[1];
  if (!href) return null;
  try {
    const url = new URL(decode(href));
    return url.protocol === 'https:' && url.hostname === 'mail.google.com' ? url.href : null;
  } catch {
    return null;
  }
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decode(match[1]) : null;
}

// The feed is plain Atom 0.3 with no nested markup in the fields read here, so a full XML parser is not needed.
export function parseGmailFeed(xml: string): PreviewContent | null {
  if (!/<feed[\s>]/.test(xml)) return null;
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  const messages = entries.slice(0, PREVIEW_MESSAGES).map((entry): MailMessage => {
    const author = /<author>([\s\S]*?)<\/author>/.exec(entry)?.[1] ?? '';
    const issued = Date.parse(tag(entry, 'issued') ?? '');
    return {
      from: tag(author, 'name') || tag(author, 'email') || '',
      subject: tag(entry, 'title') ?? '',
      at: Number.isFinite(issued) ? issued : null,
      link: gmailLink(entry),
    };
  });
  const fullcount = Number(tag(xml, 'fullcount'));
  return {
    kind: 'mail',
    unread: Number.isInteger(fullcount) && fullcount >= entries.length ? fullcount : entries.length,
    messages,
  };
}

// What the Calendar tab's reader reports for each event chip in its day columns.
export interface CalendarChip {
  id: string;
  dateKey: number;
  title: string;
  // Minutes after midnight, from the chip's position in its day column.
  top: number;
  bottom: number;
}

// Google Calendar numbers its day columns as ((year - 1970) << 9) | (month << 5) | day.
export function decodeDateKey(key: number): { year: number; month: number; day: number } | null {
  if (!Number.isInteger(key) || key <= 0) return null;
  const day = key & 31;
  const month = (key >> 5) & 15;
  const year = 1970 + (key >> 9);
  return month >= 1 && month <= 12 && day >= 1 ? { year, month, day } : null;
}

// Positions are a few pixels off the hour lines, so the start snaps to the nearest and the end up to the next
// five minutes: a 17:29–18:27 chip is the 17:30–18:30 event.
export function calendarEvents(chips: readonly CalendarChip[], now: number): CalendarEvent[] {
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const chip of chips) {
    const date = decodeDateKey(chip.dateKey);
    const title = chip.title.trim();
    if (!date || !title || seen.has(chip.id) || !(chip.bottom > chip.top)) continue;
    seen.add(chip.id);
    const startMinutes = Math.round(chip.top / 5) * 5;
    const endMinutes = Math.max(startMinutes + 5, Math.ceil(chip.bottom / 5) * 5);
    const start = new Date(date.year, date.month - 1, date.day, 0, startMinutes).getTime();
    const end = new Date(date.year, date.month - 1, date.day, 0, endMinutes).getTime();
    if (end > now) events.push({ id: chip.id, title, start, end });
  }
  return events.sort((a, b) => a.start - b.start || a.end - b.end).slice(0, PREVIEW_EVENTS);
}

export interface PreviewSize {
  width: number;
  height: number;
}

export const PREVIEW_GAP = 8;
const EDGE = 8;

// Beside the hovered tile or row, top-aligned with it, on the side with room; a toolbar tab, which has page
// below it rather than beside it, gets the preview underneath.
export function placePreview(anchor: AnchorRect, size: PreviewSize, area: PreviewSize): { x: number; y: number } {
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, area.height - size.height - EDGE));
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, area.width - size.width - EDGE));
  const right = anchor.x + anchor.width + PREVIEW_GAP;
  const left = anchor.x - PREVIEW_GAP - size.width;
  if (anchor.width < area.width / 2 && right + size.width <= area.width - EDGE)
    return { x: Math.round(right), y: Math.round(clampY(anchor.y)) };
  if (left >= EDGE) return { x: Math.round(left), y: Math.round(clampY(anchor.y)) };
  return { x: Math.round(clampX(anchor.x)), y: Math.round(clampY(anchor.y + anchor.height + PREVIEW_GAP)) };
}

// The request comes from the browser interface over IPC; anything unexpected is dropped.
export function validPreviewRequest(value: unknown): PreviewRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tabId, url, anchor, theme } = value as Record<string, unknown>;
  if (tabId !== null && (typeof tabId !== 'string' || tabId.length > 100)) return null;
  if (typeof url !== 'string' || url.length > 4096 || !previewKind(url)) return null;
  const rect = validAnchor(anchor);
  const colors = validTheme(theme);
  return rect && colors ? { tabId, url, anchor: rect, theme: colors } : null;
}

export interface PreviewItem {
  primary: string;
  secondary: string;
  meta: string;
  // An event happening now, highlighted in the accent colour.
  live: boolean;
}

// What the preview shows, already worded and formatted, so the overlay only lays it out.
export interface PreviewView {
  heading: string | null;
  items: PreviewItem[];
  // Shown instead of items: nothing unread, no more events, or why the preview cannot be read.
  message: string | null;
  footer: string | null;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function age(at: number | null, now: number, locale: string): string {
  if (at === null) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  const unit = (value: number, name: 'minute' | 'hour') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
  if (minutes < 60) return unit(Math.max(1, minutes), 'minute');
  if (minutes < 24 * 60) return unit(Math.round(minutes / 60), 'hour');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(at);
}

function day(start: number, now: number, locale: string, translate: Translate): string {
  const days = Math.round((startOfDay(start) - startOfDay(now)) / 86400000);
  if (days <= 0) return translate('previews.today');
  if (days === 1) return translate('previews.tomorrow');
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(start);
}

export function previewView(content: PreviewContent, now: number, locale: string, translate: Translate): PreviewView {
  if (content.kind === 'unavailable') {
    return {
      heading: null,
      items: [],
      message: translate(content.site === 'mail' ? 'previews.mailUnavailable' : 'previews.calendarUnavailable'),
      footer: null,
    };
  }
  if (content.kind === 'mail') {
    const extra = content.unread - content.messages.length;
    return {
      heading: content.unread > 0 ? translate('previews.unreadMail', { count: content.unread }) : null,
      items: content.messages.map((message) => ({
        primary: message.from,
        secondary: message.subject,
        meta: age(message.at, now, locale),
        live: false,
      })),
      message: content.unread === 0 ? translate('previews.noMail') : null,
      footer: extra > 0 ? translate('previews.moreMail', { count: extra }) : null,
    };
  }
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  return {
    heading: null,
    items: content.events.map((event) => {
      const live = event.start <= now && now < event.end;
      return {
        primary: event.title,
        secondary: `${time.format(event.start)} – ${time.format(event.end)}`,
        meta: live ? translate('previews.now') : day(event.start, now, locale, translate),
        live,
      };
    }),
    message: content.events.length === 0 ? translate('previews.noEvents') : null,
    footer: null,
  };
}
