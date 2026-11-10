import assert from 'node:assert/strict';
import { test } from 'node:test';
import placement from '../../../dist/main/tabs/page-placement.js';
import tabs from '../../../dist/main/tabs/tabs.js';
import menus from '../../../dist/main/window/window-menus.js';
import i18n from '../../../dist/shared/i18n.js';

const { slotRect, SPLIT_GAP } = placement;

function fixture(ids = ['a', 'b', 'c', 'd', 'e']) {
  const manager = new tabs.TabManager({
    window: { contentView: { removeChildView() {}, addChildView() {} } },
    freezeBackground: () => false,
    onHtmlFullScreenChange() {},
    onChange() {},
    onPrivateEnded() {},
    closed: [],
  });
  for (const id of ids) manager.tabs.push(manager.createRecord({ id, url: `https://${id}.example/` }));
  manager.activeId = 'a';
  manager.showVisible = () => {};
  manager.activate = (id) => {
    manager.activeId = id;
  };
  return manager;
}

test('panes share the page width with a gap and cover it edge to edge', () => {
  const bounds = { x: 10, y: 20, width: 1001, height: 500 };
  assert.deepEqual(slotRect(bounds, { index: 0, count: 1 }), bounds);
  const panes = [0, 1, 2].map((index) => slotRect(bounds, { index, count: 3 }));
  assert.equal(panes[0].x, 10);
  assert.equal(panes[2].x + panes[2].width, 1011);
  for (let i = 1; i < panes.length; i++) assert.equal(panes[i].x - (panes[i - 1].x + panes[i - 1].width), SPLIT_GAP);
  assert.ok(panes.every((pane) => pane.y === 20 && pane.height === 500));
});

test('splitting follows list order, caps the pane count and keeps the focused tab', () => {
  const manager = fixture();
  manager.split(['c', 'a']);
  assert.deepEqual(manager.splitTabIds, ['a', 'c']);
  assert.equal(manager.activeTabId, 'a');
  assert.deepEqual(manager.visibleIds(), ['a', 'c']);
  assert.deepEqual(manager.slotOf(manager.find('c')), { index: 1, count: 2 });

  manager.split(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(manager.splitTabIds, ['a', 'c']);

  manager.splitWithActive('b');
  assert.deepEqual(manager.splitTabIds, ['a', 'c', 'b']);
  assert.equal(manager.canSplitWithActive('b'), false);
  manager.splitWithActive('d');
  assert.equal(manager.canSplitWithActive('e'), false);
});

test('a split opened from outside its members focuses the first member', () => {
  const manager = fixture();
  manager.split(['d', 'c']);
  assert.equal(manager.activeTabId, 'c');
  assert.equal(manager.slotOf(manager.find('a')), null);
});

test('closing the focused pane hands focus to the remaining member and collapses the split', () => {
  const manager = fixture();
  manager.split(['a', 'c']);
  manager.closeApproved('a');
  assert.equal(manager.activeTabId, 'c');
  assert.deepEqual(manager.splitTabIds, []);
});

test('a tab joins only one split and exiting removes the whole split', () => {
  const manager = fixture();
  manager.split(['a', 'b']);
  manager.split(['b', 'c']);
  assert.deepEqual(manager.splits, [['b', 'c']]);
  manager.unsplit('c');
  assert.deepEqual(manager.splitTabIds, []);
});

test('a full-screen pane takes the whole page while the split stays', () => {
  const manager = fixture();
  manager.split(['a', 'b']);
  manager.fullScreenId = 'a';
  assert.deepEqual(manager.visibleIds(), ['a']);
  assert.equal(manager.slotOf(manager.find('a')), null);
  assert.deepEqual(manager.splitTabIds, ['a', 'b']);
});

test('tab menu offers to join or leave a split', () => {
  i18n.setLocale('en');
  const called = [];
  const actions = {
    togglePin() {},
    toggleMute() {},
    discard() {},
    close() {},
    duplicate() {},
    closeOthers() {},
    closeRight() {},
    splitWithActive: () => called.push('join'),
    unsplit: () => called.push('leave'),
  };
  const tab = { pinned: false, isPrivate: false, url: 'https://example.com/', live: true };
  const labels = (availability) =>
    menus
      .tabMenuTemplate(tab, false, actions, { others: true, right: true, ...availability })
      .map(({ label }) => label);
  assert.ok(labels({ splitWithActive: true }).includes('Open in Split View'));
  assert.ok(labels({ inSplit: true, splitWithActive: true }).includes('Exit Split View'));
  assert.ok(!labels({ inSplit: true }).includes('Open in Split View'));
  assert.ok(labels({ selected: 3, splitSelected: true }).includes('Open 3 Tabs in Split View'));
  assert.ok(!labels({ selected: 5 }).some((label) => label?.includes('Split View')));
});

function liveFixture(ids = ['a', 'b', 'c']) {
  const children = [];
  const contentView = {
    children,
    addChildView(view) {
      const index = children.indexOf(view);
      if (index >= 0) children.splice(index, 1);
      children.push(view);
    },
    removeChildView(view) {
      const index = children.indexOf(view);
      if (index >= 0) children.splice(index, 1);
    },
  };
  const manager = new tabs.TabManager({
    window: { contentView },
    freezeBackground: () => false,
    onHtmlFullScreenChange() {},
    onChange() {},
    onPrivateEnded() {},
    closed: [],
  });
  for (const id of ids) {
    const tab = manager.createRecord({ id, url: `https://${id}.example/` });
    tab.view = {
      id,
      bounds: null,
      webContents: { send() {}, focus() {}, getZoomFactor: () => 1, isDestroyed: () => true },
      setBounds(bounds) {
        this.bounds = bounds;
      },
      setBorderRadius() {},
    };
    manager.tabs.push(tab);
  }
  manager.setPageLayout({ x: 0, y: 0, width: 1006, height: 600 }, 0);
  manager.activate('a');
  const attached = () => children.map(({ id }) => id);
  const width = (id) => manager.find(id).view.bounds.width;
  return { manager, attached, width };
}

test('views attach and detach as focus moves into, within and out of a split', () => {
  const { manager, attached, width } = liveFixture();
  assert.deepEqual(attached(), ['a']);
  assert.equal(width('a'), 1006);

  manager.split(['a', 'b']);
  assert.deepEqual(attached(), ['a', 'b']);
  assert.equal(width('a'), 500);
  assert.equal(manager.find('b').view.bounds.x, 506);

  manager.activate('b');
  assert.equal(manager.activeTabId, 'b');
  assert.deepEqual(attached(), ['a', 'b']);

  manager.activate('c');
  assert.deepEqual(attached(), ['c']);
  assert.equal(width('c'), 1006);

  manager.activate('a');
  assert.deepEqual(attached(), ['a', 'b']);
});

test('closing the focused pane leaves its partner at full width', () => {
  const { manager, attached, width } = liveFixture();
  manager.split(['a', 'b']);
  manager.closeApproved('a');
  assert.equal(manager.activeTabId, 'b');
  assert.deepEqual(attached(), ['b']);
  assert.equal(width('b'), 1006);
});

test('closing a background pane widens the focused one', () => {
  const { manager, attached, width } = liveFixture();
  manager.split(['a', 'b']);
  manager.closeApproved('b');
  assert.equal(manager.activeTabId, 'a');
  assert.deepEqual(attached(), ['a']);
  assert.equal(width('a'), 1006);
});

test('full screen hides the partner, and switching to it then shows it again', () => {
  const { manager, attached, width } = liveFixture();
  manager.split(['a', 'b']);
  manager.fullScreenId = 'a';
  manager.showVisible();
  assert.deepEqual(attached(), ['a']);
  assert.equal(width('a'), 1006);

  manager.activate('b');
  assert.deepEqual(attached(), ['a', 'b']);
  assert.equal(width('b'), 500);

  manager.fullScreenId = null;
  manager.showVisible();
  assert.deepEqual(attached(), ['a', 'b']);
});

test('a dropped tab joins on the side it was released over', () => {
  const manager = fixture();
  manager.splitWithActive('c', 'left');
  assert.deepEqual(manager.splitTabIds, ['c', 'a']);
  manager.splitWithActive('d', 'right');
  assert.deepEqual(manager.splitTabIds, ['c', 'a', 'd']);
  manager.splitWithActive('e', 'anything');
  assert.deepEqual(manager.splitTabIds, ['c', 'a', 'd', 'e']);
});

test('dragging over the page makes room on the hovered side and clears on drop', () => {
  const { manager, attached, width } = liveFixture();
  manager.previewSplit('b', 'left');
  assert.deepEqual(attached(), ['a']);
  assert.equal(width('a'), 500);
  assert.equal(manager.find('a').view.bounds.x, 506);

  manager.previewSplit('a', 'right');
  assert.equal(width('a'), 1006);

  manager.previewSplit('b', 'right');
  assert.equal(manager.find('a').view.bounds.x, 0);
  manager.previewSplit(null, 'right');
  assert.equal(width('a'), 1006);

  manager.previewSplit('b', 'left');
  manager.splitWithActive('b', 'left');
  assert.deepEqual(manager.splitTabIds, ['b', 'a']);
  assert.deepEqual(attached(), ['a', 'b']);
  assert.equal(manager.find('b').view.bounds.x, 0);
  assert.equal(manager.find('a').view.bounds.x, 506);
});
