import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bookmarks-panel-'));
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

let panelOpen = true;
let collapsed = false;
const panelView = {
  folders: [
    { id: 'work', title: 'Work', parentId: null },
    { id: 'docs', title: 'Docs', parentId: 'work' },
  ],
  bookmarks: [
    { id: 'inbox', title: 'Inbox', url: 'https://a.example/inbox', folderId: null, icon: null },
    { id: 'board', title: 'Board', url: 'https://b.example/', folderId: 'work', icon: null },
    { id: 'spec', title: 'Spec', url: 'https://c.example/spec', folderId: 'docs', icon: null },
  ],
};

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
      bookmarksPanel: panelOpen ? panelView : null,
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
    // The active tab shows the bookmarked inbox further down the page; another tab shows the board.
    manager.tabs.push(manager.createRecord({ id: 'a', url: 'https://a.example/inbox#thread', title: 'Inbox' }));
    manager.tabs.push(manager.createRecord({ id: 'b', url: 'https://b.example/', title: 'Board' }));
    manager.activeId = 'a';
    const actions = [];
    ipcMain.handle(IpcChannel.getState, () => view());
    ipcMain.on(IpcChannel.action, (_event, action) => actions.push(action));
    await window.loadFile(path.resolve('dist/renderer/index.html'));
    const js = (code) => window.webContents.executeJavaScript(code);
    const row = (title) =>
      `[...document.querySelectorAll('#bookmarks-panel .row')].find((item) => item.textContent.includes('${title}'))`;
    const rightClick = async (title) => {
      const rect = await js(
        `(() => { const r = (${row(title)}).getBoundingClientRect(); return { x: Math.round(r.x + 20), y: Math.round(r.y + r.height / 2) }; })()`,
      );
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...rect });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...rect });
    };
    const typeInto = async (index, text) => {
      await js(
        `(() => { const input = document.querySelectorAll('.bookmark-editor input')[${index}]; input.focus(); input.select(); })()`,
      );
      await window.webContents.insertText(text);
    };

    // Folders start closed; the root bookmark whose page is the active tab is lifted like the active tab.
    await eventually(`!!document.querySelector('#bookmarks-panel .row')`);
    assert.equal(await js(`!!${row('Board')}`), false);
    assert.equal(await js(`(${row('Inbox')}).classList.contains('active')`), true);
    assert.equal(await js(`(${row('Work')}).getAttribute('aria-expanded')`), 'false');

    // Opening folders shows what is inside; a bookmark open in another tab is marked open but not active.
    await click(`#bookmarks-panel .row.folder`);
    await eventually(`!!${row('Board')}`);
    assert.equal(await js(`(${row('Board')}).classList.contains('open')`), true);
    assert.equal(await js(`(${row('Board')}).classList.contains('active')`), false);
    await eventually(`!!${row('Docs')}`);
    assert.equal(await js(`!!${row('Spec')}`), false);
    await js(`(${row('Docs')}).click()`);
    await eventually(`!!${row('Spec')}`);
    assert.equal(await js(`(${row('Spec')}).classList.contains('open')`), false);

    // A click opens the page; main switches to its tab when there is one.
    await js(`(${row('Board')}).click()`);
    const start = Date.now();
    while (actions.at(-1)?.type !== 'open-bookmark' && Date.now() - start < 2000)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(actions.at(-1), { type: 'open-bookmark', url: 'https://b.example/' });

    // Right-click edits the name and the address, with Save and Cancel; a bad address is refused here.
    await rightClick('Spec');
    await eventually(`document.querySelectorAll('.bookmark-editor input').length === 2`);
    await typeInto(0, 'Product spec');
    await typeInto(1, 'not an address');
    await js(`document.querySelector('.bookmark-editor button[type="submit"]').click()`);
    await eventually(`!!document.querySelector('.bookmark-editor .error')`);
    assert.equal(
      actions.some((action) => action.type === 'edit-bookmark'),
      false,
    );
    await typeInto(1, 'https://c.example/spec/v2');
    await js(`document.querySelector('.bookmark-editor button[type="submit"]').click()`);
    await eventually(`!document.querySelector('.bookmark-editor')`);
    assert.deepEqual(actions.at(-1), {
      type: 'edit-bookmark',
      id: 'spec',
      title: 'Product spec',
      url: 'https://c.example/spec/v2',
    });

    // Escape cancels, and so does a press outside the card or a click into the page, which takes focus away.
    const before = actions.length;
    await rightClick('Board');
    await eventually(`!!document.querySelector('.bookmark-editor')`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await eventually(`!document.querySelector('.bookmark-editor')`);
    await rightClick('Board');
    await eventually(`!!document.querySelector('.bookmark-editor')`);
    await js(
      `(() => { const input = document.querySelector('.bookmark-editor input'); input.value = 'Changed'; input.dispatchEvent(new Event('input')); })()`,
    );
    await click('#bookmarks-panel header strong');
    await eventually(`!document.querySelector('.bookmark-editor')`);
    await rightClick('Board');
    await eventually(`!!document.querySelector('.bookmark-editor')`);
    await js(`window.dispatchEvent(new Event('blur'))`);
    await eventually(`!document.querySelector('.bookmark-editor')`);
    assert.equal(actions.length, before);
    await rightClick('Work');
    await eventually(`document.querySelectorAll('.bookmark-editor input').length === 1`);
    await typeInto(0, 'Projects');
    await js(`document.querySelector('.bookmark-editor button[type="submit"]').click()`);
    await eventually(`!document.querySelector('.bookmark-editor')`);
    assert.deepEqual(actions.slice(before), [{ type: 'rename-bookmark-folder', id: 'work', title: 'Projects' }]);

    // The footer opens the full bookmarks page, and the header closes the panel.
    await js(`document.querySelector('#bookmarks-panel footer button').click()`);
    await js(`document.querySelector('#bookmarks-panel header button').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(
      actions.slice(-2).map((action) => action.type),
      ['open-bookmarks-page', 'toggle-bookmarks-panel'],
    );
    panelOpen = false;
    changed();
    await eventually(`!document.querySelector('#bookmarks-panel')`);
    console.log(
      'PASS: the bookmarks panel shows folders, lifts the bookmark of the active tab, marks open ones, opens pages and edits names and addresses',
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
