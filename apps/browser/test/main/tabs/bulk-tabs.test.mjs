import assert from 'node:assert/strict';
import { test } from 'node:test';
import bulk from '../../../dist/main/tabs/bulk-tabs.js';
import tabs from '../../../dist/main/tabs/tabs.js';
import menus from '../../../dist/main/window/window-menus.js';
import i18n from '../../../dist/shared/i18n.js';

function fixture(ids = ['left', 'source', 'right', 'last']) {
  const manager = new tabs.TabManager({
    window: { contentView: { removeChildView() {} } },
    freezeBackground: () => false,
    onHtmlFullScreenChange() {},
    onChange() {},
    onPrivateEnded() {},
    closed: [],
  });
  for (const id of ids) manager.tabs.push(manager.createRecord({ id, url: `https://${id}.example/` }));
  manager.activeId = 'source';
  manager.activate = (id) => {
    manager.activeId = id;
  };
  return manager;
}

test('bulk targets follow visible order, skip pinned tabs and keep the source', () => {
  const ordered = ['left', 'source', 'pin', 'right', 'last'].map((id) => ({
    id,
    pinnedUrl: id === 'pin' ? 'https://pin.example/' : null,
  }));
  assert.deepEqual(
    bulk.bulkCloseTargets(ordered, 'source', 'others').map(({ id }) => id),
    ['left', 'right', 'last'],
  );
  assert.deepEqual(
    bulk.bulkCloseTargets(ordered, 'source', 'right').map(({ id }) => id),
    ['right', 'last'],
  );
  assert.deepEqual(bulk.bulkCloseTargets(ordered, 'missing', 'others'), []);
  assert.deepEqual(bulk.bulkCloseTargets(ordered, 'last', 'right'), []);
});

test('bulk close cancellation preserves every tab and closed-tab history, then can be retried', async () => {
  const manager = fixture();
  manager.confirmClose = async (tab) => tab.id !== 'last';
  assert.equal(await manager.closeRelated('source', 'others'), false);
  assert.deepEqual(
    manager.tabs.map(({ id }) => id),
    ['left', 'source', 'right', 'last'],
  );
  assert.deepEqual(manager.options.closed, []);
  assert.equal(manager.closing.size, 0);
  manager.confirmClose = async () => true;
  assert.equal(await manager.closeRelated('source', 'right'), true);
  assert.deepEqual(
    manager.tabs.map(({ id }) => id),
    ['left', 'source'],
  );
  assert.deepEqual(
    manager.options.closed.map(({ id }) => id),
    ['last', 'right'],
  );
  assert.equal(manager.activeTabId, 'source');
});

test('bulk close protects pinned tabs and activates the retained source when another tab is active', async () => {
  const manager = fixture(['pin', 'left', 'source', 'right']);
  manager.tabs[0].pinnedUrl = manager.tabs[0].url;
  manager.activeId = 'right';
  assert.equal(await manager.closeRelated('source', 'others'), true);
  assert.deepEqual(
    manager.tabs.map(({ id }) => id),
    ['pin', 'source'],
  );
  assert.equal(manager.activeTabId, 'source');
  assert.equal(manager.canCloseRelated('source', 'others'), false);
});

test('unopened pinned launchers offer ordinary tabs to their right', async () => {
  const manager = fixture(['pin', 'source', 'right']);
  manager.tabs[0].pinnedUrl = manager.tabs[0].url;
  assert.equal(manager.canCloseRelated('pin', 'right'), true);
  assert.equal(await manager.closeRelated('pin', 'right'), true);
  assert.deepEqual(
    manager.tabs.map(({ id }) => id),
    ['pin'],
  );
  assert.equal(manager.activeTabId, 'pin');
});

test('overlapping closes are ignored and changes to targets during consent cancel the group', async () => {
  const manager = fixture();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  manager.confirmClose = async () => {
    await gate;
    return true;
  };
  const closing = manager.closeRelated('source', 'others');
  assert.equal(await manager.closeRelated('source', 'right'), false);
  manager.close('source');
  assert.equal(manager.count, 4);
  manager.tabs.at(-1).pinnedUrl = 'https://last.example/';
  release();
  assert.equal(await closing, false);
  assert.equal(manager.count, 4);
  assert.equal(manager.closing.size, 0);
  assert.deepEqual(manager.options.closed, []);
});

test('navigating or replacing an approved page while another page waits cancels group close', async () => {
  for (const change of ['navigate', 'replace']) {
    const manager = fixture();
    let currentUrl = 'https://left.example/';
    const contents = { isDestroyed: () => false, getURL: () => currentUrl };
    manager.tabs[0].view = { webContents: contents };
    manager.confirmClose = async (tab) => {
      if (tab.id === 'last') {
        if (change === 'navigate') currentUrl = 'https://other.example/';
        else manager.tabs[0].view = null;
      }
      return true;
    };
    assert.equal(await manager.closeRelated('source', 'others'), false);
    assert.equal(manager.count, 4);
    assert.deepEqual(manager.options.closed, []);
  }
});

test('duplicate has its own identity and history, preserves privacy, and is unpinned beside its source', () => {
  for (const isPrivate of [false, true]) {
    const manager = fixture();
    const source = manager.tabs[0];
    source.isPrivate = isPrivate;
    source.pinnedUrl = source.url;
    source.muted = true;
    const history = {
      entries: [
        { url: source.url, title: 'First', pageState: 'state' },
        { url: 'https://second.example/', title: 'Second' },
      ],
      index: 0,
    };
    source.history = history;
    if (!isPrivate)
      source.view = {
        webContents: { navigationHistory: { getAllEntries: () => history.entries, getActiveIndex: () => 0 } },
      };
    const id = manager.duplicate(source.id);
    const copy = manager.tabs[1];
    assert.equal(copy.id, id);
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.url, source.url);
    assert.equal(copy.isPrivate, isPrivate);
    assert.equal(copy.muted, true);
    assert.equal(copy.pinnedUrl, null);
    assert.equal(copy.openerId, null);
    assert.equal(manager.activeTabId, copy.id);
    assert.deepEqual(copy.history, history);
    copy.history.entries[0].title = 'Independent';
    assert.equal(history.entries[0].title, 'First');
    assert.equal(manager.duplicate('missing'), null);
  }
});

test('tab menu exposes duplicate and disables bulk operations without eligible tabs', () => {
  i18n.setLocale('tr');
  const called = [];
  const menu = menus.tabMenuTemplate(
    { pinned: false, isPrivate: false, url: 'https://example.com/', live: true },
    true,
    {
      togglePin() {},
      toggleMute() {},
      discard() {},
      close() {},
      duplicate: () => called.push('duplicate'),
      closeOthers: () => called.push('others'),
      closeRight: () => called.push('right'),
    },
    { others: true, right: false },
  );
  menu.find(({ label }) => label === 'Sekmeyi çoğalt').click();
  const others = menu.find(({ label }) => label === 'Diğer sekmeleri kapat');
  assert.equal(others.enabled, true);
  others.click();
  assert.equal(menu.find(({ label }) => label === 'Sağdaki sekmeleri kapat').enabled, false);
  assert.deepEqual(called, ['duplicate', 'others']);
});
