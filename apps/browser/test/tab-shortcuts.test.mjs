import assert from 'node:assert/strict';
import { test } from 'node:test';
import shortcuts from '../dist/main/tab-shortcuts.js';

const { tabForShortcut, tabListOrder } = shortcuts;

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
