import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import types from '../../dist/shared/types.js';
import menus from '../../dist/main/window/window-menus.js';
import agentPanel from '../../dist/shared/agent-panel.js';
import persistence from '../../dist/main/tabs/persistence.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-pinning-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
let window;
let manager;
let collapsed = false;
let pinnedDisplay = 'always';
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
      panelCollapsed: collapsed,
      panelSide: 'left',
      pinnedDisplay,
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
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
      manager.tabs.push(manager.createRecord({ id, url: `https://${id}.example/`, title: `Tab ${id}` }));
    const retained = new WebContentsView();
    await retained.webContents.loadURL('data:text/html,<p>Retained tab</p>');
    manager.tabs.find((tab) => tab.id === 'b').view = retained;
    window.contentView.addChildView(retained);
    manager.activeId = 'a';
    ipcMain.handle(IpcChannel.getState, () => view());
    ipcMain.on(IpcChannel.action, (_event, action) => {
      if (action.type === 'open-tab-menu') {
        const tab = manager.snapshotFor(action.id);
        const menu = menus.tabMenuTemplate(
          tab,
          action.id === manager.activeTabId,
          {
            togglePin: () => manager.togglePin(action.id),
            toggleMute() {},
            discard() {},
            close() {},
            duplicate() {},
            closeOthers() {},
            closeRight() {},
          },
          { others: false, right: false },
        );
        menu[1].click();
      } else if (action.type === 'select-tab') manager.selectTab(action.id, action.mode);
      else if (action.type === 'clear-tab-selection') manager.clearSelection();
      else if (action.type === 'close-selected-tabs') void manager.closeSelected();
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));
    await eventually("document.querySelectorAll('aside button.select').length === 8");
    for (const [index, id] of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].entries()) {
      await window.webContents.executeJavaScript(
        `document.querySelector('aside button.select[title="https://${id}.example/"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true}))`,
      );
      await eventually(`document.querySelectorAll('aside .favorite').length === ${index + 1}`);
      assert.equal(manager.tabs.filter((tab) => tab.pinnedUrl).length, index + 1);
    }
    const geometry = await window.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('aside').getBoundingClientRect();
      return [...document.querySelectorAll('.favorite button')].map(button => {
        const r = button.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,panelLeft:panel.left,panelRight:panel.right};
      });
    })()`);
    for (const r of geometry) {
      assert.ok(r.left >= r.panelLeft && r.right <= r.panelRight, JSON.stringify(r));
      assert.ok(r.bottom > r.top);
    }
    const saved = manager.toSavedWindow();
    assert.equal(saved.tabs.filter((tab) => tab.pinnedUrl).length, 8);
    assert.deepEqual(
      saved.tabs.map((tab) => tab.pinnedUrl),
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => `https://${id}.example/`),
    );
    assert.equal(manager.options.closed.length, 0);
    // Hidden launchers must not make newly pinned background tabs disappear.
    // This is the user's actual appearance setting: expanded-only pins in a collapsed panel.
    for (const tab of manager.tabs) manager.togglePin(tab.id);
    collapsed = true;
    pinnedDisplay = 'expanded';
    changed();
    await eventually(
      "document.querySelectorAll('aside .row').length === 8 && document.querySelector('aside').classList.contains('collapsed')",
    );
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      await window.webContents.executeJavaScript(
        `document.querySelector('aside .row button[aria-label^="Tab ${id}"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}))`,
      );
      await eventually("document.querySelectorAll('aside .row').length === 8");
      assert.equal(manager.tabs.find((tab) => tab.id === id).pinnedUrl, `https://${id}.example/`);
    }
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('aside .favorite').length"), 0);
    const persisted = new persistence.SessionStore(profile);
    persisted.saveNow({ version: 2, windows: [manager.toSavedWindow()] });
    const restored = new persistence.SessionStore(profile).load();
    assert.equal(restored.windows[0].tabs.filter((tab) => tab.pinnedUrl).length, 8);
    console.log(
      'PASS: eight successive production sidebar pin actions remain visible in expanded and collapsed/expanded-only modes, including background tabs, and persist without a two-pin limit',
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
