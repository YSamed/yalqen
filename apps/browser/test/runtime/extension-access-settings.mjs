import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import extensions from '../../dist/main/extensions/extensions.js';
import controllers from '../../dist/main/extensions/extension-access-controller.js';
import extensionIpc from '../../dist/main/extensions/extensions-ipc.js';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import settingsPage from '../../dist/main/app/settings-page.js';
import internal from '../../dist/main/pages/internal-pages.js';
import types from '../../dist/shared/types.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-access-ui-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const windows = [];
let window, manager;
let approved = false,
  prompts = 0;
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw Error(`Timed out: ${predicate}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
app
  .whenReady()
  .then(async () => {
    const preferences = new settings.SettingsStore(root);
    const view = () => ({
      values: preferences.get(),
      version: 'test',
      downloadDirectory: root,
      defaultBrowser: true,
      engines: [{ id: 'google', label: 'Google' }],
      customTemplateValid: true,
      update: { state: 'unavailable' },
    });
    ipc.registerSettingsIpc({
      view,
      profiles: { view: () => ({ currentId: 'default', profiles: [] }) },
      update: (patch) => preferences.update(patch),
      updateThreatLists: async () => {},
      clearData: async () => {},
      updater: {},
      relaunch() {},
      permissions: {},
      requestRules: {},
      onRequestRulesSaved() {},
    });
    const browsing = session.fromPartition('persist:extension-settings');
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
    const source = path.join(fs.realpathSync(root), 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'Access UI test', version: '1.0', host_permissions: ['<all_urls>'] }),
    );
    manager = new extensions.ExtensionManager(root, browsing, () => settingsPage.broadcastExtensions(manager.list()));
    assert.equal(await manager.install(source), null);
    const access = new controllers.ExtensionAccessController({
      extensions: manager,
      pages: () => [],
      approveReload: async () => null,
      dialogs: {
        showMessageBox: async () => {
          prompts++;
          return { response: approved ? 0 : 1 };
        },
      },
    });
    extensionIpc.registerExtensionsIpc({
      extensions: manager,
      access,
      parentWindow: (contents) => windows.find((w) => w.webContents === contents),
      openTab() {},
    });
    window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 850,
      webPreferences: {
        session: browsing,
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    windows.push(window);
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(message);
    });
    await window.loadURL('yalqen://settings/extensions');
    await eventually("!!document.querySelector('.access form,form.access')");
    await window.webContents.executeJavaScript(
      `Array.from(document.querySelector('form.access').querySelectorAll('[role=option]')).find(item=>item.textContent.trim()==='Selected sites').click()`,
    );
    await eventually("!!document.querySelector('form.access textarea')");
    const save = async (value) =>
      window.webContents.executeJavaScript(
        `(() => {const input=document.querySelector('form.access textarea');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form.access').requestSubmit()})()`,
      );
    await save('javascript:alert(1)');
    await eventually("document.querySelector('form.access [role=alert]')?.textContent.includes('HTTP/HTTPS')");
    assert.equal(prompts, 0);
    await save('https://example.com:8443/path');
    await eventually("document.querySelector('form.access [role=alert]')?.textContent.includes('not changed')");
    assert.equal(manager.accessFor(source).mode, 'all');
    approved = true;
    await save('https://example.com:8443/path');
    await eventually("document.querySelector('form.access textarea').value === 'https://example.com'");
    assert.deepEqual(manager.accessFor(source), { mode: 'sites', sites: ['https://example.com'] });
    await window.webContents.executeJavaScript(
      `Array.from(document.querySelector('form.access').querySelectorAll('[role=option]')).find(item=>item.textContent.trim()==='When allowed from the extension menu').click(); document.querySelector('form.access').requestSubmit()`,
    );
    await eventually("document.querySelector('form.access [role=status]')?.textContent.includes('saved')");
    assert.equal(manager.accessFor(source).mode, 'click');
    const preload = path.join(root, 'attacker.cjs');
    fs.writeFileSync(
      preload,
      "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('test',{invoke:(...args)=>ipcRenderer.invoke(...args)});",
    );
    const attacker = new BrowserWindow({
      show: false,
      webPreferences: { session: browsing, preload, sandbox: true, contextIsolation: true },
    });
    windows.push(attacker);
    await attacker.loadURL('data:text/html,Untrusted page');
    const before = prompts;
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `test.invoke(${JSON.stringify(types.ExtensionsChannel.setAccess)},${JSON.stringify(source)},{mode:'all',sites:[]})`,
      ),
      null,
    );
    assert.equal(prompts, before);
    assert.equal(manager.accessFor(source).mode, 'click');
    console.log(
      'PASS: production extension access settings validate site lists, preserve native cancellation, save normalized engine scope and click mode, reject untrusted IPC',
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
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  manager?.stopUpdates();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
