import assert from 'node:assert/strict';
import { test } from 'node:test';
import previews from '../../dist/shared/previews.js';
import i18n from '../../dist/shared/i18n.js';

const {
  previewKind,
  gmailFeedUrl,
  parseGmailFeed,
  decodeDateKey,
  calendarEvents,
  placePreview,
  validPreviewRequest,
  previewView,
} = previews;
const { t } = i18n;

test('only gmail and google calendar get a preview', () => {
  assert.equal(previewKind('https://mail.google.com/mail/u/0/#inbox'), 'mail');
  assert.equal(previewKind('https://calendar.google.com/calendar/u/0/r/week'), 'calendar');
  assert.equal(previewKind('https://mail.google.com/chat/u/0/'), null);
  assert.equal(previewKind('http://mail.google.com/mail/u/0/'), null);
  assert.equal(previewKind('https://calendar.google.com.example/calendar/'), null);
  assert.equal(previewKind('not a url'), null);
});

test('the gmail feed follows the account of the tab', () => {
  assert.equal(gmailFeedUrl('https://mail.google.com/mail/u/2/#inbox'), 'https://mail.google.com/mail/u/2/feed/atom');
  assert.equal(gmailFeedUrl('https://mail.google.com/mail/'), 'https://mail.google.com/mail/u/0/feed/atom');
});

const entry = (
  from,
  subject,
  issued,
  link = 'https://mail.google.com/mail/u/0?account_id=a&amp;message_id=1&amp;view=conv',
) => `<entry>
  <title>${subject}</title><summary>…</summary><link rel="alternate" href="${link}" type="text/html"/>
  <modified>${issued}</modified><issued>${issued}</issued><id>tag:gmail</id>
  <author><name>${from}</name><email>someone@example.com</email></author>
</entry>`;
const feed = (fullcount, entries) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed version="0.3" xmlns="http://purl.org/atom/ns#">
  <title>Gmail - Inbox</title><tagline>New messages</tagline><fullcount>${fullcount}</fullcount>
  ${entries.join('')}</feed>`;

test('the gmail feed gives the unread count and the newest messages', () => {
  const preview = parseGmailFeed(
    feed(5, [
      entry('Ada &amp; Co', 'Q4 &lt;draft&gt; &#8211; review', '2026-11-11T10:00:08Z'),
      entry('WeQuel', 'Ett nytt jobb', '2026-11-11T09:00:00Z'),
      entry('Bob', 'Lunch', '2026-11-10T09:00:00Z'),
      entry('Cleo', 'Hidden by the limit', '2026-11-09T09:00:00Z'),
    ]),
  );
  assert.equal(preview.kind, 'mail');
  assert.equal(preview.unread, 5);
  assert.deepEqual(
    preview.messages.map((message) => [message.from, message.subject]),
    [
      ['Ada & Co', 'Q4 <draft> – review'],
      ['WeQuel', 'Ett nytt jobb'],
      ['Bob', 'Lunch'],
    ],
  );
  assert.equal(preview.messages[0].at, Date.parse('2026-11-11T10:00:08Z'));
  assert.equal(preview.messages[0].link, 'https://mail.google.com/mail/u/0?account_id=a&message_id=1&view=conv');
});

test('only links back into gmail are kept from the feed', () => {
  const preview = parseGmailFeed(
    feed(2, [
      entry('Mallory', 'Click me', '2026-11-11T10:00:08Z', 'https://evil.example/phish'),
      entry('Eve', 'No link', '2026-11-11T10:00:08Z', 'javascript:alert(1)'),
    ]),
  );
  assert.deepEqual(
    preview.messages.map((message) => message.link),
    [null, null],
  );
});

test('an empty feed means nothing unread, and a sign-in page is not a feed', () => {
  assert.deepEqual(parseGmailFeed(feed(0, [])), { kind: 'mail', unread: 0, messages: [] });
  assert.equal(parseGmailFeed('<!doctype html><title>Sign in</title>'), null);
  assert.equal(parseGmailFeed(''), null);
});

test('calendar day keys decode to dates', () => {
  assert.deepEqual(decodeDateKey(29033), { year: 2026, month: 11, day: 9 });
  assert.deepEqual(decodeDateKey(29034), { year: 2026, month: 11, day: 10 });
  assert.equal(decodeDateKey(0), null);
  assert.equal(decodeDateKey(1.5), null);
});

const at = (day, hours, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const chip = (id, day, title, top, bottom) => ({ id, dateKey: 28672 + 11 * 32 + day, title, top, bottom });

test('calendar chips become the next events, snapped to five minutes', () => {
  const now = at(11, 11, 10);
  const events = calendarEvents(
    [
      chip('past', 11, 'Standup', 9 * 60 - 1, 9 * 60 + 27),
      chip('later', 11, 'Dinner', 19 * 60 - 1, 22 * 60 + 57),
      chip('soon', 11, 'Design review', 17 * 60 + 59, 18 * 60 + 57),
      chip('soon', 11, 'Design review', 18 * 60 + 47, 18 * 60 + 57),
      chip('friday', 13, 'Dentist', 10 * 60 - 1, 10 * 60 + 57),
      chip('next', 14, 'Hidden by the limit', 9 * 60, 10 * 60),
      chip('untitled', 12, '  ', 9 * 60, 10 * 60),
    ],
    now,
  );
  assert.deepEqual(events, [
    { id: 'soon', title: 'Design review', start: at(11, 18), end: at(11, 19) },
    { id: 'later', title: 'Dinner', start: at(11, 19), end: at(11, 23) },
    { id: 'friday', title: 'Dentist', start: at(13, 10), end: at(13, 11) },
  ]);
});

test('an event that has started but not ended is still upcoming', () => {
  const events = calendarEvents([chip('now', 11, 'Workshop', 10 * 60 + 59, 12 * 60 - 3)], at(11, 11, 10));
  assert.deepEqual(events, [{ id: 'now', title: 'Workshop', start: at(11, 11), end: at(11, 12) }]);
});

test('previews open beside the sidebar and stay inside the window', () => {
  const area = { width: 1200, height: 800 };
  const size = { width: 300, height: 160 };
  assert.deepEqual(placePreview({ x: 10, y: 50, width: 60, height: 40 }, size, area), { x: 78, y: 50 });
  assert.deepEqual(placePreview({ x: 10, y: 700, width: 60, height: 40 }, size, area), { x: 78, y: 632 });
  // A sidebar on the right opens it to the left.
  assert.deepEqual(placePreview({ x: 1130, y: 50, width: 60, height: 40 }, size, area), { x: 822, y: 50 });
  // A wide toolbar tab gets it underneath.
  assert.deepEqual(placePreview({ x: 100, y: 10, width: 1000, height: 30 }, size, area), { x: 100, y: 48 });
});

const theme = { dark: false, surface: '#fff', text: '#000', accent: '#e8590c', border: 'rgb(0 0 0 / 0.1)' };

test('preview requests are checked before anything is read', () => {
  const request = {
    tabId: 'abc',
    url: 'https://mail.google.com/mail/u/0/',
    anchor: { x: 1, y: 2, width: 3, height: 4 },
    theme,
  };
  assert.deepEqual(validPreviewRequest(request), request);
  assert.deepEqual(validPreviewRequest({ ...request, tabId: null }), { ...request, tabId: null });
  assert.equal(validPreviewRequest({ ...request, url: 'https://example.com/' }), null);
  assert.equal(validPreviewRequest({ ...request, tabId: 7 }), null);
  assert.equal(validPreviewRequest({ ...request, anchor: { x: 1 } }), null);
  assert.equal(validPreviewRequest({ ...request, theme: { ...theme, dark: 'yes' } }), null);
  assert.equal(validPreviewRequest(null), null);
});

test('the mail preview lists senders and says how many more are unread', () => {
  const now = Date.parse('2026-11-11T10:03:00Z');
  const view = previewView(
    {
      kind: 'mail',
      unread: 5,
      messages: [
        { from: 'WeQuel', subject: 'Ett nytt jobb', at: Date.parse('2026-11-11T10:00:00Z') },
        { from: 'Bob', subject: 'Lunch', at: Date.parse('2026-11-11T07:00:00Z') },
        { from: 'Cleo', subject: 'Old', at: null },
      ],
    },
    now,
    'en',
    t,
  );
  assert.equal(view.heading, '5 unread');
  assert.deepEqual(
    view.items.map((item) => [item.primary, item.secondary, item.meta]),
    [
      ['WeQuel', 'Ett nytt jobb', '3m'],
      ['Bob', 'Lunch', '3h'],
      ['Cleo', 'Old', ''],
    ],
  );
  assert.equal(view.footer, '+2 more unread');
  assert.equal(view.message, null);
});

test('an empty inbox and an unreadable preview say so', () => {
  const empty = previewView({ kind: 'mail', unread: 0, messages: [] }, 0, 'en', t);
  assert.equal(empty.message, 'No unread mail. You can exhale.');
  assert.equal(empty.heading, null);
  assert.equal(empty.footer, null);
  assert.match(previewView({ kind: 'unavailable', site: 'mail' }, 0, 'en', t).message, /Gmail/);
  assert.match(previewView({ kind: 'unavailable', site: 'calendar' }, 0, 'en', t).message, /day or week view/);
  assert.equal(previewView({ kind: 'calendar', events: [] }, 0, 'en', t).message, 'No more events this week.');
});

test('the calendar preview marks the event happening now and names other days', () => {
  const now = at(11, 11, 10);
  const view = previewView(
    {
      kind: 'calendar',
      events: [
        { title: 'Workshop', start: at(11, 11), end: at(11, 12) },
        { title: 'Breakfast', start: at(12, 8, 30), end: at(12, 9) },
        { title: 'Dentist', start: at(13, 10), end: at(13, 11) },
      ],
    },
    now,
    'en',
    t,
  );
  assert.deepEqual(
    view.items.map((item) => [item.primary, item.meta, item.live]),
    [
      ['Workshop', 'Now', true],
      ['Breakfast', 'Tomorrow', false],
      ['Dentist', 'Fri', false],
    ],
  );
  assert.match(view.items[1].secondary, /^8:30\sAM – 9:00\sAM$/);
});
