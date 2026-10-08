import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, BrowserWindow, session } from 'electron';
import extensions from '../../dist/main/extensions/extensions.js';
import controllers from '../../dist/main/extensions/extension-access-controller.js';
import tabs from '../../dist/main/tabs/tabs.js';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-access-')));
app.setPath('userData', path.join(root, 'profile'));
const windows = [];
let manager, tabManager;
const deadline = setTimeout(() => app.exit(1), 30000);
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>Access test</title><input value="saved draft">');
});
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw Error('Access test timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
    const source = path.join(root, 'source');
    fs.mkdirSync(source);
    const manifest = {
      manifest_version: 3,
      name: 'Site access test',
      version: '1.0',
      permissions: ['scripting', 'tabs', 'storage', 'activeTab'],
      host_permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
    };
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(source, 'content.js'), 'document.documentElement.dataset.extensionMark="yes"');
    fs.writeFileSync(path.join(source, 'probe.html'), '<script src="probe.js"></script>');
    fs.writeFileSync(
      path.join(source, 'probe.js'),
      `globalThis.inject=async(id)=>new Promise(resolve=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{document.documentElement.dataset.injected='yes';return true}},result=>resolve({error:chrome.runtime.lastError?.message??null,result})));globalThis.fetchSite=async(url)=>{try{return {text:await(await fetch(url)).text()}}catch(e){return {error:e.message}}};globalThis.saveValue=()=>chrome.storage.local.set({retained:'keep identity'});globalThis.readValue=()=>chrome.storage.local.get('retained');`,
    );
    const browsing = session.fromPartition('persist:access');
    manager = new extensions.ExtensionManager(root, browsing, () => {});
    assert.equal(await manager.install(source), null);
    const identity = manager.list()[0].id;
    async function extensionPage() {
      const window = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
      windows.push(window);
      await window.loadURL(`chrome-extension://${identity}/probe.html`);
      return window.webContents;
    }
    await (await extensionPage()).executeJavaScript('saveValue()');
    const window = new BaseWindow({ show: false });
    windows.push(window);
    let allow = false,
      prompts = 0,
      approve = true;
    tabManager = new tabs.TabManager({
      window,
      session: browsing,
      privateSession: session.fromPartition('private-access'),
      closed: [],
      pagePreferences: () => ({}),
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
      confirmUnload: () => {
        prompts++;
        return allow;
      },
    });
    const pageIds = [];
    for (const host of ['localhost', '127.0.0.1']) {
      const id = tabManager.open(`http://${host}:${server.address().port}/`);
      pageIds.push(id);
      await eventually(
        () =>
          !tabManager.snapshotFor(id).loading &&
          tabManager.tabs
            .find((tab) => tab.id === id)
            .view.webContents.getURL()
            .startsWith('http'),
      );
    }
    const pages = () => pageIds.map((id) => tabManager.tabs.find((tab) => tab.id === id).view.webContents);
    const controller = new controllers.ExtensionAccessController({
      extensions: manager,
      pages,
      approveReload: (contents) => tabManager.approveExtensionReload(contents),
      dialogs: { showMessageBox: async () => ({ response: approve ? 0 : 1 }) },
    });
    const draft = pages()[1];
    await draft.executeJavaScript(
      'window.onbeforeunload=()=>"unsaved"; document.querySelector("input").value="keep this draft"',
    );
    assert.ok(await controller.setAccess(source, { mode: 'sites', sites: ['http://localhost'] }, window, () => true));
    assert.equal(manager.accessFor(source).mode, 'all');
    assert.equal(await draft.executeJavaScript('document.querySelector("input").value'), 'keep this draft');
    assert.equal(await draft.executeJavaScript('document.documentElement.dataset.extensionMark'), 'yes');
    allow = true;
    assert.equal(
      await controller.setAccess(source, { mode: 'sites', sites: ['http://localhost'] }, window, () => true),
      null,
    );
    assert.equal(prompts, 2, 'consent is collected once, and approved reload must not prompt a second time');
    assert.equal(manager.list()[0].id, identity);
    let extension = await extensionPage();
    assert.equal((await extension.executeJavaScript('readValue()')).retained, 'keep identity');
    for (const [index, host] of ['localhost', '127.0.0.1'].entries()) {
      const page = pages()[index],
        url = page.getURL();
      assert.equal(
        await page.executeJavaScript('document.documentElement.dataset.extensionMark??null'),
        index === 0 ? 'yes' : null,
      );
      const injection = await extension.executeJavaScript(`inject(${page.id})`);
      assert.equal(injection.error === null, index === 0, JSON.stringify(injection));
      const fetched = await extension.executeJavaScript(`fetchSite(${JSON.stringify(url)})`);
      assert.equal(typeof fetched.text === 'string', index === 0, `${host}: ${JSON.stringify(fetched)}`);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'))), manifest);
    assert.equal(await controller.setAccess(source, { mode: 'click', sites: [] }, window, () => true), null);
    assert.equal(await pages()[0].executeJavaScript('document.documentElement.dataset.extensionMark??null'), null);
    assert.equal(await controller.requestSite(source, pages()[0].getURL(), window, () => true), null);
    assert.deepEqual(manager.list()[0].sessionSites, ['http://localhost']);
    assert.equal(await pages()[0].executeJavaScript('document.documentElement.dataset.extensionMark'), 'yes');
    assert.equal(await pages()[1].executeJavaScript('document.documentElement.dataset.extensionMark??null'), null);
    manager.saveNow();
    manager.stopUpdates();
    browsing.extensions.removeExtension(identity);
    manager = new extensions.ExtensionManager(root, browsing, () => {});
    await manager.loadAll();
    assert.equal(manager.list()[0].id, identity);
    assert.deepEqual(manager.list()[0].sessionSites, []);
    await pages()[0].loadURL(pages()[0].getURL());
    assert.equal(
      await pages()[0].executeJavaScript('document.documentElement.dataset.extensionMark??null'),
      null,
      'session grants must never be restored from the runtime copy',
    );
    extension = await extensionPage();
    assert.equal((await extension.executeJavaScript('readValue()')).retained, 'keep identity');
    console.log(
      'PASS: native host permissions and content scripts enforced, DOM/network access blocked outside selected sites, stable identity/storage, atomic beforeunload cancellation, session grant/reset',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  manager?.stopUpdates();
  tabManager?.destroyAll();
  server.close();
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  manager?.stopUpdates();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
