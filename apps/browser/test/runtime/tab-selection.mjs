import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tab-selection-'));
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
async function click(selector, modifiers = []) {
  const rect = await window.webContents.executeJavaScript(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x: Math.round(r.x+r.width/2),y: Math.round(r.y+r.height/2)};
  })()`);
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, modifiers, ...rect });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, modifiers, ...rect });
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
      sidebarVisible: true,
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
    const retained = new WebContentsView();
    await retained.webContents.loadURL('data:text/html,<p>Retained tab</p>');
    manager.tabs.find((tab) => tab.id === 'b').view = retained;
    window.contentView.addChildView(retained);
    manager.activeId = 'a';
    ipcMain.handle(IpcChannel.getState, () => view());
    ipcMain.on(IpcChannel.action, (_event, action) => {
      if (action.type === 'select-tab') manager.selectTab(action.id, action.mode);
      else if (action.type === 'clear-tab-selection') manager.clearSelection();
      else if (action.type === 'close-selected-tabs') void manager.closeSelected();
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));
    await eventually("document.querySelectorAll('aside button.select').length === 4");
    await click('aside button.select[title="https://c.example/"]', ['meta']);
    await eventually("document.querySelectorAll('aside button.select[aria-pressed=true]').length === 2");
    assert.deepEqual(manager.selectedTabIds, ['a', 'c']);
    await click('aside button.select[title="https://d.example/"]', ['shift']);
    await eventually(
      "document.querySelector('aside button.select[title=\"https://d.example/\"]').getAttribute('aria-pressed') === 'true'",
    );
    assert.deepEqual(manager.selectedTabIds, ['c', 'd']);
    await click('.selection button.clear-selection');
    await eventually("document.querySelectorAll('aside button.select[aria-pressed=true]').length === 0");
    await click('aside button.select[title="https://c.example/"]', [
      process.platform === 'darwin' ? 'meta' : 'control',
    ]);
    await eventually("document.querySelectorAll('aside button.select[aria-pressed=true]').length === 2");
    await click('.selection button.icon-btn');
    await eventually("document.querySelectorAll('aside button.select').length === 2");
    assert.deepEqual(
      manager.tabs.map(({ id }) => id),
      ['b', 'd'],
    );
    assert.deepEqual(
      manager.options.closed.map(({ id }) => id),
      ['c', 'a'],
    );
    console.log(
      'PASS: production Svelte sidebar handles real Cmd/Ctrl/Shift selection, pressed states, clearing and selected close IPC',
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
