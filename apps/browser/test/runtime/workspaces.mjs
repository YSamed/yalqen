import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { app, BrowserWindow, session, webContents } from 'electron';
import stores from '../../dist/main/library/workspaces.js';
import handlers from '../../dist/main/library/workspace-handlers.js';
import tabs from '../../dist/main/tabs/tabs.js';
import internal from '../../dist/main/pages/internal-pages.js';
import shared from '../../dist/shared/workspaces.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-workspace-runtime-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const windows = [],
  managers = [];
const deadline = setTimeout(() => app.exit(1), 30_000);
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<title>${request.url === '/private' ? 'Private' : 'Article'}</title><input id=draft>`);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw Error('Workspace fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://localhost:${server.address().port}`;
    const browsing = session.fromPartition('workspaces'),
      privateSession = session.fromPartition('private-workspaces');
    const create = (target) => {
      const window = new BrowserWindow({
        show: false,
        width: 1000,
        height: 800,
        webPreferences: {
          session: target,
          preload: path.resolve('dist/preload/page-preload.js'),
          sandbox: true,
          contextIsolation: true,
        },
      });
      windows.push(window);
      return window;
    };
    const createManager = () => {
      const window = create(browsing),
        noop = () => {};
      const manager = new tabs.TabManager({
        window,
        pagePreload: path.resolve('dist/preload/page-preload.js'),
        pageTheme: 'light',
        closed: [],
        privateWindow: false,
        session: browsing,
        privateSession,
        freezeBackground: () => false,
        onChange: noop,
        onPrivateEnded: noop,
        onPageSwipe: noop,
        onNewTabSearch: noop,
        onRepoPrompt: noop,
        onAnnouncement: noop,
        onFeedback: noop,
        onUpdateCard: noop,
        onHtmlFullScreenChange: noop,
        onVisit: () => null,
        onVisitTitle: noop,
        onVisitFavicon: noop,
        onHistoryDelete: noop,
        onHistoryClear: noop,
        onFindResult: noop,
        zoomFor: () => 1,
        defaultZoom: () => 1,
        hasOwnZoom: () => false,
        pagePreferences: () => ({}),
        onZoom: noop,
        hasCertificateException: () => false,
        certificateToken: () => null,
        onCertificateProceed: () => false,
        popupsAllowed: () => false,
        onPageCommand: noop,
        isBookmarked: () => false,
        upgradeHttp: () => null,
        httpsOnlyWarning: () => '',
        onProceedHttp: () => null,
        confirmHttpRedirect: async () => false,
        onContextMenu: noop,
        requestRules: () => [],
        translation: () => ({ enabled: false, language: 'en' }),
        agentScope: () => false,
        agentTracing: () => false,
        confirmUnload: () => false,
      });
      managers.push(manager);
      return manager;
    };
    const original = createManager();
    original.open(url + '/article');
    await eventually(() => original.activeContents()?.getTitle() === 'Article');
    const contents = original.activeContents(),
      originalId = original.activeTabId;
    await contents.executeJavaScript(
      "draft.value='Unsaved form secret';window.onbeforeunload=e=>{e.preventDefault();e.returnValue=''};true",
    );
    original.setSelectedGroup('Work');
    original.togglePin(originalId);
    original.open(url + '/private', { activate: false, isPrivate: true });
    const store = new stores.WorkspaceStore(root);
    let opened;
    handlers.installWorkspaceHandlers({
      store,
      owned: (contents) => windows.some((window) => window.webContents === contents),
      writable: (contents) => contents.session === browsing,
      snapshot: () => original.toSavedWindow(),
      open: (saved) => {
        opened = createManager();
        opened.restore(saved);
      },
      changed: () => {
        for (const contents of webContents.getAllWebContents())
          if (!contents.isDestroyed() && contents.getURL().startsWith(shared.WORKSPACES_URL))
            contents.send(shared.WorkspaceChannel.changed);
      },
    });
    const renderer = path.resolve('dist/renderer');
    const assets = internal.loadInternalPages({
      newTab: path.join(renderer, 'newtab.html'),
      newTabScript: path.join(renderer, 'newtab-suggestions.js'),
      history: path.join(renderer, 'history.html'),
      downloads: path.join(renderer, 'downloads.html'),
      bookmarks: path.join(renderer, 'bookmarks.html'),
      settings: path.join(renderer, 'settings.html'),
      workspaces: path.join(renderer, 'workspaces.html'),
    });
    for (const target of [browsing, privateSession]) internal.serveInternalPages(target, assets, {});
    const page = create(browsing);
    await page.loadURL(shared.WORKSPACES_URL);
    const ui = page.webContents;
    const ready = (predicate) => eventually(async () => await ui.executeJavaScript(predicate));
    await ready("!document.querySelector('[data-empty]').hidden");
    await ui.executeJavaScript(
      "document.querySelector('#save input').value='<b>Research</b>';document.querySelector('#save').requestSubmit()",
    );
    await ready("document.querySelectorAll('ol li').length===1 && !document.querySelector('ol button').disabled");
    assert.equal(await ui.executeJavaScript("document.querySelector('ol strong').textContent"), '<b>Research</b>');
    assert.equal(await ui.executeJavaScript("document.querySelectorAll('ol strong b').length"), 0);
    assert.equal(store.list()[0].count, 1);
    assert.equal(fs.readFileSync(store.file, 'utf8').includes('Unsaved form secret'), false);
    assert.equal(fs.readFileSync(store.file, 'utf8').includes('/private'), false);
    await ui.executeJavaScript(
      "document.querySelector('ol input').value='Renamed';document.querySelector('ol form').requestSubmit()",
    );
    await ready(
      "document.querySelector('ol strong').textContent==='Renamed' && !document.querySelector('[data-open]').disabled",
    );
    assert.equal(new stores.WorkspaceStore(root).list()[0].name, 'Renamed');
    await ui.executeJavaScript("document.querySelector('[data-open]').click()");
    await eventually(() => opened?.activeContents()?.getTitle() === 'Article');
    assert.notEqual(opened.activeTabId, originalId);
    assert.equal(opened.toSavedWindow().tabs[0].group, 'Work');
    assert.equal(opened.toSavedWindow().tabs[0].pinnedUrl, url + '/article');
    assert.equal(
      await contents.executeJavaScript(
        "draft.value==='Unsaved form secret' && typeof window.onbeforeunload==='function'",
      ),
      true,
    );
    assert.equal(await opened.activeContents().executeJavaScript('draft.value'), '');
    assert.equal(original.count, 2);
    const privatePage = create(privateSession);
    await privatePage.loadURL(shared.WORKSPACES_URL);
    await eventually(
      async () => await privatePage.webContents.executeJavaScript("!document.querySelector('[data-readonly]').hidden"),
    );
    const id = store.list()[0].id;
    assert.equal(
      await privatePage.webContents.executeJavaScript(`window.yalqenWorkspaces.open(${JSON.stringify(id)})`),
      false,
    );
    assert.equal(await privatePage.webContents.executeJavaScript("window.yalqenWorkspaces.save('Private')"), false);
    await ui.executeJavaScript("window.confirm=()=>false;document.querySelector('[data-remove]').click()");
    assert.equal(store.list().length, 1);
    await ui.executeJavaScript("window.confirm=()=>true;document.querySelector('[data-remove]').click()");
    await ready("document.querySelectorAll('ol li').length===0");
    assert.equal(original.count, 2);
    assert.equal(opened.count, 1);
    const attacker = path.join(root, 'attacker.cjs');
    fs.writeFileSync(
      attacker,
      "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('invoke',(name,...args)=>ipcRenderer.invoke(name,...args));",
    );
    const external = new BrowserWindow({
      show: false,
      webPreferences: { session: browsing, preload: attacker, sandbox: true, contextIsolation: true },
    });
    windows.push(external);
    await external.loadURL('data:text/html,Attacker');
    assert.equal(
      await external.webContents.executeJavaScript(
        `window.invoke(${JSON.stringify(shared.WorkspaceChannel.save)},'Attack')`,
      ),
      false,
    );
    assert.equal(
      await external.webContents.executeJavaScript(`window.invoke(${JSON.stringify(shared.WorkspaceChannel.list)})`),
      null,
    );
    console.log(
      'PASS: production workspace UI/preload/IPC saves, renames, restores real Chromium tabs/groups/pins into a new window without touching the source form, excludes private/history data, confirms deletion and rejects private/external mutations',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  server.close();
  for (const manager of managers) manager.destroyAll();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
