import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, nativeImage, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import extensionBridge from '../../dist/main/extensions/extension-bridge.js';
import historyModule from '../../dist/main/library/history.js';
import bookmarksModule from '../../dist/main/library/bookmarks.js';
import downloadsModule from '../../dist/main/library/downloads.js';
import downloadManagerModule from '../../dist/main/library/download-manager.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-worker-apis-')));
app.setPath('userData', path.join(profile, 'profile'));
const windows = [];
const deadline = setTimeout(() => app.exit(1), 30000);
const server = http.createServer((req, res) => {
  if (req.url === '/file') {
    res.setHeader('Content-Disposition', 'attachment; filename="server.txt"');
    res.end('downloaded');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/frame' ? '<iframe src="/child"></iframe>' : '<title>Page</title>');
});
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw Error('Extension worker APIs test timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Read at worker startup, like uBlock Origin Lite and Bitwarden do.
const WORKER = `const seen = [];
const webext = self.browser || self.chrome;
webext.commands.onCommand.addListener((name, tab) => seen.push('command:' + name + ':' + (tab && tab.id)));
chrome.commands.onCommand.addListener(() => {});
webext.contextMenus.removeAll(() => webext.contextMenus.create({ id: 'fill', title: 'Fill', contexts: ['all'] }));
webext.contextMenus.onClicked.addListener((info) => seen.push('menu:' + info.menuItemId));
webext.notifications.onClicked.addListener(() => {});
webext.notifications.onButtonClicked.addListener(() => {});
webext.webNavigation.onCommitted.addListener((details) => seen.push('committed:' + details.frameId + ':' + details.url));
chrome.webNavigation.onCompleted.addListener((details) => seen.push('completed:' + details.tabId));
chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => seen.push('fragment:' + details.frameId + ':' + details.url));
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => seen.push('history:' + details.frameId + ':' + details.url));
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId > 0) seen.push('subframe:' + details.parentFrameId + ':' + details.url);
});
webext.bookmarks.onCreated.addListener((id, node) => seen.push('bookmark:' + node.title));
webext.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  seen.push('download:' + delta.state.current);
  chrome.storage.local.set({ ['download:' + delta.id]: delta.state.current });
});
webext.history.onVisited.addListener((item) => chrome.storage.local.set({ ['visit:' + item.url]: item.title }));
webext.action.onClicked.addListener((tab) => seen.push('clicked:' + (tab && tab.id)));
chrome.action.setBadgeBackgroundColor({ color: '#00f' });
chrome.runtime.onMessage.addListener((_message, _sender, reply) => {
  Promise.all([webext.commands.getAll(), chrome.storage.local.get()]).then(([commands, stored]) =>
    reply({ seen, commands, stored }),
  );
  return true;
});`;

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const source = path.join(profile, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Worker APIs test',
        version: '1.0',
        permissions: ['webNavigation', 'contextMenus', 'notifications', 'history', 'bookmarks', 'downloads', 'storage'],
        action: { default_popup: 'page.html' },
        background: { service_worker: 'worker.js' },
        commands: {
          'toggle-blocking': { description: 'Toggle blocking', suggested_key: { default: 'Alt+Shift+Y' } },
          _execute_action: { suggested_key: { default: 'Alt+Shift+U' } },
        },
      }),
    );
    fs.writeFileSync(path.join(source, 'worker.js'), WORKER);
    fs.writeFileSync(path.join(source, 'page.html'), '<title>Extension page</title>');
    fs.writeFileSync(
      path.join(source, 'icon.png'),
      nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG(),
    );

    const browsing = session.fromPartition('persist:extension-worker-apis');
    let tab;
    const actions = [];
    const popups = [];
    const bridge = new extensionBridge.ExtensionBridge(
      browsing,
      {
        open: () => null,
        close: () => false,
        isTab: (contents) => contents === tab.webContents,
        viewType: (contents) => (contents === tab.webContents ? 'TAB' : null),
        windowId: () => tab.id,
        isActive: () => true,
        windows: () => [{ id: tab.id, focused: true }],
        openAction: (id, contents) => actions.push(`${id}:${contents?.id}`),
        openActionPopup: (windowId, popupUrl) => {
          if (windowId !== null && windowId !== tab.id) return 'no-window';
          const url = popupUrl(tab.webContents);
          if (!url) return 'no-popup';
          popups.push([windowId, url]);
          return 'opened';
        },
      },
      path.resolve(import.meta.dirname, '../../dist/preload/extension-apis.js'),
    );
    const library = path.join(profile, 'library');
    const downloadDirectory = path.join(profile, 'downloads');
    fs.mkdirSync(library);
    fs.mkdirSync(downloadDirectory);
    const downloads = new downloadsModule.DownloadStore(library);
    const downloadManager = new downloadManagerModule.DownloadManager({
      store: downloads,
      daily: browsing,
      privateBrowsing: session.fromPartition('worker-apis-private'),
      developer: session.fromPartition('worker-apis-developer'),
      directory: () => downloadDirectory,
      askBeforeDownload: () => false,
      parentOf: () => undefined,
      onStateChange() {},
    });
    const history = new historyModule.HistoryStore(library);
    bridge.attachLibrary({
      history,
      bookmarks: new bookmarksModule.BookmarkStore(library),
      downloads,
      downloadManager,
      bookmarksChanged() {},
    });
    tab = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
    const page = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
    windows.push(tab, page);
    const extension = await browsing.extensions.loadExtension(source);
    await page.loadURL(`chrome-extension://${extension.id}/page.html`);
    const ask = () => page.webContents.executeJavaScript('chrome.runtime.sendMessage({})');

    const { commands } = await ask();
    assert.deepEqual(commands, [
      { name: '_execute_action', description: '', shortcut: 'Alt+Shift+U' },
      { name: 'toggle-blocking', description: 'Toggle blocking', shortcut: 'Alt+Shift+Y' },
    ]);
    assert.ok(
      Object.values(browsing.serviceWorkers.getAllRunning()).some(({ scope }) => scope.includes(extension.id)),
      'extension worker is not running',
    );

    assert.equal(
      await page.webContents.executeJavaScript(
        "(self.browser || chrome).tabs.getCurrent().then((tab) => tab === undefined ? 'none' : 'tab')",
      ),
      'none',
    );

    const url = `http://127.0.0.1:${server.address().port}/`;
    await tab.loadURL(url);
    await eventually(async () => (await ask()).seen.includes(`completed:${tab.webContents.id}`));
    assert.ok((await ask()).seen.includes(`committed:0:${url}`));

    await tab.webContents.executeJavaScript("location.hash = 'a'");
    await eventually(async () => (await ask()).seen.includes(`fragment:0:${url}#a`));
    await tab.webContents.executeJavaScript("history.pushState({}, '', '/pushed')");
    await eventually(async () => (await ask()).seen.includes(`history:0:${url}pushed`));
    const seenNow = (await ask()).seen;
    assert.ok(!seenNow.includes(`history:0:${url}#a`), 'a fragment change fired onHistoryStateUpdated');
    assert.ok(!seenNow.includes(`fragment:0:${url}pushed`), 'pushState fired onReferenceFragmentUpdated');

    tab.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Y', modifiers: ['alt', 'shift'] });
    await eventually(async () => (await ask()).seen.includes(`command:toggle-blocking:${tab.webContents.id}`));
    tab.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['alt', 'shift'] });
    await eventually(() => actions.includes(`${extension.id}:${tab.webContents.id}`));

    const uiKey = { type: 'keyDown', code: 'KeyY', alt: true, shift: true, control: false, meta: false };
    assert.equal(bridge.shortcut({ ...uiKey, isAutoRepeat: true }, null), false);
    assert.equal(bridge.shortcut(uiKey, null), true);
    const foreign = new BrowserWindow({ show: false, webPreferences: { partition: 'private-worker-apis' } });
    windows.push(foreign);
    assert.equal(bridge.shortcut(uiKey, foreign.webContents), false);
    await eventually(async () => (await ask()).seen.includes('command:toggle-blocking:undefined'));

    await tab.loadURL(`${url}frame`);
    await eventually(async () => (await ask()).seen.includes(`subframe:0:${url}child`));

    const params = {
      linkURL: '',
      srcURL: '',
      mediaType: 'none',
      selectionText: '',
      isEditable: false,
      pageURL: url,
      frameURL: '',
    };
    const [item] = bridge.menuItems(tab.webContents, params);
    assert.equal(item.label, 'Fill');
    item.click();
    await eventually(async () => (await ask()).seen.includes('menu:fill'));
    const port = server.address().port;
    const node = await page.webContents.executeJavaScript(
      `chrome.bookmarks.create({ title: 'Saved', url: 'http://127.0.0.1:${port}/saved' })`,
    );
    assert.equal(node.parentId, '1');
    const [root] = await page.webContents.executeJavaScript('chrome.bookmarks.getTree()');
    assert.ok(root.children[0].children.some((child) => child.id === node.id));
    await eventually(async () => (await ask()).seen.includes('bookmark:Saved'));

    history.visit(`http://127.0.0.1:${port}/visited`, 'Visited');
    const found = await page.webContents.executeJavaScript(`chrome.history.search({ text: 'visited' })`);
    assert.deepEqual(
      found.map((item) => item.title),
      ['Visited'],
    );
    assert.equal(
      await page.webContents.executeJavaScript(`chrome.permissions.contains({ permissions: ['downloads'] })`),
      true,
    );

    const downloadId = await page.webContents.executeJavaScript(
      `chrome.downloads.download({ url: 'http://127.0.0.1:${port}/file', filename: 'named.txt' })`,
    );
    assert.equal(typeof downloadId, 'number');
    await eventually(async () => (await ask()).seen.includes('download:complete'));
    assert.equal(fs.readFileSync(path.join(downloadDirectory, 'named.txt'), 'utf8'), 'downloaded');
    const [downloaded] = await page.webContents.executeJavaScript(`chrome.downloads.search({ id: ${downloadId} })`);
    assert.equal(downloaded.state, 'complete');
    assert.equal(downloaded.exists, true);
    const dataId = await page.webContents.executeJavaScript(
      `chrome.downloads.download({ url: 'data:text/plain,hi', filename: 'data.txt' })`,
    );
    assert.equal(typeof dataId, 'number');
    await eventually(() => fs.existsSync(path.join(downloadDirectory, 'data.txt')));
    const running = () =>
      Object.values(browsing.serviceWorkers.getAllRunning()).some(({ scope }) => scope.includes(extension.id));
    page.webContents.debugger.attach('1.3');
    await page.webContents.executeJavaScript(
      `window.completed = new Set(); chrome.downloads.onChanged.addListener((d) => d.state?.current === 'complete' && completed.add(d.id))`,
    );
    await page.webContents.debugger.sendCommand('ServiceWorker.enable');
    await page.webContents.debugger.sendCommand('ServiceWorker.stopAllWorkers');
    await eventually(() => !running());
    const sleepingId = await page.webContents.executeJavaScript(
      `chrome.downloads.download({ url: 'http://127.0.0.1:${port}/file', filename: 'asleep.txt' })`,
    );
    await eventually(() => page.webContents.executeJavaScript(`completed.has(${sleepingId})`));
    await eventually(async () => (await ask()).stored[`download:${sleepingId}`] === 'complete');
    await page.webContents.debugger.sendCommand('ServiceWorker.stopAllWorkers');
    await eventually(() => !running());
    const sleepingVisit = `http://127.0.0.1:${port}/asleep-visit`;
    history.visit(sleepingVisit, 'Asleep');
    await eventually(async () => (await ask()).stored[`visit:${sleepingVisit}`] === 'Asleep');
    page.webContents.debugger.detach();
    assert.equal(
      await page.webContents.executeJavaScript(
        `chrome.downloads.download({ url: 'file:///etc/hosts' }).then(() => 'ok', () => 'rejected')`,
      ),
      'rejected',
    );

    assert.equal(
      await page.webContents.executeJavaScript(`chrome.action.openPopup().then(() => 'opened', () => 'rejected')`),
      'opened',
    );
    const popupUrl = `chrome-extension://${extension.id}/page.html`;
    assert.deepEqual(popups.pop(), [null, popupUrl]);
    const openPopup = (arg) =>
      page.webContents.executeJavaScript(
        `chrome.action.openPopup(${arg}).then(() => 'opened', (error) => String(error.message).split('Error: ').pop())`,
      );
    assert.equal(await openPopup(`{ windowId: ${tab.id} }`), 'opened');
    assert.deepEqual(popups.pop(), [tab.id, popupUrl]);
    assert.equal(await openPopup('{ windowId: 987654 }'), 'No window with id: 987654.');
    assert.equal(popups.length, 0);
    const tabId = tab.webContents.id;
    await page.webContents.executeJavaScript(`chrome.action.setPopup({ popup: '', tabId: ${tabId} })`);
    assert.equal(await openPopup(''), 'Extension does not have a popup on the active tab.');
    assert.equal(popups.length, 0);
    await page.webContents.executeJavaScript(`chrome.action.setPopup({ popup: null, tabId: ${tabId} })`);
    assert.equal(await openPopup(''), 'opened');
    await page.webContents.executeJavaScript(`(async () => {
      await chrome.action.setPopup({ popup: '' });
      await chrome.action.setBadgeText({ text: '5' });
      await chrome.browserAction.setBadgeText({ text: '7', tabId: ${tabId} });
      await chrome.action.setTitle({ title: 'Tab title', tabId: ${tabId} });
      const pixels = new ImageData(16, 16);
      pixels.data.fill(200);
      await chrome.action.setIcon({ imageData: pixels, tabId: ${tabId} });
      await chrome.action.setIcon({ path: { 16: 'icon.png', 32: 'missing.png' } });
    })()`);
    assert.equal(
      await page.webContents.executeJavaScript(
        `chrome.action.setIcon({ path: '../outside.png' }).then(() => 'set', () => 'rejected')`,
      ),
      'rejected',
    );
    assert.deepEqual(
      await page.webContents.executeJavaScript('chrome.action.getBadgeBackgroundColor({})'),
      [0, 0, 255, 255],
    );
    assert.deepEqual(await page.webContents.executeJavaScript('chrome.action.getUserSettings()'), {
      isOnToolbar: true,
    });
    assert.equal(await page.webContents.executeJavaScript('chrome.action.getPopup({})'), '');
    await eventually(() => bridge.actionState(extension.id, null).listens);
    const tabState = bridge.actionState(extension.id, tab.webContents);
    assert.equal(tabState.badge, '7');
    assert.equal(tabState.title, 'Tab title');
    assert.equal(tabState.popupUrl, null);
    assert.equal(tabState.icon?.getSize().width, 16);
    assert.ok(bridge.actionState(extension.id, null).icon);
    bridge.actionClicked(extension.id, tab.webContents);
    await eventually(async () => (await ask()).seen.includes(`clicked:${tabId}`));
    bridge.actionClicked(extension.id, foreign.webContents);
    await page.webContents.executeJavaScript(`chrome.action.disable(${tabId})`);
    assert.equal(bridge.actionState(extension.id, tab.webContents).enabled, false);
    tab.destroy();
    await eventually(() => bridge.actionState(extension.id, { id: tabId }).badge === '5');
    assert.ok(!(await ask()).seen.includes('clicked:undefined'), 'a private tab click reached the extension');
    assert.equal(bridge.actionState(extension.id, { id: tabId }).enabled, true);

    console.log(
      'PASS: extension worker gets action, history, bookmarks, downloads, commands, _execute_action, webNavigation subframes, contextMenus and notifications shims',
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(() => {
  clearTimeout(deadline);
  server.close();
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
