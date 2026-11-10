import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import bookmarks from '../../../dist/main/library/bookmarks.js';
import browserImport from '../../../dist/main/library/browser-import.js';
import workspaces from '../../../dist/main/library/workspaces.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { BookmarkStore } = bookmarks;
const { WorkspaceStore } = workspaces;
const { arcSidebarSources, importArcSidebar, importBookmarkFile, importErrorMessage, isArcSidebar, parseArcSidebar } =
  browserImport;

const tab = (id, parentID, savedURL, title = null, savedTitle = '') => ({
  id,
  parentID,
  childrenIds: [],
  title,
  data: { tab: { savedURL, savedTitle } },
});
const list = (id, parentID, title, childrenIds) => ({ id, parentID, childrenIds, title, data: { list: {} } });
const container = (id, childrenIds) => ({ id, parentID: null, childrenIds, title: null, data: { itemContainer: {} } });

// Items and spaces alternate an id string and the object, as Arc writes them.
const flat = (objects) => objects.flatMap((object) => [object.id, object]);

function sidebar() {
  const items = [
    container('pin-work', ['docs', 'f-1', 'split']),
    tab('docs', 'pin-work', 'https://docs.example.com/', 'Belgeler'),
    list('f-1', 'pin-work', 'Projeler', ['gh', 'f-2']),
    tab('gh', 'f-1', 'https://github.com/', null, 'GitHub'),
    list('f-2', 'f-1', '', ['deep']),
    tab('deep', 'f-2', 'https://deep.example.com/'),
    { id: 'split', parentID: 'pin-work', childrenIds: ['left', 'right'], title: null, data: { splitView: {} } },
    tab('left', 'split', 'https://left.example.com/'),
    tab('right', 'split', 'https://docs.example.com/'),
    container('unpin-work', ['today']),
    tab('today', 'unpin-work', 'https://today.example.com/'),
    container('pin-home', ['mail', 'local', 'docs-again']),
    tab('docs-again', 'pin-home', 'https://docs.example.com/', 'Belgeler'),
    tab('mail', 'pin-home', 'https://mail.example.com/'),
    tab('local', 'pin-home', 'arc://extensions'),
    container('top', ['fav']),
    tab('fav', 'top', 'https://fav.example.com/', 'Favori'),
  ];
  const spaces = [
    { id: 's-1', title: 'İş', newContainerIDs: [{ unpinned: {} }, 'unpin-work', { pinned: {} }, 'pin-work'] },
    { id: 's-2', containerIDs: ['unpinned', 'missing', 'pinned', 'pin-home'] },
  ];
  return {
    sidebar: {
      containers: [
        { littleBrowser: {} },
        { items: flat([container('little', ['l']), tab('l', 'little', 'https://little.example.com/')]), spaces: [] },
        { global: {} },
        { items: flat(items), spaces: flat(spaces), topAppsContainerIDs: [{ default: {} }, 'top'] },
      ],
    },
  };
}

test('Arc spaces, nested folders and Favorites become bookmark folders; unpinned tabs are left out', () => {
  const parsed = parseArcSidebar(sidebar());
  assert.deepEqual(
    parsed.folders.map((folder) => folder.path),
    [['İş'], ['İş', 'Projeler'], ['İş', 'Projeler', 'Yeni klasör'], ['Alan 1'], ['Arc Favorileri']],
  );
  assert.deepEqual(
    parsed.bookmarks.map(({ title, url, folderPath }) => [title, url, folderPath]),
    [
      ['Belgeler', 'https://docs.example.com/', ['İş']],
      ['GitHub', 'https://github.com/', ['İş', 'Projeler']],
      ['', 'https://deep.example.com/', ['İş', 'Projeler', 'Yeni klasör']],
      ['', 'https://left.example.com/', ['İş']],
      ['', 'https://mail.example.com/', ['Alan 1']],
      ['Favori', 'https://fav.example.com/', ['Arc Favorileri']],
    ],
  );
  assert.equal(parsed.skipped, 3);
});

test('each Arc space becomes a workspace of its pinned tabs, repeated across spaces but not within one', () => {
  const { spaces } = parseArcSidebar(sidebar());
  assert.deepEqual(
    spaces.map(({ name, tabs }) => [name, tabs.map(({ url, group }) => [url, group])]),
    [
      [
        'İş',
        [
          ['https://docs.example.com/', null],
          ['https://github.com/', 'Projeler'],
          ['https://deep.example.com/', 'Projeler'],
          ['https://left.example.com/', null],
        ],
      ],
      [
        'Alan 1',
        [
          ['https://mail.example.com/', null],
          ['https://docs.example.com/', null],
        ],
      ],
    ],
  );
});

test('importing the sidebar saves pinned workspace tabs once per space name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-arc-'));
  try {
    const file = path.join(dir, 'StorableSidebar.json');
    fs.writeFileSync(file, JSON.stringify(sidebar()));
    const store = new BookmarkStore(path.join(dir, 'profile'));
    const spaces = new WorkspaceStore(path.join(dir, 'profile'));
    assert.equal((await importArcSidebar(store, file, spaces)).workspaces, 2);
    assert.deepEqual(
      spaces.list().map(({ name, count }) => [name, count]),
      [
        ['Alan 1', 2],
        ['İş', 4],
      ],
    );
    const opened = spaces.open(spaces.list().find(({ name }) => name === 'İş').id);
    assert.ok(opened.tabs.every((tab) => tab.pinnedUrl === tab.url));
    assert.equal((await importArcSidebar(store, file, spaces)).workspaces, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('items without childrenIds are found by parentID', () => {
  const data = sidebar();
  for (const item of data.sidebar.containers[3].items) if (typeof item === 'object') delete item.childrenIds;
  const urls = parseArcSidebar(data).bookmarks.map((bookmark) => bookmark.url);
  assert.ok(urls.includes('https://github.com/'));
  assert.ok(!urls.includes('https://today.example.com/'));
});

test('a file without the Arc sidebar layout is rejected', () => {
  for (const data of [null, {}, { sidebar: { containers: [{ global: {} }] } }]) {
    assert.throws(() => parseArcSidebar(data), SyntaxError);
  }
});

test('the sidebar file is imported read-only and a half-written file asks to close Arc', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-arc-'));
  try {
    const file = path.join(dir, 'Arc', 'StorableSidebar.json');
    assert.deepEqual(arcSidebarSources(dir), []);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = JSON.stringify(sidebar());
    fs.writeFileSync(file, content);
    assert.deepEqual(arcSidebarSources(dir), [{ label: 'Arc — Kenar çubuğu', file }]);
    assert.ok(isArcSidebar(file));

    const store = new BookmarkStore(path.join(dir, 'profile'));
    const result = await importBookmarkFile(store, file);
    assert.deepEqual(result, { bookmarks: 6, folders: 5, skipped: 3, workspaces: 0 });
    assert.equal(fs.readFileSync(file, 'utf8'), content);
    assert.deepEqual((await importArcSidebar(store, file)).bookmarks, 0);

    fs.writeFileSync(file, content.slice(0, 40));
    const error = await importArcSidebar(store, file).catch((caught) => caught);
    assert.equal(importErrorMessage(error), i18n.t('browserImport.bookmarksUnreadable'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
