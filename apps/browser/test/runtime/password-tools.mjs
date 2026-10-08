import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import passwords from '../../dist/main/privacy/passwords.js';
import handlers from '../../dist/main/privacy/password-handlers.js';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import settingsPage from '../../dist/main/app/settings-page.js';
import internal from '../../dist/main/pages/internal-pages.js';
import tools from '../../dist/main/privacy/password-tools.js';
import types from '../../dist/shared/types.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-password-ui-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const windows = [];
let window;
const deadline = setTimeout(() => app.exit(1), 30_000);
let authenticated = true,
  approved = true,
  authentications = 0;
const csv = path.join(root, 'chosen passwords.csv');
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function button(label) {
  await window.webContents.executeJavaScript(
    `Array.from(document.querySelector('#pane').querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`,
  );
}
async function form(values) {
  await window.webContents.executeJavaScript(
    `(() => { for (const [id, value] of Object.entries(${JSON.stringify(values)})) { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); } document.querySelector('#pane form').requestSubmit(); })()`,
  );
}
app
  .whenReady()
  .then(async () => {
    const store = new passwords.PasswordStore(root, handlers.safeStorageCipher);
    assert.equal(store.view().available, true);
    handlers.installPasswordHandlers({
      store,
      savesPasswords: () => false,
      parentOf: (contents) => windows.find((candidate) => candidate.webContents === contents),
      isSettingsFrame: settingsPage.isSettingsFrame,
      onChange: () => settingsPage.broadcastPasswords(store.view()),
      authenticate: async () => {
        authentications++;
        return authenticated;
      },
      transferDialogs: {
        showSaveDialog: async () => ({ canceled: false, filePath: csv }),
        showOpenDialog: async () => ({ canceled: false, filePaths: [csv] }),
        showMessageBox: async (_window, options) => {
          assert.ok(options.message.includes('passwords'));
          return { response: approved ? 1 : 0 };
        },
      },
    });
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
    const browsing = session.fromPartition('password-ui');
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
      width: 1000,
      height: 800,
      webPreferences: {
        session: browsing,
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    windows.push(window);
    await window.loadURL('yalqen://settings/passwords');
    await eventually(
      "Array.from(document.querySelector('#pane').querySelectorAll('button')).some(button => button.textContent.trim() === 'Add password')",
    );
    await button('Add password');
    await eventually("!!document.getElementById('credential-password')");
    await button('Generate strong password');
    await eventually("document.getElementById('credential-password').value.length === 20");
    const generated = await window.webContents.executeJavaScript(
      "document.getElementById('credential-password').value",
    );
    await form({ 'credential-url': 'https://fixture.example/login', 'credential-username': 'ada' });
    await eventually('(async () => (await window.yalqenSettings.passwords()).passwords.length === 1)()');
    assert.equal(store.logins('https://fixture.example')[0].password, generated);
    assert.equal(fs.readFileSync(store.file, 'utf8').includes(generated), false);
    await eventually("!document.getElementById('credential-password')");
    await button('Edit');
    await eventually("!!document.getElementById('credential-password')");
    assert.equal(
      await window.webContents.executeJavaScript("document.getElementById('credential-password').value"),
      '',
    );
    await form({ 'credential-username': 'grace' });
    await eventually("(async () => (await window.yalqenSettings.passwords()).passwords[0].username === 'grace')()");
    assert.equal(store.logins('https://fixture.example')[0].password, generated);
    fs.writeFileSync(csv, 'preserve until consent');
    approved = false;
    await button('Export CSV…');
    await eventually(
      "!Array.from(document.querySelector('#pane').querySelectorAll('button')).find(button => button.textContent.trim() === 'Export CSV…').disabled",
    );
    assert.equal(fs.readFileSync(csv, 'utf8'), 'preserve until consent');
    approved = true;
    authenticated = false;
    await button('Export CSV…');
    await eventually(
      "!Array.from(document.querySelector('#pane').querySelectorAll('button')).find(button => button.textContent.trim() === 'Export CSV…').disabled",
    );
    assert.equal(fs.readFileSync(csv, 'utf8'), 'preserve until consent');
    authenticated = true;
    await button('Export CSV…');
    await eventually("document.querySelector('#pane [role=status]')?.textContent.includes('Processed 1')");
    assert.equal(fs.statSync(csv).mode & 0o777, 0o600);
    const exported = tools.parsePasswordCsv(fs.readFileSync(csv, 'utf8')).records;
    assert.deepEqual(exported, [{ origin: 'https://fixture.example', username: 'grace', password: generated }]);
    fs.writeFileSync(
      csv,
      tools.serializePasswordCsv([
        ...exported,
        { origin: 'https://second.example', username: 'other', password: 'fixture imported secret' },
      ]),
    );
    await button('Import CSV…');
    await eventually('(async () => (await window.yalqenSettings.passwords()).passwords.length === 2)()');
    assert.equal(
      new passwords.PasswordStore(root, handlers.safeStorageCipher).logins('https://second.example')[0].password,
      'fixture imported secret',
    );
    const preload = path.join(root, 'untrusted.js');
    fs.writeFileSync(
      preload,
      "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('test',{invoke:(...args)=>ipcRenderer.invoke(...args)});",
    );
    const attacker = new BrowserWindow({
      show: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true },
    });
    windows.push(attacker);
    await attacker.loadURL('data:text/html,untrusted');
    const before = authentications;
    assert.equal(
      await attacker.webContents.executeJavaScript(`test.invoke(${JSON.stringify(types.PasswordsChannel.generate)})`),
      null,
    );
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `test.invoke(${JSON.stringify(types.PasswordsChannel.save)}, {id:null,url:'https://unauthorized.example',username:'x',password:'x'})`,
      ),
      false,
    );
    assert.equal(
      (
        await attacker.webContents.executeJavaScript(
          `test.invoke(${JSON.stringify(types.PasswordsChannel.transfer)}, 'export')`,
        )
      ).status,
      'cancelled',
    );
    assert.equal(authentications, before);
    assert.equal(store.view().passwords.length, 2);
    console.log(
      'PASS: production password UI generates/adds/edits encrypted records, CSV export/import requires owner and native consent, preserves cancellation and rejects untrusted IPC',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  for (const item of windows) if (!item.isDestroyed()) item.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(error);
  }
});
