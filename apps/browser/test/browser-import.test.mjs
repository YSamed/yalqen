import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import bookmarks from '../dist/main/bookmarks.js';
import browserImport from '../dist/main/browser-import.js';

const { BookmarkStore } = bookmarks;
const { chromiumProfiles, importChromiumBookmarks, importErrorMessage, parseChromiumBookmarks, webkitTimeToUnixMs } =
  browserImport;

const NEW_YEAR = Date.UTC(2024, 0, 1);
const NEW_YEAR_WEBKIT = '13348540800000000';

const url = (name, address, date_added = NEW_YEAR_WEBKIT) => ({ type: 'url', name, url: address, date_added });
const folder = (name, ...children) => ({ type: 'folder', name, children });
const chromium = (bar = [], other = [], synced = []) => ({
  roots: {
    bookmark_bar: folder('Yer işaretleri çubuğu', ...bar),
    other: folder('Diğer yer işaretleri', ...other),
    synced: folder('Mobil yer işaretleri', ...synced),
  },
  version: 1,
});

async function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-import-'));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function touch(file, content = '{}') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('nested folders are flattened and root children stay at the top level, across all three roots', () => {
  const { bookmarks: list, skipped } = parseChromiumBookmarks(
    chromium(
      [
        url('Bar', 'https://bar.example/'),
        folder(
          'Work',
          url('Mail', 'https://mail.example/'),
          folder('Docs', folder('Old', url('Spec', 'https://spec.example/'))),
        ),
        folder('  ', url('Unnamed', 'https://unnamed.example/')),
      ],
      [url('Other', 'https://other.example/')],
      [folder('Phone', url('Mobile', 'https://mobile.example/'))],
    ),
  );
  assert.equal(skipped, 0);
  assert.deepEqual(
    list.map(({ title, url, folder }) => [title, url, folder]),
    [
      ['Bar', 'https://bar.example/', null],
      ['Mail', 'https://mail.example/', 'Work'],
      ['Spec', 'https://spec.example/', 'Work / Docs / Old'],
      ['Unnamed', 'https://unnamed.example/', null],
      ['Other', 'https://other.example/', null],
      ['Mobile', 'https://mobile.example/', 'Phone'],
    ],
  );
  assert.deepEqual(parseChromiumBookmarks({ roots: { other: folder('Other', url('O', 'https://o.example/')) } }), {
    bookmarks: [{ title: 'O', url: 'https://o.example/', folder: null, createdAt: NEW_YEAR }],
    skipped: 0,
  });
});

test('WebKit timestamps become Unix milliseconds', () => {
  assert.equal(webkitTimeToUnixMs(NEW_YEAR_WEBKIT), NEW_YEAR);
  assert.equal(webkitTimeToUnixMs('13348540800123456'), NEW_YEAR + 123);
  assert.equal(webkitTimeToUnixMs(13348540800000000), NEW_YEAR);
  assert.equal(webkitTimeToUnixMs(13348540800000000n), NEW_YEAR);
  for (const missing of ['0', '', 'abc', undefined, null, {}]) assert.equal(webkitTimeToUnixMs(missing), null);
  const [bookmark] = parseChromiumBookmarks(chromium([url('A', 'https://a.example/', '13348540800123456')])).bookmarks;
  assert.equal(bookmark.createdAt, NEW_YEAR + 123);
  assert.equal(parseChromiumBookmarks(chromium([url('B', 'https://b.example/', '0')])).bookmarks[0].createdAt, null);
});

test('duplicates and addresses that cannot be bookmarked are skipped', () => {
  const parsed = parseChromiumBookmarks(
    chromium(
      [
        url('A', 'https://a.example/'),
        url('Script', 'javascript:alert(1)'),
        url('Settings', 'chrome://settings/'),
        { type: 'url', name: 'No address' },
      ],
      [folder('Copy', url('A again', 'https://a.example/'))],
      [url('File', 'file:///tmp/a.html'), null, { type: 'separator' }],
    ),
  );
  assert.deepEqual(
    parsed.bookmarks.map((bookmark) => bookmark.url),
    ['https://a.example/', 'file:///tmp/a.html'],
  );
  assert.equal(parsed.skipped, 4);
});

test('files that are not Chromium bookmarks are rejected with a clear message', () => {
  for (const data of [null, [], {}, { roots: 'x' }]) {
    assert.throws(() => parseChromiumBookmarks(data), SyntaxError);
  }
  assert.match(importErrorMessage(new SyntaxError('x')), /yer imi dosyası değil/);
  assert.match(importErrorMessage(Object.assign(new Error('x'), { code: 'ENOENT' })), /bulunamadı/);
  assert.match(importErrorMessage(Object.assign(new Error('x'), { code: 'EACCES' })), /izni yok/);
  assert.equal(importErrorMessage(new Error('disk')), 'disk');
});

test('imports only add, reuse folders by title and add nothing the second time', async () => {
  await withDir(async (dir) => {
    const store = new BookmarkStore(dir);
    const known = store.add('https://known.example/', 'Known');
    const work = store.addFolder('Work');
    const source = path.join(dir, 'Bookmarks');
    touch(
      source,
      JSON.stringify(
        chromium(
          [url('Renamed', 'https://known.example/'), folder('Work', url('Mail', 'https://mail.example/'))],
          [folder('News', url('Paper', 'https://paper.example/'), url('Bad', 'javascript:x'))],
        ),
      ),
    );

    assert.deepEqual(await importChromiumBookmarks(store, source), { bookmarks: 2, folders: 1, skipped: 2 });
    assert.deepEqual(store.find(known.url), known);
    assert.equal(store.find('https://mail.example/').folderId, work.id);
    assert.equal(store.find('https://paper.example/').createdAt, NEW_YEAR);
    assert.deepEqual(
      store.folders().map((item) => item.title),
      ['Work', 'News'],
    );

    assert.deepEqual(await importChromiumBookmarks(store, source), { bookmarks: 0, folders: 0, skipped: 4 });
    store.saveNow();
    assert.equal(new BookmarkStore(dir).bookmarks().length, 3);

    await assert.rejects(importChromiumBookmarks(store, path.join(dir, 'missing')), { code: 'ENOENT' });
    touch(source, '{"roots":');
    await assert.rejects(importChromiumBookmarks(store, source), SyntaxError);
  });
});

test('installed browser profiles are found with their display names', async () => {
  await withDir(async (dir) => {
    const chrome = path.join(dir, 'Google/Chrome');
    touch(
      path.join(chrome, 'Local State'),
      JSON.stringify({ profile: { info_cache: { Default: { name: 'Kişisel' }, 'Profile 10': { name: ' ' } } } }),
    );
    for (const profile of ['Default', 'Profile 2', 'Profile 10', 'Guest Profile']) {
      touch(path.join(chrome, profile, 'Bookmarks'));
    }
    fs.mkdirSync(path.join(chrome, 'Profile 3'));
    touch(path.join(dir, 'Microsoft Edge/Default/Bookmarks'));
    touch(path.join(dir, 'Microsoft Edge/Local State'), '{');

    assert.deepEqual(
      chromiumProfiles('Bookmarks', dir).map(({ label, file }) => [label, path.relative(dir, file)]),
      [
        ['Chrome — Kişisel', 'Google/Chrome/Default/Bookmarks'],
        ['Chrome — Profile 2', 'Google/Chrome/Profile 2/Bookmarks'],
        ['Chrome — Profile 10', 'Google/Chrome/Profile 10/Bookmarks'],
        ['Edge — Default', 'Microsoft Edge/Default/Bookmarks'],
      ],
    );
    assert.deepEqual(chromiumProfiles('History', dir), []);
  });
});
