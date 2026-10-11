import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-sidebar-widgets-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
const { IpcChannel } = types;
const { EMPTY_AGENT_SESSION, EMPTY_AGENT_CHAT, EMPTY_PROJECT_RUN } = agentPanel;
const tab = (id, fields = {}) => ({
  id,
  title: `Tab ${id}`,
  url: `https://${id}.example/`,
  faviconUrl: null,
  live: true,
  frozen: false,
  loading: false,
  pinned: false,
  security: 'secure',
  isPrivate: false,
  bookmarked: false,
  blockedPopups: 0,
  consoleErrors: 0,
  overrides: {},
  translation: { available: false, translated: false, language: null },
  autoReloadSeconds: null,
  audible: false,
  muted: false,
  canGoBack: false,
  canGoForward: false,
  agentObserved: false,
  agentReadAt: null,
  agentEpisode: null,
  agentRules: 0,
  ...fields,
});

let window;
let state = {
  tabs: [tab('a'), tab('b', { title: 'Midnight City', audible: true })],
  listOrder: ['a', 'b'],
  developer: false,
  activeTabId: 'a',
  selectedTabIds: [],
  pageFullScreen: false,
  windowFullScreen: false,
  addressPlaceholder: 'Search',
  panelCollapsed: false,
  panelSide: 'left',
  pinnedDisplay: 'always',
  sidebarVisible: true,
  sidebarWidgets: ['media', 'clock', 'focus', 'closed-tabs', 'downloads'],
  closedTabs: [{ id: 'closed-1', title: 'Closed page', url: 'https://closed.example/', faviconUrl: null }],
  toolbarVisible: true,
  toolbarTabs: true,
  toolbarButtons: ['settings'],
  material: 'opaque',
  device: null,
  zoom: 1,
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
};
const actions = [];
const push = (patch) => {
  state = { ...state, ...patch };
  window.webContents.send(IpcChannel.state, JSON.stringify(state));
};
const widgetIds = () =>
  window.webContents.executeJavaScript(
    "[...document.querySelectorAll('.widgets .widget')].map((node) => node.classList[1].slice('widget-'.length))",
  );
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function click(selector) {
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 900,
      webPreferences: { preload: path.resolve('dist/preload/preload.js'), sandbox: true, contextIsolation: true },
    });
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(message);
    });
    ipcMain.handle(IpcChannel.getState, () => state);
    ipcMain.on(IpcChannel.action, (_event, action) => {
      actions.push(action);
      if (action.type === 'set-sidebar-widgets') push({ sidebarWidgets: action.ids });
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));

    // Downloads stays hidden while nothing downloads; the rest follow the saved order.
    await eventually("document.querySelectorAll('.widgets .widget').length === 4");
    assert.deepEqual(await widgetIds(), ['media', 'clock', 'focus', 'closed-tabs']);

    await click('.widget-media .round.primary');
    assert.deepEqual(actions.at(-1), { type: 'toggle-media', id: 'b' });
    // A paused tab keeps its card until it closes.
    push({ tabs: [tab('a'), tab('b', { title: 'Midnight City' })] });
    await eventually("document.querySelector('.widget-media .round.primary')?.getAttribute('aria-label') === 'Play'");
    push({ tabs: [tab('a')], listOrder: ['a'] });
    await eventually("!document.querySelector('.widget-media')");

    await click('.widget-closed-tabs .closed button');
    assert.deepEqual(actions.at(-1), { type: 'reopen-closed-tab', id: 'closed-1' });

    await click('.widget-focus .round.primary');
    await eventually(
      "document.querySelector('.widget-focus .round.primary').getAttribute('aria-label') === 'Pause focus'",
    );

    // Dropping the focus timer on the top half of the clock moves it above the clock.
    await window.webContents.executeJavaScript(`(() => {
      const data = new DataTransfer();
      const source = document.querySelector('.widget-focus');
      const target = document.querySelector('.widget-clock');
      const rect = target.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.x + 10, clientY: rect.y + 4 };
      source.dispatchEvent(new DragEvent('dragstart', at));
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
      source.dispatchEvent(new DragEvent('dragend', at));
    })()`);
    assert.deepEqual(actions.at(-1), {
      type: 'set-sidebar-widgets',
      ids: ['media', 'focus', 'clock', 'closed-tabs', 'downloads'],
    });
    await eventually("document.querySelector('.widgets .widget').classList.contains('widget-focus')");

    push({ downloads: { active: 1, progress: 0.4, started: 1 } });
    await eventually("!!document.querySelector('.widget-downloads')");

    // The narrow sidebar has no room for widgets.
    push({ panelCollapsed: true });
    await eventually("!document.querySelector('.widgets')");

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
