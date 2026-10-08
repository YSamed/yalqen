import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import bookmarks from '../../../dist/main/library/bookmarks.js';
import html from '../../../dist/main/library/bookmark-html.js';
import browserImport from '../../../dist/main/library/browser-import.js';

async function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bookmark-tree-'));
  const store = new bookmarks.BookmarkStore(directory);
  try {
    await run(store, directory);
  } finally {
    store.saveNow();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('legacy folders retain IDs and literal slash names when saved in the new format', async () => {
  await withStore((_store, directory) => {
    fs.writeFileSync(
      path.join(directory, 'bookmarks.json'),
      JSON.stringify({
        version: 1,
        folders: [{ id: 'legacy', title: 'Work / Docs', createdAt: 12 }],
        bookmarks: [{ id: 'page', title: 'Keep', url: 'https://example.com/', createdAt: 13, folderId: 'legacy' }],
      }),
    );
    const store = new bookmarks.BookmarkStore(directory);
    assert.deepEqual(store.folders(), [{ id: 'legacy', title: 'Work / Docs', createdAt: 12, parentId: null }]);
    store.rename('page', 'Updated');
    store.saveNow();
    assert.equal(JSON.parse(fs.readFileSync(store.file)).version, 2);
    assert.equal(new bookmarks.BookmarkStore(directory).find('https://example.com/').id, 'page');
  });
});

test('folder moves reject cycles and deletion promotes children and bookmarks without loss', async () => {
  await withStore((store, directory) => {
    const root = store.addFolder('Root');
    const child = store.addFolder('Child', root.id);
    const grandchild = store.addFolder('Grandchild', child.id);
    const page = store.add('https://example.com/', 'Page');
    store.move(page.id, child.id);
    assert.equal(store.moveFolder(root.id, grandchild.id), false);
    assert.equal(store.moveFolder(child.id, child.id), false);
    assert.equal(store.moveFolder(child.id, 'missing'), false);
    assert.equal(store.addFolder('Invalid', 'missing'), null);
    store.removeFolder(child.id);
    store.saveNow();
    const restored = new bookmarks.BookmarkStore(directory);
    assert.equal(restored.folders().find((folder) => folder.id === grandchild.id).parentId, root.id);
    assert.equal(restored.find(page.url).folderId, root.id);
  });
});

test('hierarchical HTML round trips distinct slash paths, duplicate leaf names and empty child folders', async () => {
  await withStore(async (store) => {
    const a = store.addFolder('A');
    const b = store.addFolder('B', a.id);
    const literal = store.addFolder('A / B');
    const other = store.addFolder('Other');
    store.addFolder('B', other.id);
    store.addFolder('Empty', b.id);
    for (const [index, folder] of [b, literal].entries()) {
      const entry = store.add(`https://example.com/${index}`, `Page ${index}`);
      store.move(entry.id, folder.id);
    }
    const parsed = await html.parseBookmarkHtml(html.exportBookmarkHtml(store.folders(), store.bookmarks()));
    assert.deepEqual(
      parsed.bookmarks.map((entry) => entry.folderPath),
      [['A', 'B'], ['A / B']],
    );
    assert.ok(parsed.folders.some((folder) => JSON.stringify(folder.path) === '["A","B","Empty"]'));
    const copy = new bookmarks.BookmarkStore(path.join(path.dirname(store.file), 'copy'));
    assert.deepEqual(copy.importBookmarks(parsed.bookmarks, parsed.folders), { bookmarks: 2, folders: 6 });
    assert.deepEqual(copy.importBookmarks(parsed.bookmarks, parsed.folders), { bookmarks: 0, folders: 0 });
    assert.equal(copy.folders().filter((folder) => folder.title === 'B').length, 2);
    copy.saveNow();
  });
});

test('bulk commands and URL editing persist once, keep unselected entries and invalidate address caches', async () => {
  await withStore((store, directory) => {
    const entries = [0, 1, 2].map((index) => store.add(`https://example.com/${index}`, `Page ${index}`));
    const folder = store.addFolder('Target');
    store.has(entries[0].url);
    store.suggestions();
    assert.equal(
      store.moveMany(
        entries.slice(0, 2).map((entry) => entry.id),
        folder.id,
      ),
      true,
    );
    assert.equal(store.moveMany([entries[2].id], 'missing'), false);
    assert.equal(store.edit(entries[0].id, 'Edited', entries[1].url), false);
    assert.equal(store.edit(entries[0].id, 'Edited', 'javascript:alert(1)'), false);
    assert.equal(store.edit(entries[0].id, 'Edited', 'https://new.example/'), true);
    assert.equal(store.has(entries[0].url), false);
    assert.ok(store.suggestions().some((entry) => entry.url === 'https://new.example/'));
    assert.equal(store.removeMany(Array.from({ length: 1001 }, () => entries[2].id)), false);
    assert.equal(store.removeMany([entries[0].id, entries[1].id]), true);
    store.saveNow();
    assert.deepEqual(
      new bookmarks.BookmarkStore(directory).bookmarks().map((entry) => entry.id),
      [entries[2].id],
    );
  });
});

test('browser imports retain ancestors and empty folders rather than merging their display labels', async () => {
  await withStore((store) => {
    const parsed = browserImport.parseChromiumBookmarks({
      roots: {
        bookmark_bar: {
          children: [
            { type: 'folder', name: 'Root', children: [{ type: 'folder', name: 'Empty', children: [] }] },
            {
              type: 'folder',
              name: 'Root / Empty',
              children: [{ type: 'url', name: 'Page', url: 'https://example.com/' }],
            },
          ],
        },
      },
    });
    assert.deepEqual(store.importBookmarks(parsed.bookmarks, parsed.folders), { bookmarks: 1, folders: 3 });
    assert.equal(
      store.folders().find((folder) => folder.title === 'Empty').parentId,
      store.folders().find((folder) => folder.title === 'Root').id,
    );
    assert.equal(store.folders().find((folder) => folder.title === 'Root / Empty').parentId, null);
  });
});

test('corrupt folder cycles are repaired and the maximum depth remains exportable', async () => {
  await withStore(async (_store, directory) => {
    fs.writeFileSync(
      path.join(directory, 'bookmarks.json'),
      JSON.stringify({
        version: 2,
        bookmarks: [],
        folders: [
          { id: 'a', title: 'A', createdAt: 1, parentId: 'b' },
          { id: 'b', title: 'B', createdAt: 1, parentId: 'a' },
        ],
      }),
    );
    const store = new bookmarks.BookmarkStore(directory);
    assert.ok(store.folders().some((folder) => folder.parentId === null));
    let parent = null;
    for (let index = 0; index < 127; index++) parent = store.addFolder(`Depth ${index}`, parent).id;
    assert.equal(store.addFolder('Too deep', parent), null);
    const parsed = await html.parseBookmarkHtml(html.exportBookmarkHtml(store.folders(), store.bookmarks()));
    assert.equal(parsed.folders.length, 129);
    store.saveNow();
  });
});
