import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import tabs from '../../dist/main/tabs/tabs.js';
import handlers from '../../dist/main/privacy/permission-handlers.js';
import appLinks from '../../dist/main/privacy/app-links.js';
import permissions from '../../dist/main/privacy/permissions.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-app-links-')));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});

// A sign-in page and an authorization endpoint that sends the token back to an app with a redirect.
// The same page for every other path; the request is never written back into it.
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
    // The prompt is answered with Cancel: allowing would hand the test link to the system for real.
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

    // A link to the app asks first, naming the app and the site, instead of being refused silently.
    await contents.executeJavaScript(`document.getElementById('open').click()`, true);
    await eventually(() => prompts.length === 1, 'the prompt for a clicked app link');
    assert.deepEqual(prompts[0], { app: 'Test App', host: `127.0.0.1:${server.address().port}` });

    // So does the usual OAuth ending: the authorization endpoint redirecting to the app.
    contents.loadURL(`${base}/authorize`).catch(() => {});
    await eventually(() => prompts.length === 2, 'the prompt for a redirect to the app');

    // window.open of an app link goes to the same prompt and leaves no empty tab behind.
    const count = tabManager.tabs.length;
    await contents.executeJavaScript(`window.open('x-yalqen-test://callback?code=popup')`, true);
    await eventually(() => prompts.length === 3, 'the prompt for window.open of an app link');
    assert.deepEqual(opened, [{ url: 'x-yalqen-test://callback?code=popup', isPrivate: false }]);
    assert.equal(tabManager.tabs.length, count);

    // Links that no app opens never prompt.
    await contents.executeJavaScript(`location.href = 'x-yalqen-nothing://x'`, true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(prompts.length, 3);

    console.log(
      'PASS: app links from sign-in pages (click, redirect, window.open) ask to open the app instead of failing silently',
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
