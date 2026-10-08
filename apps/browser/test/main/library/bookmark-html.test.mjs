import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import htmlBookmarks from '../../../dist/main/library/bookmark-html.js';
import bookmarks from '../../../dist/main/library/bookmarks.js';
import browserImport from '../../../dist/main/library/browser-import.js';
import page from '../../../dist/main/pages/bookmarks-page.js';
import navigation from '../../../dist/main/pages/internal-navigation.js';

const { parseBookmarkHtml, exportBookmarkHtml, writeBookmarkHtml, MAX_BOOKMARK_FILE_BYTES } = htmlBookmarks;
const { BookmarkStore } = bookmarks;

const source = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
 <DT><H3 ADD_DATE="1700000000">İş &amp; araştırma</H3>
 <DL><p>
  <DT><A HREF="https://example.com/?a=1&amp;b=2" ADD_DATE="1700000001">Örnek &lt;başlık&gt;</A>
  <DT><H3>Alt <b>klasör</b></H3>
  <DL><p><DT><A HREF='file:///tmp/report.html'>Yerel dosya</A></DL><p>
  <DT><A HREF="https://other.example/">Aynı üst klasör</A>
 </DL><p>
 <DT><H3>Boş</H3><DL><p></DL><p>
 <DT><A HREF="https://loose.example/" ADD_DATE="garbage">Klasörsüz</A>
 <DT><A HREF="https://example.com/?a=1&amp;b=2">Tekrar</A>
 <DT><A HREF="javascript:alert(1)">Betik</A>
 <DT><A HREF="data:text/html,unsafe">Veri</A>
 <DT><A HREF="https://[invalid">Geçersiz</A>
 <script>globalThis.bookmarkImportRan = true;</script>
 <template><A HREF="https://hidden.example/">Hidden</A></template>
</DL><p>`;

test('Netscape HTML handles omitted tags, nested folders, entities, dates and unsupported URLs', async () => {
  const parsed = await parseBookmarkHtml(source);
  assert.deepEqual(parsed.folders, [
    { title: 'İş & araştırma', createdAt: 1700000000000, path: ['İş & araştırma'] },
    { title: 'İş & araştırma / Alt klasör', createdAt: null, path: ['İş & araştırma', 'Alt klasör'] },
    { title: 'Boş', createdAt: null, path: ['Boş'] },
  ]);
  assert.deepEqual(
    parsed.bookmarks.map(({ title, url, folder }) => [title, url, folder]),
    [
      ['Örnek <başlık>', 'https://example.com/?a=1&b=2', 'İş & araştırma'],
      ['Yerel dosya', 'file:///tmp/report.html', 'İş & araştırma / Alt klasör'],
      ['Aynı üst klasör', 'https://other.example/', 'İş & araştırma'],
      ['Klasörsüz', 'https://loose.example/', null],
    ],
  );
  assert.equal(parsed.bookmarks[0].createdAt, 1700000001000);
  assert.equal(parsed.bookmarks[3].createdAt, null);
  assert.equal(parsed.skipped, 4);
  assert.equal(globalThis.bookmarkImportRan, undefined);
});

test('HTML exports round trip names, URLs, dates, loose bookmarks and empty folders', async () => {
  const folders = [
    { id: 'f', title: `İş <script>"&'`, createdAt: 1700000000000 },
    { id: 'e', title: 'Boş', createdAt: 1700000002000 },
  ];
  const entries = [
    {
      id: 'a',
      title: `<img src=x onerror="alert(1)"> & Örnek`,
      url: 'https://example.com/?a="&b=<>',
      folderId: 'f',
      createdAt: 1700000003000,
    },
    { id: 'b', title: 'Dosya', url: 'file:///tmp/a.html', folderId: null, createdAt: 1700000004000 },
    { id: 'c', title: 'Missing folder', url: 'https://loose.example/', folderId: 'gone', createdAt: 1700000005000 },
    { id: 'd', title: 'Unsafe', url: 'javascript:alert(1)', folderId: null, createdAt: 1 },
  ];
  const html = exportBookmarkHtml(folders, entries);
  assert.match(html, /NETSCAPE-Bookmark-file-1/);
  assert.match(html, /charset=UTF-8/);
  assert.doesNotMatch(html, /<script>|<img|javascript:/);
  const result = await parseBookmarkHtml(html);
  assert.deepEqual(
    result.folders,
    folders.map(({ title, createdAt }) => ({ title, createdAt, path: [title] })),
  );
  assert.deepEqual(
    result.bookmarks,
    entries.slice(0, 3).map(({ title, url, createdAt }, index) => ({
      title,
      url,
      createdAt,
      folder: index === 0 ? folders[0].title : null,
      folderPath: index === 0 ? [folders[0].title] : [],
    })),
  );
  assert.equal(result.skipped, 0);
  assert.deepEqual(await parseBookmarkHtml(exportBookmarkHtml([], [])), { bookmarks: [], folders: [], skipped: 0 });
});

test('HTML file import is additive, persists empty folders and counts existing addresses', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yalqen-bookmark-html-'));
  try {
    const file = path.join(dir, 'bookmarks.html');
    await fs.writeFile(file, `\uFEFF${source}`, 'utf8');
    const store = new BookmarkStore(dir);
    store.add('https://loose.example/', 'Keep my title');
    assert.deepEqual(await browserImport.importBookmarkFile(store, file), { bookmarks: 3, folders: 3, skipped: 5 });
    assert.equal(store.find('https://loose.example/').title, 'Keep my title');
    assert.deepEqual(await browserImport.importBookmarkFile(store, file), { bookmarks: 0, folders: 0, skipped: 8 });
    store.saveNow();
    const restored = new BookmarkStore(dir);
    assert.equal(restored.bookmarks().length, 4);
    assert.equal(restored.folders().length, 3);
    assert.equal(restored.folders()[0].createdAt, 1700000000000);
    const output = path.join(dir, 'export.html');
    await fs.writeFile(output, 'previous export');
    await writeBookmarkHtml(output, restored.folders(), restored.bookmarks());
    const copy = new BookmarkStore(path.join(dir, 'copy'));
    assert.deepEqual(await browserImport.importBookmarkFile(copy, output), { bookmarks: 4, folders: 3, skipped: 0 });
    copy.saveNow();
    assert.equal(
      (await fs.readdir(dir)).some((name) => name.endsWith('.tmp')),
      false,
    );
    const empty = path.join(dir, 'empty.html');
    await fs.writeFile(empty, '<DL><DT><H3>Only empty</H3><DL></DL></DL>');
    assert.deepEqual(await browserImport.importBookmarkFile(copy, empty), { bookmarks: 0, folders: 1, skipped: 0 });
    copy.saveNow();
    assert.ok(new BookmarkStore(path.join(dir, 'copy')).folders().some(({ title }) => title === 'Only empty'));
    await fs.writeFile(
      file,
      JSON.stringify({
        roots: { bookmark_bar: { children: [{ type: 'url', name: 'Chrome', url: 'https://chrome.example/' }] } },
      }),
    );
    assert.deepEqual(await browserImport.importBookmarkFile(store, file), { bookmarks: 1, folders: 0, skipped: 0 });
    store.saveNow();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('invalid, oversized and deeply nested imports fail before changing existing bookmarks', async () => {
  await assert.rejects(
    parseBookmarkHtml('<html><a href="https://example.com/">Not a bookmark file</a></html>'),
    SyntaxError,
  );
  await assert.rejects(parseBookmarkHtml('x'.repeat(MAX_BOOKMARK_FILE_BYTES + 1)), RangeError);
  await assert.rejects(parseBookmarkHtml('<DL>'.repeat(130) + '</DL>'.repeat(130)), RangeError);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yalqen-bookmark-limit-'));
  try {
    const store = new BookmarkStore(dir);
    store.add('https://existing.example/', 'Keep');
    const file = path.join(dir, 'large.html');
    await fs.writeFile(file, '<DL>');
    await fs.truncate(file, MAX_BOOKMARK_FILE_BYTES + 1);
    await assert.rejects(browserImport.importBookmarkFile(store, file), RangeError);
    await fs.writeFile(file, '<html>Not bookmarks</html>');
    await assert.rejects(browserImport.importBookmarkFile(store, file), SyntaxError);
    assert.equal(store.bookmarks().length, 1);
    assert.equal(store.folders().length, 0);
    store.saveNow();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('transfer links are offered on empty and filtered bookmark pages and require the internal source page', () => {
  for (const query of ['', 'filtered']) {
    const html = page.renderBookmarks([], [], query);
    for (const action of ['import', 'export']) {
      const url = `yalqen://bookmarks/${action}`;
      assert.ok(html.includes(`href="${url}"`));
      const command = navigation.internalNavigation(url);
      assert.equal(navigation.isAllowedFrom(command, 'yalqen://bookmarks/?q=filtered'), true);
      assert.equal(navigation.isAllowedFrom(command, 'https://untrusted.example/'), false);
      assert.equal(navigation.isAllowedFrom(command, 'yalqen://newtab/'), false);
    }
  }
});
