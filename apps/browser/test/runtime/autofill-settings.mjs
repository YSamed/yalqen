import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import stores from '../../dist/main/privacy/autofill.js';
import handlers from '../../dist/main/privacy/autofill-handlers.js';
import passwords from '../../dist/main/privacy/password-handlers.js';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import settingsPage from '../../dist/main/app/settings-page.js';
import internal from '../../dist/main/pages/internal-pages.js';
import types from '../../dist/shared/types.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-autofill-ui-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const windows = [];
const rendererErrors = [];
let window;
let authenticated = true,
  auths = 0;
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) {
      console.error(await window.webContents.executeJavaScript("document.querySelector('#pane').innerText"));
      throw Error(`Timed out: ${predicate}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function button(label) {
  await window.webContents.executeJavaScript(
    `Array.from(document.querySelector('#pane').querySelectorAll('button')).find(item=>item.textContent.trim()===${JSON.stringify(label)}).click()`,
  );
}
async function form(values) {
  await window.webContents.executeJavaScript(
    `(() => {for(const [id,value] of Object.entries(${JSON.stringify(values)})){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}})()`,
  );
  await window.webContents.executeJavaScript("document.querySelector('#pane form').requestSubmit()");
}
app
  .whenReady()
  .then(async () => {
    const store = new stores.AutofillStore(root, passwords.safeStorageCipher);
    handlers.installAutofillHandlers({
      store,
      allowed: () => false,
      parentOf: (contents) => windows.find((w) => w.webContents === contents),
      changed: () => settingsPage.broadcastAutofill(store.view()),
      authenticate: async () => {
        auths++;
        return authenticated;
      },
    });
    const preferences = new settings.SettingsStore(root),
      view = () => ({
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
    const browsing = session.fromPartition('autofill-settings');
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
    window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 1100,
      webPreferences: {
        session: browsing,
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    windows.push(window);
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') rendererErrors.push(message);
    });
    await window.loadURL('yalqen://settings/autofill');
    await eventually(
      "Array.from(document.querySelector('#pane').querySelectorAll('button')).some(item=>item.textContent.trim()==='Add address')",
    );
    await button('Add address');
    await eventually("!!document.getElementById('autofill-givenName')");
    await form({
      'autofill-label': 'Home',
      'autofill-givenName': 'Ada',
      'autofill-familyName': 'Lovelace',
      'autofill-streetAddress': '12 Test Street',
      'autofill-city': 'Istanbul',
      'autofill-country': 'TR',
    });
    await eventually("document.querySelectorAll('#pane li strong').length===1");
    assert.equal(auths, 0);
    await button('Edit');
    await eventually("document.getElementById('autofill-streetAddress')?.value==='12 Test Street'");
    await form({ 'autofill-city': 'Ankara' });
    await eventually("document.querySelector('#pane li .hint')?.textContent.includes('Ankara')");
    await button('Add card');
    await eventually("!!document.getElementById('autofill-number')");
    authenticated = false;
    await form({
      'autofill-label': 'Test card',
      'autofill-name': 'Ada Lovelace',
      'autofill-number': '4242424242424242',
      'autofill-month': '04',
      'autofill-year': '2035',
    });
    await eventually("!!document.querySelector('#pane [role=alert]')");
    assert.equal(store.choices('card').length, 0);
    authenticated = true;
    await form({});
    await eventually("document.querySelectorAll('#pane li strong').length===2");
    const card = store.choices('card')[0];
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('#pane ul').textContent.includes('4242424242424242')",
      ),
      false,
    );
    assert.equal(fs.readFileSync(store.file, 'utf8').includes('4242424242424242'), false);
    assert.equal(new stores.AutofillStore(root, passwords.safeStorageCipher).read(card.id).number, '4242424242424242');
    authenticated = false;
    const before = auths;
    assert.equal(
      await window.webContents.executeJavaScript(`window.yalqenSettings.readAutofill(${JSON.stringify(card.id)})`),
      null,
    );
    assert.equal(auths, before + 1);
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
    const attempted = auths;
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `test.invoke(${JSON.stringify(types.AutofillChannel.read)},${JSON.stringify(card.id)})`,
      ),
      null,
    );
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `test.invoke(${JSON.stringify(types.AutofillChannel.remove)},${JSON.stringify(card.id)})`,
      ),
      null,
    );
    assert.equal(auths, attempted);
    assert.equal(store.choices('card').length, 1);
    assert.equal(
      await window.webContents.executeJavaScript(`window.yalqenSettings.removeAutofill(${JSON.stringify(card.id)})`),
      true,
    );
    assert.equal(new stores.AutofillStore(root, passwords.safeStorageCipher).choices('card').length, 0);
    assert.deepEqual(rendererErrors, []);
    console.log(
      'PASS: production settings add/edit encrypted addresses and cards, preserve authentication cancellation, hide full card numbers, persist removal and reject untrusted read/delete IPC',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
