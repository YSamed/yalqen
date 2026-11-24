import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import extensionBridge from '../../dist/main/extensions/extension-bridge.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-worker-apis-')));
app.setPath('userData', path.join(profile, 'profile'));
const windows = [];
const deadline = setTimeout(() => app.exit(1), 30000);
const server = http.createServer((req, res) => {
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
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId > 0) seen.push('subframe:' + details.parentFrameId + ':' + details.url);
});
chrome.runtime.onMessage.addListener((_message, _sender, reply) => {
  webext.commands.getAll().then((commands) => reply({ seen, commands }));
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
        permissions: ['webNavigation', 'contextMenus', 'notifications'],
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

    const browsing = session.fromPartition('persist:extension-worker-apis');
    let tab;
    const actions = [];
    const bridge = new extensionBridge.ExtensionBridge(
      browsing,
      {
        open: () => null,
        close: () => false,
        isTab: (contents) => contents === tab.webContents,
        windowId: () => tab.id,
        isActive: () => true,
        windows: () => [{ id: tab.id, focused: true }],
        openAction: (id, contents) => actions.push(`${id}:${contents?.id}`),
      },
      path.resolve(import.meta.dirname, '../../dist/preload/extension-apis.js'),
    );
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
    console.log(
      'PASS: extension worker gets commands, _execute_action, webNavigation subframes, contextMenus and notifications shims',
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
