import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tab-cleanup-'));
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

let tabCleanup = true;
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
      tabCleanup,
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
    // Tabs without a page are the ones memory saving unloaded; b is loaded and p is pinned.
    for (const id of ['a', 'b', 'c', 'd'])
      manager.tabs.push(manager.createRecord({ id, url: `https://${id}.example/`, title: `Tab ${id}` }));
    manager.tabs.push(
      manager.createRecord({ id: 'p', url: 'https://p.example/', pinnedUrl: 'https://p.example/', title: 'Pinned' }),
    );
    const loaded = new WebContentsView();
    await loaded.webContents.loadURL('data:text/html,<p>Loaded tab</p>');
    manager.tabs.find((tab) => tab.id === 'b').view = loaded;
    window.contentView.addChildView(loaded);
    manager.activeId = 'a';
    ipcMain.handle(IpcChannel.getState, () => view());
    ipcMain.on(IpcChannel.action, (_event, action) => {
      if (action.type === 'clean-tabs') void manager.closeIdle();
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));

    // The clean button counts the unpinned idle tabs: not the active one, the loaded one or the pinned one.
    const cleanButton = 'aside .tab-cleanup button';
    await eventually(`document.querySelector('${cleanButton}')?.getAttribute('aria-label') === 'Clean 2 tabs'`);
    assert.equal(
      await window.webContents.executeJavaScript(`document.querySelector('${cleanButton}').title`),
      'Clean 2 tabs (⌘⇧K)',
    );
    await click(cleanButton);
    await eventually("document.querySelectorAll('aside button.select').length === 2");
    assert.deepEqual(
      manager.tabs.map(({ id }) => id),
      ['a', 'b', 'p'],
    );
    assert.deepEqual(manager.options.closed.map(({ id }) => id).sort(), ['c', 'd']);
    assert.equal(manager.activeId, 'a');

    // With nothing left to clean the button stays put but does nothing.
    await eventually(`document.querySelector('${cleanButton}').getAttribute('aria-disabled') === 'true'`);
    // The pointer is still over it, so its title is held by the tooltip; the label says the same.
    assert.equal(
      await window.webContents.executeJavaScript(`document.querySelector('${cleanButton}').getAttribute('aria-label')`),
      'No tab to clean',
    );
    await click(cleanButton);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(manager.tabs.length, 3);

    // The collapsed sidebar keeps the button.
    manager.tabs.push(manager.createRecord({ id: 'e', url: 'https://e.example/', title: 'Tab e' }));
    collapsed = true;
    changed();
    await eventually("document.querySelector('aside.panel')?.classList.contains('collapsed')");
    await eventually(`document.querySelector('${cleanButton}')?.getAttribute('aria-label') === 'Clean 1 tab'`);

    // Turning the setting off removes it.
    tabCleanup = false;
    changed();
    await eventually(`!document.querySelector('${cleanButton}')`);
    console.log(
      'PASS: the sidebar clean button closes unpinned idle tabs only, shows its shortcut, stays in the collapsed sidebar and follows its setting',
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
