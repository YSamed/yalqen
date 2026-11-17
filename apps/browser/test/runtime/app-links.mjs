import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import tabs from '../../dist/main/tabs/tabs.js';
import handlers from '../../dist/main/privacy/permission-handlers.js';
import appLinks from '../../dist/main/privacy/app-links.js';
import permissions from '../../dist/main/privacy/permissions.js';
import i18n from '../../dist/shared/i18n.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-app-links-')));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

const server = http.createServer((req, res) => {
  if (req.url === '/authorize') {
    res.writeHead(302, { Location: 'x-yalqen-test://callback?code=redirected' });
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>Sign in</title><a id="open" href="x-yalqen-test://callback?code=clicked">Open the app</a>');
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
    const browsing = session.fromPartition('app-links');
    const store = new permissions.PermissionStore(null);
    const prompts = [];
    const links = new appLinks.AppLinks({
      storeFor: () => store,
      appFor: (url) => (url.startsWith('x-yalqen-test:') ? 'Test App.app' : ''),
      confirm: async (prompt) => {
        prompts.push(prompt);
        return { open: false, always: false };
      },
    });
    handlers.installPermissionHandlers({
      sessions: [[browsing, false]],
      storeFor: () => store,
      parentOf: () => undefined,
      blockedRequests: () => [],
      appLinks: links,
    });
    const opened = [];
    tabManager = new tabs.TabManager({
      window: new BaseWindow({ show: false }),
      session: browsing,
      privateSession: session.fromPartition('private-app-links'),
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
      popupsAllowed: () => true,
      onAppLink: (contents, url, isPrivate) => {
        opened.push({ url, isPrivate });
        void links.ask(contents, url, contents.getURL(), isPrivate);
      },
    });
    const id = tabManager.open(`${base}/signin`);
    await eventually(() => tabManager.snapshotFor(id)?.loading === false, 'the sign-in page');
    const contents = tabManager.find(id).view.webContents;

    await contents.executeJavaScript(`document.getElementById('open').click()`, true);
    await eventually(() => prompts.length === 1, 'the prompt for a clicked app link');
    assert.deepEqual(prompts[0], { app: 'Test App', host: `127.0.0.1:${server.address().port}` });

    contents.loadURL(`${base}/authorize`).catch(() => {});
    await eventually(() => prompts.length === 2, 'the prompt for a redirect to the app');

    const count = tabManager.tabs.length;
    await contents.executeJavaScript(`window.open('x-yalqen-test://callback?code=popup')`, true);
    await eventually(() => prompts.length === 3, 'the prompt for window.open of an app link');
    assert.deepEqual(opened, [{ url: 'x-yalqen-test://callback?code=popup', isPrivate: false }]);
    assert.equal(tabManager.tabs.length, count);

    await contents.executeJavaScript(`location.href = 'x-yalqen-nothing://x'`, true);
    if (process.platform === 'linux') {
      await eventually(() => prompts.length === 4, 'the Linux fallback prompt for an unnamed app');
      assert.equal(prompts[3].app, i18n.t('appLinks.anApp'));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(prompts.length, 3);
    }

    console.log(
      'PASS: app links from sign-in pages (click, redirect, window.open) ask to open the app instead of failing silently',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
registerBeforeQuit(() => {
  clearTimeout(deadline);
  tabManager?.destroyAll();
  server.close();
});
registerWillQuit(() => removeDirectory(root));
