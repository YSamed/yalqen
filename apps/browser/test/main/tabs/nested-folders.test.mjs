import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import persistence from '../../../dist/main/tabs/persistence.js';
import shortcuts from '../../../dist/main/tabs/tab-shortcuts.js';
import tabs from '../../../dist/main/tabs/tabs.js';
import groups from '../../../dist/shared/tab-groups.js';

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
  manager.activeId = 'a';
  return manager;
}

function nested() {
  const m = manager();
  m.setTabGroup('a', 'Work');
  m.setTabGroup('b', 'Docs');
  m.setTabGroup('c', 'Drafts');
  assert.equal(m.moveGroup('Docs', 'Work'), true);
  assert.equal(m.moveGroup('Drafts', 'Docs'), true);
  return m;
}

const view = (m) => m.groupView().map(({ name, parent, count }) => [name, parent, count]);

test('a folder moves into another folder and the sidebar order follows the nesting', () => {
  const m = nested();
  assert.deepEqual(view(m), [
    ['Work', null, 1],
    ['Docs', 'Work', 1],
    ['Drafts', 'Docs', 1],
  ]);
  m.setTabGroup('d', 'Work');
  assert.deepEqual(
    shortcuts.tabListOrder(m.tabs, m.openedPinned, m.groupParents).map((tab) => tab.id),
    ['a', 'd', 'b', 'c'],
  );
});

test('a tab moves into a nested folder and expands every collapsed ancestor', () => {
  const m = nested();
  m.toggleGroup('Work');
  m.toggleGroup('Docs');
  assert.equal(m.setTabGroup('d', 'Drafts'), true);
  assert.equal(m.tabs.find((tab) => tab.id === 'd').group, 'Drafts');
  assert.equal(
    m.groupView().some((group) => group.collapsed),
    false,
  );
});

test('a folder cannot move into itself or into its own descendant', () => {
  const m = nested();
  assert.equal(m.moveGroup('Work', 'Work'), false);
  assert.equal(m.moveGroup('Work', 'Docs'), false);
  assert.equal(m.moveGroup('Work', 'Drafts'), false);
  assert.equal(m.moveGroup('Work', 'Missing'), false);
  assert.equal(m.moveGroup('Docs', ''), false);
  assert.deepEqual(m.groupTargets('Work'), []);
  assert.deepEqual(m.groupTargets('Drafts'), ['Work']);
  assert.equal(m.moveGroup('Drafts', null), true);
  assert.equal(m.groupView().find((group) => group.name === 'Drafts').parent, null);
});

test('renaming keeps the nesting and removing a folder lifts its tabs and subfolders one level', () => {
  const m = nested();
  assert.equal(m.renameGroup('Docs', 'Notes'), true);
  assert.deepEqual(view(m)[1], ['Notes', 'Work', 1]);
  assert.deepEqual(view(m)[2], ['Drafts', 'Notes', 1]);
  m.removeGroup('Notes');
  assert.equal(m.tabs.find((tab) => tab.id === 'b').group, 'Work');
  assert.deepEqual(view(m), [
    ['Work', null, 2],
    ['Drafts', 'Work', 1],
  ]);
  m.removeGroup('Work');
  assert.deepEqual(view(m), [['Drafts', null, 1]]);
});

test('a folder with only subfolders stays, and an empty subfolder disappears', () => {
  const m = nested();
  m.setTabGroup('a', null);
  assert.deepEqual(view(m)[0], ['Work', null, 0]);
  m.setTabGroup('b', null);
  m.setTabGroup('c', null);
  assert.deepEqual(view(m), []);
  assert.equal(m.groupParents.size, 0);
});

test('nesting survives a session save and load, and old sessions without it still load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-folders-'));
  try {
    const m = nested();
    m.toggleGroup('Docs');
    const store = new persistence.SessionStore(dir);
    store.saveNow({ version: 2, windows: [m.toSavedWindow()] });
    const [saved] = new persistence.SessionStore(dir).load().windows;
    assert.deepEqual(saved.groupParents, { Docs: 'Work', Drafts: 'Docs' });
    assert.deepEqual(saved.collapsedGroups, ['Docs']);
    assert.deepEqual([...groups.parseGroupParents(saved.groupParents)], [...m.groupParents]);
    assert.deepEqual([...groups.parseGroupParents(persistence.pinnedOnly(saved).groupParents)], [...m.groupParents]);
    assert.equal('groupParents' in manager().toSavedWindow(), false);
    assert.equal(groups.parseGroupParents(undefined).size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saved nesting with cycles, self references or invalid names is dropped', () => {
  const parsed = groups.parseGroupParents({ A: 'B', B: 'A', C: 'C', D: 7, '': 'A', E: 'A' });
  assert.deepEqual(
    [...parsed],
    [
      ['A', 'B'],
      ['E', 'A'],
    ],
  );
});
