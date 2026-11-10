import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-split-drag-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
let window;
let manager;
const { IpcChannel } = types;
const { EMPTY_AGENT_SESSION, EMPTY_AGENT_CHAT, EMPTY_PROJECT_RUN } = agentPanel;
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) {
      console.error(await window.webContents.executeJavaScript('document.querySelector("aside")?.textContent'));
      throw new Error(`Timed out: ${predicate}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 640,
      webPreferences: { preload: path.resolve('dist/preload/preload.js'), sandbox: true, contextIsolation: true },
    });
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(message);
    });
    const view = () => ({
      ...manager.state(),
      developer: false,
      pageFullScreen: false,
      windowFullScreen: false,
      addressPlaceholder: 'Search',
      panelCollapsed: false,
      panelSide: 'left',
      pinnedDisplay: 'always',
      favorites: [],
      sidebarVisible: true,
      media: null,
      toolbarVisible: true,
      toolbarTabs: true,
      toolbarButtons: ['settings'],
      material: 'opaque',
      defaultZoom: 1,
      downloads: { active: 0, progress: null, started: 0 },
      extensions: false,
      profile: 'personal',
      agentPanelOpen: false,
      agentSession: EMPTY_AGENT_SESSION,
      agentChat: EMPTY_AGENT_CHAT,
      agentProviders: ['claude'],
      projectRun: EMPTY_PROJECT_RUN,
      agentElements: [],
      agentTerminal: false,
      agentProjects: [],
      agentProjectId: '',
      agentConversationId: '',
      agentBackgroundChats: [],
    });
    const changed = () => window.webContents.send(IpcChannel.state, JSON.stringify(view()));
    manager = new tabs.TabManager({
      window,
      onChange: changed,
      onHtmlFullScreenChange() {},
      onPrivateEnded() {},
      freezeBackground: () => false,
      isBookmarked: () => false,
      hasCertificateException: () => false,
      translation: () => ({ enabled: false, language: 'en' }),
      hasOwnZoom: () => false,
      defaultZoom: () => 1,
      closed: [],
    });
    for (const id of ['a', 'b', 'c', 'd'])
      manager.tabs.push(manager.createRecord({ id, url: `https://${id}.example/`, title: `Tab ${id}` }));
    manager.activeId = 'a';
    ipcMain.handle(IpcChannel.getState, () => view());
    const actions = [];
    ipcMain.on(IpcChannel.action, (_event, action) => {
      if (action.type === 'preview-split' || action.type === 'split-tab') actions.push(action);
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));
    await eventually("document.querySelectorAll('aside button.select').length === 4");
    const center = (selector) =>
      window.webContents.executeJavaScript(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), left: Math.round(r.left), right: Math.round(r.right)};
      })()`);
    const row = await center('aside button.select[title="https://c.example/"]');
    const page = await center('section.page');
    const mouse = (type, { x, y }) =>
      window.webContents.sendInputEvent({
        type,
        button: 'left',
        clickCount: 1,
        modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [],
        x,
        y,
      });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    window.webContents.focus();

    mouse('mouseDown', row);
    for (const x of [row.x + 10, row.x + 40, page.right - 40]) {
      mouse('mouseMove', { x, y: page.y });
      await settle();
    }
    await eventually("document.querySelector('.split-drop') && !document.querySelector('.split-drop.left')");
    mouse('mouseMove', { x: page.left + 40, y: page.y });
    await eventually("!!document.querySelector('.split-drop.left')");
    mouse('mouseUp', { x: page.left + 40, y: page.y });
    await eventually("!document.querySelector('.split-drop')");
    await settle();
    assert.deepEqual(actions, [
      { type: 'preview-split', id: 'c', side: 'right' },
      { type: 'preview-split', id: 'c', side: 'left' },
      { type: 'split-tab', id: 'c', side: 'left' },
    ]);

    actions.length = 0;
    mouse('mouseDown', row);
    for (const x of [row.x + 10, row.x + 40, page.right - 40]) {
      mouse('mouseMove', { x, y: page.y });
      await settle();
    }
    await eventually("!!document.querySelector('.split-drop')");
    mouse('mouseMove', { x: row.x, y: row.y });
    await eventually("!document.querySelector('.split-drop')");
    mouse('mouseUp', { x: row.x, y: row.y });
    await settle();
    assert.deepEqual(actions, [
      { type: 'preview-split', id: 'c', side: 'right' },
      { type: 'preview-split', id: null, side: 'right' },
    ]);

    actions.length = 0;
    const active = await center('aside button.select[title="https://a.example/"]');
    mouse('mouseDown', active);
    for (const x of [active.x + 10, active.x + 40, page.right - 40]) {
      mouse('mouseMove', { x, y: page.y });
      await settle();
    }
    mouse('mouseUp', { x: page.right - 40, y: page.y });
    await settle();
    assert.deepEqual(actions, []);
    console.log(
      'PASS: production Svelte sidebar previews and drops a dragged tab into a split on the hovered page half',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  manager?.destroyAll();
  window?.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch (error) {
    console.error(error);
  }
});
