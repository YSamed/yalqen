import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import workspaces from '../../../dist/main/library/workspaces.js';
import tabs from '../../../dist/main/tabs/tabs.js';
import order from '../../../dist/main/tabs/tab-shortcuts.js';
const { WorkspaceStore } = workspaces;
function manager() {
  const manager = new tabs.TabManager({
    window: { contentView: { removeChildView() {} } },
    freezeBackground: () => false,
    onChange() {},
    onPrivateEnded() {},
    closed: [],
  });
  for (const id of ['a', 'b', 'c', 'd'])
    manager.tabs.push(manager.createRecord({ id, url: `https://${id}.example/`, title: id }));
  manager.tabs.push(manager.createRecord({ id: 'private', url: 'https://private.example/', title: 'Private' }, true));
  manager.activeId = 'a';
  return manager;
}
test('groups assign selections, match visual/shortcut order, rename/collapse, persist only normal members and ungroup without closing', () => {
  const m = manager();
  m.selected = new Set(['a', 'c']);
  assert.equal(m.setSelectedGroup('Work'), true);
  assert.deepEqual(
    order.tabListOrder(m.tabs, m.openedPinned).map((tab) => tab.id),
    ['b', 'd', 'private', 'a', 'c'],
  );
  m.toggleGroup('Work');
  assert.equal(m.groupView()[0].collapsed, true);
  assert.equal(m.renameGroup('Work', 'Research'), true);
  assert.equal(m.groupView()[0].collapsed, true);
  m.selected = new Set(['private']);
  m.setSelectedGroup('Secret');
  m.toggleGroup('Secret');
  const saved = m.toSavedWindow();
  assert.deepEqual(saved.collapsedGroups, ['Research']);
  assert.equal(
    saved.tabs.some((tab) => tab.url.includes('private')),
    false,
  );
  assert.equal(m.setSelectedGroup('x'.repeat(81)), false);
  m.removeGroup('Research');
  assert.equal(m.tabs.length, 5);
  assert.equal(m.tabs.find((tab) => tab.id === 'a').group, null);
});
test('workspace saves, renames and removes atomically; independent opens have fresh tab ids and no form/history/private data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-workspaces-'));
  try {
    const m = manager();
    m.selected = new Set(['a', 'c']);
    m.setSelectedGroup('Work');
    m.togglePin('a');
    m.toggleGroup('Work');
    m.tabs[0].history = { entries: [{ url: 'https://a.example/', title: 'A', pageState: 'FORM SECRET' }], index: 0 };
    const store = new WorkspaceStore(dir);
    assert.equal(store.save('Session', m.toSavedWindow()), true);
    assert.equal(store.save('Session', m.toSavedWindow()), false);
    const id = store.list()[0].id,
      first = store.open(id),
      second = store.open(id);
    assert.equal(first.tabs.length, 4);
    assert.ok(first.tabs.every((tab) => tab.history === null));
    assert.notEqual(first.tabs[0].id, second.tabs[0].id);
    assert.notEqual(first.tabs[0].id, m.tabs[0].id);
    assert.equal(first.tabs[0].pinnedUrl, 'https://a.example/');
    assert.equal(first.tabs[0].group, 'Work');
    assert.equal(first.activeTabId, first.tabs[0].id);
    assert.deepEqual(first.collapsedGroups, ['Work']);
    const json = fs.readFileSync(store.file, 'utf8');
    assert.equal(json.includes('FORM SECRET'), false);
    assert.equal(json.includes('private.example'), false);
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.equal(store.rename(id, 'Changed'), true);
    assert.equal(new WorkspaceStore(dir).list()[0].name, 'Changed');
    fs.renameSync(store.file, store.file + '.backup');
    fs.mkdirSync(store.file);
    assert.equal(store.remove(id), false);
    assert.equal(store.list().length, 1);
    fs.rmdirSync(store.file);
    assert.equal(store.remove(id), true);
    assert.equal(new WorkspaceStore(dir).list().length, 0);
    assert.equal(store.save('Empty', { tabs: [], activeTabId: null }), false);
    assert.equal(
      store.save('Unsafe', { tabs: [{ id: 'x', url: 'https://secret:password@a.example/' }], activeTabId: 'x' }),
      false,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
