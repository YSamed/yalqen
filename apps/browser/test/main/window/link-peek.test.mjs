import assert from 'node:assert/strict';
import { test } from 'node:test';
import popups from '../../../dist/main/tabs/popups.js';
import tabs from '../../../dist/main/tabs/tabs.js';
import contextMenu from '../../../dist/main/window/context-menu.js';
import peekWindow from '../../../dist/main/window/link-peek.js';
import i18n from '../../../dist/shared/i18n.js';
import layout from '../../../dist/shared/link-peek.js';

const { opensPeek } = popups;
const { LinkPeek } = peekWindow;
const { PEEK_HEADER, PEEK_INSET, PEEK_MAX_WIDTH, peekLayout } = layout;

function fakeView() {
  const listeners = new Map();
  let url = '';
  let destroyed = false;
  const webContents = {
    bounds: null,
    loading: undefined,
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    off: (event, listener) =>
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((item) => item !== listener),
      ),
    emit: (event, ...args) => (listeners.get(event) ?? []).forEach((listener) => listener(...args)),
    count: (event) => (listeners.get(event) ?? []).length,
    loadURL: async (next) => {
      url = next;
    },
    loadFile: () => webContents.loading ?? Promise.resolve(),
    getURL: () => url,
    getTitle: () => '',
    setWindowOpenHandler() {},
    send() {},
    focus() {},
    close: () => {
      destroyed = true;
    },
    isDestroyed: () => destroyed,
  };
  return { webContents, setBounds: (bounds) => (webContents.bounds = bounds), setBorderRadius() {} };
}

function fixture(overlayLoads = []) {
  const children = [];
  const calls = { promoted: [], closed: 0, created: [], developerViews: [] };
  const window = {
    isDestroyed: () => false,
    contentView: {
      children,
      addChildView: (view) => {
        if (children.includes(view)) children.splice(children.indexOf(view), 1);
        children.push(view);
      },
      removeChildView: (view) => {
        if (children.includes(view)) children.splice(children.indexOf(view), 1);
      },
    },
  };
  const views = { page: null, overlay: null };
  const peek = new LinkPeek({
    window,
    page: 'peek.html',
    area: () => ({ x: 10, y: 50, width: 800, height: 600 }),
    createOverlay: () => {
      views.overlay = fakeView();
      views.overlay.webContents.loading = overlayLoads.shift();
      return views.overlay;
    },
    createPageView: (isPrivate, developer = false) => {
      calls.created.push(isPrivate);
      calls.developerViews.push(developer);
      return (views.page = fakeView());
    },
    upgradeHttp: (url) => (url.startsWith('http:') ? url.replace('http:', 'https:') : null),
    onPromote: (page) => calls.promoted.push(page),
    onClosed: () => calls.closed++,
  });
  return { peek, children, calls, views };
}

const owner = (tabId, url = 'https://host.example/') => ({ tabId, url });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the card keeps its margin, its width limit and the header above the page', () => {
  const { card, body } = peekLayout(800, 600);
  assert.deepEqual(card, { x: PEEK_INSET, y: PEEK_INSET, width: 800 - 2 * PEEK_INSET, height: 600 - 2 * PEEK_INSET });
  assert.deepEqual(body, { ...card, y: card.y + PEEK_HEADER, height: card.height - PEEK_HEADER });
  const wide = peekLayout(3000, 600).card;
  assert.equal(wide.width, PEEK_MAX_WIDTH);
  assert.equal(wide.x * 2 + wide.width, 3000);
  const tiny = peekLayout(30, 40);
  assert.equal(tiny.card.width, 0);
  assert.equal(tiny.body.height, 0);
});

test('a docked card fills the whole window below its header', () => {
  const { card, body } = peekLayout(480, 680, 0);
  assert.deepEqual(card, { x: 0, y: 0, width: 480, height: 680 });
  assert.deepEqual(body, { x: 0, y: PEEK_HEADER, width: 480, height: 680 - PEEK_HEADER });
});

test('only a feature-less new window on a web address peeks', () => {
  assert.equal(opensPeek('new-window', '', 'https://example.com/'), true);
  assert.equal(opensPeek('new-window', 'width=500,height=400', 'https://example.com/'), false);
  assert.equal(opensPeek('foreground-tab', '', 'https://example.com/'), false);
  assert.equal(opensPeek('new-window', '', 'javascript:alert(1)'), false);
});

test('the link menu offers Peek Link for web addresses only', () => {
  i18n.setLocale('en');
  const flags = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false };
  const context = (linkURL) => ({
    linkURL,
    srcURL: '',
    mediaType: 'none',
    selectionText: '',
    isEditable: false,
    editFlags: flags,
    misspelledWord: '',
    dictionarySuggestions: [],
  });
  const peeked = [];
  const actions = { peekLink: (url) => peeked.push(url) };
  const find = (link) =>
    contextMenu.contextMenuTemplate(context(link), actions).find(({ label }) => label === 'Peek Link');
  find('https://example.com/').click();
  assert.deepEqual(peeked, ['https://example.com/']);
  assert.equal(find('data:text/plain,hi'), undefined);
  const without = contextMenu.contextMenuTemplate(context('https://example.com/'), {});
  assert.equal(
    without.some(({ label }) => label === 'Peek Link'),
    false,
  );
});

test('a peek opens above the page area, upgrades http and closes on Escape', async () => {
  const { peek, children, calls, views } = fixture();
  peek.open('http://example.com/', true, owner('tab-1'));
  await settle();
  assert.deepEqual(calls.created, [true]);
  assert.equal(views.page.webContents.getURL(), 'https://example.com/');
  assert.deepEqual(children, [views.overlay, views.page]);
  assert.deepEqual(views.overlay.webContents.bounds, { x: 10, y: 50, width: 800, height: 600 });
  assert.deepEqual(views.page.webContents.bounds, {
    x: 10 + PEEK_INSET,
    y: 50 + PEEK_INSET + PEEK_HEADER,
    width: 800 - 2 * PEEK_INSET,
    height: 600 - 2 * PEEK_INSET - PEEK_HEADER,
  });
  assert.equal(peek.isOpen, true);

  let prevented = false;
  views.page.webContents.emit(
    'before-input-event',
    { preventDefault: () => (prevented = true) },
    { type: 'keyDown', key: 'Escape' },
  );
  assert.equal(prevented, true);
  assert.equal(peek.isOpen, false);
  assert.deepEqual(children, []);
  assert.equal(views.page.webContents.isDestroyed(), true);
  assert.equal(calls.closed, 1);
});

test('the chrome closes it, other schemes never open and a new peek replaces the old one', async () => {
  const { peek, children, calls, views } = fixture();
  peek.open('file:///private/file', false, owner('tab-1'));
  assert.equal(peek.isOpen, false);

  peek.open('https://a.example/', false, owner('tab-1'));
  await settle();
  const first = views.page;
  peek.open('https://b.example/', false, owner('tab-1'));
  await settle();
  assert.equal(first.webContents.isDestroyed(), true);
  assert.deepEqual(children, [views.overlay, views.page]);

  peek.closeUnless(owner('tab-1'));
  assert.equal(peek.isOpen, true);
  peek.closeUnless(owner('tab-2'));
  assert.equal(peek.isOpen, false);
  assert.equal(calls.closed, 2);

  peek.open('https://c.example/', false, owner('tab-1'));
  await settle();
  views.overlay.webContents.emit('ipc-message', {}, 'yalqen-peek:action', 'close');
  assert.equal(peek.isOpen, false);
});

test('promoting hands the loaded view to a tab with its privacy and drops the peek handlers', async () => {
  const { peek, children, calls, views } = fixture();
  peek.open('https://example.com/', true, owner('tab-1'));
  await settle();
  views.page.webContents.emit('page-title-updated', {}, 'Example');
  views.page.webContents.emit('input-event', {}, { type: 'mouseDown' });
  views.page.webContents.emit('input-event', {}, { type: 'char' });
  views.overlay.webContents.emit('ipc-message', {}, 'yalqen-peek:action', 'promote');

  assert.equal(peek.isOpen, false);
  assert.equal(calls.closed, 0);
  assert.deepEqual(children, []);
  assert.equal(views.overlay.webContents.isDestroyed(), true);
  assert.equal(views.page.webContents.isDestroyed(), false);
  assert.equal(views.page.webContents.count('before-input-event'), 0);
  assert.equal(calls.promoted.length, 1);
  const { view, ...page } = calls.promoted[0];
  assert.equal(view, views.page);
  assert.deepEqual(page, {
    url: 'https://example.com/',
    title: 'Example',
    isPrivate: true,
    developer: false,
    interacted: true,
    edited: true,
  });
});

test('a peek from a developer tab browses and is kept in developer mode', async () => {
  const { peek, calls, views } = fixture();
  peek.open('https://example.com/', true, owner('tab-1'), true);
  await settle();
  assert.deepEqual(calls.created.at(-1), true);
  assert.deepEqual(calls.developerViews, [true]);
  views.overlay.webContents.emit('ipc-message', {}, 'yalqen-peek:action', 'promote');
  assert.equal(calls.promoted[0].developer, true);
});

test('an adopted peek becomes a tab that keeps its privacy and skips history when private', () => {
  const visits = [];
  const manager = new tabs.TabManager({
    window: { contentView: { removeChildView() {}, addChildView() {} } },
    freezeBackground: () => false,
    onHtmlFullScreenChange() {},
    onChange() {},
    onPrivateEnded() {},
    onVisit: (url) => visits.push(url) && 'visit',
    closed: [],
  });
  manager.tabs.push(manager.createRecord({ id: 'a', url: 'https://a.example/' }));
  manager.activeId = 'a';
  manager.mount = () => null;
  manager.activate = (id) => (manager.activeId = id);
  const view = { webContents: { isLoading: () => true } };

  manager.adoptView(view, { url: 'https://b.example/', title: 'B', isPrivate: true, interacted: true, edited: true });
  manager.adoptView(view, {
    url: 'https://c.example/',
    title: 'C',
    isPrivate: false,
    interacted: false,
    edited: false,
  });
  const byUrl = (url) => manager.tabs.find((tab) => tab.url === url);
  const [b, c] = [byUrl('https://b.example/'), byUrl('https://c.example/')];
  assert.deepEqual([b.isPrivate, c.isPrivate], [true, false]);
  assert.deepEqual([b.visitId, c.visitId], [null, 'visit']);
  assert.deepEqual(visits, ['https://c.example/']);
  assert.equal(b.openerId, 'a');
  assert.equal(b.title, 'B');
  assert.deepEqual([b.interacted, b.edited, c.interacted, c.edited], [true, true, false, false]);
});

test('a peek whose chrome fails to load never closes the peek that replaced it', async () => {
  let fail;
  const { peek } = fixture([new Promise((_resolve, reject) => (fail = reject))]);
  peek.open('https://a.example/', false, owner('tab-1'));
  peek.open('https://b.example/', false, owner('tab-1'));
  await settle();
  fail(new Error('load failed'));
  await settle();
  assert.equal(peek.isOpen, true);
});

test('links and redirects inside the peek stay on the web and follow HTTPS-Only', async () => {
  const { peek, views } = fixture();
  peek.open('https://example.com/', false, owner('tab-1'));
  await settle();
  const navigate = (event, url, extra = {}) => {
    const detail = { url, isMainFrame: true, ...extra, preventDefault: () => (detail.prevented = true) };
    views.page.webContents.emit(event, detail);
    return detail;
  };
  const insecure = navigate('will-navigate', 'http://example.com/next');
  assert.equal(insecure.prevented, true);
  assert.equal(views.page.webContents.getURL(), 'https://example.com/next');
  assert.equal(navigate('will-navigate', 'https://example.com/other').prevented, undefined);
  assert.equal(navigate('will-navigate', 'file:///private/file').prevented, true);
  assert.equal(navigate('will-redirect', 'http://example.com/').prevented, true);
  assert.equal(navigate('will-redirect', 'https://example.com/').prevented, undefined);
  assert.equal(navigate('will-redirect', 'http://example.com/', { isMainFrame: false }).prevented, undefined);
});
