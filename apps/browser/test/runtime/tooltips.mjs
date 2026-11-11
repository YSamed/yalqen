import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import types from '../../dist/shared/types.js';
import overlay from '../../dist/main/window/tooltip-overlay.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tooltips-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
const { IpcChannel } = types;
const { TooltipOverlay } = overlay;
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
  favorites: [],
  spaces: [],
  activeSpaceId: '',
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
      width: 900,
      height: 700,
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
    const run = (script) => window.webContents.executeJavaScript(script);
    const hover = (selector) =>
      run(
        `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`,
      );
    const leave = (selector) =>
      run(
        `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`,
      );
    const waitFor = async (type) => {
      const start = Date.now();
      while (actions.at(-1)?.type !== type) {
        if (Date.now() - start > 5000) throw new Error(`Timed out waiting for ${type}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return actions.at(-1);
    };
    const close = '.row .actions button';
    await eventually(`!!document.querySelector('${close}')`);

    // Every tab close button names its shortcut.
    assert.deepEqual(await run(`[...document.querySelectorAll('${close}')].map((button) => button.title)`), [
      'Close tab (⌘W)',
      'Close tab (⌘W)',
    ]);

    // A title with a shortcut is shown by the browser as text and key caps, never by the system.
    const toggle = '.footer button[aria-expanded]';
    const title = await run(`document.querySelector('${toggle}').title`);
    assert.equal(title, 'Collapse sidebar (⇧⌘P)');
    await hover(toggle);
    assert.equal(await run(`document.querySelector('${toggle}').hasAttribute('title')`), false);
    const shown = await waitFor('show-tooltip');
    assert.equal(shown.tooltip.text, 'Collapse sidebar');
    assert.deepEqual(shown.tooltip.keys, ['⇧', '⌘', 'P']);
    assert.ok(shown.tooltip.anchor.width > 0 && shown.tooltip.anchor.height > 0);
    assert.match(shown.tooltip.theme.accent, /\S/);
    await leave(toggle);
    await waitFor('hide-tooltip');
    assert.equal(await run(`document.querySelector('${toggle}').title`), title);

    // Pressing the button dismisses its tooltip before it appears.
    const count = actions.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await hover(toggle);
    await run(`document.querySelector('${toggle}').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(
      actions.slice(count).some((action) => action.type === 'show-tooltip'),
      false,
    );
    assert.equal(await run(`document.querySelector('${toggle}').title`), title);

    // The overlay draws the tooltip above everything, sized to its text and kept below the anchor.
    const childrenBefore = window.contentView.children.length;
    const tooltip = new TooltipOverlay(window);
    tooltip.show({ ...shown.tooltip, anchor: { x: 200, y: 20, width: 34, height: 34 } });
    const view = () => window.contentView.children.at(-1);
    const start = Date.now();
    while (view() === undefined || view().getBounds().height === 64) {
      if (Date.now() - start > 5000) throw new Error('The tooltip was never measured');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const bounds = view().getBounds();
    assert.ok(bounds.height < 64 && bounds.width < 380, JSON.stringify(bounds));
    assert.ok(bounds.y + 10 >= 20 + 34, JSON.stringify(bounds));
    assert.equal(
      await view().webContents.executeJavaScript(
        "[...document.querySelectorAll('kbd')].map((key) => key.textContent).join(' ')",
      ),
      '⇧ ⌘ P',
    );
    assert.equal(
      await view().webContents.executeJavaScript("document.getElementById('text').textContent"),
      'Collapse sidebar',
    );
    tooltip.hide();
    assert.equal(window.contentView.children.length, childrenBefore);
    tooltip.destroy();

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
