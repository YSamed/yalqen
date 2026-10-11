import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-media-player-'));
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
  media: null,
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
    });
    await window.loadFile(path.resolve('dist/renderer/index.html'));

    const song = {
      tabId: 'b',
      title: 'Midnight City',
      artist: 'M83',
      artwork: null,
      faviconUrl: null,
      duration: 240,
      position: 60,
      playing: true,
      updatedAt: Date.now(),
    };
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await window.webContents.executeJavaScript("!!document.querySelector('.player')"), false);

    push({ media: song });
    await eventually("document.querySelector('.player .title')?.textContent === 'Midnight City'");
    assert.equal(
      await window.webContents.executeJavaScript("document.querySelector('.player .artist .name').textContent"),
      'M83',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('.player .track').getAttribute('aria-valuenow')",
      ),
      '60',
    );

    await click('.player .play');
    assert.deepEqual(actions.at(-1), { type: 'toggle-media', id: 'b' });
    await click('.player .info');
    assert.deepEqual(actions.at(-1), { type: 'activate-tab', id: 'b' });

    // Clicking three quarters along the bar seeks to 3:00, two minutes past 1:00.
    await window.webContents.executeJavaScript(`(() => {
      const track = document.querySelector('.player .track');
      const rect = track.getBoundingClientRect();
      track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 0.75, clientY: rect.top + 2 }));
    })()`);
    const seek = actions.at(-1);
    assert.equal(seek.type, 'seek-media');
    assert.ok(Math.abs(seek.seconds - 120) <= 1, `seek by ${seek.seconds}`);

    push({ media: { ...song, playing: false, updatedAt: Date.now() } });
    await eventually("document.querySelector('.player .play')?.getAttribute('aria-label') === 'Play'");

    // Live streams have no length, so the bar goes away while the button stays.
    push({ media: { ...song, duration: null, position: null, updatedAt: Date.now() } });
    await eventually("!document.querySelector('.player .track') && !!document.querySelector('.player .play')");

    // The narrow sidebar has no room for the player.
    push({ panelCollapsed: true });
    await eventually("!document.querySelector('.player')");
    push({ panelCollapsed: false, media: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await window.webContents.executeJavaScript("!!document.querySelector('.player')"), false);

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
