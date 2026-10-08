import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session, webContents } from 'electron';
import reading from '../../dist/main/library/reading-list.js';
import handlers from '../../dist/main/library/reading-list-handlers.js';
import internal from '../../dist/main/pages/internal-pages.js';
import shared from '../../dist/shared/reading-list.js';
import i18n from '../../dist/shared/i18n.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-reading-list-ui-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const windows = [];
const deadline = setTimeout(() => app.exit(1), 30_000);
async function eventually(contents, predicate) {
  const start = Date.now();
  while (!(await contents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw Error(`Reading list UI timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
app
  .whenReady()
  .then(async () => {
    i18n.setLocale('tr');
    const store = new reading.ReadingListStore(root);
    const browsing = session.fromPartition('reading-list');
    const privateSession = session.fromPartition('private-reading-list');
    handlers.installReadingListHandlers({
      store,
      owned: (contents) => windows.some((window) => window.webContents === contents),
      writable: (contents) => contents.session === browsing,
      changed: () => handlers.broadcastReadingList(webContents.getAllWebContents()),
    });
    const renderer = path.resolve('dist/renderer');
    const assets = internal.loadInternalPages({
      newTab: path.join(renderer, 'newtab.html'),
      newTabScript: path.join(renderer, 'newtab-suggestions.js'),
      history: path.join(renderer, 'history.html'),
      downloads: path.join(renderer, 'downloads.html'),
      bookmarks: path.join(renderer, 'bookmarks.html'),
      settings: path.join(renderer, 'settings.html'),
      readingList: path.join(renderer, 'reading-list.html'),
    });
    for (const target of [browsing, privateSession]) internal.serveInternalPages(target, assets, {});
    const create = (target, preload = path.resolve('dist/preload/page-preload.js')) => {
      const window = new BrowserWindow({
        show: false,
        width: 1000,
        height: 800,
        webPreferences: { session: target, preload, sandbox: true, contextIsolation: true },
      });
      windows.push(window);
      return window;
    };
    const normal = create(browsing),
      contents = normal.webContents;
    const title = '<img src=x onerror="window.pwned=true"> İstanbul';
    assert.equal(
      reading.saveReadingPage(store, { url: 'https://a.example/#chapter', title, isPrivate: false, developer: false }),
      true,
    );
    store.add('https://b.example/', 'Second');
    await normal.loadURL(shared.READING_LIST_URL);
    await eventually(contents, "document.querySelectorAll('ol li').length===2");
    assert.equal(await contents.executeJavaScript('document.documentElement.lang'), 'tr');
    assert.equal(await contents.executeJavaScript("document.querySelectorAll('ol img').length"), 0);
    assert.equal(await contents.executeJavaScript("document.querySelectorAll('ol strong')[1].textContent"), title);
    assert.equal(
      await contents.executeJavaScript("document.querySelectorAll('ol a')[1].href"),
      'https://a.example/#chapter',
    );
    await contents.executeJavaScript(
      "document.querySelector('input').value='İSTANBUL';document.querySelector('form').requestSubmit()",
    );
    await eventually(contents, "document.querySelectorAll('ol li').length===1");
    await contents.executeJavaScript("document.querySelector('[data-read]').click()");
    await eventually(
      contents,
      "document.querySelector('[data-read]').getAttribute('aria-pressed')==='true' && !document.querySelector('[data-read]').disabled",
    );
    assert.equal(new reading.ReadingListStore(root).list('', 'read')[0].title, title);
    await contents.executeJavaScript(
      "document.querySelector('select').value='unread';document.querySelector('select').dispatchEvent(new Event('change'))",
    );
    await eventually(
      contents,
      "document.querySelectorAll('ol li').length===0 && !document.querySelector('[data-empty]').hidden",
    );
    await contents.executeJavaScript(
      "document.querySelector('input').value='';document.querySelector('form').requestSubmit()",
    );
    await eventually(contents, "document.querySelectorAll('ol li').length===1");
    assert.equal(await contents.executeJavaScript("document.querySelector('ol strong').textContent"), 'Second');
    const privateWindow = create(privateSession),
      privateContents = privateWindow.webContents;
    await privateWindow.loadURL(shared.READING_LIST_URL);
    await eventually(
      privateContents,
      "document.querySelectorAll('ol li').length===2 && !document.querySelector('[data-readonly]').hidden",
    );
    assert.equal(
      await privateContents.executeJavaScript(
        "Array.from(document.querySelectorAll('ol button')).every(button=>button.disabled)",
      ),
      true,
    );
    const id = store.list()[0].id;
    assert.equal(
      await privateContents.executeJavaScript(`window.yalqenReadingList.remove(${JSON.stringify(id)})`),
      false,
    );
    assert.equal(
      await privateContents.executeJavaScript(`window.yalqenReadingList.setRead(${JSON.stringify(id)},true)`),
      false,
    );
    assert.equal(
      reading.saveReadingPage(store, {
        url: 'https://private.example/',
        title: 'Private',
        isPrivate: true,
        developer: false,
      }),
      false,
    );
    assert.equal(
      reading.saveReadingPage(store, { url: 'https://dev.example/', title: 'Dev', isPrivate: false, developer: true }),
      false,
    );
    await contents.executeJavaScript("document.querySelector('[data-remove]').click()");
    await eventually(contents, "document.querySelectorAll('ol li').length===0");
    await eventually(privateContents, "document.querySelectorAll('ol li').length===1");
    assert.equal(new reading.ReadingListStore(root).list().length, 1);
    const attackerPreload = path.join(root, 'attacker.cjs');
    fs.writeFileSync(
      attackerPreload,
      "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('invoke',(name,...args)=>ipcRenderer.invoke(name,...args));",
    );
    const attacker = create(browsing, attackerPreload);
    await attacker.loadURL('data:text/html,<p>Attacker</p>');
    for (const [channel, args, expected] of [
      [shared.ReadingListChannel.list, ['', 'all'], null],
      [shared.ReadingListChannel.remove, [store.list()[0].id], false],
      [shared.ReadingListChannel.read, [store.list()[0].id, false], false],
    ])
      assert.equal(
        await attacker.webContents.executeJavaScript(
          `window.invoke(${JSON.stringify(channel)},...${JSON.stringify(args)})`,
        ),
        expected,
      );
    await normal.loadURL('data:text/html,<p>Normal external page</p>');
    assert.equal(await contents.executeJavaScript('typeof window.yalqenReadingList'), 'undefined');
    assert.equal(store.list().length, 1);
    console.log(
      'PASS: production reading list/preload saves and restores entries, searches, changes read status, deletes and broadcasts changes, renders hostile titles as text and rejects private/developer saves and external IPC',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
