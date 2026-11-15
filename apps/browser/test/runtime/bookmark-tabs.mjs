import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bookmark-tabs-')));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

// The same page for every path; the request is never written back into it.
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>Bookmark tabs test</title><p>Bookmark tabs</p>');
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
    const base = `http://127.0.0.1:${server.address().port}`;
    tabManager = new tabs.TabManager({
      window: new BaseWindow({ show: false }),
      session: session.fromPartition('bookmark-tabs'),
      privateSession: session.fromPartition('private-bookmark-tabs'),
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
    const mail = tabManager.open(`${base}/mail/#inbox`);
    const other = tabManager.open(`${base}/other`);
    await eventually(() => tabManager.snapshotFor(other)?.loading === false, 'the other page');
    const count = tabManager.tabs.length;

    // A bookmark for a page that is open switches to its tab, whatever follows the # in either address.
    assert.equal(tabManager.openPage(`${base}/mail`), mail);
    assert.equal(tabManager.activeId, mail);
    assert.equal(tabManager.tabs.length, count);

    // Otherwise the page opens in a new tab in front.
    const opened = tabManager.openPage(`${base}/docs`);
    assert.equal(tabManager.tabs.length, count + 1);
    assert.equal(tabManager.activeId, opened);
    await eventually(() => tabManager.snapshotFor(opened)?.url === `${base}/docs`, 'the new tab at the bookmark');

    console.log('PASS: a bookmark switches to the tab already showing its page and opens a new tab otherwise');
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
