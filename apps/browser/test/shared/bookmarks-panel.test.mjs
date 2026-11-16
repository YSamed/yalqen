import assert from 'node:assert/strict';
import { test } from 'node:test';
import panel from '../../dist/shared/bookmarks-panel.js';

const { pageKey, tabForBookmark, bookmarkTree } = panel;

test('a bookmark matches its page whatever comes after # and a trailing slash', () => {
  assert.equal(pageKey('https://mail.google.com/mail/u/0/#inbox'), pageKey('https://mail.google.com/mail/u/0/'));
  assert.equal(pageKey('https://example.com/'), pageKey('https://example.com'));
  assert.notEqual(pageKey('https://example.com/a'), pageKey('https://example.com/b'));
  assert.notEqual(pageKey('https://example.com/?q=1'), pageKey('https://example.com/?q=2'));
  assert.equal(pageKey('not a url'), 'not a url');
});

test('the open tab for a bookmark is the active one when it shows that page', () => {
  const tabs = [
    { id: 'a', url: 'https://example.com/#one' },
    { id: 'b', url: 'https://other.com/' },
    { id: 'c', url: 'https://example.com/' },
  ];
  assert.equal(tabForBookmark('https://example.com', tabs, 'c').id, 'c');
  assert.equal(tabForBookmark('https://example.com', tabs, 'b').id, 'a');
  assert.equal(tabForBookmark('https://missing.com', tabs, 'a'), null);
});

test('folders nest and keep their order; stray parents fall back to the root', () => {
  const tree = bookmarkTree({
    folders: [
      { id: 'work', title: 'Work', parentId: null },
      { id: 'docs', title: 'Docs', parentId: 'work' },
      { id: 'lost', title: 'Lost', parentId: 'gone' },
    ],
    bookmarks: [
      { id: '1', title: 'Root', url: 'https://a.com/', folderId: null, icon: null },
      { id: '2', title: 'Spec', url: 'https://b.com/', folderId: 'docs', icon: null },
      { id: '3', title: 'Board', url: 'https://c.com/', folderId: 'work', icon: null },
      { id: '4', title: 'Orphan', url: 'https://d.com/', folderId: 'gone', icon: null },
    ],
  });
  assert.deepEqual(
    tree.folders.map((node) => node.folder.id),
    ['work', 'lost'],
  );
  assert.deepEqual(
    tree.folders[0].folders.map((node) => node.folder.id),
    ['docs'],
  );
  assert.deepEqual(
    tree.folders[0].bookmarks.map((bookmark) => bookmark.id),
    ['3'],
  );
  assert.deepEqual(
    tree.folders[0].folders[0].bookmarks.map((bookmark) => bookmark.id),
    ['2'],
  );
  assert.deepEqual(
    tree.bookmarks.map((bookmark) => bookmark.id),
    ['1', '4'],
  );
});
