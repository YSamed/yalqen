import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import profiles from '../../dist/main/app/profiles.js';
import controllers from '../../dist/main/app/profile-controller.js';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import settingsPage from '../../dist/main/app/settings-page.js';
import internalPages from '../../dist/main/pages/internal-pages.js';
import types from '../../dist/shared/types.js';

process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-profile-settings-'));
app.setPath('userData', root);
internalPages.registerInternalScheme();
const registry = new profiles.ProfileRegistry(root, 'Personal');
let controller;
let window;
let attacker;
let approve = false;
const launches = [];
const deadline = setTimeout(() => app.exit(1), 30_000);
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function button(label, row = '') {
  await window.webContents.executeJavaScript(`(() => {
    const section = document.getElementById('persistent-profiles-title').closest('section');
    const parent = ${row ? `Array.from(section.querySelectorAll('li')).find(li => li.querySelector('strong').textContent === ${JSON.stringify(row)})` : 'section'};
    Array.from(parent.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click();
  })()`);
}
app
  .whenReady()
  .then(async () => {
    const store = new settings.SettingsStore(root);
    const view = () => ({
      values: store.get(),
      version: 'test',
      downloadDirectory: root,
      defaultBrowser: true,
      engines: [{ id: 'google', label: 'Google' }],
      customTemplateValid: true,
      update: { state: 'unavailable' },
    });
    controller = new controllers.ProfileController(
      registry,
      'default',
      'Personal',
      () => settingsPage.broadcastSettings(view()),
      async (id) => {
        launches.push(id);
      },
      { showMessageBox: async () => ({ response: approve ? 1 : 0 }) },
    );
    controller.start();
    ipc.registerSettingsIpc({
      view,
      profiles: controller,
      update: (patch) => store.update(patch),
      updateThreatLists: async () => {},
      clearData: async () => {},
      updater: { check() {}, install() {} },
      relaunch() {},
      permissions: {},
      requestRules: {},
      onRequestRulesSaved() {},
    });
    const browsing = session.fromPartition('profile-settings');
    internalPages.serveInternalPages(
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
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(message);
    });
    await window.loadURL('yalqen://settings/');
    await eventually("document.querySelectorAll('section li').length === 1");
    await window.webContents.executeJavaScript(`(() => {
    const form = document.getElementById('persistent-profiles-title').closest('section').querySelector('form');
    const input = form.querySelector('input'); input.value = 'Work'; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit();
  })()`);
    await eventually("document.querySelectorAll('section li').length === 2");
    const work = registry.view('default').profiles.find(({ name }) => name === 'Work');
    assert.ok(work);
    await button('Rename', 'Work');
    await eventually("document.querySelectorAll('section form').length === 2");
    await window.webContents.executeJavaScript(`(() => {
    const form = document.querySelector('section li form'); const input = form.querySelector('input');
    input.value = 'Business'; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit();
  })()`);
    await eventually(
      "Array.from(document.querySelectorAll('section strong')).some(node => node.textContent === 'Business')",
    );
    await button('Make default', 'Business');
    await eventually(
      "document.querySelector('section').textContent.includes('Default on startup') && Array.from(document.querySelectorAll('section li')).find(li => li.querySelector('strong').textContent === 'Business').textContent.includes('Default on startup')",
    );
    assert.equal(registry.activate([], () => false).profile.id, work.id);
    await button('Open', 'Business');
    await eventually("!document.querySelector('section input').disabled");
    assert.deepEqual(launches, [work.id]);
    fs.writeFileSync(path.join(registry.directory(work.id), 'sentinel'), 'keep until approved');
    await button('Delete profile', 'Business');
    await eventually(
      "document.querySelectorAll('section li').length === 2 && Array.from(document.querySelectorAll('section button')).some(button => button.textContent.trim() === 'Delete profile' && !button.disabled)",
    );
    assert.equal(fs.existsSync(path.join(registry.directory(work.id), 'sentinel')), true);
    approve = true;
    await button('Delete profile', 'Business');
    await eventually("document.querySelectorAll('section li').length === 1");
    assert.equal(fs.existsSync(path.join(root, 'profiles', work.id)), false);

    const preload = path.join(root, 'attacker-preload.js');
    fs.writeFileSync(
      preload,
      `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('test', { invoke: (...args) => ipcRenderer.invoke(...args) });`,
    );
    attacker = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } });
    await attacker.loadURL('data:text/html,<p>Untrusted page</p>');
    assert.equal(
      await attacker.webContents.executeJavaScript(
        `window.test.invoke(${JSON.stringify(types.SettingsChannel.profileAction)}, 'create', '', 'Unauthorized')`,
      ),
      null,
    );
    assert.equal(registry.view('default').profiles.length, 1);
    console.log(
      'PASS: production settings UI creates, renames, selects default, opens and confirms/cancels deletion through guarded profile IPC; untrusted pages cannot manage profiles',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  window?.destroy();
  attacker?.destroy();
  controller?.stop();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(error);
  }
});
