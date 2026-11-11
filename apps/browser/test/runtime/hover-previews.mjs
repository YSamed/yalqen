import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import types from '../../dist/shared/types.js';
import overlay from '../../dist/main/window/hover-preview.js';
import agentPanel from '../../dist/shared/agent-panel.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-hover-previews-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
const { IpcChannel } = types;
const { HoverPreview } = overlay;
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
  tabs: [
    tab('a'),
    tab('m', { title: 'Inbox (2) - someone@gmail.com - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' }),
  ],
  listOrder: ['a', 'm'],
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
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rowOf = (title) =>
      `[...document.querySelectorAll('aside li.row')].find((row) => row.textContent.includes(${JSON.stringify(title)}))`;
    await eventually("document.querySelectorAll('aside li.row').length === 2");

    // Only a Gmail or Calendar row offers a preview.
    assert.equal(await run(`${rowOf('Inbox (2)')}.hasAttribute('data-hover-preview')`), true);
    assert.equal(await run(`${rowOf('Tab a')}.hasAttribute('data-hover-preview')`), false);

    // Hovering it asks for the preview after a short pause, anchored to the row, in the interface's colours.
    const count = actions.length;
    await run(`${rowOf('Inbox (2)')}.dispatchEvent(new PointerEvent('pointerenter'))`);
    await wait(150);
    assert.equal(
      actions.slice(count).some((action) => action.type === 'show-preview'),
      false,
    );
    const start = Date.now();
    while (!actions.slice(count).some((action) => action.type === 'show-preview')) {
      if (Date.now() - start > 3000) throw new Error('No preview was requested');
      await wait(20);
    }
    const shown = actions.findLast((action) => action.type === 'show-preview').preview;
    assert.equal(shown.tabId, 'm');
    assert.equal(shown.url, 'https://mail.google.com/mail/u/0/#inbox');
    assert.ok(shown.anchor.width > 0 && shown.anchor.height > 0);
    assert.equal(typeof shown.theme.dark, 'boolean');

    // Leaving the row lets the main process wait for the pointer to reach the preview; a plain row asks for nothing.
    await run(`${rowOf('Inbox (2)')}.dispatchEvent(new PointerEvent('pointerleave'))`);
    assert.equal(actions.at(-1).type, 'leave-preview');
    // Coming straight back asks again at once, so the open preview is kept.
    const back = actions.length;
    await run(`${rowOf('Inbox (2)')}.dispatchEvent(new PointerEvent('pointerenter'))`);
    assert.equal(actions.slice(back).at(0)?.type, 'show-preview');
    await run(`${rowOf('Inbox (2)')}.dispatchEvent(new PointerEvent('pointerleave'))`);
    // Pressing anywhere in the interface puts it away at once.
    await run(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    assert.equal(actions.at(-1).type, 'hide-preview');
    const before = actions.length;
    await run(`${rowOf('Tab a')}.dispatchEvent(new PointerEvent('pointerenter'))`);
    await wait(700);
    assert.equal(
      actions.slice(before).some((action) => action.type === 'show-preview'),
      false,
    );

    // The overlay lists the messages beside the row, inside the window.
    const chosen = [];
    const preview = new HoverPreview(window, (choice) => chosen.push(choice));
    const mail = {
      heading: '5 unread',
      items: [
        { primary: 'WeQuel', secondary: 'Ett nytt jobb', meta: '3m', live: false },
        { primary: 'Bob', secondary: 'Lunch', meta: '3h', live: false },
      ],
      message: null,
      footer: '+3 more unread',
    };
    const anchor = { x: 10, y: 120, width: 200, height: 34 };
    const placed = async () => {
      const begun = Date.now();
      while (!preview.isShowing('mail') || !view() || view().getBounds().x < 0) {
        if (Date.now() - begun > 5000) throw new Error('The preview was never placed');
        await wait(20);
      }
      await wait(100);
    };
    const view = () => window.contentView.children.at(-1);
    const card = (script) => view().webContents.executeJavaScript(script);
    preview.show(preview.begin(), 'mail', mail, anchor, shown.theme);
    await placed();
    const bounds = view().getBounds();
    assert.ok(bounds.x + 14 >= 10 + 200, JSON.stringify(bounds));
    assert.ok(bounds.x + bounds.width <= 1000, JSON.stringify(bounds));
    assert.deepEqual(
      await card(
        "[...document.querySelectorAll('.primary')].map((node) => node.textContent).concat(document.getElementById('footer').textContent)",
      ),
      ['WeQuel', 'Bob', '+3 more unread'],
    );

    // Once the pointer is on the card it stays after the tile is left, and goes once the pointer leaves it.
    await card("document.getElementById('card').dispatchEvent(new MouseEvent('mouseenter'))");
    await wait(100);
    preview.release();
    await wait(500);
    assert.equal(preview.isShowing('mail'), true);
    await card("document.getElementById('card').dispatchEvent(new MouseEvent('mouseleave'))");
    await wait(500);
    assert.equal(preview.isShowing('mail'), false);

    // Without the pointer reaching the card, leaving the tile puts it away after a moment.
    preview.show(preview.begin(), 'mail', mail, anchor, shown.theme);
    await placed();
    preview.release();
    assert.equal(preview.isShowing('mail'), true);
    await wait(500);
    assert.equal(preview.isShowing('mail'), false);

    // A click on a message reports which one, and the footer reports the tab.
    preview.show(preview.begin(), 'mail', mail, anchor, shown.theme);
    await placed();
    await card("document.querySelectorAll('.item')[1].click()");
    await wait(200);
    assert.deepEqual(chosen, [1]);
    assert.equal(preview.isShowing('mail'), false);
    preview.show(preview.begin(), 'mail', mail, anchor, shown.theme);
    await placed();
    await card("document.getElementById('footer').click()");
    await wait(200);
    assert.deepEqual(chosen, [1, 'tab']);

    // A read that finishes after the pointer left is never shown.
    const late = preview.begin();
    preview.hide();
    const children = window.contentView.children.length;
    preview.show(late, 'mail', { heading: null, items: [], message: 'late', footer: null }, anchor, shown.theme);
    await wait(300);
    assert.equal(window.contentView.children.length, children);
    preview.destroy();

    clearTimeout(deadline);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
