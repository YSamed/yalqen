import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import bridge from '../../dist/main/window/interface-bridge.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-interface-bridge-')));
app.setPath('userData', path.join(profile, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

const preload = path.join(profile, 'preload.js');
fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('yalqen', { ready: true });");
const page = path.join(profile, 'index.html');
fs.writeFileSync(page, '<title>Interface</title>');
const windows = [];

function interfaceWindow(name, withPreload) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: name,
      sandbox: true,
      contextIsolation: true,
      ...(withPreload ? { preload } : {}),
    },
  });
  windows.push(window);
  const loads = { count: 0 };
  window.webContents.on('did-finish-load', () => loads.count++);
  bridge.watchInterfaceBridge(window.webContents);
  return { window, loads };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 1500));

app
  .whenReady()
  .then(async () => {
    // With its preload the interface loads once and is left alone.
    const healthy = interfaceWindow('bridge-healthy', true);
    await healthy.window.loadFile(page);
    await settle();
    assert.equal(healthy.loads.count, 1);
    assert.equal(await healthy.window.webContents.executeJavaScript('window.yalqen.ready'), true);

    // Without it the page is reloaded, but only twice, so a broken preload cannot loop.
    const broken = interfaceWindow('bridge-broken', false);
    await broken.window.loadFile(page);
    await settle();
    assert.equal(broken.loads.count, 3);

    // When a reload brings the bridge back, the window stops there.
    const recovering = interfaceWindow('bridge-recovering', false);
    recovering.window.webContents.once('did-finish-load', () => {
      session.fromPartition('bridge-recovering').registerPreloadScript({ type: 'frame', filePath: preload });
    });
    await recovering.window.loadFile(page);
    await settle();
    assert.equal(recovering.loads.count, 2);
    assert.equal(await recovering.window.webContents.executeJavaScript('window.yalqen.ready'), true);

    console.log(
      'PASS: the window reloads its interface when it comes up without its preload bridge, at most twice, and leaves a healthy interface alone',
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(() => {
  clearTimeout(deadline);
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
