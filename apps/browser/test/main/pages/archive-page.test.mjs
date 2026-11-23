import assert from 'node:assert/strict';
import { test } from 'node:test';
import archivePage from '../../../dist/main/pages/archive-page.js';

const tab = (id, title, closedAt) => ({
  id,
  url: `https://example.com/${id}`,
  title,
  faviconUrl: null,
  history: null,
  closedAt,
});

test('archived tabs list newest first with escaped titles and restore links', () => {
  const html = archivePage.renderArchive([tab('old', 'Old', 1), tab('a b', '<b>New</b>', 2)]);
  assert.ok(html.indexOf('&lt;b&gt;New&lt;/b&gt;') < html.indexOf('Old'));
  assert.doesNotMatch(html, /<b>New/);
  assert.match(html, /href="yalqen:\/\/archive\/restore\?id=a%20b"/);
  assert.match(html, /href="yalqen:\/\/archive\/restore\?id=old"/);
});

test('an empty archive explains what appears there', () => {
  assert.match(archivePage.renderArchive([]), /<p class="empty">/);
});

test('only the archive root is served', async () => {
  const page = archivePage.serveArchive(new URL('yalqen://archive/'), '<main>__YALQEN_ARCHIVE_SLOT__</main>', []);
  assert.match(await page.text(), /<main><p class="empty">/);
  assert.equal(archivePage.serveArchive(new URL('yalqen://archive/other'), '', []).status, 404);
});
