import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-toolbar-buttons-'));
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

const PINNED = 'abcdefghijklmnopabcdefghijklmnop';
const GONE = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let window;
const state = {
  tabs: [tab('a'), tab('b', { title: 'Midnight City', audible: true })],
  listOrder: ['a', 'b'],
  developer: false,
  activeTabId: 'a',
  selectedTabIds: [],
  splitTabIds: [],
  pageFullScreen: false,
  windowFullScreen: false,
  addressPlaceholder: 'Search',
  panelCollapsed: false,
  panelSide: 'left',
  pinnedDisplay: 'always',
  sidebarVisible: true,
  media: null,
  toolbarVisible: true,
  toolbarTabs: true,
  toolbarButtons: ['devtools', `extension:${PINNED}`, `extension:${GONE}`, 'settings'],
  toolbarExtensions: [{ id: PINNED, title: 'Grammar Helper', icon: ICON }],
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
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 700,
      webPreferences: { preload: path.resolve('dist/preload/preload.js'), sandbox: true, contextIsolation: true },
    });
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(message);
    });
    ipcMain.handle(IpcChannel.getState, () => state);
    ipcMain.on(IpcChannel.action, (_event, action) => actions.push(action));
    await window.loadFile(path.resolve('dist/renderer/index.html'));
    const run = (script) => window.webContents.executeJavaScript(script);
    const devtools = "document.querySelector('header button[aria-label=\\'Developer tools\\']')";
    const pinned = "document.querySelector('header button[aria-label=\\'Grammar Helper\\']')";
    await eventually(`!!${devtools} && !!${pinned}`);

    // Developer tools names its shortcut and toggles them for the active tab.
    assert.equal(await run(`${devtools}.title`), 'Developer tools (⌥⌘I)');
    await run(`${devtools}.click()`);
    assert.deepEqual(actions.at(-1), { type: 'toggle-devtools' });

    // A pinned extension shows its own icon and opens its popup from where the button is.
    assert.equal(await run(`${pinned}.querySelector('img').getAttribute('src')`), ICON);
    await run(`${pinned}.click()`);
    const opened = actions.at(-1);
    assert.equal(opened.type, 'open-extension-action');
    assert.equal(opened.id, PINNED);
    assert.ok(opened.anchor.width > 0 && opened.anchor.height > 0);

    // Buttons follow the saved order, and an uninstalled extension leaves no gap.
    const order = await run(`(() => {
      const labels = ['Developer tools', 'Grammar Helper', 'Settings'];
      return [...document.querySelectorAll('header button')]
        .map((button) => button.getAttribute('aria-label'))
        .filter((label) => labels.includes(label));
    })()`);
    assert.deepEqual(order, ['Developer tools', 'Grammar Helper', 'Settings']);

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
