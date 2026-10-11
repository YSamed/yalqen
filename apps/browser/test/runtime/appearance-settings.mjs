import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import internal from '../../dist/main/pages/internal-pages.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-appearance-ui-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const rendererErrors = [];
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
const labelled = (label) => `document.querySelector('#pane [aria-label=${JSON.stringify(label)}]')`;
app
  .whenReady()
  .then(async () => {
    const preferences = new settings.SettingsStore(root);
    preferences.update({ toolbarButtons: ['bookmarks', 'history', 'settings'] });
    ipc.registerSettingsIpc({
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
      permissions: {},
      requestRules: {},
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
    await window.loadURL('yalqen://settings/appearance');
    await eventually(`!!${choice('Right, narrow')}`);

    // One layout card sets the sidebar's visibility, side and width together.
    await run(`${choice('Right, narrow')}.click()`);
    await eventually(`${choice('Right, narrow')}.getAttribute('aria-checked')==='true'`);
    assert.deepEqual(
      (({ sidebarVisible, panelSide, panelCollapsed }) => ({ sidebarVisible, panelSide, panelCollapsed }))(
        preferences.get(),
      ),
      { sidebarVisible: true, panelSide: 'right', panelCollapsed: true },
    );
    await run(`${choice('Hidden, tabs on top')}.click()`);
    await eventually(`${choice('Hidden, tabs on top')}.getAttribute('aria-checked')==='true'`);
    assert.equal(preferences.get().sidebarVisible, false);
    assert.equal(preferences.get().panelSide, 'right');
    await run(
      `${choice('Hidden, tabs on top')}.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,
    );
    await eventually(`${choice('Left, wide')}.getAttribute('aria-checked')==='true'`);
    assert.equal(preferences.get().sidebarVisible, true);
    assert.equal(preferences.get().panelCollapsed, false);

    await run(`${choice('Dark')}.click()`);
    await eventually(`${choice('Dark')}.getAttribute('aria-checked')==='true'`);
    assert.equal(preferences.get().theme, 'dark');

    // Toolbar buttons are removed and added from the preview, and move with Option and the arrow keys.
    await run(`${labelled('Remove History button')}.click()`);
    await eventually(`!!${labelled('Add History button')}`);
    assert.deepEqual(preferences.get().toolbarButtons, ['bookmarks', 'settings']);
    await run(`${labelled('Add Downloads button')}.click()`);
    await eventually(`!!${labelled('Remove Downloads button')}`);
    assert.deepEqual(preferences.get().toolbarButtons, ['bookmarks', 'settings', 'downloads']);
    await run(
      `${labelled('Remove Downloads button')}.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}))`,
    );
    await eventually(`document.querySelector('#pane [data-id]:nth-of-type(2)')?.dataset.id==='downloads'`);
    assert.deepEqual(preferences.get().toolbarButtons, ['bookmarks', 'downloads', 'settings']);
    await run(`document.querySelector('#pane [data-id=settings]').click()`);
    assert.ok(preferences.get().toolbarButtons.includes('settings'));

    // Searching opens the Advanced group when a setting inside it matches.
    assert.equal(await run(`document.querySelector('#pane details').open`), false);
    await run(
      `(() => {const input=document.querySelector('input[type=search], .search input');input.value='zoom';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await eventually(`[...document.querySelectorAll('#pane details')].some(item=>item.open&&!item.hidden)`);

    assert.deepEqual(rendererErrors, []);
    console.log(
      'PASS: appearance settings pick theme and sidebar layout from cards, edit toolbar buttons from the preview and open Advanced for matching searches',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  if (window && !window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
