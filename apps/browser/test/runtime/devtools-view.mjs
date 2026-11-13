import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import tabs from '../../dist/main/tabs/tabs.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-devtools-view-')));
app.setPath('userData', path.join(profile, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

// The same page for every path; the request is never written back into it.
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>DevTools view test</title><p id="hello">DevTools</p>');
});

let tabManager;
async function eventually(predicate, label) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const page = `http://127.0.0.1:${server.address().port}/`;
    const window = new BaseWindow({ show: false, width: 1200, height: 800 });
    tabManager = new tabs.TabManager({
      window,
      session: session.fromPartition('devtools-view'),
      privateSession: session.fromPartition('private-devtools-view'),
      closed: [],
      isBookmarked: () => false,
      hasCertificateException: () => false,
      agentScope: () => false,
      upgradeHttp: () => null,
      onChange() {},
      onHtmlFullScreenChange() {},
      onPrivateEnded() {},
      freezeBackground: () => false,
      onVisit: () => null,
      onVisitTitle() {},
      onVisitFavicon() {},
      zoomFor: () => 1,
      translation: () => ({ enabled: false, language: 'en' }),
      confirmUnload: () => true,
    });
    tabManager.setPageLayout({ x: 100, y: 50, width: 1000, height: 700 }, 0);
    tabManager.setPageRadius(12);
    const children = () => window.contentView.children;
    const loaded = (id) =>
      eventually(() => tabManager.snapshotFor(id)?.url === page && !tabManager.snapshotFor(id).loading, page);

    const other = tabManager.open(page);
    await loaded(other);
    const inspected = tabManager.open(page);
    await loaded(inspected);
    const tab = tabManager.find(inspected);
    assert.deepEqual(tab.view.getBounds(), { x: 100, y: 50, width: 1000, height: 700 });

    // DevTools opens in its own view right of the page, the split gap away, instead of inside the page's view.
    tabManager.toggleDevTools();
    assert.equal(tab.devToolsShown, true);
    // Memory saving leaves a tab with DevTools open alone.
    assert.equal(tabManager.discardCandidates().find((item) => item.id === inspected).devToolsOpen, true);
    const tools = tab.devTools;
    assert.ok(children().includes(tools));
    assert.deepEqual(tools.getBounds(), { x: 700, y: 50, width: 400, height: 700 });
    assert.deepEqual(tab.view.getBounds(), { x: 100, y: 50, width: 594, height: 700 });
    assert.deepEqual(tabManager.state().devToolsDivider, { x: 694, y: 50, width: 6, height: 700, value: 40 });
    await eventually(() => tools.webContents.getURL().startsWith('devtools://'), 'the DevTools frontend in its view');

    // Dragging the gap resizes DevTools and the page together.
    // x is where the pointer is, the middle of the gap.
    tabManager.resizeDevTools(797);
    assert.deepEqual(tools.getBounds(), { x: 800, y: 50, width: 300, height: 700 });
    assert.equal(tab.view.getBounds().width, 694);

    // Another tab hides this tab's DevTools; coming back shows it again.
    tabManager.activate(other);
    assert.equal(children().includes(tools), false);
    assert.equal(tabManager.state().devToolsDivider, null);
    tabManager.activate(inspected);
    assert.ok(children().includes(tools));

    // Closing gives the page its full area back, and Inspect opens DevTools again in the same view.
    tabManager.toggleDevTools();
    assert.equal(tab.devToolsShown, false);
    assert.equal(children().includes(tools), false);
    assert.deepEqual(tab.view.getBounds(), { x: 100, y: 50, width: 1000, height: 700 });
    tabManager.inspect(tab.view.webContents, 10, 10);
    assert.equal(tab.devToolsShown, true);
    assert.equal(tab.devTools, tools);
    assert.equal(window.contentView.children.length, children().length);

    // When the DevTools page closes or crashes by itself, the tab lets it go and gets its full area back.
    tools.webContents.close();
    await eventually(() => !tab.devToolsShown && tab.devTools === null, 'DevTools forgotten once its page closed');
    assert.equal(children().includes(tools), false);
    assert.deepEqual(tab.view.getBounds(), { x: 100, y: 50, width: 1000, height: 700 });
    assert.equal(tabManager.state().devToolsDivider, null);
    tabManager.toggleDevTools();
    const fresh = tab.devTools;
    assert.notEqual(fresh, tools);
    await eventually(() => fresh.webContents.getURL().startsWith('devtools://'), 'a new DevTools page');
    fresh.webContents.forcefullyCrashRenderer();
    await eventually(() => !tab.devToolsShown && tab.devTools === null, 'DevTools forgotten once its page crashed');
    assert.deepEqual(tab.view.getBounds(), { x: 100, y: 50, width: 1000, height: 700 });
    tabManager.toggleDevTools();
    const last = tab.devTools;

    // Closing the tab closes its DevTools too.
    tabManager.close(inspected);
    // A closed view drops its contents altogether.
    await eventually(
      () => !last.webContents || last.webContents.isDestroyed(),
      'the DevTools view closed with its tab',
    );
    console.log(
      'PASS: DevTools opens in its own rounded view beside the page, resizes from the gap, follows its tab, resets when its page closes or crashes and closes with the tab',
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(() => {
  clearTimeout(deadline);
  tabManager?.destroyAll();
  server.close();
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
