import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { mainModule } from './main-module.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: fileURLToPath(new URL('../dist/main/', import.meta.url)) },
    tabs: { type: 'string', default: '500' },
    live: { type: 'string', default: '20' },
    out: { type: 'string' },
  },
});
const tabCount = Number(values.tabs);
const liveCount = Number(values.live);
if (!Number.isInteger(tabCount) || tabCount < 2 || tabCount > 2000)
  throw new Error('--tabs must be between 2 and 2000');
if (!Number.isInteger(liveCount) || liveCount < 1 || liveCount > tabCount)
  throw new Error('--live must be between 1 and --tabs');

if (!process.versions.electron) {
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  void run();
}

async function run() {
  const { app, WebContentsView } = require('electron');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tab-snapshot-bench-'));
  app.setPath('userData', profile);
  const views = [];
  const timer = setTimeout(() => app.exit(1), 60000);
  try {
    await app.whenReady();
    const { TabManager } = require(mainModule(values['module-dir'], 'tabs/tabs.js'));
    const manager = new TabManager({
      isBookmarked: () => false,
      hasCertificateException: () => false,
      translation: () => ({ enabled: false, language: 'tr' }),
    });
    // Keep real native contents in a fixed fixture to isolate snapshot preparation from page rendering.
    for (let index = 0; index < tabCount; index++) {
      const tab = manager.createRecord({
        id: `tab-${index}`,
        url: `https://site${index}.example/`,
        title: `Page ${index}`,
      });
      if (index >= tabCount - liveCount) {
        const view = new WebContentsView({ webPreferences: { sandbox: true } });
        views.push(view);
        tab.view = view;
      }
      manager.tabs.push(tab);
    }
    const id = `tab-${tabCount - 1}`;
    manager.activeId = id;
    const contents = views.at(-1).webContents;
    for (let index = 0; index < 3; index++) await contents.loadURL(`data:text/html,<title>Page ${index}</title>`);
    const snapshot = () =>
      manager.snapshotFor ? manager.snapshotFor(id) : manager.state().tabs.find((tab) => tab.id === id);
    assert.deepEqual(
      snapshot(),
      manager.state().tabs.find((tab) => tab.id === id),
    );
    assert.equal(snapshot().canGoBack, true);
    assert.equal(snapshot().canGoForward, false);
    const navigated = new Promise((resolve) => contents.once('did-navigate', resolve));
    contents.navigationHistory.goBack();
    await navigated;
    assert.equal(snapshot().canGoForward, true);
    let checksum = 0;
    for (let index = 0; index < 100; index++) snapshot();
    const samples = [];
    const iterations = 500;
    for (let repeat = 0; repeat < 7; repeat++) {
      const start = performance.now();
      for (let index = 0; index < iterations; index++) {
        const tab = snapshot();
        checksum += tab.title.length + Number(tab.canGoBack) + Number(tab.canGoForward);
      }
      samples.push((performance.now() - start) / iterations);
    }
    samples.sort((a, b) => a - b);
    const record = {
      electron: process.versions.electron,
      tabs: tabCount,
      live: liveCount,
      iterations,
      checksum,
      medianMs: Number(samples[3].toFixed(6)),
    };
    if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify(record, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    for (const view of views) view.webContents.close();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
