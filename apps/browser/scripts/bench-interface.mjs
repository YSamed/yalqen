import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: {
    'renderer-dir': { type: 'string', default: fileURLToPath(new URL('../dist/renderer/', import.meta.url)) },
    tabs: { type: 'string', default: '200' },
    updates: { type: 'string', default: '200' },
    'active-only': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
const count = (name) => {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < 2 || value > 2000) throw new Error(`--${name} must be between 2 and 2000`);
  return value;
};
const tabCount = count('tabs');
const updates = count('updates');

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
  const { app, BrowserWindow, ipcMain } = require('electron');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-interface-bench-'));
  app.setPath('userData', profile);
  const preload = path.join(profile, 'preload.cjs');
  fs.writeFileSync(
    preload,
    `
const { contextBridge, ipcRenderer } = require('electron');
const listeners = new Set();
contextBridge.exposeInMainWorld('yalqen', {
  getState: () => ipcRenderer.invoke('bench:initial'),
  onState: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  onWallpaper: () => () => {}, setLayout: () => {}, send: () => {},
});
ipcRenderer.on('bench:state', (_event, state) => {
  const start = performance.now();
  for (const listener of listeners) listener(state);
  Promise.resolve().then(() => Promise.resolve().then(() => ipcRenderer.send('bench:applied', performance.now() - start)));
});
`,
  );
  const initial = {
    tabs: Array.from({ length: tabCount }, (_, index) => ({
      id: `tab-${index}`,
      title: `Page ${index}`,
      url: `https://site${index}.example/`,
      faviconUrl: null,
      live: index === 0,
      frozen: false,
      loading: false,
      pinned: false,
      security: 'secure',
      isPrivate: false,
      bookmarked: false,
      blockedPopups: 0,
      consoleErrors: 0,
      overrides: {
        cacheDisabled: false,
        network: null,
        colorScheme: null,
        reducedMotion: false,
        printMedia: false,
        userAgent: null,
        requestRules: false,
      },
      translation: { status: 'idle', available: false },
      autoReloadSeconds: null,
      audible: false,
      muted: false,
      canGoBack: false,
      canGoForward: false,
    })),
    listOrder: Array.from({ length: tabCount }, (_, index) => `tab-${index}`),
    developer: false,
    activeTabId: 'tab-0',
    pageFullScreen: false,
    windowFullScreen: false,
    addressPlaceholder: 'Ara veya adres yaz',
    panelCollapsed: false,
    panelSide: 'left',
    sidebarVisible: true,
    toolbarVisible: true,
    toolbarTabs: !values['active-only'],
    toolbarButtons: ['bookmarks', 'history', 'settings', 'downloads'],
    material: 'opaque',
    device: null,
    zoom: 1,
    defaultZoom: 1,
    downloads: { active: 0, progress: null, started: 0 },
    extensions: false,
    pendingUpdate: null,
    profile: 'personal',
  };
  ipcMain.handle('bench:initial', () => initial);
  let window;
  const timer = setTimeout(() => {
    console.error('Interface benchmark timed out');
    app.exit(1);
  }, 60000);
  try {
    await app.whenReady();
    window = new BrowserWindow({
      width: 1280,
      height: 820,
      show: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true },
    });
    window.webContents.on('console-message', (details) => {
      console.error(details.message);
    });
    window.webContents.on('preload-error', (_event, _path, error) => console.error(error));
    await window.loadFile(path.join(path.resolve(values['renderer-dir']), 'index.html'));
    const applied = (state) =>
      new Promise((resolve) => {
        ipcMain.once('bench:applied', (_event, ms) => resolve(ms));
        window.webContents.send('bench:state', state);
      });
    await applied(initial);
    const results = [];
    for (const scenario of ['background-title', 'download-progress']) {
      const samples = [];
      const state = structuredClone(initial);
      for (let index = 0; index < updates + 20; index++) {
        if (scenario === 'background-title') state.tabs[tabCount - 1].title = `Changed ${index}`;
        else state.downloads = { active: 1, progress: (index % 100) / 100, started: 1 };
        const ms = await applied(state);
        if (index >= 20) samples.push(ms);
      }
      if (scenario === 'background-title') {
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.querySelectorAll('.panel .select .title')[${tabCount - 1}].textContent`,
          ),
          `Changed ${updates + 19}`,
        );
      } else {
        assert.equal(
          await window.webContents.executeJavaScript("document.querySelector('.panel .card-meta').textContent"),
          `%${(updates + 19) % 100}`,
        );
      }
      samples.sort((a, b) => a - b);
      results.push({
        scenario,
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
        p95Ms: Number(samples[Math.floor(samples.length * 0.95)].toFixed(3)),
      });
    }
    const record = {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      tabs: tabCount,
      updates,
      toolbarTabs: initial.toolbarTabs,
      results,
    };
    if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
    console.table(results);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    window?.destroy();
    ipcMain.removeHandler('bench:initial');
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
