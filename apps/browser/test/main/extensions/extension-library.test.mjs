import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import library from '../../../dist/main/extensions/extension-library.js';
import historyModule from '../../../dist/main/library/history.js';
import bookmarksModule from '../../../dist/main/library/bookmarks.js';
import downloadsModule from '../../../dist/main/library/downloads.js';

const {
  ExtensionLibrary,
  bookmarkChanges,
  bookmarkNodes,
  bookmarkTree,
  chromeDownload,
  downloadChanges,
  downloadRequest,
  matchesDownload,
  searchHistory,
  suggestedFilename,
} = library;

const visit = (id, url, visitedAt, title = url) => ({ id, url, title, visitedAt });

test('history search groups visits by url inside the time range', () => {
  const all = [
    visit('c', 'https://a.test/', 300),
    visit('b', 'https://b.test/', 200),
    visit('a', 'https://a.test/', 100),
  ];
  assert.deepEqual(searchHistory(all, all, { startTime: 0 }, 1000), [
    { id: 'c', url: 'https://a.test/', title: 'https://a.test/', lastVisitTime: 300, visitCount: 2, typedCount: 0 },
    { id: 'b', url: 'https://b.test/', title: 'https://b.test/', lastVisitTime: 200, visitCount: 1, typedCount: 0 },
  ]);
  assert.deepEqual(
    searchHistory(all, all, { startTime: 150, endTime: 250 }, 1000).map((item) => item.id),
    ['b'],
  );
  assert.equal(searchHistory(all, all, {}, 250 + 24 * 60 * 60 * 1000).length, 1);
  assert.equal(searchHistory(all, all, { startTime: 0, maxResults: 1 }, 1000).length, 1);
});

test('bookmarks form a Chrome tree under the bookmarks bar', () => {
  const folders = [{ id: 'f', title: 'Work', createdAt: 1, parentId: null }];
  const bookmarks = [
    { id: 'x', title: 'X', url: 'https://x.test/', folderId: 'f', createdAt: 2 },
    { id: 'y', title: 'Y', url: 'https://y.test/', folderId: null, createdAt: 3 },
  ];
  const nodes = bookmarkNodes(folders, bookmarks);
  const [bar] = bookmarkTree(nodes, '0').children;
  assert.equal(bar.id, '1');
  assert.deepEqual(
    bar.children.map((node) => [node.id, node.parentId, node.index]),
    [
      ['f', '1', 0],
      ['y', '1', 1],
    ],
  );
  assert.deepEqual(bar.children[0].children[0], {
    id: 'x',
    parentId: 'f',
    index: 0,
    title: 'X',
    url: 'https://x.test/',
    dateAdded: 2,
  });
  assert.throws(() => bookmarkTree(nodes, 'missing'), /Can't find bookmark/);
});

test('bookmark diffs report created, changed, moved and only the top of a removed subtree', () => {
  const before = bookmarkNodes(
    [{ id: 'f', title: 'Work', createdAt: 1, parentId: null }],
    [
      { id: 'x', title: 'X', url: 'https://x.test/', folderId: 'f', createdAt: 2 },
      { id: 'y', title: 'Y', url: 'https://y.test/', folderId: null, createdAt: 3 },
    ],
  );
  const after = bookmarkNodes(
    [{ id: 'g', title: 'New', createdAt: 4, parentId: null }],
    [{ id: 'y', title: 'Y2', url: 'https://y.test/', folderId: 'g', createdAt: 3 }],
  );
  const names = bookmarkChanges(before, after).map(([name, [id]]) => `${name}:${id}`);
  assert.deepEqual(names.sort(), [
    'bookmarks.onChanged:y',
    'bookmarks.onCreated:g',
    'bookmarks.onMoved:y',
    'bookmarks.onRemoved:f',
  ]);
});

test('downloads map to Chrome items and diffs', () => {
  const entry = {
    id: 'u',
    url: 'https://x.test/a.zip',
    filename: 'a.zip',
    savePath: '/d/a.zip',
    state: 'progressing',
    receivedBytes: 5,
    totalBytes: 10,
    startedAt: 0,
  };
  const running = chromeDownload(entry, 1, false);
  assert.equal(running.state, 'in_progress');
  assert.equal(running.error, undefined);
  const done = chromeDownload({ ...entry, state: 'completed', receivedBytes: 10 }, 1, true);
  const cancelled = chromeDownload({ ...entry, state: 'cancelled' }, 2, false);
  assert.equal(cancelled.error, 'USER_CANCELED');
  const changes = downloadChanges(
    new Map([[1, running]]),
    new Map([
      [1, done],
      [2, cancelled],
    ]),
  );
  assert.deepEqual(changes, [
    ['downloads.onChanged', [{ id: 1, state: { previous: 'in_progress', current: 'complete' } }]],
    ['downloads.onCreated', [cancelled]],
    ['downloads.onChanged', [{ id: 2, state: { previous: 'in_progress', current: 'interrupted' } }]],
  ]);
  assert.deepEqual(downloadChanges(new Map([[2, cancelled]]), new Map()), [['downloads.onErased', [2]]]);
  assert.equal(matchesDownload(done, { state: 'complete', query: ['zip', '-tar'] }), true);
  assert.equal(matchesDownload(done, { query: ['-zip'] }), false);
  assert.equal(matchesDownload(done, { id: 2 }), false);
});

test('extension download requests are checked before they start', () => {
  assert.deepEqual(downloadRequest({ url: 'https://x.test/a', headers: [{ name: 'X-A', value: '1' }] }), {
    url: 'https://x.test/a',
    filename: null,
    headers: { 'X-A': '1' },
  });
  assert.equal(downloadRequest({ url: 'data:text/plain,hi', filename: 'notes/hi.txt' }).filename, 'notes/hi.txt');
  assert.throws(() => downloadRequest({ url: 'file:///etc/passwd' }), /Cannot download file:/);
  assert.throws(() => downloadRequest({ url: 'https://x.test/', filename: '../x' }), /Invalid filename/);
  assert.throws(() => downloadRequest({ url: 'https://x.test/', filename: '/etc/x' }), /Invalid filename/);
  assert.throws(() => downloadRequest({ url: 'https://x.test/', method: 'POST' }), /Only GET/);
});

test('extension bookmark and history calls edit the stores and emit Chrome events', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-library-'));
  try {
    const history = new historyModule.HistoryStore(directory);
    const bookmarks = new bookmarksModule.BookmarkStore(directory);
    const downloads = new downloadsModule.DownloadStore(directory);
    const downloadManager = { onChange: null, actions: () => ({}), changed() {} };
    const events = [];
    let refreshed = 0;
    const api = new ExtensionLibrary(
      { history, bookmarks, downloads, downloadManager, bookmarksChanged: () => refreshed++ },
      { wants: () => true, emit: (permission, name, args) => events.push([permission, name, args]) },
    );
    const settled = () => new Promise((resolve) => setImmediate(resolve));
    api.call('bookmarks', 'getTree', [], []);
    history.visit('https://seen.test/', 'Seen');
    bookmarks.add('https://seen.test/', 'Seen');
    await settled();
    events.length = 0;

    const folder = api.call('bookmarks', 'create', [{ title: 'Work' }], []);
    const mark = api.call('bookmarks', 'create', [{ parentId: folder.id, title: 'A', url: 'https://a.test/' }], []);
    assert.equal(mark.parentId, folder.id);
    const other = api.call('bookmarks', 'create', [{ title: 'Other' }], []);
    assert.equal(api.call('bookmarks', 'create', [{ parentId: other.id, url: 'https://a.test/' }], []).id, mark.id);
    assert.equal(bookmarks.find('https://a.test/').folderId, folder.id);
    api.call('bookmarks', 'remove', [other.id], []);
    assert.throws(
      () => api.call('bookmarks', 'create', [{ parentId: mark.id, title: 'B' }], []),
      /not specify a folder/,
    );
    assert.throws(() => api.call('bookmarks', 'update', ['1', { title: 'x' }], []), /root bookmark folders/);
    assert.throws(() => api.call('bookmarks', 'remove', [folder.id], []), /non-empty folder/);
    await settled();
    assert.deepEqual(
      events.map(([, name, [id]]) => `${name}:${id}`),
      [`bookmarks.onCreated:${folder.id}`, `bookmarks.onCreated:${mark.id}`],
    );
    api.call('bookmarks', 'removeTree', [folder.id], []);
    await settled();
    assert.deepEqual(events.at(-1).slice(1, 2), ['bookmarks.onRemoved']);
    assert.equal(events.at(-1)[2][0], folder.id);
    assert.equal(bookmarks.bookmarks().length, 1);
    assert.ok(refreshed >= 3);

    api.call('history', 'addUrl', [{ url: 'https://new.test/' }], []);
    await settled();
    assert.equal(events.at(-1)[1], 'history.onVisited');
    assert.equal(events.at(-1)[2][0].url, 'https://new.test/');
    assert.deepEqual(
      api.call('history', 'search', [{ text: 'new.test' }], []).map((item) => item.url),
      ['https://new.test/'],
    );
    api.call('history', 'deleteUrl', [{ url: 'https://new.test/' }], []);
    await settled();
    assert.deepEqual(events.at(-1)[2], [{ allHistory: false, urls: ['https://new.test/'] }]);
    api.call('history', 'deleteAll', [], []);
    await settled();
    assert.deepEqual(events.at(-1)[2], [{ allHistory: true, urls: [] }]);
    assert.throws(() => api.call('history', 'addUrl', [{ url: 'file:///x' }], []), /invalid/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('extensions remove only completed download files and cannot accept dangerous downloads', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-library-'));
  try {
    const downloads = new downloadsModule.DownloadStore(directory);
    const file = (name) => path.join(directory, name);
    fs.writeFileSync(file('done.txt'), 'x');
    fs.mkdirSync(file('folder.txt'));
    const base = { url: 'https://x.test/f', receivedBytes: 1, totalBytes: 1, startedAt: 1 };
    for (const [name, state] of [
      ['done.txt', 'completed'],
      ['folder.txt', 'completed'],
      ['run.txt', 'progressing'],
      ['bad.txt', 'blocked'],
    ])
      downloads.add({ ...base, id: name, filename: name, savePath: file(name), state });
    downloads.add({
      ...base,
      id: 'shot',
      filename: 'shot.png',
      savePath: file('shot.png'),
      state: 'completed',
      screenshot: true,
    });
    const events = [];
    const api = new ExtensionLibrary(
      {
        history: new historyModule.HistoryStore(directory),
        bookmarks: new bookmarksModule.BookmarkStore(directory),
        downloads,
        downloadManager: { onChange: null, actions: () => ({}), changed() {} },
        bookmarksChanged() {},
      },
      { wants: () => true, emit: (_permission, name, args) => events.push([name, args]) },
    );
    const items = await api.call('downloads', 'search', [{}], []);
    const id = (name) => items.find((item) => item.filename === file(name)).id;
    assert.equal(
      items.some((item) => item.filename === file('shot.png')),
      false,
    );
    const remove = (name) => api.call('downloads', 'removeFile', [id(name)], []);
    await assert.rejects(remove('run.txt'), /Download must be complete/);
    await assert.rejects(remove('bad.txt'), /Download must be complete/);
    await assert.rejects(api.call('downloads', 'removeFile', [9999], []), /Invalid download id/);
    await assert.rejects(remove('folder.txt'), /moved or replaced/);
    assert.ok(fs.existsSync(file('folder.txt')));
    await assert.rejects(
      api.call('downloads', 'acceptDanger', [id('bad.txt')], []),
      /Yalqen does not let extensions accept dangerous downloads/,
    );

    await remove('done.txt');
    assert.equal(fs.existsSync(file('done.txt')), false);
    const [removed] = await api.call('downloads', 'search', [{ id: id('done.txt') }], []);
    assert.equal(removed.exists, false);
    assert.deepEqual(events.at(-1), [
      'downloads.onChanged',
      [{ id: id('done.txt'), exists: { previous: true, current: false } }],
    ]);
    await assert.rejects(remove('done.txt'), /already deleted/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('filename suggestions keep only a safe base name', () => {
  assert.equal(suggestedFilename({ filename: 'notes/renamed.txt', conflictAction: 'overwrite' }), 'renamed.txt');
  for (const filename of ['../x', '/etc/x', 'C:x', '', 7, undefined])
    assert.equal(suggestedFilename({ filename }), null);
  assert.equal(suggestedFilename(null), null);
});
