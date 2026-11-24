import assert from 'node:assert/strict';
import { test } from 'node:test';
import types from '../../dist/shared/types.js';

const { DEFAULT_SIDEBAR_FOOTER_ITEMS, placeSidebarFooterItem, sanitizeSidebarFooterItems } = types;

test('footer items keep known, unique entries and at most three', () => {
  assert.deepEqual(sanitizeSidebarFooterItems('spaces', DEFAULT_SIDEBAR_FOOTER_ITEMS), DEFAULT_SIDEBAR_FOOTER_ITEMS);
  assert.deepEqual(
    sanitizeSidebarFooterItems(['settings', 'nope', 'settings', 'history', 'profile', 'downloads'], []),
    ['settings', 'history', 'profile'],
  );
  assert.deepEqual(sanitizeSidebarFooterItems([], DEFAULT_SIDEBAR_FOOTER_ITEMS), []);
});

test('placing a footer item moves it to the slot and drops what no longer fits', () => {
  const items = ['spaces', 'downloads', 'screenshot'];
  assert.deepEqual(placeSidebarFooterItem(items, 'settings', 0), ['settings', 'spaces', 'downloads']);
  assert.deepEqual(placeSidebarFooterItem(items, 'screenshot', 0), ['screenshot', 'spaces', 'downloads']);
  assert.deepEqual(placeSidebarFooterItem(['history'], 'profile', 2), ['history', 'profile']);
  assert.deepEqual(placeSidebarFooterItem([], 'profile', -4), ['profile']);
});
