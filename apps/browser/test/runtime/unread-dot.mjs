import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-unread-dot-'));
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

let window;
let state = {
  tabs: [
    tab('a'),
    tab('b', {
      title: 'Inbox (3) - someone@gmail.com - Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
      unread: true,
    }),
  ],
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
  favorites: [],
  sidebarVisible: true,
  media: null,
  toolbarVisible: true,
  toolbarTabs: true,
  toolbarButtons: ['settings'],
  material: 'opaque',
  accent: '#e8590c',
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

app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      width: 1000,
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
    const dots = (scope) => run(`document.querySelectorAll(${JSON.stringify(`${scope} .unread-dot`)}).length`);

    // Only the tab whose site reports unread mail gets the dot, and its label says so.
    await eventually("document.querySelectorAll('aside .row').length === 2");
    assert.equal(await dots('aside'), 1);
    assert.match(await run("document.querySelector('aside .unread-dot').closest('.row').textContent"), /Inbox \(3\)/);
    assert.match(
      await run("document.querySelector('aside .unread-dot').closest('button').getAttribute('aria-label')"),
      /unread messages/,
    );

    // The dot uses the accent colour and sits on the favicon's top-right corner.
    const dot = await run(`(() => {
      const dot = document.querySelector('aside .unread-dot').getBoundingClientRect();
      const icon = document.querySelector('aside .unread-dot').parentElement.getBoundingClientRect();
      return {
        color: getComputedStyle(document.querySelector('aside .unread-dot')).backgroundColor,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        right: dot.right - icon.right,
        top: dot.top - icon.top,
      };
    })()`);
    assert.ok(dot.right > 0 && dot.top < 0, JSON.stringify(dot));
    assert.equal(dot.accent, '#e8590c');
    assert.equal(dot.color, 'rgb(232, 89, 12)');

    // The narrow sidebar keeps the dot on its favicon-only buttons.
    push({ panelCollapsed: true });
    await eventually("document.querySelector('aside')?.classList.contains('collapsed')");
    await eventually("document.querySelectorAll('aside .unread-dot').length === 1");

    // With tabs in the toolbar, the toolbar chip shows it.
    push({ panelCollapsed: false, sidebarVisible: false, toolbarTabs: true });
    await eventually("document.querySelectorAll('header .unread-dot').length === 1");

    // Once the mail is read the dot goes away.
    push({ tabs: state.tabs.map((entry) => ({ ...entry, unread: false })) });
    await eventually("document.querySelectorAll('.unread-dot').length === 0");

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
