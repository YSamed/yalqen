import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import bookmarks from '../../dist/main/library/bookmarks.js';
import pages from '../../dist/main/pages/bookmarks-page.js';
import internal from '../../dist/main/pages/internal-pages.js';
import navigation from '../../dist/main/pages/internal-navigation.js';
import html from '../../dist/main/pages/html.js';
import i18n from '../../dist/shared/i18n.js';

internal.registerInternalScheme();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bookmark-editing-'));
app.setPath('userData', directory);
const deadline = setTimeout(() => app.exit(1), 30_000);
let window;
let store;
const ROOT = 'yalqen://bookmarks/';
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw new Error('Bookmark UI test timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    i18n.setLocale('tr');
    store = new bookmarks.BookmarkStore(directory);
    const parent = store.addFolder('Parent');
    const child = store.addFolder('Child', parent.id);
    const grandchild = store.addFolder('Grandchild', child.id);
    const entries = [0, 1, 2].map((index) => store.add(`https://example.com/${index}`, `Page ${index}`));
    store.move(entries[0].id, child.id);
    store.move(entries[1].id, grandchild.id);
    const publicDir = path.resolve('src/renderer/public');
    const template = fs
      .readFileSync(path.join(publicDir, 'bookmarks.html'), 'utf8')
      .replace(/\{\{([\w.]+)\}\}/g, (_match, key) => html.escapeHtml(i18n.t(key)))
      .replace(
        '__YALQEN_STYLES_SLOT__',
        ['tokens.css', 'controls.css'].map((name) => fs.readFileSync(path.join(publicDir, name), 'utf8')).join('\n'),
      );
    const assets = { template, script: fs.readFileSync(path.join(publicDir, 'bookmarks.js'), 'utf8') };
    session.defaultSession.protocol.handle('yalqen', (request) =>
      pages.serveBookmarks(new URL(request.url), assets, (query) => ({
        folders: store.folders(),
        bookmarks: store.bookmarks(query),
      })),
    );
    window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    const contents = window.webContents;
    let changes = 0;
    contents.on('will-navigate', (event) => {
      const command = navigation.internalNavigation(event.url);
      if (!command) return;
      event.preventDefault();
      if (command.type !== 'page-command' || !navigation.isAllowedFrom(command, contents.getURL())) return;
      if (bookmarks.runBookmarksCommand(store, command.name, command.params)) {
        changes++;
        setImmediate(() => {
          if (!contents.isDestroyed()) void contents.loadURL(ROOT);
        });
      }
    });
    const ready = async () =>
      eventually(
        async () =>
          !contents.isLoading() && (await contents.executeJavaScript("!!document.querySelector('#bulk-bookmarks')")),
      );
    await contents.loadURL(ROOT);
    await ready();
    assert.equal(
      await contents.executeJavaScript(`document.querySelector('[data-folder-id="${child.id}"] h2').textContent`),
      'Parent / Child',
    );
    await contents.executeJavaScript(`document.querySelector('[data-folder-id="${parent.id}"] details').open = true`);
    await eventually(
      async () =>
        await contents.executeJavaScript(
          `!document.querySelector('[data-folder-id="${parent.id}"] select').hasAttribute('data-folder-options')`,
        ),
    );
    assert.deepEqual(
      await contents.executeJavaScript(
        `Array.from(document.querySelector('[data-folder-id="${parent.id}"] select').options, option => option.value)`,
      ),
      [''],
    );
    await contents.executeJavaScript(
      `(() => {const form=document.querySelector('.new-folder');form.elements.title.value='Added';form.elements.parent.value=${JSON.stringify(child.id)};form.requestSubmit();})()`,
    );
    await eventually(() => store.folders().some((folder) => folder.title === 'Added'));
    await ready();
    assert.equal(store.folders().find((folder) => folder.title === 'Added').parentId, child.id);
    const choose = async (ids) =>
      contents.executeJavaScript(
        `(() => {const ids=${JSON.stringify(ids)};for(const choice of document.querySelectorAll('[data-bookmark-selection]')) {choice.checked=ids.includes(choice.value);choice.dispatchEvent(new Event('change'));}})()`,
      );
    await choose(entries.slice(0, 2).map((entry) => entry.id));
    assert.equal(
      await contents.executeJavaScript("document.querySelector('[data-selection-count]').textContent"),
      '2 seçildi',
    );
    await contents.executeJavaScript(
      `(() => {const form=document.querySelector('#bulk-bookmarks');form.elements.folder.value=${JSON.stringify(parent.id)};form.requestSubmit(form.querySelector('button'));})()`,
    );
    await eventually(
      () => store.find(entries[0].url).folderId === parent.id && store.find(entries[1].url).folderId === parent.id,
    );
    await ready();
    assert.equal(store.find(entries[2].url).folderId, null);
    await choose(entries.slice(0, 2).map((entry) => entry.id));
    const before = changes;
    await contents.executeJavaScript(
      "window.confirmations=0;window.confirm=()=>{window.confirmations++;return false};document.querySelector('#bulk-bookmarks').requestSubmit(document.querySelector('[data-confirm]'));",
    );
    assert.equal(await contents.executeJavaScript('window.confirmations'), 1);
    assert.equal(changes, before);
    assert.equal(store.bookmarks().length, 3);
    await contents.executeJavaScript(
      "window.confirm=()=>true;document.querySelector('#bulk-bookmarks').requestSubmit(document.querySelector('[data-confirm]'))",
    );
    await eventually(() => store.bookmarks().length === 1);
    await ready();
    assert.equal(store.bookmarks()[0].id, entries[2].id);
    await contents.executeJavaScript(
      `(() => {const form=document.querySelector('form[action="yalqen://bookmarks/rename"]');form.elements.title.value='Updated';form.elements.url.value='https://changed.example/';form.requestSubmit();})()`,
    );
    await eventually(() => store.has('https://changed.example/'));
    await ready();
    assert.equal(store.has(entries[2].url), false);
    store.saveNow();
    const restored = new bookmarks.BookmarkStore(directory);
    assert.equal(restored.find('https://changed.example/').title, 'Updated');
    assert.equal(restored.folders().find((folder) => folder.title === 'Added').parentId, child.id);
    console.log(
      'PASS: production bookmark page creates nested folders, excludes cyclic parents, edits URLs, moves selected entries, cancels/confirms bulk deletion and persists the hierarchy',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  store?.saveNow();
  if (window && !window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(error);
  }
});
