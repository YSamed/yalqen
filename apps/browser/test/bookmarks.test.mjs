import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import bookmarks from '../dist/main/bookmarks.js';
import suggestions from '../dist/main/suggestions.js';
import i18n from '../dist/shared/i18n.js';

i18n.setLocale('tr');

const { BookmarkStore, bookmarksMenuTemplate, canBookmark, renderBookmarks } = bookmarks;

function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bookmarks-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('web pages and files can be bookmarked', () => {
  assert.equal(canBookmark('https://a.com/'), true);
  assert.equal(canBookmark('file:///tmp/a.html'), true);
  assert.equal(canBookmark('yalqen://newtab/'), false);
  assert.equal(canBookmark('javascript:alert(1)'), false);
});

test('bookmarks are added once, edited, moved and persisted', () => {
  withDir((dir) => {
    const store = new BookmarkStore(dir);
    const a = store.add('https://a.com/', '  A \n sitesi ');
    assert.equal(a.title, 'A sitesi');
    assert.equal(store.add('https://a.com/', 'başka').id, a.id);
    assert.equal(store.add('yalqen://history/', 'Geçmiş'), null);
    const b = store.add('https://b.com/', '');
    assert.equal(b.title, 'https://b.com/');

    const folder = store.addFolder('İş');
    store.move(a.id, folder.id);
    store.rename(b.id, 'B');
    store.move(b.id, 'unknown');
    assert.deepEqual(store.bookmarks('iş').length, 0);
    assert.deepEqual(
      store.bookmarks('b.com').map((item) => item.title),
      ['B'],
    );
    store.saveNow();

    const reloaded = new BookmarkStore(dir);
    assert.deepEqual(
      reloaded.folders().map((item) => item.title),
      ['İş'],
    );
    assert.deepEqual(
      reloaded.bookmarks().map((item) => [item.title, item.folderId]),
      [
        ['A sitesi', folder.id],
        ['B', null],
      ],
    );
    assert.equal(reloaded.find('https://a.com/').id, a.id);

    reloaded.removeFolder(folder.id);
    assert.equal(reloaded.find('https://a.com/').folderId, null);
    reloaded.remove(a.id);
    assert.equal(reloaded.find('https://a.com/'), undefined);
    reloaded.saveNow();
  });
});

test('bookmarked addresses are known after every change', () => {
  withDir((dir) => {
    const store = new BookmarkStore(dir);
    assert.equal(store.has('https://example.com/'), false);
    const bookmark = store.add('https://example.com/', 'Örnek');
    assert.equal(store.has('https://example.com/'), true);
    store.remove(bookmark.id);
    assert.equal(store.has('https://example.com/'), false);
    store.saveNow();
  });
});

test('suggestion snapshots are reused, immutable, and follow bookmark changes', () => {
  withDir((dir) => {
    const store = new BookmarkStore(dir);
    const first = store.add('https://first.example/', 'İstanbul');
    const snapshot = store.suggestions();
    assert.equal(store.suggestions(), snapshot);
    assert.deepEqual(snapshot, [{ title: 'İstanbul', url: first.url }]);
    assert.throws(() => snapshot.push({ title: 'Injected', url: 'https://injected.example/' }), TypeError);
    assert.throws(() => {
      snapshot[0].title = 'Changed';
    }, TypeError);

    const publicCopy = store.bookmarks();
    publicCopy[0].title = 'Changed';
    publicCopy.push({ ...first, url: 'https://injected.example/' });
    const found = store.find(first.url);
    found.title = 'Changed';
    assert.equal(store.suggestions(), snapshot);
    assert.equal(store.find(first.url).title, 'İstanbul');

    const suggest = (term) =>
      suggestions.suggest(term, {
        tabs: [],
        bookmarks: store.suggestions(),
        history: suggestions.EMPTY_HISTORY_INDEX,
      });
    assert.equal(suggest('İSTANBUL')[0].title, 'İstanbul');
    store.rename(first.id, 'İzmir');
    assert.notEqual(store.suggestions(), snapshot);
    assert.deepEqual(suggest('istanbul'), []);
    assert.equal(suggest('İZMİR')[0].title, 'İzmir');
    assert.equal(snapshot[0].title, 'İstanbul');
    const second = store.add('https://second.example/', 'Isparta');
    assert.equal(suggest('ISPARTA')[0].url, second.url);
    store.remove(second.id);
    assert.deepEqual(suggest('ISPARTA'), []);
    store.saveNow();
    assert.deepEqual(new BookmarkStore(dir).suggestions(), [{ title: 'İzmir', url: first.url }]);
  });
});

test('cached bookmark searches reflect renamed and removed entries', () => {
  withDir((dir) => {
    const store = new BookmarkStore(dir);
    const first = store.add('https://first.example/', 'İstanbul');
    const second = store.add('https://second.example/', 'Isparta');
    assert.deepEqual(
      store.bookmarks('İSTANBUL').map(({ id }) => id),
      [first.id],
    );
    assert.deepEqual(
      store.bookmarks('ISPARTA').map(({ id }) => id),
      [second.id],
    );
    store.rename(first.id, 'İzmir');
    assert.equal(store.bookmarks('istanbul').length, 0);
    assert.deepEqual(
      store.bookmarks('İZMİR').map(({ id }) => id),
      [first.id],
    );
    store.remove(second.id);
    assert.equal(store.bookmarks('ısparta').length, 0);
    store.saveNow();
  });
});

test('damaged entries are dropped and missing folders are cleared', () => {
  withDir((dir) => {
    fs.writeFileSync(
      path.join(dir, 'bookmarks.json'),
      JSON.stringify({
        version: 1,
        folders: [{ id: 'f', title: 'F', createdAt: 1 }, { id: 3 }],
        bookmarks: [
          { id: '1', title: 'a', url: 'https://a.com/', folderId: 'gone', createdAt: 1 },
          { id: '2', title: 'x', url: 'javascript:x', folderId: null, createdAt: 1 },
          { id: '3', title: 'c', url: 'https://c.com/', folderId: 'f', createdAt: 1 },
        ],
      }),
    );
    const store = new BookmarkStore(dir);
    assert.deepEqual(
      store.folders().map((item) => item.id),
      ['f'],
    );
    assert.deepEqual(
      store.bookmarks().map((item) => [item.id, item.folderId]),
      [
        ['1', null],
        ['3', 'f'],
      ],
    );
  });
});

test('the menu lists folders, then loose bookmarks', () => {
  const opened = [];
  const folders = [
    { id: 'f', title: 'İş', createdAt: 1 },
    { id: 'g', title: 'Boş klasör', createdAt: 2 },
  ];
  const list = [
    { id: '1', title: 'A', url: 'https://a.com/', folderId: 'f', createdAt: 1 },
    { id: '2', title: 'B'.repeat(80), url: 'https://b.com/', folderId: null, createdAt: 2 },
  ];
  const items = bookmarksMenuTemplate(folders, list, {
    open: (url) => opened.push(url),
    showAll: () => opened.push('all'),
  });
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    ['İş', 'Boş klasör', `${'B'.repeat(59)}…`, '-', 'Tüm yer imleri', 'Yer imlerini içe aktar'],
  );
  assert.deepEqual(
    items[1].submenu.map((item) => item.label),
    ['Boş'],
  );
  items[0].submenu[0].click();
  items[2].click();
  items[4].click();
  assert.deepEqual(opened, ['https://a.com/', 'https://b.com/', 'all']);
  assert.equal(bookmarksMenuTemplate([], [], {})[0].label, 'Henüz yer imi yok');
});

test('the menu offers detected browsers and a file to import', () => {
  const imported = [];
  const importFrom = (file) => imported.push(file ?? 'choose');
  const [, , , importMenu] = bookmarksMenuTemplate([], [], { importFrom }, [
    { label: 'Chrome — Kişi 1', file: '/chrome/Default/Bookmarks' },
  ]);
  assert.deepEqual(
    importMenu.submenu.map((item) => item.label ?? '-'),
    ['Chrome — Kişi 1', '-', 'Bookmarks dosyası seç…'],
  );
  importMenu.submenu[0].click();
  importMenu.submenu[2].click();
  assert.deepEqual(imported, ['/chrome/Default/Bookmarks', 'choose']);
  assert.deepEqual(
    bookmarksMenuTemplate([], [], { importFrom })
      .at(-1)
      .submenu.map((item) => item.label),
    ['Bookmarks dosyası seç…'],
  );
});

test('folder grouping preserves folder, bookmark, and loose entry order', () => {
  const folders = [
    { id: 'b', title: 'Folder B', createdAt: 2 },
    { id: 'a', title: 'Folder A', createdAt: 1 },
  ];
  const list = [
    { id: '1', title: 'A first', url: 'https://a1.example/', folderId: 'a', createdAt: 1 },
    { id: '2', title: 'Loose first', url: 'https://loose1.example/', folderId: null, createdAt: 2 },
    { id: '3', title: 'B first', url: 'https://b1.example/', folderId: 'b', createdAt: 3 },
    { id: '4', title: 'A second', url: 'https://a2.example/', folderId: 'a', createdAt: 4 },
    { id: '5', title: 'Loose second', url: 'https://loose2.example/', folderId: null, createdAt: 5 },
  ];
  const menu = bookmarksMenuTemplate(folders, list, { open() {}, showAll() {} });
  assert.deepEqual(
    menu.slice(0, 4).map(({ label }) => label),
    ['Folder B', 'Folder A', 'Loose first', 'Loose second'],
  );
  assert.deepEqual(
    menu[0].submenu.map(({ label }) => label),
    ['B first'],
  );
  assert.deepEqual(
    menu[1].submenu.map(({ label }) => label),
    ['A first', 'A second'],
  );
  const html = renderBookmarks(folders, list, '');
  const positions = [
    '<h2>Folder B</h2>',
    '<strong>B first</strong>',
    '<h2>Folder A</h2>',
    '<strong>A first</strong>',
    '<strong>A second</strong>',
    '<strong>Loose first</strong>',
    '<strong>Loose second</strong>',
  ].map((marker) => html.indexOf(marker));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
});

test('the page escapes content and points its forms at commands', () => {
  const html = renderBookmarks(
    [{ id: 'f', title: '<i>F</i>', createdAt: 1 }],
    [{ id: 'x', title: '<b>A</b>', url: 'https://a.com/?q="', folderId: 'f', createdAt: 1 }],
    '',
  );
  assert.ok(!html.includes('<b>A</b>') && !html.includes('<i>F</i>'));
  for (const command of ['new-folder', 'rename', 'move', 'remove?id=x', 'rename-folder', 'remove-folder?id=f']) {
    assert.ok(html.includes(`yalqen://bookmarks/${command}`), command);
  }
  assert.match(renderBookmarks([], [], ''), /Henüz yer imi yok/);
  assert.match(renderBookmarks([], [], 'zzz'), /Eşleşen yer imi bulunamadı/);
});

test('the page lists folders once, however many bookmarks can be moved', () => {
  const folders = Array.from({ length: 30 }, (_, index) => ({
    id: `f${index}`,
    title: `Folder ${index}`,
    createdAt: 1,
  }));
  const list = Array.from({ length: 200 }, (_, index) => ({
    id: `b${index}`,
    title: `Bookmark ${index}`,
    url: `https://site${index}.example/`,
    folderId: index % 2 === 0 ? `f${index % 30}` : null,
    createdAt: 1,
  }));
  const html = renderBookmarks(folders, list, '');
  const template = /<template id="folder-options">(.*?)<\/template>/s.exec(html)?.[1] ?? '';
  assert.equal(template.match(/<option /g)?.length, folders.length + 1);
  assert.equal(html.match(/<option /g)?.length, folders.length + 1 + list.length);
  assert.match(html, /<option value="f2" selected>Folder 2<\/option><\/select>/);
  assert.match(html, /<select [^>]*data-folder-options><option value="" selected>Klasör yok<\/option><\/select>/);
  assert.doesNotMatch(renderBookmarks([], list.slice(0, 1), ''), /folder-options/);
});

test('page commands edit the store and unknown ones are ignored', () => {
  withDir((dir) => {
    const store = new BookmarkStore(dir);
    const bookmark = store.add('https://example.com/', 'Örnek');
    const run = (command, params) => bookmarks.runBookmarksCommand(store, command, new URLSearchParams(params));
    assert.equal(run('new-folder', { title: 'İş' }), true);
    const [folder] = store.folders();
    assert.equal(run('move', { id: bookmark.id, folder: folder.id }), true);
    assert.equal(store.find('https://example.com/').folderId, folder.id);
    assert.equal(run('rename', { id: bookmark.id, title: 'Yeni' }), true);
    assert.equal(store.find('https://example.com/').title, 'Yeni');
    assert.equal(run('explode', { id: bookmark.id }), false);
    assert.equal(run('remove-folder', { id: folder.id }), true);
    assert.equal(store.find('https://example.com/').folderId, null);
    assert.equal(run('remove', { id: bookmark.id }), true);
    assert.equal(store.has('https://example.com/'), false);
  });
});
