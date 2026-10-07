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
    freezeBackground: () => false,
    closed: [],
    confirmUnload: () => false,
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
  contents.pinchLimits = [];
  contents.setVisualZoomLevelLimits = async (min, max) => {
    contents.pinchLimits.push([min, max]);
  };
  contents.getURL = () => 'https://example.com/';
  contents.navigationHistory = {
    getAllEntries: () => [{ url: 'https://example.com/', title: 'Example' }],
    getActiveIndex: () => 0,
    length: () => 1,
    getEntryAtIndex: () => ({ url: 'https://example.com/', title: 'Example' }),
  };
  contents.executeJavaScriptInIsolatedWorld = async () => true;
  contents.allowUnload = false;
  contents.isDestroyed = () => destroyed;
  contents.close = (options) => {
    if (options?.waitForBeforeUnload) {
      const event = {
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      contents.emit('-before-unload-fired', event, contents.allowUnload);
      if (event.defaultPrevented) return;
    }
    destroyed = true;
    contents.emit('page-title-updated', {}, 'Late title');
  };
  return { webContents: contents };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('cancelling tab close preserves its view, listeners and closed-tab history', async () => {
  const f = fixture();
  f.manager.close(f.tab.id);
  f.manager.close(f.tab.id);
  await nextTurn();
  assert.equal(f.manager.count, 1);
  assert.equal(f.tab.view, f.view);
  assert.equal(f.view.webContents.isDestroyed(), false);
  assert.ok(f.view.webContents.listenerCount('page-title-updated') > 0);
  assert.deepEqual(f.manager.options.closed, []);
  assert.deepEqual(f.removed, []);
  f.view.webContents.allowUnload = true;
  f.manager.close(f.tab.id);
  await nextTurn();
  assert.equal(f.manager.count, 0);
  assert.equal(f.view.webContents.isDestroyed(), true);
  assert.equal(f.manager.options.closed.length, 1);
});

test('cancelling window close preserves previously approved tabs too', async () => {
  const f = fixture();
  f.view.webContents.allowUnload = true;
  const second = f.manager.createRecord({ id: 'second', url: 'https://example.com/' });
  second.view = createView();
  f.manager.tabs.push(second);
  assert.equal(await f.manager.confirmCloseAll(), false);
  assert.equal(f.manager.count, 2);
  assert.equal(f.tab.view, f.view);
  assert.equal(f.view.webContents.isDestroyed(), false);
  assert.equal(second.view.webContents.isDestroyed(), false);
  second.view.webContents.allowUnload = true;
  assert.equal(await f.manager.confirmCloseAll(), true);
  assert.equal(f.manager.count, 2);
  assert.deepEqual(f.manager.options.closed, []);
  f.manager.destroyAll();
});

test('pinch zoom is allowed when a page is attached and released with its listeners', () => {
  const f = fixture();
  assert.deepEqual(f.view.webContents.pinchLimits, [[1, 3]]);
  assert.ok(f.view.webContents.listenerCount('did-navigate') > 0);
  f.manager.discard(f.tab.id);
  assert.equal(f.view.webContents.listenerCount('did-navigate'), 0);
});

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
