import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import changeFeed from '../../../dist/main/library/change-feed.js';
import downloadsPage from '../../../dist/main/pages/downloads-page.js';
import internalPages from '../../../dist/main/pages/internal-pages.js';
import newTabPage from '../../../dist/main/pages/new-tab-page.js';
import suggestionModule from '../../../dist/main/address-bar/suggestions.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { loadInternalPages, serveInternalPages } = internalPages;
const { indexHistory, suggest } = suggestionModule;
const page = (name) => path.resolve('src/renderer/public', name);

function serve(sources, settings = path.resolve('src/renderer/settings.html')) {
  let handle;
  const session = {
    protocol: {
      handle(_scheme, callback) {
        handle = callback;
      },
    },
  };
  const pages = loadInternalPages({
    newTab: page('newtab.html'),
    newTabScript: page('newtab-suggestions.js'),
    history: page('history.html'),
    downloads: page('downloads.html'),
    bookmarks: page('bookmarks.html'),
    settings,
  });
  serveInternalPages(session, pages, {
    pinned: () => [],
    visits: () => [],
    downloads: { list: () => [], changes: new changeFeed.ChangeFeed() },
    bookmarks: () => ({ folders: [], bookmarks: [] }),
    showWelcome: () => false,
    showAnnouncement: () => false,
    showFeedback: () => false,
    showRepoPrompt: () => false,
    suggestions: () => [],
    ...sources,
  });
  return handle;
}

test('the new tab serves matching local suggestions and its script', async () => {
  const handle = serve({
    suggestions: (query) =>
      suggest(query, {
        tabs: [],
        bookmarks: [{ title: 'GitHub', url: 'https://github.com/' }],
        history: indexHistory([{ title: 'GitLab', url: 'https://gitlab.com/', visitedAt: 1 }]),
      }),
  });

  const response = await handle(new Request('yalqen://newtab/suggestions?q=git'));
  assert.deepEqual(
    (await response.json()).map(({ kind, url }) => [kind, url]),
    [
      ['bookmark', 'https://github.com/'],
      ['history', 'https://gitlab.com/'],
    ],
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const script = await handle(new Request('yalqen://newtab/suggestions.js'));
  assert.match(script.headers.get('content-type'), /^application\/javascript/);
  assert.match(await script.text(), /fetch\(/);

  const mark = await handle(new Request('yalqen://newtab/mark.png'));
  assert.equal(mark.headers.get('content-type'), 'image/png');
  assert.ok((await mark.arrayBuffer()).byteLength > 0);
});

test('the repo prompt is only rendered when it is due and never beside the welcome', async () => {
  const body = async (sources) => (await serve(sources)(new Request('yalqen://newtab/'))).text();
  assert.doesNotMatch(await body({}), /class="repo-prompt"/);
  assert.match(await body({ showRepoPrompt: () => true }), /yalqen:\/\/newtab\/repo\?action=star/);
  assert.doesNotMatch(await body({ showWelcome: () => true, showRepoPrompt: () => true }), /class="repo-prompt"/);
});

test('the announcement shows beside the welcome and replaces the repo prompt', async () => {
  const body = async (sources) => (await serve(sources)(new Request('yalqen://newtab/'))).text();
  assert.doesNotMatch(await body({}), /class="repo-prompt announcement"/);
  assert.match(await body({ showAnnouncement: () => true }), /yalqen:\/\/newtab\/announcement\?action=try/);
  assert.match(await body({ showWelcome: () => true, showAnnouncement: () => true }), /announcement\?action=close/);
  const both = await body({ showAnnouncement: () => true, showRepoPrompt: () => true });
  assert.doesNotMatch(both, /repo\?action=star/);
});

test('the feedback card is its own card and never shows on the welcome', async () => {
  const body = async (sources) => (await serve(sources)(new Request('yalqen://newtab/'))).text();
  assert.doesNotMatch(await body({}), /feedback\?action=open/);
  assert.match(await body({ showFeedback: () => true }), /yalqen:\/\/newtab\/feedback\?action=open/);
  assert.doesNotMatch(await body({ showWelcome: () => true, showFeedback: () => true }), /feedback\?action/);
  const both = await body({ showAnnouncement: () => true, showFeedback: () => true, showRepoPrompt: () => true });
  assert.match(both, /announcement\?action=try/);
  assert.match(both, /feedback\?action=open/);
  assert.doesNotMatch(both, /repo\?action=star/);
});

test('the downloads page updates itself when the list changes', async () => {
  const changes = new changeFeed.ChangeFeed();
  let entries = [];
  const handle = serve({ downloads: { list: () => entries, changes } });

  const html = await (await handle(new Request('yalqen://downloads/'))).text();
  assert.match(html, /<div id="downloads" data-version="0">/);
  assert.match(html, /yalqen:\/\/downloads\/downloads\.js/);
  const script = await handle(new Request('yalqen://downloads/downloads.js'));
  assert.match(await script.text(), /downloads\/changes/);

  const waiting = handle(new Request('yalqen://downloads/changes?since=0'));
  entries = [
    {
      id: 'a',
      url: 'https://a.com/f',
      filename: 'f.zip',
      savePath: '/tmp/f.zip',
      state: 'completed',
      receivedBytes: 1,
      totalBytes: 1,
      startedAt: 1,
    },
  ];
  changes.notify();
  const update = await (await waiting).json();
  assert.equal(update.version, 1);
  assert.equal(update.html, downloadsPage.renderDownloads(entries));
});

test('unchanged download polls omit HTML and do not read the list', async () => {
  let reads = 0;
  const handle = serve({
    downloads: {
      list: () => {
        reads++;
        return [];
      },
      changes: { version: 3, next: async () => 3 },
    },
  });
  const response = await handle(new Request('yalqen://downloads/changes?since=3'));
  assert.deepEqual(await response.json(), { version: 3 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(reads, 0);
});

test('cancelled download polls stop waiting and return no redundant HTML', async () => {
  const controller = new AbortController();
  const handle = serve({});
  const waiting = handle(new Request('yalqen://downloads/changes?since=0', { signal: controller.signal }));
  controller.abort();
  assert.deepEqual(await (await waiting).json(), { version: 0 });
});

test('page titles with replacement patterns are inserted literally', async () => {
  const title = "Fiyat $& indirim $` $' $$";
  const handle = serve({
    visits: () => [{ id: 'v', url: 'https://example.com/', title, visitedAt: Date.now() }],
    bookmarks: () => ({
      folders: [],
      bookmarks: [{ id: 'b', url: 'https://example.com/', title, folderId: null, createdAt: 1 }],
    }),
    pinned: () => [{ url: 'https://example.com/', title, faviconUrl: null }],
  });
  for (const url of ['yalqen://history/', 'yalqen://bookmarks/', 'yalqen://newtab/']) {
    const html = await (await handle(new Request(url))).text();
    assert.ok(html.includes('Fiyat $&#38; indirim $` $&#39; $$'), url);
    assert.doesNotMatch(html, /__YALQEN_\w+_SLOT__/, url);
    assert.equal(html.match(/<!doctype html>/gi)?.length, 1, url);
  }
});

test('the bookmarks page loads its folder picker script from its own origin', async () => {
  const handle = serve({});
  const page = await handle(new Request('yalqen://bookmarks/'));
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /<script src="yalqen:\/\/bookmarks\/bookmarks\.js" defer><\/script>/);
  const script = await handle(new Request('yalqen://bookmarks/bookmarks.js'));
  assert.match(script.headers.get('content-type'), /^application\/javascript/);
  assert.match(await script.text(), /folder-options/);
  assert.equal((await handle(new Request('yalqen://bookmarks/missing'))).status, 404);
  const history = await handle(new Request('yalqen://history/'));
  assert.doesNotMatch(history.headers.get('content-security-policy'), /script-src/);
});

test('pinned sites render as escaped tiles with a letter fallback', () => {
  const html = newTabPage.renderPinned([
    { url: 'https://github.com/', title: 'GitHub', faviconUrl: 'https://github.com/favicon.ico' },
    { url: 'https://example.com/?q="x"', title: '<b>Örnek</b>', faviconUrl: null },
  ]);
  assert.match(html, /<img src="https:\/\/github\.com\/favicon\.ico"/);
  assert.match(html, /<span class="letter">E<\/span>/);
  assert.doesNotMatch(html, /<b>/);
  assert.equal(newTabPage.renderPinned([]), '');
});

test('the settings page and only its own assets are served under yalqen://settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-settings-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'settings.html'), '<title>Ayarlar</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'settings.js'), 'export {};');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  const handle = serve({}, path.join(dir, 'settings.html'));

  for (const url of ['yalqen://settings/', 'yalqen://settings/privacy']) {
    const response = await handle(new Request(url));
    assert.equal(await response.text(), '<title>Ayarlar</title>');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  const script = await handle(new Request('yalqen://settings/assets/settings.js'));
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  for (const url of ['yalqen://settings/assets/..%2Fsecret.txt', 'yalqen://settings/assets/missing.js']) {
    assert.equal((await handle(new Request(url))).status, 404);
  }
});
