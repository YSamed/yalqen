import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { app, BrowserWindow, session } from 'electron';
import storage from '../../dist/main/privacy/site-storage.js';
import handlers from '../../dist/main/privacy/site-storage-handlers.js';
import settings from '../../dist/main/app/settings.js';
import settingsIpc from '../../dist/main/app/settings-ipc.js';
import internal from '../../dist/main/pages/internal-pages.js';
import types from '../../dist/shared/site-storage.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-site-storage-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const windows = [];
const rendererErrors = [];
let stage = 'setup';
let settingsWindow,
  confirmResult = false,
  confirmations = 0,
  duringConfirm = async () => {};
const deadline = setTimeout(() => {
  console.error(`Timed out during ${stage}`);
  app.exit(1);
}, 35_000);
const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end('self.addEventListener("fetch",()=>{});');
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>Stored site</h1>');
  }
});
const privateServer = http.createServer(server.listeners('request')[0]);
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 6000) throw Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
function windowFor(browsing, preload) {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 1100,
    webPreferences: { session: browsing, preload, sandbox: true, contextIsolation: true },
  });
  windows.push(window);
  return window;
}
async function seed(window, url, value) {
  await window.loadURL(url);
  await window.webContents.executeJavaScript(`(async()=>{
    localStorage.setItem('keep',${JSON.stringify(value)});
    document.cookie='keep=${value};path=/';
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kept',1);r.onupgradeneeded=()=>r.result.createObjectStore('items');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite');tx.objectStore('items').put('x'.repeat(40000),'key');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
    await (await caches.open('kept')).put('/resource',new Response('x'.repeat(40000)));
    await navigator.serviceWorker.register('/sw.js');
  })()`);
}
async function stored(window, url) {
  await window.loadURL(url);
  return window.webContents.executeJavaScript(
    `(async()=>({local:localStorage.getItem('keep'), databases:(await indexedDB.databases()).map(d=>d.name), caches:await caches.keys(), workers:(await navigator.serviceWorker.getRegistrations()).length}))()`,
  );
}
async function embedded(window, url) {
  await window.webContents.executeJavaScript(`new Promise(resolve=>{
    const frame=document.createElement('iframe');frame.src=${JSON.stringify(url)};frame.onload=resolve;document.body.append(frame);
  })`);
  return window.webContents.mainFrame.frames.find((frame) => frame.url.startsWith(url));
}
async function button(domain) {
  await settingsWindow.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('section[aria-label="Site data"] li')).find(li=>li.querySelector('strong')?.textContent===${JSON.stringify(domain)}).querySelector('button').click()`,
  );
}
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => privateServer.listen(0, '127.0.0.1', resolve));
    const port = server.address().port,
      a = `http://127.0.0.1:${port}`,
      b = `http://localhost:${port}`;
    const browsing = session.fromPartition('persist:storage-test'),
      privateSession = session.fromPartition('private-storage-test'),
      otherProfile = session.fromPartition('persist:other-storage-profile');
    const index = new storage.StorageOrigins(root),
      manager = new storage.SiteStorageManager(browsing, index, () => []);
    handlers.observeStorageOrigins(browsing, index, (contents) =>
      windows.some((window) => window.webContents === contents),
    );
    const aWindow = windowFor(browsing),
      bWindow = windowFor(browsing),
      privateWindow = windowFor(privateSession),
      otherWindow = windowFor(otherProfile);
    stage = 'seeding';
    await seed(aWindow, a, 'normal-a');
    await seed(bWindow, b, 'normal-b');
    await seed(privateWindow, a, 'private-a');
    await seed(otherWindow, a, 'other-a');
    await seed(privateWindow, `http://localhost:${privateServer.address().port}`, 'private-only');
    const thirdParty = await embedded(aWindow, b);
    await thirdParty.executeJavaScript(
      `(async()=>{localStorage.setItem('partition','third-party-b');await (await caches.open('partition')).put('/partition',new Response('partitioned resource'))})()`,
    );
    assert.deepEqual(index.list().sort(), [a, b].sort());
    index.saveNow();
    assert.deepEqual(new storage.StorageOrigins(root).list().sort(), [a, b].sort());
    await aWindow.loadURL('about:blank');
    await bWindow.loadURL('about:blank');
    await browsing.clearStorageData({ storages: ['cookies'] });
    index.clear();
    stage = 'quota discovery';
    await eventually(() => storage.quotaOrigins(browsing.getStoragePath()).origins.includes(a));
    assert.ok((await manager.groups()).groups.some((group) => group.domain === '127.0.0.1'));
    handlers.installSiteStorageHandlers({
      manager,
      parentOf: (contents) => windows.find((window) => window.webContents === contents),
      confirm: async (_parent, domain) => {
        confirmations++;
        assert.ok(domain === null || ['127.0.0.1', 'localhost'].includes(domain));
        await duringConfirm();
        return confirmResult;
      },
    });
    const preferences = new settings.SettingsStore(root);
    settingsIpc.registerSettingsIpc({
      view: () => ({
        values: preferences.get(),
        version: 'test',
        downloadDirectory: root,
        defaultBrowser: true,
        engines: [{ id: 'google', label: 'Google' }],
        customTemplateValid: true,
        update: { state: 'unavailable' },
      }),
      profiles: { view: () => ({ currentId: 'default', profiles: [] }) },
      update: (patch) => preferences.update(patch),
      updateThreatLists: async () => {},
      clearData: async () => {},
      updater: {},
      relaunch() {},
      permissions: { origins: () => [], list: () => [] },
      requestRules: {},
      onRequestRulesSaved() {},
    });
    internal.serveInternalPages(
      browsing,
      {
        settings: {
          template: fs.readFileSync(path.resolve('dist/renderer/settings.html'), 'utf8'),
          asset: (name) => fs.readFileSync(path.resolve('dist/renderer/assets', name)),
        },
      },
      {},
    );
    settingsWindow = windowFor(browsing, path.resolve('dist/preload/page-preload.js'));
    settingsWindow.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') rendererErrors.push(message);
    });
    stage = 'settings load';
    await settingsWindow.loadURL('yalqen://settings/privacy');
    await eventually(() =>
      settingsWindow.webContents.executeJavaScript(
        "document.querySelectorAll('section[aria-label=\"Site data\"] li strong').length===2 && document.querySelector('section[aria-label=\"Site data\"]').getAttribute('aria-busy')==='false'",
      ),
    );
    const view = await settingsWindow.webContents.executeJavaScript("window.yalqenSettings.siteStorage('',0)");
    assert.equal(view.total, 2);
    assert.ok(view.sites.every((site) => site.databaseBytes > 0));
    for (let id = 0; id < 25; id++) index.remember(`https://example${id}.test/`);
    const firstPage = await settingsWindow.webContents.executeJavaScript("window.yalqenSettings.siteStorage('',0)");
    const secondPage = await settingsWindow.webContents.executeJavaScript("window.yalqenSettings.siteStorage('',20)");
    assert.equal(firstPage.total, 27);
    assert.equal(firstPage.sites.length, 20);
    assert.equal(firstPage.more, true);
    assert.equal(secondPage.sites.length, 7);
    assert.equal(secondPage.more, false);
    assert.equal(new Set([...firstPage.sites, ...secondPage.sites].map((site) => site.domain)).size, 27);
    assert.equal(
      await settingsWindow.webContents.executeJavaScript(
        "window.yalqenSettings.siteStorage('localhost',0).then(view=>view.sites.length)",
      ),
      1,
    );
    stage = 'cancel clear';
    await button('127.0.0.1');
    await eventually(() => confirmations === 1);
    await eventually(() =>
      settingsWindow.webContents.executeJavaScript(
        "document.querySelector('section[aria-label=\"Site data\"]').getAttribute('aria-busy')==='false'",
      ),
    );
    assert.ok((await stored(aWindow, a)).databases.includes('kept'));
    await aWindow.loadURL('about:blank');
    confirmResult = true;
    stage = 'scoped clear';
    await button('127.0.0.1');
    await eventually(() => confirmations === 2);
    await eventually(() =>
      settingsWindow.webContents.executeJavaScript(
        "document.querySelector('section[aria-label=\"Site data\"]').getAttribute('aria-busy')==='false'",
      ),
    );
    assert.deepEqual(await stored(aWindow, a), { local: null, databases: [], caches: [], workers: 0 });
    const keptEmbedded = await embedded(aWindow, b);
    assert.equal(await keptEmbedded.executeJavaScript("localStorage.getItem('partition')"), 'third-party-b');
    assert.ok((await keptEmbedded.executeJavaScript('caches.keys()')).includes('partition'));
    assert.equal((await stored(bWindow, b)).local, 'normal-b');
    assert.equal((await stored(privateWindow, a)).local, 'private-a');
    assert.equal((await stored(otherWindow, a)).local, 'other-a');
    stage = 'navigation cancellation';
    duringConfirm = async () => {
      await settingsWindow.loadURL('data:text/html,Navigated away');
    };
    void settingsWindow.webContents
      .executeJavaScript("window.yalqenSettings.clearSiteStorage('localhost')")
      .catch(() => null);
    await eventually(() => settingsWindow.webContents.getURL().startsWith('data:'));
    assert.equal((await stored(bWindow, b)).local, 'normal-b');
    duringConfirm = async () => {};
    stage = 'untrusted IPC';
    const attackerPreload = path.join(root, 'attacker.cjs');
    fs.writeFileSync(
      attackerPreload,
      "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('test',{invoke:(...args)=>ipcRenderer.invoke(...args)})",
    );
    const attacker = windowFor(browsing, attackerPreload);
    await attacker.loadURL('data:text/html,Untrusted');
    const before = confirmations;
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `test.invoke(${JSON.stringify(types.SiteStorageChannel.clear)},null)`,
      ),
      null,
    );
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `test.invoke(${JSON.stringify(types.SiteStorageChannel.list)},'',0)`,
      ),
      null,
    );
    assert.equal(confirmations, before);
    await settingsWindow.loadURL('yalqen://settings/privacy');
    await eventually(() => settingsWindow.webContents.executeJavaScript('!!window.yalqenSettings'));
    await aWindow.loadURL('about:blank');
    await bWindow.loadURL('about:blank');
    stage = 'all data clear';
    assert.equal(
      await settingsWindow.webContents.executeJavaScript('window.yalqenSettings.clearSiteStorage(null)'),
      true,
    );
    assert.deepEqual(await stored(bWindow, b), { local: null, databases: [], caches: [], workers: 0 });
    await aWindow.loadURL(a);
    const clearedEmbedded = await embedded(aWindow, b);
    assert.equal(await clearedEmbedded.executeJavaScript("localStorage.getItem('partition')"), null);
    assert.deepEqual(await clearedEmbedded.executeJavaScript('caches.keys()'), []);
    assert.equal((await stored(privateWindow, a)).local, 'private-a');
    assert.equal((await stored(otherWindow, a)).local, 'other-a');
    assert.deepEqual(rendererErrors, []);
    console.log(
      'PASS: production site-data settings discover dormant Chromium storage, measure real usage, preserve cancel/navigation, clear scoped/all data and isolate private/other profiles and untrusted IPC',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  server.close();
  privateServer.close();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
