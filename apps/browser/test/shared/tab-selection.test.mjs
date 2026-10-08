import assert from 'node:assert/strict';
import { test } from 'node:test';
import selection from '../../dist/shared/tab-selection.js';

test('modifier selection starts with the active tab, toggles items and removes stale ids', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(selection.selectTabIds(order, [], null, 'a', 'c', 'toggle'), { ids: ['a', 'c'], anchor: 'c' });
  assert.deepEqual(selection.selectTabIds(order, ['gone', 'a', 'c'], 'c', 'a', 'c', 'toggle'), {
    ids: ['a'],
    anchor: 'c',
  });
  assert.deepEqual(selection.selectTabIds(order, ['a', 'gone'], 'a', 'a', 'missing', 'toggle').ids, ['a']);
});

test('ranges work in both directions and follow the visible order', () => {
  const order = ['pin', 'a', 'b', 'c', 'd'];
  assert.deepEqual(selection.selectTabIds(order, [], null, 'a', 'd', 'range'), {
    ids: ['a', 'b', 'c', 'd'],
    anchor: 'a',
  });
  assert.deepEqual(selection.selectTabIds(order, ['a', 'b', 'c'], 'c', 'a', 'pin', 'range'), {
    ids: ['pin', 'a', 'b', 'c'],
    anchor: 'c',
  });
  assert.deepEqual(selection.selectTabIds(order, [], 'removed', null, 'b', 'range'), { ids: ['b'], anchor: 'b' });
});

test('group movement preserves internal order, handles either direction and does not mutate inputs', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const move = (ids, id, toIndex) => selection.moveTabSelection(tabs, ids, id, toIndex).map(({ id }) => id);
  assert.deepEqual(move(['a', 'c'], 'a', 4), ['b', 'd', 'e', 'a', 'c']);
  assert.deepEqual(move(['c', 'd'], 'd', 0), ['c', 'd', 'a', 'b', 'e']);
  assert.deepEqual(move(['a', 'c'], 'e', 0), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(move([], 'a', NaN), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(
    tabs.map(({ id }) => id),
    ['a', 'b', 'c', 'd', 'e'],
  );
});
