import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import tabs from '../../dist/main/tabs/tabs.js';

const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-pinned-home-')));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

const server = http.createServer((req, res) => {
  const port = server.address().port;
  res.setHeader('Content-Type', 'text/html');
  res.end(`<title>Pinned home test</title>
    <a id="same" href="/inbox/1">same site</a>
    <a id="away" href="http://localhost:${port}/elsewhere">other site</a>`);
});

let stayHome = true;
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
    const port = server.address().port;
    const home = `http://127.0.0.1:${port}/home`;
    const window = new BaseWindow({ show: false });
    tabManager = new tabs.TabManager({
      window,
      session: session.fromPartition('pinned-home'),
      privateSession: session.fromPartition('private-pinned-home'),
      closed: [],
      isBookmarked: () => false,
      hasCertificateException: () => false,
      agentScope: () => false,
      upgradeHttp: () => null,
      onChange() {},
      onHtmlFullScreenChange() {},
      onPrivateEnded() {},
      freezeBackground: () => false,
      pinnedTabsStayHome: () => stayHome,
      onVisit: () => null,
      onVisitTitle() {},
      onVisitFavicon() {},
      zoomFor: () => 1,
      translation: () => ({ enabled: false, language: 'en' }),
      confirmUnload: () => true,
    });
    const urlOf = (id) => tabManager.snapshotFor(id)?.url ?? '';
    const loaded = (id, url) => eventually(() => urlOf(id) === url && !tabManager.snapshotFor(id).loading, url);
    const clicks = {
      same: "setTimeout(() => document.getElementById('same').click())",
      away: "setTimeout(() => document.getElementById('away').click())",
    };
    const click = (id, link) => tabManager.find(id).view.webContents.executeJavaScript(clicks[link]);

    const other = tabManager.open(`http://127.0.0.1:${port}/other`);
    await loaded(other, `http://127.0.0.1:${port}/other`);
    const pinned = tabManager.open(home);
    await loaded(pinned, home);
    tabManager.togglePin(pinned);
    assert.equal(tabManager.snapshotFor(pinned).pinned, true);

    await click(pinned, 'same');
    await loaded(pinned, `http://127.0.0.1:${port}/inbox/1`);
    const count = tabManager.tabs.length;

    await click(pinned, 'away');
    await eventually(() => tabManager.tabs.length === count + 1, 'a new tab for the other site');
    const away = tabManager.activeId;
    assert.notEqual(away, pinned);
    await loaded(away, `http://localhost:${port}/elsewhere`);
    assert.equal(tabManager.snapshotFor(away).pinned, false);
    assert.equal(urlOf(pinned), `http://127.0.0.1:${port}/inbox/1`);

    tabManager.close(away);
    await eventually(() => tabManager.activeId === pinned, 'back on the pinned tab');

    tabManager.navigate(`http://localhost:${port}/typed`);
    await eventually(() => tabManager.activeId !== pinned, 'a new tab for the typed address');
    await loaded(tabManager.activeId, `http://localhost:${port}/typed`);
    assert.equal(urlOf(pinned), `http://127.0.0.1:${port}/inbox/1`);
    tabManager.activate(pinned);
    tabManager.navigate(`http://127.0.0.1:${port}/inbox/2`);
    await loaded(pinned, `http://127.0.0.1:${port}/inbox/2`);
    assert.equal(tabManager.activeId, pinned);

    tabManager.activate(other);
    assert.equal(tabManager.discard(pinned), true);
    tabManager.activate(pinned);
    await loaded(pinned, home);

    stayHome = false;
    const before = tabManager.tabs.length;
    await click(pinned, 'away');
    await loaded(pinned, `http://localhost:${port}/elsewhere`);
    assert.equal(tabManager.tabs.length, before);
    tabManager.activate(other);
    assert.equal(tabManager.discard(pinned), true);
    tabManager.activate(pinned);
    await loaded(pinned, `http://localhost:${port}/elsewhere`);

    console.log(
      'PASS: pinned tabs keep their site: links and typed addresses for other sites open new tabs, reloads start at the pinned address, and the setting turns it off',
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
