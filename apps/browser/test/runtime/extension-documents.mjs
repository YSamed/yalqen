import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import extensionBridge from '../../dist/main/extensions/extension-bridge.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-documents-')));
app.setPath('userData', path.join(profile, 'profile'));
const windows = [];
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw Error('Extension documents test timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const WORKER = `const seen = [];
chrome.sidePanel.onOpened.addListener((info) => seen.push('opened:' + info.path + ':' + info.windowId));
chrome.sidePanel.onClosed.addListener((info) => seen.push('closed:' + info.path));
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === 'seen') return void reply(seen);
  if (message.type === 'parsed') return void seen.push('parsed:' + message.text);
  if (message.type === 'make') {
    const create = (justification) => chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification,
    });
    create('first')
      .then(() => create('second').then(() => 'created twice', (error) => error.message))
      .then(async (second) => reply({
        second,
        has: await chrome.offscreen.hasDocument(),
        contexts: (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).map((c) => c.documentUrl),
      }), (error) => reply({ error: error.message }));
    return true;
  }
  if (message.type === 'close') {
    chrome.offscreen.closeDocument().then(() => chrome.offscreen.hasDocument()).then(reply);
    return true;
  }
});`;

app
  .whenReady()
  .then(async () => {
    const source = path.join(profile, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Documents test',
        version: '1.0',
        permissions: ['offscreen', 'sidePanel'],
        side_panel: { default_path: 'panel.html' },
        background: { service_worker: 'worker.js' },
      }),
    );
    fs.writeFileSync(path.join(source, 'worker.js'), WORKER);
    fs.writeFileSync(path.join(source, 'page.html'), '<title>Page</title>');
    fs.writeFileSync(path.join(source, 'panel.html'), '<title>Panel</title>');
    fs.writeFileSync(path.join(source, 'offscreen.html'), '<script src="offscreen.js"></script>');
    fs.writeFileSync(
      path.join(source, 'offscreen.js'),
      `const doc = new DOMParser().parseFromString('<b>ok</b>', 'text/html');
chrome.runtime.sendMessage({ type: 'parsed', text: doc.body.textContent });`,
    );

    const browsing = session.fromPartition('persist:extension-documents');
    const page = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
    windows.push(page);
    const panelWindowId = 42;
    let panel = null;
    const bridge = new extensionBridge.ExtensionBridge(
      browsing,
      {
        open: () => null,
        close: () => false,
        isTab: () => false,
        windowId: (contents) => (panel && contents === panel.webContents ? panelWindowId : page.id),
        isActive: () => false,
        windows: () => [{ id: panelWindowId, focused: true }],
        openAction() {},
        openSidePanel: (_id, url, windowId) => {
          if (windowId !== panelWindowId) return null;
          panel = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
          windows.push(panel);
          void panel.loadURL(url);
          return panel.webContents;
        },
        closeSidePanel: () => {
          if (panel && !panel.isDestroyed()) panel.destroy();
          panel = null;
        },
        sidePanelOpen: () => panel !== null && !panel.isDestroyed(),
      },
      path.resolve(import.meta.dirname, '../../dist/preload/extension-apis.js'),
    );
    const extension = await browsing.extensions.loadExtension(source);
    await page.loadURL(`chrome-extension://${extension.id}/page.html`);
    const run = (code) => page.webContents.executeJavaScript(code);
    const ask = (type) => run(`chrome.runtime.sendMessage({ type: '${type}' })`);

    const made = await ask('make');
    assert.equal(made.error, undefined, made.error);
    assert.equal(made.second, 'Only a single offscreen document may be created.');
    assert.equal(made.has, true);
    assert.deepEqual(made.contexts, [`chrome-extension://${extension.id}/offscreen.html`]);
    await eventually(async () => (await ask('seen')).includes('parsed:ok'));
    assert.equal(await ask('close'), false);

    assert.equal(bridge.sidePanelUrl(extension.id, null), `chrome-extension://${extension.id}/panel.html`);
    assert.deepEqual(await run('chrome.sidePanel.getOptions({})'), { enabled: true, path: 'panel.html' });
    assert.equal(
      await run(`chrome.sidePanel.setOptions({ path: 'https://example.com/' }).then(() => 'set', () => 'rejected')`),
      'rejected',
    );
    await run('chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })');
    assert.deepEqual(await run('chrome.sidePanel.getPanelBehavior()'), { openPanelOnActionClick: true });
    assert.equal(bridge.opensSidePanelOnAction(extension.id), true);
    assert.equal(await run(`chrome.sidePanel.open({}).then(() => 'opened', () => 'rejected')`), 'rejected');

    await run(`chrome.sidePanel.open({ windowId: ${panelWindowId} })`);
    await eventually(async () => (await ask('seen')).includes(`opened:panel.html:${panelWindowId}`));
    await eventually(() => panel?.webContents.getURL() === `chrome-extension://${extension.id}/panel.html`);

    bridge.toggleSidePanel(extension.id, panelWindowId, null);
    assert.equal(panel, null);
    await eventually(async () => (await ask('seen')).includes('closed:panel.html'));

    await run('chrome.sidePanel.setOptions({ enabled: false })');
    assert.equal(bridge.sidePanelUrl(extension.id, null), null);
    console.log('PASS: native offscreen documents and runtime.getContexts, and the sidePanel bridge');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(() => {
  clearTimeout(deadline);
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
