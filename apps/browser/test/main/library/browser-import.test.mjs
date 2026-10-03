import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import bookmarks from '../../../dist/main/library/bookmarks.js';
import browserImport from '../../../dist/main/library/browser-import.js';
import historyModule from '../../../dist/main/library/history.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { BookmarkStore } = bookmarks;
const {
  chromiumProfiles,
  firefoxProfiles,
  firefoxTimeToUnixMs,
  historyImportMenu,
  importChromiumBookmarks,
  importChromiumHistory,
  importErrorMessage,
  importFirefoxBookmarks,
  importFirefoxHistory,
  isFirefoxPlaces,
  parseChromiumBookmarks,
  parseChromiumHistory,
  parseFirefoxBookmarks,
  parseFirefoxHistory,
  parseFirefoxProfiles,
  webkitTimeToUnixMs,
} = browserImport;
const { HistoryStore, MAX_VISITS } = historyModule;

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

const visitRow = (url, last_visit_time = NEW_YEAR_WEBKIT, title = 'Sayfa') => ({ url, title, last_visit_time });

test('Chromium history rows become web visits, newest first', () => {
  assert.deepEqual(
    parseChromiumHistory([
      visitRow('https://old.example/', NEW_YEAR_WEBKIT, 'Eski'),
      visitRow('http://new.example/', 13348540800123456n, null),
      visitRow('https://earlier.example/', 13348540799000000),
      visitRow('chrome://settings/'),
      visitRow('file:///tmp/a.html'),
      visitRow('javascript:alert(1)'),
      visitRow('https://never.example/', 0n),
      visitRow('https://unknown.example/', null),
      { url: 42, title: 'Sayı', last_visit_time: NEW_YEAR_WEBKIT },
      {},
    ]),
    [
      { url: 'http://new.example/', title: '', visitedAt: NEW_YEAR + 123 },
      { url: 'https://old.example/', title: 'Eski', visitedAt: NEW_YEAR },
      { url: 'https://earlier.example/', title: 'Sayfa', visitedAt: NEW_YEAR - 1000 },
    ],
  );
});

test('only the most recent visits up to the history cap are imported', () => {
  const rows = Array.from({ length: MAX_VISITS + 10 }, (_, index) =>
    visitRow(`https://site.example/${index}`, BigInt(NEW_YEAR_WEBKIT) + BigInt(index) * 1000n),
  );
  const visits = parseChromiumHistory(rows);
  assert.equal(visits.length, MAX_VISITS);
  assert.deepEqual(visits[0], {
    url: `https://site.example/${MAX_VISITS + 9}`,
    title: 'Sayfa',
    visitedAt: NEW_YEAR + MAX_VISITS + 9,
  });
  assert.equal(visits.at(-1).url, 'https://site.example/10');
});

test('streamed history keeps the newest valid rows and preserves source order at the cap', () => {
  const rows = Array.from({ length: MAX_VISITS + 1 }, (_, index) => visitRow(`https://same-time.example/${index}`));
  rows.push(
    visitRow('chrome://invalid/', BigInt(NEW_YEAR_WEBKIT) + 9000n),
    visitRow('https://no-time.example/', 0n),
    visitRow('https://newer.example/', BigInt(NEW_YEAR_WEBKIT) + 1000n),
    visitRow('https://latest.example/', BigInt(NEW_YEAR_WEBKIT) + 5000n),
    visitRow('https://middle.example/', BigInt(NEW_YEAR_WEBKIT) + 3000n),
  );
  const stream = function* () {
    yield* rows;
  };
  const visits = parseChromiumHistory(stream());
  assert.equal(visits.length, MAX_VISITS);
  assert.deepEqual(
    visits.slice(0, 3).map(({ url }) => url),
    ['https://latest.example/', 'https://middle.example/', 'https://newer.example/'],
  );
  assert.deepEqual(
    visits.slice(3).map(({ url }) => url),
    rows.slice(0, MAX_VISITS - 3).map(({ url }) => url),
  );
  assert.deepEqual(
    parseFirefoxHistory(
      rows
        .map(({ last_visit_time, ...row }) => ({
          ...row,
          last_visit_date: last_visit_time === 0n ? 0n : BigInt(last_visit_time) - 11_644_473_600_000_000n,
        }))
        [Symbol.iterator](),
    ),
    visits,
  );
});

test('unsorted streamed histories match the newest visits selected from the complete source', () => {
  const rows = Array.from({ length: MAX_VISITS * 4 }, (_, index) => ({
    url: `https://site.example/${index}`,
    title: `Visit ${index}`,
    last_visit_time: BigInt(NEW_YEAR_WEBKIT) + BigInt(((index * 7919) % 1000) * 1000),
  }));
  const expected = rows
    .map(({ url, title, last_visit_time }) => ({ url, title, visitedAt: webkitTimeToUnixMs(last_visit_time) }))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_VISITS);
  assert.deepEqual(parseChromiumHistory(rows[Symbol.iterator]()), expected);
});

test('newest-first history stops reading once the cap is filled', () => {
  let read = 0;
  function* rows() {
    for (let index = 0; index < MAX_VISITS * 3; index++) {
      read++;
      yield {
        url: index % 10 === 0 ? 'chrome://newtab/' : `https://site.example/${index}`,
        title: `Visit ${index}`,
        last_visit_time: BigInt(NEW_YEAR_WEBKIT) - BigInt(index * 1000),
      };
    }
  }
  const visits = parseChromiumHistory(rows(), 'newest-first');
  assert.equal(visits.length, MAX_VISITS);
  assert.ok(read < MAX_VISITS * 1.2, `read ${read} rows`);
  assert.deepEqual(visits, parseChromiumHistory([...rows()]));
});

test('an ordered import matches the unordered selection, ties and skipped rows included', async () => {
  await withDir(async (dir) => {
    const source = path.join(dir, 'History');
    const db = historyDb(source);
    db.exec('DELETE FROM urls');
    const insert = db.prepare('INSERT INTO urls (url, title, last_visit_time, hidden) VALUES (?, ?, ?, ?)');
    const rows = [];
    for (let index = 0; index < MAX_VISITS * 2; index++) {
      const row = {
        url: index % 13 === 0 ? 'about:blank' : `https://site.example/${index}`,
        title: `Visit ${index}`,
        last_visit_time: BigInt(NEW_YEAR_WEBKIT) + BigInt(((index * 7919) % 700) * 1000),
        hidden: index % 29 === 0 ? 1 : 0,
      };
      insert.run(row.url, row.title, row.last_visit_time, row.hidden);
      if (row.hidden === 0) rows.push(row);
    }
    db.close();
    let imported;
    await importChromiumHistory({ importVisits: (visits) => (imported = visits).length }, source);
    assert.deepEqual(imported, parseChromiumHistory(rows));
  });
});

function historyDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
    last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)`);
  const insert = db.prepare('INSERT INTO urls (url, title, last_visit_time, hidden) VALUES (?, ?, ?, ?)');
  insert.run('https://a.example/', 'A', 13348540800123456n, 0);
  insert.run('https://frame.example/', 'Çerçeve', 13348540800123456n, 1);
  insert.run('chrome://newtab/', 'Yeni sekme', 13348540800123456n, 0);
  return db;
}

const tempCopies = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('yalqen-sqlite-')).length;

test('history is read from a temporary copy of a History database', async () => {
  await withDir(async (dir) => {
    const source = path.join(dir, 'History');
    historyDb(source).close();
    const before = fs.readFileSync(source);
    const copies = tempCopies();
    const store = new HistoryStore(path.join(dir, 'yalqen'));

    assert.deepEqual(await importChromiumHistory(store, source), { visits: 1, skipped: 0 });
    assert.deepEqual(
      store.list().map(({ url, title, visitedAt }) => [url, title, visitedAt]),
      [['https://a.example/', 'A', NEW_YEAR + 123]],
    );
    assert.deepEqual(await importChromiumHistory(store, source), { visits: 0, skipped: 1 });
    assert.deepEqual(fs.readFileSync(source), before);
    assert.deepEqual(fs.readdirSync(dir), ['History']);
    assert.equal(tempCopies(), copies);
  });
});

test('history can be imported while the source browser is in the middle of a write', async () => {
  await withDir(async (dir) => {
    const source = path.join(dir, 'History');
    const browser = historyDb(source);
    browser.exec('CREATE TABLE visits(id INTEGER PRIMARY KEY, note TEXT)');
    browser.exec(`INSERT INTO visits (note) VALUES ${Array.from({ length: 500 }, () => "('x')").join(',')}`);
    browser.exec('PRAGMA cache_size = 1; BEGIN');
    browser.exec(`UPDATE urls SET title = 'Yarım'; UPDATE visits SET note = '${'y'.repeat(200)}'`);
    assert.ok(fs.existsSync(`${source}-journal`));

    const store = new HistoryStore(path.join(dir, 'yalqen'));
    assert.deepEqual(await importChromiumHistory(store, source), { visits: 1, skipped: 0 });
    assert.equal(store.list()[0].title, 'A');
    browser.exec('COMMIT');
    assert.equal(browser.prepare('SELECT title FROM urls WHERE id = 1').get().title, 'Yarım');
    browser.close();
  });
});

test('files that are not Chromium history are rejected with a clear message', async () => {
  await withDir(async (dir) => {
    const store = new HistoryStore(path.join(dir, 'yalqen'));
    const message = async (file) => {
      try {
        await importChromiumHistory(store, file);
      } catch (error) {
        return importErrorMessage(error, 'history');
      }
      return 'imported';
    };
    touch(path.join(dir, 'text'), 'not a database at all, just some text that is long enough');
    new DatabaseSync(path.join(dir, 'Cookies')).exec('CREATE TABLE cookies(name TEXT)');
    for (const file of ['text', 'Cookies']) {
      assert.equal(
        await message(path.join(dir, file)),
        'Bu dosya Chrome, Brave, Edge ya da Firefox geçmiş dosyası değil.',
      );
    }
    assert.equal(await message(path.join(dir, 'missing')), 'Geçmiş dosyası bulunamadı.');
    assert.equal(
      importErrorMessage(
        Object.assign(new Error('database disk image is malformed'), { code: 'ERR_SQLITE_ERROR' }),
        'history',
      ),
      'Geçmiş dosyası okunamadı. Tarayıcıyı kapatıp yeniden deneyin.',
    );
    assert.equal(store.list().length, 0);
  });
});

test('the history import menu offers detected browsers and a file', () => {
  const imported = [];
  const menu = historyImportMenu([{ label: 'Brave — Kişisel', file: '/brave/Default/History' }], (file) =>
    imported.push(file ?? 'choose'),
  );
  assert.equal(menu.label, 'Geçmişi içe aktar');
  assert.deepEqual(
    menu.submenu.map((item) => item.label ?? '-'),
    ['Brave — Kişisel', '-', 'History dosyası seç…'],
  );
  menu.submenu[0].click();
  menu.submenu[2].click();
  assert.deepEqual(imported, ['/brave/Default/History', 'choose']);
  assert.deepEqual(
    historyImportMenu([], () => {}).submenu.map((item) => item.label),
    ['History dosyası seç…'],
  );
});

const NEW_YEAR_FIREFOX = BigInt(NEW_YEAR) * 1000n;

test('Firefox timestamps are microseconds since 1970, not since 1601', () => {
  assert.equal(firefoxTimeToUnixMs(NEW_YEAR_FIREFOX), NEW_YEAR);
  assert.equal(firefoxTimeToUnixMs(String(NEW_YEAR_FIREFOX + 123_456n)), NEW_YEAR + 123);
  assert.equal(firefoxTimeToUnixMs(Number(NEW_YEAR_FIREFOX)), NEW_YEAR);
  for (const missing of [0n, '', 'abc', undefined, null, {}]) assert.equal(firefoxTimeToUnixMs(missing), null);
  assert.equal(webkitTimeToUnixMs(NEW_YEAR_FIREFOX), null);
});

test('Firefox profiles are read from profiles.ini and listed when they have places.sqlite', async () => {
  await withDir(async (dir) => {
    const root = path.join(dir, 'Firefox');
    const elsewhere = path.join(dir, 'elsewhere');
    const ini = [
      '[Install4F96D1932A9F858E]',
      'Default=Profiles/abcd.default-release',
      'Locked=1',
      '',
      '[Profile1]',
      'Name=default',
      'IsRelative=1',
      'Path=Profiles/xyz.default',
      'Default=1',
      '',
      '[Profile0]',
      'Name=default-release',
      'IsRelative=1',
      'Path=Profiles/abcd.default-release',
      '',
      '[Profile2]',
      'Name=İş',
      'IsRelative=0',
      `Path=${elsewhere}`,
      '',
      '[Profile3]',
      'IsRelative=1',
      'Path=Profiles/efgh.unnamed',
      '',
      '[Profile4]',
      'Name=broken',
      '',
      '[BackgroundTasksProfiles]',
      'MozillaBackgroundTask-4F96D1932A9F858E-backgroundupdate=ijkl.backgroundupdate',
      '',
      '[General]',
      'StartWithLastProfile=1',
      'Version=2',
    ].join('\r\n');

    assert.deepEqual(parseFirefoxProfiles(ini, root), [
      { name: 'default', dir: path.join(root, 'Profiles/xyz.default') },
      { name: 'default-release', dir: path.join(root, 'Profiles/abcd.default-release') },
      { name: 'İş', dir: elsewhere },
      { name: 'efgh.unnamed', dir: path.join(root, 'Profiles/efgh.unnamed') },
    ]);
    assert.deepEqual(parseFirefoxProfiles('', root), []);

    assert.deepEqual(firefoxProfiles(dir), []);
    touch(path.join(root, 'profiles.ini'), ini);
    touch(path.join(root, 'Profiles/abcd.default-release/places.sqlite'), '');
    touch(path.join(elsewhere, 'places.sqlite'), '');
    fs.mkdirSync(path.join(root, 'Profiles/xyz.default'), { recursive: true });
    assert.deepEqual(firefoxProfiles(dir), [
      {
        label: 'Firefox — default-release',
        file: path.join(root, 'Profiles/abcd.default-release/places.sqlite'),
      },
      { label: 'Firefox — İş', file: path.join(elsewhere, 'places.sqlite') },
    ]);
    assert.ok(isFirefoxPlaces(path.join(elsewhere, 'places.sqlite')));
    assert.ok(!isFirefoxPlaces('/chrome/Default/History'));
  });
});

const bookmarkRow = (id, type, parent, title, extra = {}) => ({
  id,
  type,
  parent,
  title,
  guid: null,
  dateAdded: null,
  url: null,
  ...extra,
});
const FIREFOX_ROOT_ROWS = [
  bookmarkRow(1, 2, 0, '', { guid: 'root________' }),
  bookmarkRow(2, 2, 1, 'menu', { guid: 'menu________' }),
  bookmarkRow(3, 2, 1, 'toolbar', { guid: 'toolbar_____' }),
  bookmarkRow(4, 2, 1, 'tags', { guid: 'tags________' }),
  bookmarkRow(5, 2, 1, 'unfiled', { guid: 'unfiled_____' }),
  bookmarkRow(6, 2, 1, 'mobile', { guid: 'mobile______' }),
];

test('Firefox bookmark rows skip the built-in roots and tags and flatten nested folders', () => {
  const rows = [
    ...FIREFOX_ROOT_ROWS,
    bookmarkRow(10, 1, 3, 'Bar', { url: 'https://bar.example/', dateAdded: NEW_YEAR_FIREFOX }),
    bookmarkRow(11, 2, 3, 'Work'),
    bookmarkRow(12, 1, 11, 'Mail', { url: 'https://mail.example/', dateAdded: NEW_YEAR_FIREFOX + 123_456n }),
    bookmarkRow(13, 2, 11, 'Docs'),
    bookmarkRow(14, 2, 13, ' Old '),
    bookmarkRow(15, 1, 14, 'Spec', { url: 'https://spec.example/', dateAdded: 0 }),
    bookmarkRow(16, 1, 3, 'Most Visited', { url: 'place:sort=8&maxResults=10' }),
    bookmarkRow(17, 3, 3, null),
    bookmarkRow(20, 1, 2, null, { url: 'https://menu.example/', dateAdded: String(NEW_YEAR_FIREFOX) }),
    bookmarkRow(21, 1, 2, 'Bar again', { url: 'https://bar.example/' }),
    bookmarkRow(30, 2, 4, 'okunacak'),
    bookmarkRow(31, 1, 30, null, { url: 'https://tagged.example/' }),
    bookmarkRow(40, 1, 5, 'File', { url: 'file:///tmp/a.html' }),
    bookmarkRow(50, 2, 6, 'Phone'),
    bookmarkRow(51, 1, 50, 'Mobile', { url: 'https://mobile.example/' }),
    bookmarkRow(60, 1, 99, 'Orphan', { url: 'https://orphan.example/' }),
  ];
  const expected = {
    bookmarks: [
      { title: 'Bar', url: 'https://bar.example/', folder: null, createdAt: NEW_YEAR },
      { title: 'Mail', url: 'https://mail.example/', folder: 'Work', createdAt: NEW_YEAR + 123 },
      { title: 'Spec', url: 'https://spec.example/', folder: 'Work / Docs / Old', createdAt: null },
      { title: '', url: 'https://menu.example/', folder: null, createdAt: NEW_YEAR },
      { title: 'File', url: 'file:///tmp/a.html', folder: null, createdAt: null },
      { title: 'Mobile', url: 'https://mobile.example/', folder: 'Phone', createdAt: null },
    ],
    skipped: 2,
  };
  assert.deepEqual(parseFirefoxBookmarks(rows), expected);
  const bigints = rows.map((row) => ({
    ...row,
    id: BigInt(row.id),
    type: BigInt(row.type),
    parent: BigInt(row.parent),
  }));
  assert.deepEqual(parseFirefoxBookmarks(bigints), expected);
  assert.deepEqual(parseFirefoxBookmarks([]), { bookmarks: [], skipped: 0 });
});

const firefoxVisit = (url, last_visit_date = NEW_YEAR_FIREFOX, title = 'Sayfa') => ({ url, title, last_visit_date });

test('Firefox history rows become web visits, newest first, up to the history cap', () => {
  assert.deepEqual(
    parseFirefoxHistory([
      firefoxVisit('https://old.example/', NEW_YEAR_FIREFOX, 'Eski'),
      firefoxVisit('http://new.example/', NEW_YEAR_FIREFOX + 123_456n, null),
      firefoxVisit('https://earlier.example/', Number(NEW_YEAR_FIREFOX) - 1_000_000),
      firefoxVisit('place:sort=8&maxResults=10'),
      firefoxVisit('about:config'),
      firefoxVisit('file:///tmp/a.html'),
      firefoxVisit('https://never.example/', null),
      firefoxVisit('https://zero.example/', 0n),
      {},
    ]),
    [
      { url: 'http://new.example/', title: '', visitedAt: NEW_YEAR + 123 },
      { url: 'https://old.example/', title: 'Eski', visitedAt: NEW_YEAR },
      { url: 'https://earlier.example/', title: 'Sayfa', visitedAt: NEW_YEAR - 1000 },
    ],
  );
  const visits = parseFirefoxHistory(
    Array.from({ length: MAX_VISITS + 10 }, (_, index) =>
      firefoxVisit(`https://site.example/${index}`, NEW_YEAR_FIREFOX + BigInt(index) * 1000n),
    ),
  );
  assert.equal(visits.length, MAX_VISITS);
  assert.equal(visits[0].url, `https://site.example/${MAX_VISITS + 9}`);
  assert.equal(visits[0].visitedAt, NEW_YEAR + MAX_VISITS + 9);
  assert.equal(visits.at(-1).url, 'https://site.example/10');
});

// Columns and root guids as Firefox creates them (nsPlacesTables.h, Bookmarks.sys.mjs).
const PLACES_SCHEMA = `
  CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, rev_host LONGVARCHAR,
    visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL, typed INTEGER DEFAULT 0 NOT NULL,
    frecency INTEGER DEFAULT -1 NOT NULL, last_visit_date INTEGER, guid TEXT,
    foreign_count INTEGER DEFAULT 0 NOT NULL, url_hash INTEGER DEFAULT 0 NOT NULL, description TEXT,
    preview_image_url TEXT, site_name TEXT, origin_id INTEGER, recalc_frecency INTEGER NOT NULL DEFAULT 0,
    alt_frecency INTEGER, recalc_alt_frecency INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER,
    position INTEGER, title LONGVARCHAR, keyword_id INTEGER, folder_type TEXT, dateAdded INTEGER,
    lastModified INTEGER, guid TEXT, syncStatus INTEGER NOT NULL DEFAULT 0,
    syncChangeCounter INTEGER NOT NULL DEFAULT 1);
  INSERT INTO moz_bookmarks (id, type, parent, position, title, guid) VALUES
    (1, 2, 0, 0, '', 'root________'), (2, 2, 1, 0, 'menu', 'menu________'),
    (3, 2, 1, 1, 'toolbar', 'toolbar_____'), (4, 2, 1, 2, 'tags', 'tags________'),
    (5, 2, 1, 3, 'unfiled', 'unfiled_____'), (6, 2, 1, 4, 'mobile', 'mobile______');`;

function placesDb(file, wal = false) {
  const db = new DatabaseSync(file);
  // Like a running Firefox: one exclusive WAL connection that keeps recent writes out of the main file.
  if (wal) db.exec('PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0');
  db.exec(PLACES_SCHEMA);
  let guids = 0;
  const place = (url, title, lastVisit = null, hidden = 0) =>
    db
      .prepare('INSERT INTO moz_places (url, title, last_visit_date, hidden) VALUES (?, ?, ?, ?)')
      .run(url, title, lastVisit, hidden).lastInsertRowid;
  const add = (type, parent, title = null, fk = null) =>
    db
      .prepare(
        `INSERT INTO moz_bookmarks (type, fk, parent, position, title, dateAdded, guid)
         VALUES (?, ?, ?, (SELECT count(*) FROM moz_bookmarks WHERE parent = ?), ?, ?, 'fixture_' || ?)`,
      )
      .run(type, fk, parent, parent, title, NEW_YEAR_FIREFOX, String(++guids).padStart(4, '0')).lastInsertRowid;

  const start = place('https://www.mozilla.org/firefox/central/', 'Getting Started', NEW_YEAR_FIREFOX + 5000n);
  const mail = place('https://mail.example/', 'Posta', NEW_YEAR_FIREFOX);
  const spec = place('https://spec.example/', 'Şartname');
  const mostVisited = place('place:sort=8&maxResults=10', 'Most Visited', null, 1);
  const tagged = place('https://tagged.example/', 'Etiketli', NEW_YEAR_FIREFOX - 1_000_000n);
  const phone = place('https://mobile.example/', 'Telefon');
  place('http://plain.example/', 'Düz', NEW_YEAR_FIREFOX - 2_000_000n);
  place('https://frame.example/', 'Çerçeve', NEW_YEAR_FIREFOX, 1);
  place('about:preferences', 'Ayarlar', NEW_YEAR_FIREFOX);

  add(1, 3, 'Getting Started', start);
  add(1, 3, 'Most Visited', mostVisited);
  const work = add(2, 3, 'İş');
  add(1, work, 'Posta', mail);
  add(1, add(2, work, 'Belgeler'), 'Şartname', spec);
  add(1, add(2, 2, 'Mozilla Firefox'), 'Başlarken', start);
  add(3, 2);
  add(1, add(2, 4, 'okunacak'), null, tagged);
  add(1, 6, 'Telefon', phone);
  return db;
}

test('Firefox bookmarks and history are read from a temporary copy of places.sqlite', async () => {
  await withDir(async (dir) => {
    const source = path.join(dir, 'places.sqlite');
    placesDb(source).close();
    const before = fs.readFileSync(source);
    const copies = tempCopies();
    const bookmarkStore = new BookmarkStore(path.join(dir, 'yalqen'));
    const historyStore = new HistoryStore(path.join(dir, 'yalqen'));

    assert.deepEqual(await importFirefoxBookmarks(bookmarkStore, source), { bookmarks: 4, folders: 2, skipped: 2 });
    const folders = new Map(bookmarkStore.folders().map(({ id, title }) => [id, title]));
    assert.deepEqual(
      bookmarkStore
        .bookmarks()
        .map(({ title, url, folderId, createdAt }) => [title, url, folders.get(folderId), createdAt]),
      [
        ['Getting Started', 'https://www.mozilla.org/firefox/central/', undefined, NEW_YEAR],
        ['Posta', 'https://mail.example/', 'İş', NEW_YEAR],
        ['Şartname', 'https://spec.example/', 'İş / Belgeler', NEW_YEAR],
        ['Telefon', 'https://mobile.example/', undefined, NEW_YEAR],
      ],
    );
    assert.deepEqual(await importFirefoxHistory(historyStore, source), { visits: 4, skipped: 0 });
    assert.deepEqual(
      historyStore.list().map(({ url, title, visitedAt }) => [url, title, visitedAt]),
      [
        ['https://www.mozilla.org/firefox/central/', 'Getting Started', NEW_YEAR + 5],
        ['https://mail.example/', 'Posta', NEW_YEAR],
        ['https://tagged.example/', 'Etiketli', NEW_YEAR - 1000],
        ['http://plain.example/', 'Düz', NEW_YEAR - 2000],
      ],
    );

    assert.deepEqual(await importFirefoxBookmarks(bookmarkStore, source), { bookmarks: 0, folders: 0, skipped: 6 });
    assert.deepEqual(await importFirefoxHistory(historyStore, source), { visits: 0, skipped: 4 });
    assert.deepEqual(fs.readFileSync(source), before);
    assert.equal(tempCopies(), copies);

    const chrome = path.join(dir, 'History');
    historyDb(chrome).close();
    await assert.rejects(importFirefoxBookmarks(bookmarkStore, chrome), SyntaxError);
    await assert.rejects(importFirefoxHistory(historyStore, chrome), SyntaxError);
  });
});

test('places.sqlite is read while Firefox has it open with recent writes still in the WAL', async () => {
  await withDir(async (dir) => {
    const source = path.join(dir, 'places.sqlite');
    const firefox = placesDb(source, true);
    firefox.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const recent = firefox
      .prepare('INSERT INTO moz_places (url, title, last_visit_date) VALUES (?, ?, ?)')
      .run('https://recent.example/', 'Yeni', NEW_YEAR_FIREFOX + 9000n).lastInsertRowid;
    firefox
      .prepare(
        "INSERT INTO moz_bookmarks (type, fk, parent, position, title, guid) VALUES (1, ?, 5, 0, 'Yeni', 'recent______')",
      )
      .run(recent);
    assert.ok(fs.statSync(`${source}-wal`).size > 0);
    assert.ok(!fs.existsSync(`${source}-shm`));

    const bookmarkStore = new BookmarkStore(path.join(dir, 'yalqen'));
    const historyStore = new HistoryStore(path.join(dir, 'yalqen'));
    assert.deepEqual(await importFirefoxBookmarks(bookmarkStore, source), { bookmarks: 5, folders: 2, skipped: 2 });
    assert.equal(bookmarkStore.find('https://recent.example/').title, 'Yeni');
    assert.deepEqual(await importFirefoxHistory(historyStore, source), { visits: 5, skipped: 0 });
    assert.equal(historyStore.list()[0].url, 'https://recent.example/');
    firefox.close();
  });
});
