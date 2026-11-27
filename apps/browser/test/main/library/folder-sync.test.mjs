import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sync from '../../../dist/main/library/folder-sync.js';
import workspaces from '../../../dist/main/library/workspaces.js';
import tabs from '../../../dist/main/tabs/tabs.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-sync-'));
const space = (id, name, savedAt = 1) => ({ id, name, icon: null, isolated: false, savedAt });
const pin = (url, group = null, title = url) => ({ url, title, group });
const state = (spaces = [], pins = {}, settings = { theme: 'dark' }) => ({ settings, spaces, pins });

let clock = 1000;
function device(folder, initial) {
  const box = { state: initial, applied: [] };
  box.sync = new sync.FolderSync({
    directory: temp(),
    folder: () => folder,
    now: () => ++clock,
    collect: () => structuredClone(box.state),
    apply: (next, removable) => {
      const spaces = [
        ...next.spaces,
        ...box.state.spaces.filter(
          (local) => !removable.has(local.id) && !next.spaces.some((remote) => remote.id === local.id),
        ),
      ];
      box.state = { ...structuredClone(next), spaces };
      box.applied.push([...removable]);
      return true;
    },
  });
  return box;
}
const files = (folder) =>
  fs.readdirSync(path.join(folder, sync.SYNC_DIRECTORY)).filter((name) => name.endsWith('.json'));

test('a sync file round-trips and rejects bad input', () => {
  const text = sync.syncFileText(
    'd1',
    5,
    state([space('s1', 'Work')], { s1: { tabs: [pin('https://a.test/')], groupParents: {} } }),
  );
  const file = sync.parseSyncFile(text);
  assert.equal(file.device, 'd1');
  assert.deepEqual(
    file.state.spaces.map((item) => item.id),
    ['s1'],
  );
  assert.equal(file.state.pins.s1.tabs[0].url, 'https://a.test/');
  assert.equal(sync.parseSyncFile('{}'), null);
  assert.equal(sync.parseSyncFile('not json'), null);
  const unsafe = sync.parseSyncFile(
    sync.syncFileText(
      'd1',
      5,
      state([], {
        '': { tabs: [pin('javascript:alert(1)')], groupParents: {} },
        ghost: { tabs: [], groupParents: {} },
      }),
    ),
  );
  assert.deepEqual(unsafe.state.pins[''].tabs, []);
  assert.equal(unsafe.state.pins.ghost, undefined);
});

test('pin titles never count as a change', () => {
  const a = { tabs: [pin('https://a.test/', 'Docs', 'Loading')], groupParents: {} };
  const b = { tabs: [pin('https://a.test/', 'Docs', 'Inbox (3)')], groupParents: {} };
  assert.equal(sync.samePins(a, b), true);
  assert.equal(sync.stateHash(state([], { '': a })), sync.stateHash(state([], { '': b })));
  assert.equal(sync.samePins(a, { tabs: [pin('https://a.test/')], groupParents: {} }), false);
});

test('only a newer file from another device is picked', () => {
  const files = [
    { device: 'me', savedAt: 50, state: state() },
    { device: 'b', savedAt: 20, state: state() },
    { device: 'c', savedAt: 30, state: state() },
  ];
  assert.equal(sync.newestRemote(files, 'me', 10).device, 'c');
  assert.equal(sync.newestRemote(files, 'me', 30), null);
});

test('a new Mac reads the folder first and never pushes its empty sidebar over the other', () => {
  const folder = temp();
  const a = device(folder, state([space('s1', 'Work')], { '': { tabs: [pin('https://a.test/')], groupParents: {} } }));
  const b = device(folder, state([], {}, { theme: 'light' }));
  try {
    a.sync.start();
    assert.equal(files(folder).length, 1);
    b.sync.start();
    assert.deepEqual(
      b.state.spaces.map((item) => item.id),
      ['s1'],
    );
    assert.equal(b.state.settings.theme, 'dark');
    assert.equal(files(folder).length, 1, 'applying the remote state does not echo a push');
  } finally {
    a.sync.stop();
    b.sync.stop();
  }
});

test('a change on one Mac reaches the other, deletes included, and local-only Spaces stay', () => {
  const folder = temp();
  const a = device(folder, state([space('s1', 'Work'), space('s2', 'Home')]));
  const b = device(folder, state());
  try {
    a.sync.start();
    b.sync.start();
    b.state.spaces.push(space('local', 'Mine'));
    b.sync.push();
    a.sync.check();
    assert.deepEqual(a.state.spaces.map((item) => item.id).sort(), ['local', 's1', 's2']);
    a.state.spaces = a.state.spaces.filter((item) => item.id !== 's2');
    a.sync.push();
    b.state.spaces.push(space('fresh', 'Fresh'));
    b.sync.check();
    assert.deepEqual(b.state.spaces.map((item) => item.id).sort(), ['fresh', 'local', 's1']);
  } finally {
    a.sync.stop();
    b.sync.stop();
  }
});

test('a Space missing from a stale remote file is not deleted', () => {
  const folder = temp();
  const a = device(folder, state([space('s1', 'Work')]));
  const b = device(folder, state());
  try {
    a.sync.start();
    b.sync.start();
    b.state.spaces.push(space('fresh', 'Fresh'));
    b.sync.push();
    a.state.settings = { theme: 'light' };
    a.sync.push();
    b.sync.check();
    assert.deepEqual(b.state.spaces.map((item) => item.id).sort(), ['fresh', 's1']);
    assert.equal(b.state.settings.theme, 'light');
  } finally {
    a.sync.stop();
    b.sync.stop();
  }
});

test('an older remote file is ignored', () => {
  const folder = temp();
  const a = device(folder, state([space('s1', 'Work')]));
  try {
    a.sync.start();
    const old = sync.syncFileText('other', 1, state([space('x', 'Old')]));
    fs.writeFileSync(path.join(folder, sync.SYNC_DIRECTORY, 'other.json'), old);
    a.sync.check();
    assert.deepEqual(
      a.state.spaces.map((item) => item.id),
      ['s1'],
    );
  } finally {
    a.sync.stop();
  }
});

test('synced Spaces keep their ids and only known Spaces are removed', () => {
  const store = new workspaces.WorkspaceStore(temp());
  const local = store.create('Local');
  assert.equal(store.applySyncedSpaces([space('s1', 'Work', 5)], new Set()), true);
  assert.deepEqual(
    store
      .syncedSpaces()
      .map((item) => item.id)
      .sort(),
    [local, 's1'].sort(),
  );
  assert.equal(store.applySyncedSpaces([space('s1', 'Work renamed', 5)], new Set(['s1'])), true);
  assert.deepEqual(
    store
      .syncedSpaces()
      .map((item) => [item.id, item.name])
      .find(([id]) => id === 's1'),
    ['s1', 'Work renamed'],
  );
  assert.equal(store.applySyncedSpaces([], new Set(['s1'])), true);
  assert.deepEqual(
    store.syncedSpaces().map((item) => item.id),
    [local],
  );
  assert.equal(store.applySyncedSpaces([], new Set(['s1'])), false);
});

test('two Macs with a Space of the same name keep both', () => {
  const a = new workspaces.WorkspaceStore(temp());
  const b = new workspaces.WorkspaceStore(temp());
  a.create('Work');
  b.create('Work');
  b.applySyncedSpaces(a.syncedSpaces(), new Set());
  assert.deepEqual(
    b
      .syncedSpaces()
      .map((item) => item.name)
      .sort(),
    ['Work', 'Work 2'],
  );
  a.applySyncedSpaces(b.syncedSpaces(), new Set());
  assert.equal(a.syncedSpaces().length, 2);
  assert.deepEqual(
    a
      .syncedSpaces()
      .map(({ id, name }) => [id, name])
      .sort(),
    b
      .syncedSpaces()
      .map(({ id, name }) => [id, name])
      .sort(),
  );
});

test('replacing pins keeps unpinned tabs and moves to another tab when the active pin goes', () => {
  const closed = [];
  const manager = new tabs.TabManager({
    window: { contentView: { removeChildView() {} } },
    freezeBackground: () => false,
    onChange() {},
    onPrivateEnded() {},
    closed,
  });
  manager.tabs.push(
    manager.createRecord({ id: 'p', url: 'https://old.test/', title: 'old', pinnedUrl: 'https://old.test/' }),
  );
  manager.tabs.push(manager.createRecord({ id: 'u', url: 'https://open.test/', title: 'open' }));
  manager.activeId = 'p';
  manager.activate = (id) => (manager.activeId = id);
  const saved = sync.pinsWindow({ tabs: [pin('https://new.test/', 'Work')], groupParents: {} });
  manager.replacePins(saved, '');
  const after = sync.pinsOf(manager.toSavedWindow(''));
  assert.deepEqual(
    after.tabs.map(({ url, group }) => [url, group]),
    [['https://new.test/', 'Work']],
  );
  assert.ok(manager.tabs.some((tab) => tab.id === 'u'));
  assert.notEqual(manager.activeId, 'p');
  assert.deepEqual(
    closed.map((tab) => tab.url),
    ['https://old.test/'],
    'a replaced pin can be reopened',
  );
});
