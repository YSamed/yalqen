import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, BrowserWindow, session } from 'electron';
import extensionBridge from '../../dist/main/extensions/extension-bridge.js';
import tabs from '../../dist/main/tabs/tabs.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-tabs-')));
app.setPath('userData', path.join(root, 'profile'));
const windows = [];
let tabManager;
const deadline = setTimeout(() => app.exit(1), 30000);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/auth') {
    res.writeHead(302, { Location: `${url.searchParams.get('redirect')}/cb?code=abc` });
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>Sign in</title>');
});
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw Error('Extension tabs test timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const WORKER = `chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === 'currentWindow') {
    chrome.windows.getCurrent().then((window) => reply(window.id), (error) => reply({ error: error.message }));
    return true;
  }
  if (message.type !== 'auth') return;
  const redirect = chrome.identity.getRedirectURL().replace(/\\/$/, '');
  chrome.tabs.create({ url: message.url + '?redirect=' + encodeURIComponent(redirect) }).then((tab) => {
    const updated = (id, change) => {
      if (id !== tab.id || !change.url || !change.url.startsWith(redirect)) return;
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.remove(tab.id).then(() => reply({ url: change.url, redirect, tabId: tab.id }));
    };
    chrome.tabs.onUpdated.addListener(updated);
  }, (error) => reply({ error: error.message }));
  return true;
});`;

const PAGE = `globalThis.removed = [];
chrome.tabs.onRemoved.addListener((id) => removed.push(id));
globalThis.auth = (url) => chrome.runtime.sendMessage({ type: 'auth', url });
globalThis.openFile = () => chrome.tabs.create({ url: 'file:///etc/hosts' }).then(() => 'opened', () => 'rejected');
globalThis.changes = [];
chrome.cookies.onChanged.addListener((change) => changes.push(change.cookie.name + ':' + change.cause));
globalThis.cookieRoundTrip = async (url) => {
  const set = await chrome.cookies.set({ url, name: 'grauth', value: 'token' });
  const got = await chrome.cookies.get({ url, name: 'grauth' });
  const denied = await chrome.cookies.get({ url: 'http://localhost/', name: 'grauth' }).then(() => 'allowed', () => 'denied');
  await chrome.cookies.remove({ url, name: 'grauth' });
  const gone = await chrome.cookies.get({ url, name: 'grauth' });
  return { set: set && set.value, got: got && got.value, denied, gone };
};
globalThis.openOwnPage = () => new Promise((resolve) => chrome.tabs.create({ url: 'page.html', active: false }, resolve));
globalThis.permissionChecks = async () => ({
  cookies: await chrome.permissions.contains({ permissions: ['cookies'], origins: ['http://127.0.0.1/*'] }),
  identity: await chrome.permissions.contains({ permissions: ['identity'] }),
  listed: (await chrome.permissions.getAll()).permissions.includes('cookies'),
});
globalThis.windowEvents = [];
chrome.windows.onFocusChanged.addListener((id) => windowEvents.push('focus:' + id));
chrome.windows.onRemoved.addListener((id) => windowEvents.push('removed:' + id));
globalThis.windowChecks = async () => ({
  current: (await chrome.windows.getCurrent()).id,
  callback: await new Promise((resolve) => chrome.windows.getLastFocused({}, (window) => resolve(window.id))),
  all: (await chrome.windows.getAll()).map((window) => window.id),
  byId: (await chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT)).id,
  type: (await chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT)).type,
  worker: await chrome.runtime.sendMessage({ type: 'currentWindow' }),
  missing: await chrome.windows.get(-99).then(() => 'found', () => 'rejected'),
});`;

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const source = path.join(root, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Tabs bridge test',
        version: '1.0',
        permissions: ['tabs', 'identity', 'cookies'],
        host_permissions: ['http://127.0.0.1/*'],
        background: { service_worker: 'worker.js' },
      }),
    );
    fs.writeFileSync(path.join(source, 'worker.js'), WORKER);
    fs.writeFileSync(path.join(source, 'page.html'), '<script src="page.js"></script>');
    fs.writeFileSync(path.join(source, 'page.js'), PAGE);

    const browsing = session.fromPartition('persist:extension-tabs');
    const window = new BaseWindow({ show: false });
    windows.push(window);
    const page = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
    windows.push(page);
    tabManager = new tabs.TabManager({
      window,
      session: browsing,
      privateSession: session.fromPartition('private-extension-tabs'),
      closed: [],
      isBookmarked: () => false,
      hasCertificateException: () => false,
      agentScope: () => false,
      upgradeHttp: () => null,
      onChange() {},
      onHtmlFullScreenChange() {},
      onPrivateEnded() {},
      freezeBackground: () => false,
      onVisit: () => null,
      onVisitTitle() {},
      onVisitFavicon() {},
      zoomFor: () => 1,
      translation: () => ({ enabled: false, language: 'en' }),
      confirmUnload: () => true,
    });
    const bridge = new extensionBridge.ExtensionBridge(
      browsing,
      {
        open: (url, active) => tabManager.openContents(url, active),
        close: (contents) => tabManager.closeContents(contents),
        isTab: (contents) => tabManager.hasContents(contents),
        windowId: (contents) => (contents === page.webContents ? page.id : window.id),
        isActive: (contents) => tabManager.isActiveContents(contents),
        windows: () => [
          { id: window.id, focused: true },
          { id: page.id, focused: false },
        ],
      },
      path.resolve(import.meta.dirname, '../../dist/preload/extension-apis.js'),
    );
    const extension = await browsing.extensions.loadExtension(source);
    await page.loadURL(`chrome-extension://${extension.id}/page.html`);
    const opener = tabManager.open(`http://127.0.0.1:${server.address().port}/`);
    // A tab to the right of the opener: closing the sign-in tab used to activate this one instead.
    tabManager.open(`http://127.0.0.1:${server.address().port}/other`, { activate: false });
    const startingTabs = tabManager.tabs.length;

    const result = await page.webContents.executeJavaScript(`auth('http://127.0.0.1:${server.address().port}/auth')`);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.redirect, `https://${extension.id}.chromiumapp.org`);
    assert.equal(result.url, `https://${extension.id}.chromiumapp.org/cb?code=abc`);
    await eventually(() => tabManager.tabs.length === startingTabs);
    await eventually(() => page.webContents.executeJavaScript(`removed.includes(${result.tabId})`));
    assert.equal(tabManager.activeId, opener);

    // Electron's chrome.permissions rejects permissions it does not implement; Grammarly checks for
    // "cookies" before reading its sign-in cookie.
    assert.deepEqual(await page.webContents.executeJavaScript('permissionChecks()'), {
      cookies: true,
      identity: true,
      listed: true,
    });

    // Grammarly's background page throws at startup without chrome.windows and never loads the account.
    assert.deepEqual(await page.webContents.executeJavaScript('windowChecks()'), {
      current: page.id,
      callback: window.id,
      all: [window.id, page.id],
      byId: page.id,
      type: 'normal',
      worker: window.id,
      missing: 'rejected',
    });
    bridge.windowFocusChanged(window.id);
    bridge.windowFocusChanged(-1);
    bridge.windowRemoved(window.id);
    await eventually(
      async () =>
        (await page.webContents.executeJavaScript('windowEvents.join()')) ===
        `focus:${window.id},focus:-1,removed:${window.id}`,
    );

    const cookieUrl = `http://127.0.0.1:${server.address().port}/`;
    assert.deepEqual(await page.webContents.executeJavaScript(`cookieRoundTrip(${JSON.stringify(cookieUrl)})`), {
      set: 'token',
      got: 'token',
      denied: 'denied',
      gone: null,
    });
    await browsing.cookies.set({ url: 'http://localhost/', name: 'other', value: 'hidden' });
    await eventually(() => page.webContents.executeJavaScript(`changes.includes('grauth:explicit')`));
    assert.equal(await page.webContents.executeJavaScript(`changes.some((c) => c.startsWith('other:'))`), false);

    assert.equal(await page.webContents.executeJavaScript('openFile()'), 'rejected');
    assert.equal(tabManager.tabs.length, startingTabs);

    const own = await page.webContents.executeJavaScript('openOwnPage()');
    assert.equal(typeof own.id, 'number');
    await eventually(() =>
      tabManager.tabs.some((tab) => tab.view?.webContents.getURL() === `chrome-extension://${extension.id}/page.html`),
    );
    console.log(
      'PASS: extension tabs.create/remove/onUpdated/onRemoved, host-scoped cookies, permissions, windows and identity redirect bridge',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  tabManager?.destroyAll();
  server.close();
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
