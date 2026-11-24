import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import internal from '../../dist/main/pages/internal-pages.js';
import types from '../../dist/shared/types.js';
import siteStorage from '../../dist/shared/site-storage.js';
import settingsPage from '../../dist/main/app/settings-page.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-appearance-ui-'));
app.setPath('userData', profile);
internal.registerInternalScheme();
const rendererErrors = [];
const clears = [];
let window;
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
const run = (script) => window.webContents.executeJavaScript(script);
const choice = (label) =>
  `Array.from(document.querySelectorAll('#pane [role=radio]')).find(item=>item.textContent.trim()===${JSON.stringify(label)})`;
app
  .whenReady()
  .then(async () => {
    const preferences = new settings.SettingsStore(profile);
    settingsPage.handleSettingsCall(siteStorage.SiteStorageChannel.list, () => ({
      sites: [],
      total: 0,
      offset: 0,
      more: false,
      limited: false,
    }));
    settingsPage.handleSettingsCall(types.PasswordsChannel.list, () => ({
      available: false,
      passwords: [],
      neverSave: [],
    }));
    settingsPage.handleSettingsCall(types.AutofillChannel.list, () => ({ available: false, records: [] }));
    settingsPage.handleSettingsCall(types.AgentBridgeChannel.status, () => ({
      enabled: false,
      port: null,
      error: null,
      lastCallAt: null,
      calls: 0,
      client: null,
      staleTokenAt: null,
      url: null,
      claudeCommand: null,
      codexConfig: null,
      otelConfig: null,
      observedTabs: 0,
      connectionsRevision: 0,
    }));
    ipc.registerSettingsIpc({
      view: () => ({
        values: preferences.get(),
        version: 'test',
        downloadDirectory: profile,
        defaultBrowser: true,
        engines: [{ id: 'google', label: 'Google' }],
        customTemplateValid: true,
        spaces: [],
        update: { state: 'unavailable' },
      }),
      profiles: { view: () => ({ currentId: 'default', profiles: [] }) },
      update: (patch) => preferences.update(patch),
      updateThreatLists: async () => {},
      clearData: async (request) => {
        clears.push(request);
      },
      updater: {},
      relaunch() {},
      permissions: { origins: () => [] },
      requestRules: { list: () => [] },
      onRequestRulesSaved() {},
    });
    const browsing = session.fromPartition('appearance-settings');
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
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') rendererErrors.push(message);
    });
    await window.loadURL('yalqen://settings/');
    await eventually(`!!${choice('Dark')}`);
    await run(`${choice('Dark')}.click()`);
    await eventually(`${choice('Dark')}.getAttribute('aria-checked')==='true'`);
    assert.equal(preferences.get().theme, 'dark');

    await window.loadURL('yalqen://settings/privacy');
    const clearButton = `Array.from(document.querySelectorAll('#pane button')).find(item=>item.textContent.trim()==='Clear…')`;
    await eventually(`!!${clearButton}`);
    assert.equal(await run(`document.querySelector('#pane dialog').open`), false);
    await run(`${clearButton}.click()`);
    await eventually(`document.querySelector('#pane dialog').open`);
    await run(
      `Array.from(document.querySelectorAll('#pane dialog button')).find(item=>item.textContent.trim()==='Clear data').click()`,
    );
    await eventually(`!!document.querySelector('#pane dialog [role=status]')`);
    assert.deepEqual(clears, [{ range: 'hour', history: true, downloads: false, siteData: false, cache: false }]);
    await run(
      `Array.from(document.querySelectorAll('#pane dialog button')).find(item=>item.textContent.trim()==='Close').click()`,
    );
    await eventually(`!document.querySelector('#pane dialog').open`);
    assert.equal(await run(`!!document.querySelector('#pane #secure-dns')`), false);
    await window.loadURL('yalqen://settings/advanced');
    await eventually(`!!document.querySelector('#pane #secure-dns')?.checkVisibility()`);
    await window.loadURL('yalqen://settings/tabs');
    await eventually(`!!document.querySelector('#pane h2')`);

    assert.deepEqual(rendererErrors, []);

    await run(
      `(() => {const input=document.querySelector('input[type=search], .search input');input.value='DNS';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await eventually(`!!document.querySelector('#pane #secure-dns')?.checkVisibility()`);

    console.log(
      'PASS: appearance settings pick theme from cards, show advanced settings for matching searches, and clear browsing data from a dialog',
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(() => {
  clearTimeout(deadline);
  if (window && !window.isDestroyed()) window.destroy();
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
