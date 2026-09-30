import assert from 'node:assert/strict';
import { test } from 'node:test';
import shortcuts from '../dist/main/tab-shortcuts.js';

const { tabForShortcut } = shortcuts;

const live = {};
const tabs = [
  { id: 'a', pinnedUrl: 'https://a.test/', view: null },
  { id: 'b', pinnedUrl: 'https://b.test/', view: live },
  { id: 'c', pinnedUrl: null, view: live },
  { id: 'd', pinnedUrl: null, view: null },
];

test('numbers count every tab by default', () => {
  assert.equal(tabForShortcut(tabs, 0, false).id, 'a');
  assert.equal(tabForShortcut(tabs, 3, false).id, 'd');
  assert.equal(tabForShortcut(tabs, -1, false).id, 'd');
  assert.equal(tabForShortcut(tabs, 4, false), undefined);
});

test('closed pinned tabs are skipped when asked, open and discarded tabs still count', () => {
  assert.equal(tabForShortcut(tabs, 0, true).id, 'b');
  assert.equal(tabForShortcut(tabs, 1, true).id, 'c');
  assert.equal(tabForShortcut(tabs, 2, true).id, 'd');
  assert.equal(tabForShortcut(tabs, 3, true), undefined);
  assert.equal(tabForShortcut(tabs, -1, true).id, 'd');
});
