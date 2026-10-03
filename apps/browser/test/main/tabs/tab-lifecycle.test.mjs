import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import tabs from '../../../dist/main/tabs/tabs.js';

const { TabManager } = tabs;

function fixture() {
  const changes = [];
  const removed = [];
  const manager = new TabManager({
    window: { contentView: { removeChildView: (view) => removed.push(view) } },
    onHtmlFullScreenChange: () => {},
    onChange: (persist) => changes.push(persist),
    onVisitTitle: () => {},
  });
  const tab = manager.createRecord({ id: 'background', url: 'https://example.com/' });
  manager.tabs.push(tab);
  const view = createView();
  tab.view = view;
  manager.attachListeners(tab, view);
  return { manager, tab, view, changes, removed };
}

function createView() {
  const contents = new EventEmitter();
  let destroyed = false;
  contents.debugger = new EventEmitter();
  contents.setWindowOpenHandler = () => {};
  contents.getURL = () => 'https://example.com/';
  contents.navigationHistory = {
    getAllEntries: () => [{ url: 'https://example.com/', title: 'Example' }],
    getActiveIndex: () => 0,
  };
  contents.isDestroyed = () => destroyed;
  contents.close = () => {
    destroyed = true;
    contents.emit('page-title-updated', {}, 'Late title');
  };
  return { webContents: contents };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('discarding a tab releases native and debugger listeners before closing its view', () => {
  const f = fixture();
  assert.ok(f.view.webContents.listenerCount('page-title-updated') > 0);
  assert.ok(f.view.webContents.debugger.listenerCount('message') > 0);
  assert.equal(f.manager.discard(f.tab.id), true);
  assert.equal(f.tab.view, null);
  assert.equal(f.tab.detachListeners, null);
  assert.deepEqual(f.view.webContents.eventNames(), []);
  assert.deepEqual(f.view.webContents.debugger.eventNames(), []);
  assert.equal(f.view.webContents.isDestroyed(), true);
  assert.equal(f.tab.title, 'New tab');
  assert.deepEqual(f.changes, [true]);
  assert.deepEqual(f.tab.history, {
    entries: [{ url: 'https://example.com/', title: 'Example' }],
    index: 0,
  });
});

test('a crashed renderer is unloaded after its event finishes', async () => {
  const f = fixture();
  f.view.webContents.emit('render-process-gone');
  assert.equal(f.tab.view, f.view);
  await nextTurn();
  assert.equal(f.tab.view, null);
  assert.deepEqual(f.removed, [f.view]);
  assert.deepEqual(f.changes, [true]);
});

test('a queued renderer crash does not destroy a replacement view', async () => {
  const f = fixture();
  f.view.webContents.emit('render-process-gone');
  f.manager.destroyView(f.tab);
  const replacement = createView();
  f.tab.view = replacement;
  f.manager.attachListeners(f.tab, replacement);
  await nextTurn();
  assert.equal(f.tab.view, replacement);
  assert.equal(replacement.webContents.isDestroyed(), false);
  assert.deepEqual(f.removed, [f.view]);
  assert.deepEqual(f.changes, []);
  f.manager.destroyAll();
});

test('a queued renderer crash does not unload a tab that moved to another manager', async () => {
  const f = fixture();
  f.view.webContents.emit('render-process-gone');
  f.tab.detachListeners();
  f.tab.detachListeners = null;
  f.manager.tabs.splice(0, 1);
  const recipient = new TabManager({
    window: { contentView: { removeChildView: () => {} } },
    onHtmlFullScreenChange: () => {},
    onChange: () => {},
    onVisitTitle: () => {},
  });
  recipient.tabs.push(f.tab);
  recipient.attachListeners(f.tab, f.view);
  await nextTurn();
  assert.equal(f.tab.view, f.view);
  assert.equal(f.view.webContents.isDestroyed(), false);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.changes, []);
  recipient.destroyAll();
});
