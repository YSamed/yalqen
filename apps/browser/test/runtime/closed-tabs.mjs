import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { app, BaseWindow, WebContentsView } from 'electron';
import closed from '../../dist/main/tabs/closed-tabs.js';
import tabs from '../../dist/main/tabs/tabs.js';
const parent = !process.env.YALQEN_CLOSED_TEST_ROOT;
const root = process.env.YALQEN_CLOSED_TEST_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-closed-runtime-'));
const directory = path.join(root, parent ? 'parent' : 'data');
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', directory);
const deadline = setTimeout(() => app.exit(1), 30_000);
let window;
let manager;
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error('Native closed-tab test timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
app
  .whenReady()
  .then(async () => {
    if (parent) {
      fs.writeFileSync(path.join(root, 'back.html'), '<title>Previous page</title><p>Back</p>');
      fs.writeFileSync(path.join(root, 'final.html'), '<title>Final page</title><p>Restored offline</p>');
      for (const phase of ['write', 'restore', 'empty']) {
        await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: undefined,
            YALQEN_CLOSED_TEST_ROOT: root,
            YALQEN_CLOSED_TEST_PHASE: phase,
          },
          timeout: 10_000,
          killSignal: 'SIGKILL',
        });
      }
      console.log(
        'PASS: closed-tab history survives independent Electron restarts, restores real Chromium back navigation, excludes private tabs and persists consumption',
      );
      return;
    }
    const store = new closed.ClosedTabStore(directory);
    if (process.env.YALQEN_CLOSED_TEST_PHASE === 'empty') {
      assert.equal(store.tabs.length, 0);
      return;
    }
    window = new BaseWindow({ show: false });
    manager = new tabs.TabManager({
      window,
      closed: store.tabs,
      onClosedChanged: () => store.changed(),
      onChange() {},
      onPrivateEnded() {},
      onHtmlFullScreenChange() {},
      freezeBackground: () => false,
    });
    if (process.env.YALQEN_CLOSED_TEST_PHASE === 'write') {
      const sentinel = manager.createRecord({ id: 'sentinel', url: pathToFileURL(path.join(root, 'back.html')).href });
      manager.tabs.push(sentinel);
      manager.activeId = sentinel.id;
      for (const isPrivate of [false, true]) {
        const view = new WebContentsView();
        window.contentView.addChildView(view);
        await view.webContents.loadFile(path.join(root, 'back.html'));
        await view.webContents.loadFile(path.join(root, 'final.html'));
        const tab = manager.createRecord(
          { id: isPrivate ? 'private' : 'closed', url: view.webContents.getURL(), title: view.webContents.getTitle() },
          isPrivate,
        );
        tab.view = view;
        manager.tabs.push(tab);
        manager.close(tab.id);
        await eventually(() => !manager.tabs.includes(tab));
      }
      assert.equal(store.tabs.length, 1);
      assert.equal(store.tabs[0].title, 'Final page');
      store.saveNow();
    } else {
      assert.equal(store.tabs.length, 1);
      manager.activate = (id) => {
        manager.activeId = id;
      };
      manager.reopenClosed();
      const tab = manager.tabs[0];
      const view = new WebContentsView();
      tab.view = view;
      window.contentView.addChildView(view);
      manager.load(tab, view);
      await eventually(() => view.webContents.getTitle() === 'Final page');
      assert.equal(view.webContents.navigationHistory.canGoBack(), true);
      view.webContents.navigationHistory.goBack();
      await eventually(() => view.webContents.getTitle() === 'Previous page');
      assert.equal(store.tabs.length, 0);
      store.saveNow();
    }
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  manager?.destroyAll();
  if (window && !window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  if (parent) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error(error);
    }
  }
});
