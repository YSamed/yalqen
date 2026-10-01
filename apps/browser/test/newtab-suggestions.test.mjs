import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import changeFeed from '../dist/main/change-feed.js';
import downloadsModule from '../dist/main/downloads.js';
import internalPages from '../dist/main/internal-pages.js';
import suggestionModule from '../dist/main/suggestions.js';

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
    updatePopup: page('update-popup.html'),
  });
  serveInternalPages(session, pages, {
    recent: () => [],
    pinned: () => [],
    visits: () => [],
    downloads: { list: () => [], changes: new changeFeed.ChangeFeed() },
    bookmarks: () => ({ folders: [], bookmarks: [] }),
    showWelcome: () => false,
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

test('the update popup shows the escaped version and only serves its own page', async () => {
  const handle = serve({});
  const page = await handle(new Request('yalqen://update/?version=0.2.12'));
  assert.match(await page.text(), /Yalqen 0\.2\.12 hazır[\s\S]*yalqen:\/\/update\/install/);
  const hostile = await handle(new Request('yalqen://update/?version=%3Cb%3E'));
  assert.doesNotMatch(await hostile.text(), /<b>/);
  assert.equal((await handle(new Request('yalqen://update/install'))).status, 404);
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
  assert.equal(update.html, downloadsModule.renderDownloads(entries));
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

test('pinned sites render as escaped tiles with a letter fallback', () => {
  const html = internalPages.renderPinned([
    { url: 'https://github.com/', title: 'GitHub', faviconUrl: 'https://github.com/favicon.ico' },
    { url: 'https://example.com/?q="x"', title: '<b>Örnek</b>', faviconUrl: null },
  ]);
  assert.match(html, /<img src="https:\/\/github\.com\/favicon\.ico"/);
  assert.match(html, /<span class="letter">E<\/span>/);
  assert.doesNotMatch(html, /<b>/);
  assert.equal(internalPages.renderPinned([]), '');
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
