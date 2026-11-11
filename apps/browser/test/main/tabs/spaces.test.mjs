import assert from 'node:assert/strict';
import { test } from 'node:test';
import persistence from '../../../dist/main/tabs/persistence.js';
import tabs from '../../../dist/main/tabs/tabs.js';

const { TabManager } = tabs;

function fixture({ spaces = ['work', 'home'], seeds = {} } = {}) {
  const known = [...spaces];
  const manager = new TabManager({
    isBookmarked: () => false,
    hasCertificateException: () => false,
    translation: () => ({ enabled: false, language: 'en' }),
    upgradeHttp: () => null,
    onChange() {},
    closed: [],
    spaceIds: () => known,
    spaceSeed: (id) => seeds[id] ?? null,
  });
  manager.showVisible = function () {
    for (const id of this.visibleIds()) {
      const tab = this.find(id);
      tab.view ??= {
        webContents: {
          isDestroyed: () => false,
          isCurrentlyAudible: () => false,
          getZoomFactor: () => 1,
          navigationHistory: { canGoBack: () => false, canGoForward: () => false, length: () => 0 },
          focus() {},
          send() {},
        },
      };
    }
  };
  return { manager, known };
}

function populate(manager, entries) {
  for (const entry of entries) manager.tabs.push(manager.createRecord({ title: entry.id, ...entry }));
  manager.activeId = entries[0].id;
}

const ids = (list) => list.map((tab) => tab.id);

test('every space shows only its own tabs, pinned tabs and folders', () => {
  const { manager: m } = fixture();
  populate(m, [
    { id: 'a', url: 'https://a.example/' },
    { id: 'b', url: 'https://b.example/', group: 'Notes' },
    { id: 'c', url: 'https://c.example/', space: 'work', pinnedUrl: 'https://c.example/' },
    { id: 'd', url: 'https://d.example/', space: 'work', group: 'Docs' },
  ]);
  assert.deepEqual(ids(m.state().tabs), ['a', 'b']);
  assert.deepEqual(
    m.groupView().map((group) => group.name),
    ['Notes'],
  );

  m.switchSpace('work');
  const state = m.state();
  assert.equal(state.activeSpaceId, 'work');
  assert.deepEqual(ids(state.tabs), ['c', 'd']);
  assert.equal(state.activeTabId, 'd');
  assert.deepEqual(
    state.tabGroups.map((group) => group.name),
    ['Docs'],
  );
  assert.deepEqual(
    m.pinnedPages.map((page) => page.url),
    ['https://c.example/'],
  );
});

test('a space remembers its active tab and ignores unknown space ids', () => {
  const { manager: m } = fixture();
  populate(m, [
    { id: 'a', url: 'https://a.example/' },
    { id: 'b', url: 'https://b.example/' },
    { id: 'c', url: 'https://c.example/', space: 'work' },
    { id: 'd', url: 'https://d.example/', space: 'work' },
  ]);
  m.activate('b');
  m.switchSpace('work');
  m.activate('d');
  m.switchSpace('');
  assert.equal(m.activeTabId, 'b');
  m.switchSpace('work');
  assert.equal(m.activeTabId, 'd');
  m.switchSpace('missing');
  assert.equal(m.activeSpaceId, 'work');
  m.switchSpaceByIndex(0);
  assert.equal(m.activeSpaceId, '');
  m.switchSpaceByIndex(2);
  assert.equal(m.activeSpaceId, 'home');
});

test('activating or searching for a tab in another space switches to that space', () => {
  const { manager: m } = fixture();
  populate(m, [
    { id: 'a', url: 'https://a.example/' },
    { id: 'c', url: 'https://c.example/', space: 'work' },
  ]);
  m.activate('c');
  assert.equal(m.activeSpaceId, 'work');
  assert.deepEqual(ids(m.state().tabs), ['c']);
});

test('a new tab opens in the current space and a link can open in a chosen space', () => {
  const { manager: m } = fixture();
  populate(m, [{ id: 'a', url: 'https://a.example/' }]);
  m.switchSpace('home');
  assert.equal(m.state().tabs.length, 1);
  const created = m.state().tabs[0];
  assert.equal(m.tabs.find((tab) => tab.id === created.id).space, 'home');

  const routed = m.open('https://github.com/', { space: 'work' });
  assert.equal(m.activeSpaceId, 'work');
  assert.equal(m.activeTabId, routed);
  const ignored = m.open('https://example.com/', { space: 'deleted' });
  assert.equal(m.tabs.find((tab) => tab.id === ignored).space, 'work');
});

test('folders with the same name stay separate between spaces', () => {
  const { manager: m } = fixture();
  populate(m, [
    { id: 'a', url: 'https://a.example/', group: 'Docs' },
    { id: 'b', url: 'https://b.example/', group: 'Archive' },
    { id: 'c', url: 'https://c.example/', space: 'work', group: 'Docs' },
  ]);
  assert.equal(m.moveGroup('Archive', 'Docs'), true);
  m.toggleGroup('Archive');
  m.switchSpace('work');
  assert.deepEqual(
    m.groupView().map(({ name, parent, collapsed }) => [name, parent, collapsed]),
    [['Docs', null, false]],
  );
  assert.equal(m.renameGroup('Docs', 'Specs'), true);
  m.switchSpace('');
  assert.deepEqual(
    m.groupView().map(({ name, parent, collapsed }) => [name, parent, collapsed]),
    [
      ['Docs', null, false],
      ['Archive', 'Docs', true],
    ],
  );
  assert.equal(m.tabs.find((tab) => tab.id === 'c').group, 'Specs');
});

test('moving a tab reorders only its own space', () => {
  const { manager: m } = fixture();
  populate(m, [
    { id: 'a', url: 'https://a.example/' },
    { id: 'x', url: 'https://x.example/', space: 'work' },
    { id: 'b', url: 'https://b.example/' },
    { id: 'y', url: 'https://y.example/', space: 'work' },
    { id: 'c', url: 'https://c.example/' },
  ]);
  m.move('a', 2);
  assert.deepEqual(ids(m.state().tabs), ['b', 'c', 'a']);
  assert.deepEqual(ids(m.tabs.filter((tab) => tab.space === 'work')), ['x', 'y']);
  assert.deepEqual(ids(m.tabs), ['b', 'x', 'c', 'y', 'a']);
});

test('sessions keep every space, the active space and its folders; old sessions load into the main space', () => {
  const first = fixture();
  populate(first.manager, [
    { id: 'a', url: 'https://a.example/' },
    { id: 'c', url: 'https://c.example/', space: 'work', group: 'Docs', pinnedUrl: 'https://c.example/' },
    { id: 'd', url: 'https://d.example/', space: 'work' },
  ]);
  first.manager.switchSpace('work');
  first.manager.activate('d');
  const saved = JSON.parse(JSON.stringify(first.manager.toSavedWindow()));
  assert.equal(saved.activeTabId, 'd');
  assert.deepEqual(
    saved.tabs.map((tab) => [tab.id, tab.space]),
    [
      ['a', undefined],
      ['c', 'work'],
      ['d', 'work'],
    ],
  );
  assert.deepEqual(saved.spaceGroups, { work: {} });
  assert.deepEqual(saved.seededSpaces, ['work']);

  const second = fixture();
  second.manager.restore(saved);
  assert.equal(second.manager.activeSpaceId, 'work');
  assert.deepEqual(ids(second.manager.state().tabs), ['c', 'd']);
  assert.equal(second.manager.state().tabs[0].pinned, true);
  second.manager.switchSpace('');
  assert.deepEqual(ids(second.manager.state().tabs), ['a']);

  const legacy = fixture();
  legacy.manager.restore({
    activeTabId: 'old',
    tabs: [{ id: 'old', url: 'https://old.example/', title: 'Old', faviconUrl: null, pinnedUrl: null, history: null }],
    collapsedGroups: ['Work'],
  });
  assert.equal(legacy.manager.activeSpaceId, '');
  assert.deepEqual(ids(legacy.manager.state().tabs), ['old']);
  assert.equal(legacy.manager.toSavedWindow().tabs[0].space, undefined);
});

test('a workspace snapshot holds only the tabs of one space, and restored tabs of a removed space move to the main space', () => {
  const { manager: m, known } = fixture();
  populate(m, [
    { id: 'a', url: 'https://a.example/' },
    { id: 'c', url: 'https://c.example/', space: 'work', group: 'Docs' },
  ]);
  const snapshot = m.toSavedWindow('work');
  assert.deepEqual(ids(snapshot.tabs), ['c']);
  assert.equal(snapshot.activeTabId, 'c');
  assert.equal(snapshot.seededSpaces, undefined);

  known.splice(known.indexOf('work'), 1);
  m.syncSpaces();
  assert.deepEqual(ids(m.state().tabs), ['a', 'c']);

  const stale = fixture({ spaces: [] });
  stale.manager.restore({
    activeTabId: 'c',
    tabs: [{ id: 'c', url: 'https://c.example/', title: 'C', space: 'deleted', faviconUrl: null, history: null }],
  });
  assert.deepEqual(ids(stale.manager.state().tabs), ['c']);
});

test('the first visit loads the starting tabs of a saved workspace once per window', () => {
  const seed = {
    activeTabId: 'seed-2',
    tabs: [
      { id: 'seed-1', url: 'https://one.example/', title: 'One', faviconUrl: null, pinnedUrl: 'https://one.example/' },
      { id: 'seed-2', url: 'https://two.example/', title: 'Two', faviconUrl: null, group: 'Docs' },
    ],
    groupParents: {},
  };
  const first = fixture({ seeds: { work: seed } });
  populate(first.manager, [{ id: 'a', url: 'https://a.example/' }]);
  first.manager.switchSpace('work');
  assert.deepEqual(ids(first.manager.state().tabs), ['seed-1', 'seed-2']);
  assert.equal(first.manager.activeTabId, 'seed-2');
  assert.equal(first.manager.state().tabGroups[0].name, 'Docs');

  first.manager.switchSpace('');
  first.manager.switchSpace('work');
  assert.equal(first.manager.state().tabs.length, 2);

  const saved = first.manager.toSavedWindow();
  const second = fixture({ seeds: { work: seed } });
  second.manager.restore(saved);
  second.manager.switchSpace('');
  second.manager.switchSpace('work');
  assert.equal(second.manager.state().tabs.length, 2);
});

test('a session without session restore keeps pinned tabs in their space', () => {
  const pinned = persistence.pinnedOnly({
    activeTabId: 'c',
    tabs: [
      {
        id: 'c',
        url: 'https://c.example/x',
        title: 'C',
        space: 'work',
        pinnedUrl: 'https://c.example/',
        history: null,
      },
      { id: 'd', url: 'https://d.example/', title: 'D', space: 'work', history: null },
    ],
    spaceGroups: { work: { collapsedGroups: ['Docs'] } },
    seededSpaces: ['work'],
  });
  assert.deepEqual(
    pinned.tabs.map((tab) => [tab.id, tab.space, tab.url]),
    [['c', 'work', 'https://c.example/']],
  );
  assert.deepEqual(pinned.spaceGroups, { work: { collapsedGroups: ['Docs'] } });
  assert.deepEqual(pinned.seededSpaces, ['work']);
});

test('restarting without session restore never seeds a space twice', () => {
  const seed = {
    activeTabId: 's',
    tabs: [{ id: 's', url: 'https://one.example/', title: 'One', faviconUrl: null, pinnedUrl: 'https://one.example/' }],
  };
  let saved = null;
  for (let run = 0; run < 3; run++) {
    const { manager: m } = fixture({ seeds: { work: seed } });
    populate(m, [{ id: 'a', url: 'https://a.example/' }]);
    if (saved) m.restore(persistence.pinnedOnly(saved));
    m.switchSpace('work');
    m.switchSpace('');
    m.switchSpace('work');
    assert.equal(m.state().tabs.filter((tab) => tab.pinned).length, 1);
    saved = JSON.parse(JSON.stringify(m.toSavedWindow()));
  }
});
