import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-tab-modes-')));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

// The same page for every path; the request is never written back into it.
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>Tab modes test</title><p>Tab modes</p>');
});

let tabManager;
async function eventually(predicate, label, state = () => '') {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${label} ${state()}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let sessions;
const ended = { private: 0, developer: 0 };
let modesOn = true;
const agentAsks = [];

function manager(window, options = {}) {
  return new tabs.TabManager({
    window,
    session: sessions.daily,
    privateSession: sessions.private,
    developerSession: sessions.developer,
    closed: [],
    isBookmarked: () => false,
    hasCertificateException: () => false,
    agentScope: (tab) => {
      agentAsks.push(tab);
      return false;
    },
    tabModes: () => modesOn,
    upgradeHttp: () => null,
    onChange() {},
    onHtmlFullScreenChange() {},
    onPrivateEnded: () => ended.private++,
    onDeveloperEnded: () => ended.developer++,
    freezeBackground: () => false,
    onVisit: () => null,
    onVisitTitle() {},
    onVisitFavicon() {},
    zoomFor: () => 1,
    translation: () => ({ enabled: false, language: 'en' }),
    confirmUnload: () => true,
    ...options,
  });
}

app
  .whenReady()
  .then(async () => {
    sessions = {
      daily: session.fromPartition('tab-modes-daily'),
      private: session.fromPartition('tab-modes-private'),
      developer: session.fromPartition('tab-modes-developer'),
    };
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const page = `http://127.0.0.1:${server.address().port}/work`;
    const window = new BaseWindow({ show: false });
    tabManager = manager(window);
    const contentsOf = (id) => tabManager.find(id).view.webContents;
    // The first load once timed out on CI only (about 70 ms locally), so a timeout reports where the tab stopped.
    const loadState = (id) => {
      try {
        const contents = tabManager.find(id)?.view?.webContents;
        const live = contents && !contents.isDestroyed();
        const { url, loading } = tabManager.snapshotFor(id) ?? {};
        return JSON.stringify({
          url,
          loading,
          hasView: Boolean(contents),
          destroyed: contents?.isDestroyed(),
          contentsUrl: live ? contents.getURL() : undefined,
          contentsLoading: live ? contents.isLoading() : undefined,
          crashed: live ? contents.isCrashed() : undefined,
        });
      } catch (error) {
        return `(state unavailable: ${error.message})`;
      }
    };
    const loaded = (id) =>
      eventually(
        () => tabManager.snapshotFor(id)?.url === page && !tabManager.snapshotFor(id).loading,
        page,
        () => loadState(id),
      );

    const mail = tabManager.open(page);
    await loaded(mail);
    const work = tabManager.open(page);
    await loaded(work);
    assert.equal(tabManager.canSwitchMode, true);
    assert.equal(contentsOf(work).session, sessions.daily);

    // Switching to developer reloads the same page in the developer session, with DevTools open.
    assert.equal(await tabManager.setMode(work, 'developer'), true);
    await loaded(work);
    assert.equal(contentsOf(work).session, sessions.developer);
    assert.deepEqual(
      { isPrivate: tabManager.snapshotFor(work).isPrivate, developer: tabManager.snapshotFor(work).developer },
      { isPrivate: true, developer: true },
    );
    await eventually(() => tabManager.find(work).devToolsShown, 'DevTools open in the developer tab');
    assert.equal(tabManager.activeMode, 'developer');

    // A new tab from the plus button takes the mode of the tab in front.
    const extra = tabManager.openInActiveMode(page);
    await loaded(extra);
    assert.equal(contentsOf(extra).session, sessions.developer);
    assert.equal(tabManager.snapshotFor(extra).developer, true);
    tabManager.close(extra);
    await eventually(() => !tabManager.snapshotFor(extra), 'the extra tab closed');

    // Going back to another tab gives its own mode back.
    tabManager.activate(mail);
    assert.equal(tabManager.activeMode, 'normal');
    tabManager.activate(work);
    assert.equal(tabManager.activeMode, 'developer');

    // Leaving developer mode for private forgets the developer session once no developer tab is left.
    assert.equal(await tabManager.setMode(work, 'private'), true);
    await loaded(work);
    assert.equal(contentsOf(work).session, sessions.private);
    assert.equal(tabManager.snapshotFor(work).developer, false);
    assert.equal(ended.developer, 1);
    assert.equal(tabManager.hasPrivateTabs, true);
    assert.equal(tabManager.hasDeveloperTabs, false);

    // And back to normal: the daily session, and the private data is forgotten.
    assert.equal(await tabManager.setMode(work, 'normal'), true);
    await loaded(work);
    assert.equal(contentsOf(work).session, sessions.daily);
    assert.equal(ended.private, 1);
    assert.equal(await tabManager.setMode(work, 'normal'), false);

    // Pages a developer tab opens from its menu or a peek keep developer mode, and the agent bridge sees them.
    assert.equal(await tabManager.setMode(work, 'developer'), true);
    await loaded(work);
    assert.equal(tabManager.modeOfContents(contentsOf(work)), 'developer');
    assert.equal(tabManager.modeOfContents(contentsOf(mail)), 'normal');
    assert.equal(agentAsks.filter((tab) => tab.url === page).at(-1).isPrivate, false);
    const peeked = tabManager.createPageView(true, true);
    assert.equal(peeked.webContents.session, sessions.developer);
    await peeked.webContents.loadURL(page);
    tabManager.adoptView(peeked, {
      url: page,
      title: 'Peek',
      isPrivate: true,
      developer: true,
      interacted: false,
      edited: false,
    });
    const kept = tabManager.activeId;
    assert.equal(tabManager.snapshotFor(kept).developer, true);
    await eventually(() => tabManager.find(kept).devToolsShown, 'DevTools in a kept developer peek');
    tabManager.close(kept);
    await eventually(() => !tabManager.snapshotFor(kept), 'the kept tab closed');
    assert.equal(await tabManager.setMode(work, 'normal'), true);
    await loaded(work);

    // A pinned tab keeps its mode; the page opens in a new tab of the chosen mode instead.
    tabManager.togglePin(mail);
    tabManager.activate(mail);
    const count = tabManager.tabs.length;
    assert.equal(await tabManager.setMode(mail, 'private'), true);
    await eventually(() => tabManager.tabs.length === count + 1, 'a private copy of the pinned tab');
    assert.equal(tabManager.snapshotFor(mail).isPrivate, false);
    assert.equal(tabManager.snapshotFor(tabManager.activeId).isPrivate, true);

    // With the setting off nothing switches, and the plus button opens a normal tab as before.
    modesOn = false;
    assert.equal(tabManager.canSwitchMode, false);
    assert.equal(await tabManager.setMode(work, 'private'), false);
    const privateFront = tabManager.activeId;
    assert.equal(tabManager.snapshotFor(privateFront).isPrivate, true);
    const plain = tabManager.openInActiveMode(page);
    assert.equal(tabManager.snapshotFor(plain).isPrivate, false);
    modesOn = true;

    // Private windows keep every tab private.
    const privateWindow = new BaseWindow({ show: false });
    const privateTabs = manager(privateWindow, { privateWindow: true });
    const only = privateTabs.open(page);
    assert.equal(privateTabs.canSwitchMode, false);
    assert.equal(await privateTabs.setMode(only, 'normal'), false);
    privateTabs.destroyAll();

    console.log(
      'PASS: tabs switch between normal, developer and private in place, each in its own session, with DevTools in developer mode, new tabs, menu links and peeks keeping the mode, pinned tabs kept and the setting turning it off',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  tabManager?.destroyAll();
  server.close();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
