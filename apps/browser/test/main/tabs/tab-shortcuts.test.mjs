import assert from 'node:assert/strict';
import { test } from 'node:test';
import shortcuts from '../../../dist/main/tabs/tab-shortcuts.js';

const { cycleRecentTabs, tabForShortcut, tabListOrder, TAB_CYCLE_WINDOW_MS } = shortcuts;

test('next tab goes to the most recently used tab, not the next one in the list', () => {
  const used = [
    { id: 'a', usedAt: Infinity },
    { id: 'b', usedAt: 1 },
    { id: 'c', usedAt: 3 },
  ];
  const next = cycleRecentTabs(used, 'a', 1, 0, null);
  assert.equal(next.ids[next.index], 'c');
  const previous = cycleRecentTabs(used, 'a', -1, 0, null);
  assert.equal(previous.ids[previous.index], 'b');
});

test('quick repeated presses go further back and a pause starts over', () => {
  const used = [
    { id: 'a', usedAt: Infinity },
    { id: 'b', usedAt: 1 },
    { id: 'c', usedAt: 3 },
  ];
  const first = cycleRecentTabs(used, 'a', 1, 0, null);
  const second = cycleRecentTabs(used, 'c', 1, 100, first);
  assert.equal(second.ids[second.index], 'b');
  const back = cycleRecentTabs(used, 'b', -1, 200, second);
  assert.equal(back.ids[back.index], 'c');
  const afterPause = [
    { id: 'a', usedAt: 5 },
    { id: 'b', usedAt: 4 },
    { id: 'c', usedAt: Infinity },
  ];
  const later = cycleRecentTabs(afterPause, 'c', 1, 200 + TAB_CYCLE_WINDOW_MS, back);
  assert.equal(later.ids[later.index], 'a');
});

test('recent cycling needs a second tab and a known active tab', () => {
  assert.equal(cycleRecentTabs([{ id: 'a', usedAt: 0 }], 'a', 1, 0, null), null);
  const two = [
    { id: 'a', usedAt: 0 },
    { id: 'b', usedAt: 0 },
  ];
  assert.equal(cycleRecentTabs(two, 'x', 1, 0, null), null);
});

const tabs = [
  { id: 'p1', pinnedUrl: 'https://one.test/' },
  { id: 'p2', pinnedUrl: 'https://two.test/' },
  { id: 'a', pinnedUrl: null },
  { id: 'b', pinnedUrl: null },
  { id: 'c', pinnedUrl: null },
];
const ids = (list) => list.map((tab) => tab.id);

test('closed pinned tabs stay out of the tab list', () => {
  assert.deepEqual(ids(tabListOrder(tabs, new Map())), ['a', 'b', 'c']);
});

test('opened pinned tabs sit after the tab they were opened behind', () => {
  const opened = new Map([
    ['p1', 'c'],
    ['p2', null],
  ]);
  assert.deepEqual(ids(tabListOrder(tabs, opened)), ['p2', 'a', 'b', 'c', 'p1']);
});

test('opened pinned tabs keep their opening order behind the same tab', () => {
  const opened = new Map([
    ['p2', 'a'],
    ['p1', 'a'],
  ]);
  assert.deepEqual(ids(tabListOrder(tabs, opened)), ['a', 'p2', 'p1', 'b', 'c']);
});

test('an opened pinned tab whose anchor is gone moves to the end', () => {
  assert.deepEqual(ids(tabListOrder(tabs, new Map([['p1', 'gone']]))), ['a', 'b', 'c', 'p1']);
});

test('number shortcuts follow the tab list order', () => {
  const ordered = tabListOrder(tabs, new Map([['p1', 'c']]));
  assert.equal(tabForShortcut(ordered, 0).id, 'a');
  assert.equal(tabForShortcut(ordered, 3).id, 'p1');
  assert.equal(tabForShortcut(ordered, -1).id, 'p1');
  assert.equal(tabForShortcut(ordered, 4), undefined);
});

test('stale opened pins are ignored while large groups keep their opening order', () => {
  const pins = Array.from({ length: 1000 }, (_, index) => ({ id: `p${index}`, pinnedUrl: `https://p${index}.test/` }));
  const anchor = { id: 'anchor', pinnedUrl: null };
  const opened = new Map([['gone', 'anchor'], ['anchor', null], ...pins.toReversed().map(({ id }) => [id, 'anchor'])]);
  const ordered = tabListOrder([...pins, anchor], opened);
  assert.deepEqual(ids(ordered), ['anchor', ...pins.toReversed().map(({ id }) => id)]);
  assert.equal(new Set(ordered).size, 1001);
});
