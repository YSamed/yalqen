import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from './cleanup-tasks.mjs';
import { windowAppearance } from './window-appearance.mjs';
import types from '../../dist/shared/types.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const { IpcChannel } = types;
const { EMPTY_AGENT_SESSION, EMPTY_AGENT_CHAT, EMPTY_PROJECT_RUN } = agentPanel;

export function tab(id, extra = {}) {
  return {
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
    overrides: {
      cacheDisabled: false,
      network: null,
      colorScheme: null,
      reducedMotion: false,
      printMedia: false,
      userAgent: null,
      requestRules: false,
    },
    translation: { status: 'idle', available: false },
    autoReloadSeconds: null,
    audible: false,
    muted: false,
    canGoBack: false,
    canGoForward: false,
    agentObserved: false,
    agentReadAt: null,
    agentEpisode: null,
    agentRules: 0,
    ...extra,
  };
}

export function browserState(tabs, extra = {}) {
  return {
    tabs,
    listOrder: tabs.map((entry) => entry.id),
    developer: false,
    activeTabId: tabs[0]?.id ?? null,
    selectedTabIds: [],
    splitTabIds: [],
    pageFullScreen: false,
    windowFullScreen: false,
    panelCollapsed: false,
    favorites: [],
    spaces: [{ id: '', name: 'Default', icon: null }],
    activeSpaceId: '',
    sidebarVisible: true,
    media: null,
    toolbarButtons: ['settings'],
    sidebarFooterItems: ['history'],
    ...windowAppearance,
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
    ...extra,
  };
}

// Opens the production window interface in a hidden window and drives it with real input events.
// `invoke` answers renderer requests by channel name; every call and every UI action is recorded.
export async function openInterface(name, { state, invoke = {}, width = 1100, height = 760 }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `yalqen-${name}-`));
  app.setPath('userData', profile);
  const deadline = setTimeout(() => app.exit(1), 40_000);
  let window;
  registerBeforeQuit(() => {
    clearTimeout(deadline);
    window?.destroy();
  });
  registerWillQuit(() => removeDirectory(profile));
  await app.whenReady();

  const actions = [];
  const calls = [];
  ipcMain.handle(IpcChannel.getState, () => state);
  ipcMain.on(IpcChannel.action, (_event, action) => actions.push(action));
  ipcMain.on(IpcChannel.agentDraftUpdate, (_event, ...args) => calls.push({ channel: 'agentDraftUpdate', args }));
  for (const [channel, answer] of Object.entries(invoke))
    ipcMain.handle(IpcChannel[channel], (_event, ...args) => {
      calls.push({ channel, args });
      return answer(...args);
    });

  window = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: { preload: path.resolve('dist/preload/preload.js'), sandbox: true, contextIsolation: true },
  });
  window.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') console.error(message);
  });
  await window.loadFile(path.resolve('dist/renderer/index.html'));
  window.webContents.focus();

  const run = (script) => window.webContents.executeJavaScript(script);
  const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
  async function eventually(predicate, label = predicate) {
    const start = Date.now();
    while (!(await run(predicate))) {
      if (Date.now() - start > 5000) throw new Error(`Timed out: ${label}`);
      await settle(30);
    }
  }
  async function center(selector) {
    await eventually(`!!document.querySelector(${JSON.stringify(selector)})`, selector);
    return run(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    })()`);
  }
  const mouse = (type, { x, y }, held = type === 'mouseMove') =>
    window.webContents.sendInputEvent({
      type,
      button: 'left',
      clickCount: 1,
      modifiers: held ? ['leftButtonDown'] : [],
      x,
      y,
    });
  async function click(selector) {
    const point = await center(selector);
    mouse('mouseDown', point, false);
    mouse('mouseUp', point, false);
    await settle();
  }
  async function drag(from, path, { release = true } = {}) {
    mouse('mouseDown', from, false);
    for (const point of path) {
      mouse('mouseMove', point);
      await settle();
    }
    if (release) mouse('mouseUp', path.at(-1), false);
    await settle();
  }
  async function key(keyCode, modifiers = []) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  }
  async function type(text) {
    await window.webContents.insertText(text);
    await settle();
  }
  const push = (next) => {
    state = next;
    window.webContents.send(IpcChannel.state, JSON.stringify(state));
  };

  return { window, actions, calls, run, settle, eventually, center, mouse, click, drag, key, type, push };
}

export function finish(test) {
  test.then(
    () => app.quit(),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
}
