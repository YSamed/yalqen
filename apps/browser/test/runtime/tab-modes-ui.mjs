import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import tabModes from '../../dist/shared/tab-modes.js';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tab-modes-ui-'));
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

let modesOn = true;

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
      tabModes: modesOn,
      modeSwitch: modesOn,
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
      actions.push(action.type === 'set-tab-mode' ? `mode:${action.mode}` : action.type);
      // The tab manager's own switching is covered by tab-modes.mjs; here the tab just takes the mode.
      if (action.type === 'set-tab-mode') {
        Object.assign(manager.find('a'), tabModes.modeFlags(action.mode));
        changed();
      }
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));

    const js = (code) => window.webContents.executeJavaScript(code);
    const checked = () => js(`document.querySelector('.modes .mode[aria-checked="true"]')?.getAttribute('aria-label')`);
    await eventually("document.querySelectorAll('.modes .mode').length === 3");
    assert.equal(await checked(), 'Normal');
    assert.equal(await js('document.documentElement.dataset.mode'), 'normal');

    // On a web page the picked Normal icon says what it does next.
    assert.equal(await js(`document.querySelector('.modes .mode.normal').title`), 'Site information');

    // Arrow keys move between the modes without switching; Enter picks one.
    await js(`document.querySelector('.modes .mode.normal').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await eventually(`document.activeElement?.getAttribute('aria-label') === 'Developer'`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
    await eventually(`document.activeElement?.getAttribute('aria-label') === 'Private'`);
    assert.deepEqual(actions, []);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await eventually(`document.documentElement.dataset.mode === 'private'`);
    actions.length = 0;
    Object.assign(manager.find('a'), tabModes.modeFlags('normal'));
    changed();
    await eventually(`document.documentElement.dataset.mode === 'normal'`);

    // Normal again opens the site information, as the lock did.
    await click('.modes .mode.normal');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(actions, ['open-site-info']);

    // Developer: the slider moves, and the window takes the developer look.
    await click('.modes .mode.developer');
    await eventually(`document.documentElement.dataset.mode === 'developer'`);
    assert.equal(await checked(), 'Developer');
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.modes')).getPropertyValue('--mode-index').trim()`),
      '1',
    );
    assert.equal(await js(`getComputedStyle(document.body, '::after').content`), '""');

    // Private: dark and flat, with the accent turned grey.
    await click('.modes .mode.private');
    await eventually(`document.documentElement.dataset.mode === 'private'`);
    assert.equal(await checked(), 'Private');
    assert.equal(await js(`getComputedStyle(document.documentElement).colorScheme`), 'dark');
    assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#d4d4d8');

    // Back to normal in one click; the next click on it opens the site information.
    await click('.modes .mode.normal');
    await eventually(`document.documentElement.dataset.mode === 'normal'`);
    assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#0a84ff');
    assert.deepEqual(actions, ['open-site-info', 'mode:developer', 'mode:private', 'mode:normal']);

    // With the setting off there is no slider, and a private tab leaves the window's look alone.
    modesOn = false;
    Object.assign(manager.find('a'), tabModes.modeFlags('private'));
    changed();
    await eventually(`!document.querySelector('.modes')`);
    assert.equal(await js('document.documentElement.dataset.mode'), 'normal');
    console.log(
      'PASS: the address bar mode slider switches the tab between normal, developer and private by click or keyboard, restyles the window, keeps the site information on the normal icon and follows its setting',
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
