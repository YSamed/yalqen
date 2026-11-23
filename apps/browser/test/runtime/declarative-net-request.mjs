import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import extensionBridge from '../../dist/main/extensions/extension-bridge.js';
import registry from '../../dist/main/extensions/dnr-registry.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-declarative-net-request-')));
app.setPath('userData', path.join(profile, 'profile'));
const windows = [];
const deadline = setTimeout(() => app.exit(1), 30000);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
  res.end(req.url === '/' ? '<title>Page</title>' : `window.loaded = ${JSON.stringify(req.url)};`);
});
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 8000) throw Error('declarativeNetRequest test timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Like uBlock Origin Lite: static rulesets from the manifest plus dynamic rules added by the worker.
const WORKER = `chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  chrome.declarativeNetRequest
    .updateDynamicRules({ addRules: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: message.block } }] })
    .then(() => reply('added'), (error) => reply('error: ' + error.message));
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
        name: 'Declarative blocker test',
        version: '1.0',
        permissions: ['declarativeNetRequest'],
        host_permissions: ['<all_urls>'],
        background: { service_worker: 'worker.js' },
        declarative_net_request: { rule_resources: [{ id: 'base', enabled: true, path: 'rules.json' }] },
      }),
    );
    fs.writeFileSync(
      path.join(source, 'rules.json'),
      JSON.stringify([{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/ads/' } }]),
    );
    fs.writeFileSync(path.join(source, 'worker.js'), WORKER);
    fs.writeFileSync(path.join(source, 'page.html'), '<title>Extension page</title>');

    const browsing = session.fromPartition('persist:declarative-net-request');
    const rules = new registry.DeclarativeNetRequest(path.join(profile, 'rules-state.json'));
    let tab;
    new extensionBridge.ExtensionBridge(
      browsing,
      {
        open: () => null,
        close: () => false,
        isTab: (contents) => contents === tab.webContents,
        windowId: () => tab.id,
        isActive: () => true,
        windows: () => [{ id: tab.id, focused: true }],
        declarativeNetRequest: (extensionId, state) => rules.update(extensionId, state),
      },
      path.resolve(import.meta.dirname, '../../dist/preload/extension-apis.js'),
    );
    // Yalqen keeps webRequest listeners on every session, which turns off Chromium's own rule matching.
    browsing.webRequest.onBeforeRequest((details, callback) => callback(rules.decide(details) ?? {}));
    browsing.webRequest.onBeforeSendHeaders((details, callback) =>
      callback({ requestHeaders: details.requestHeaders }),
    );

    tab = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
    const page = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
    windows.push(tab, page);
    const extension = await browsing.extensions.loadExtension(source);
    rules.load(extension);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await tab.loadURL(`${origin}/`);
    const load = (file) =>
      tab.webContents.executeJavaScript(
        `new Promise((resolve) => { const s = document.createElement('script'); s.src = ${JSON.stringify(file)} + '?' + Math.random(); s.onload = () => resolve('loaded'); s.onerror = () => resolve('blocked'); document.head.append(s); })`,
      );

    await eventually(async () => (await load('/ads/banner.js')) === 'blocked');
    assert.equal(await load('/app.js'), 'loaded');
    assert.equal(await load('/later/track.js'), 'loaded');

    await page.loadURL(`chrome-extension://${extension.id}/page.html`);
    assert.equal(await page.webContents.executeJavaScript("chrome.runtime.sendMessage({ block: '/later/' })"), 'added');
    await eventually(async () => (await load('/later/track.js')) === 'blocked');
    assert.equal(await load('/app.js'), 'loaded');
    console.log('PASS: extension declarativeNetRequest static and dynamic rules block through the webRequest gate');
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
