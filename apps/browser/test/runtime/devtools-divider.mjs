import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-devtools-divider-'));
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

let divider = { x: 600, y: 60, width: 6, height: 400, value: 40 };
let collapsed = false;

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
      panelCollapsed: collapsed,
      panelSide: 'left',
      pinnedDisplay: 'always',
      devToolsDivider: divider,
      favorites: [],
      spaces: [],
      activeSpaceId: '',
      sidebarVisible: true,
      media: null,
      toolbarVisible: true,
      toolbarTabs: true,
      toolbarButtons: ['settings'],
      toolbarExtensions: [],
      material: 'opaque',
      glassTint: 0,
      accent: '#0a84ff',
      windowColor: null,
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
    manager.tabs.push(manager.createRecord({ id: 'a', url: 'https://a.example/', title: 'Tab a' }));
    manager.activeId = 'a';
    const actions = [];
    ipcMain.handle(IpcChannel.getState, () => view());
    ipcMain.on(IpcChannel.action, (_event, action) => {
      if (action.type === 'resize-devtools') actions.push(action.x);
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));
    const js = (code) => window.webContents.executeJavaScript(code);
    const handle = '[role="separator"][aria-orientation="vertical"]';

    // The gap between the page and DevTools is a separator that reports DevTools' share.
    await eventually(`!!document.querySelector('${handle}')`);
    assert.deepEqual(
      await js(
        `(() => { const r = document.querySelector('${handle}').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`,
      ),
      [600, 60, 6, 400],
    );
    assert.equal(await js(`document.querySelector('${handle}').getAttribute('aria-valuenow')`), '40');

    // Dragging sends where the pointer is; arrows move it by 16 pixels, or 64 with Shift.
    const at = (x) => ({ x, y: 260 });
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at(603) });
    window.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', ...at(540) });
    window.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', ...at(480) });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at(480) });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Chromium may merge quick moves, so only the last position is certain.
    assert.equal(actions.at(-1), 480);
    actions.length = 0;
    await js(`document.querySelector('${handle}').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right', modifiers: ['shift'] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(actions, [587, 667]);

    // With DevTools closed there is no handle.
    divider = null;
    changed();
    await eventually(`!document.querySelector('${handle}')`);
    console.log(
      'PASS: the DevTools divider resizes by drag and by arrow keys, reports its share and goes away with DevTools',
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
