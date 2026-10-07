import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import bookmarks from '../../dist/main/library/bookmarks.js';
import browserImport from '../../dist/main/library/browser-import.js';
import importDialogs from '../../dist/main/window/import-dialogs.js';
import windowMenus from '../../dist/main/window/window-menus.js';
import i18n from '../../dist/shared/i18n.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bookmark-transfer-'));
app.setPath('userData', profile);
let window;
let store;
let copy;
const deadline = setTimeout(() => app.exit(1), 30_000);

app
  .whenReady()
  .then(async () => {
    i18n.setLocale('tr');
    window = new BrowserWindow({ show: false });
    store = new bookmarks.BookmarkStore(profile);
    const folder = store.addFolder('İş & araştırma');
    store.addFolder('Boş klasör');
    const entry = store.add('https://example.com/?a=1&b=2', 'İstanbul <başlık>');
    store.move(entry.id, folder.id);
    const destination = path.join(profile, 'chosen-name.html');
    fs.writeFileSync(destination, 'previous export');
    const messages = [];
    let saveCancelled = true;
    let openCancelled = true;
    // The dialogs are scripted; file writing, parsing and native parent handling run in real Electron.
    dialog.showSaveDialog = async (parent, options) => {
      assert.equal(parent, window);
      assert.deepEqual(options.filters, [{ name: 'HTML', extensions: ['html'] }]);
      assert.ok(options.properties.includes('showOverwriteConfirmation'));
      return { canceled: saveCancelled, filePath: destination };
    };
    dialog.showOpenDialog = async (parent, options) => {
      assert.equal(parent, window);
      assert.deepEqual(options.properties, ['openFile']);
      return { canceled: openCancelled, filePaths: [destination] };
    };
    dialog.showMessageBox = async (_parent, options) => {
      messages.push(options);
      return { response: 0 };
    };
    await importDialogs.exportBookmarksWithDialog(window, store);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous export');
    saveCancelled = false;
    await importDialogs.exportBookmarksWithDialog(window, store);
    assert.match(fs.readFileSync(destination, 'utf8'), /NETSCAPE-Bookmark-file-1/);
    assert.equal(messages.length, 0);
    copy = new bookmarks.BookmarkStore(path.join(profile, 'copy'));
    const importFile = (file) => browserImport.importBookmarkFile(copy, file);
    await importDialogs.importBookmarksWithDialog(window, importFile);
    assert.equal(copy.bookmarks().length, 0);
    openCancelled = false;
    await importDialogs.importBookmarksWithDialog(window, importFile);
    assert.equal(copy.bookmarks()[0].title, entry.title);
    assert.equal(copy.bookmarks()[0].url, entry.url);
    assert.deepEqual(
      copy.folders().map(({ title }) => title),
      ['İş & araştırma', 'Boş klasör'],
    );
    assert.equal(messages.at(-1).type, 'info');
    let exported = false;
    const menu = windowMenus.libraryMenuTemplate(store, {
      open() {},
      showAll() {},
      importBookmarks() {},
      importHistory() {},
      exportBookmarks: () => {
        exported = true;
      },
    });
    const exportAction = menu.find(({ label }) => label === 'Yer imlerini HTML olarak dışa aktar…');
    assert.ok(exportAction);
    exportAction.click();
    assert.equal(exported, true);
    fs.rmSync(destination);
    fs.mkdirSync(destination);
    await importDialogs.exportBookmarksWithDialog(window, store);
    assert.equal(messages.at(-1).type, 'error');
    assert.equal(fs.statSync(destination).isDirectory(), true);
    assert.equal(
      fs.readdirSync(profile).some((name) => name.endsWith('.tmp')),
      false,
    );
    assert.equal(store.bookmarks()[0].id, entry.id);
    console.log(
      'PASS: Electron bookmark HTML export/import, selected file, cancellation, empty folders and export failure',
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
  copy?.saveNow();
  window?.destroy();
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
