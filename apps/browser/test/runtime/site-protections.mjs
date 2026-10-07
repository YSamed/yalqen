// Real Chromium requests and cosmetic injection, using a disposable profile and local HTTP server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import adblock from '../../dist/main/privacy/adblock.js';
import protections from '../../dist/main/privacy/site-protections.js';
import settings from '../../dist/main/app/settings.js';
import cookies from '../../dist/main/privacy/third-party-cookies.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-site-test-'));
app.setPath('userData', profile);
const server = http.createServer((request, response) => {
  if (request.url === '/cookies') {
    response.setHeader('Access-Control-Allow-Origin', pageOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.end(request.headers.cookie ?? '');
  } else if (request.url === '/ad.js') {
    response.end('ad resource');
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div class="advertisement">Advertisement</div>');
  }
});
let pageOrigin;
let blocker;
const windows = [];
const deadline = setTimeout(() => app.exit(1), 35_000);

async function eventually(contents, predicate) {
  const start = Date.now();
  while (!(await contents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw new Error(`Timed out: ${predicate}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    pageOrigin = `http://127.0.0.1:${port}`;
    const tracker = `http://localhost:${port}`;
    const normal = session.fromPartition('site-test');
    const privateSession = session.fromPartition('private-site-test');
    const store = new settings.SettingsStore(profile);
    const policy = new protections.SiteProtections(
      () => store.get(),
      (patch) => store.update(patch),
    );
    const cache = path.join(profile, 'filters.bin');
    fs.writeFileSync(
      cache,
      ElectronBlocker.parse('/ad.js\n127.0.0.1##.advertisement', {
        loadCosmeticFilters: true,
        enableMutationObserver: true,
      }).serialize(),
    );
    blocker = new adblock.AdBlocker([normal, privateSession], cache, (browsing, url) =>
      policy.isAllowed('adBlocking', url, browsing === privateSession),
    );
    blocker.setEnabled(true);
    await blocker.whenReady();
    const open = async (browsing) => {
      const window = new BrowserWindow({ show: false, webPreferences: { session: browsing } });
      windows.push(window);
      await window.loadURL(`${pageOrigin}/page`);
      return window.webContents;
    };
    const page = await open(normal);
    const privatePage = await open(privateSession);
    const fetchAd = (contents) => contents.executeJavaScript("fetch('/ad.js').then(() => true, () => false)");
    const hidden = "getComputedStyle(document.querySelector('.advertisement')).display === 'none'";
    assert.equal(await fetchAd(page), false);
    await eventually(page, hidden);
    policy.setAllowed('adBlocking', pageOrigin, false, true);
    const reloaded = new Promise((resolve) => page.once('did-finish-load', resolve));
    page.reload();
    await reloaded;
    assert.equal(await fetchAd(page), true);
    assert.equal(await page.executeJavaScript(hidden), false);
    policy.setAllowed('adBlocking', pageOrigin, true, false);
    assert.equal(await fetchAd(privatePage), false);
    policy.clearPrivate();
    assert.equal(await fetchAd(privatePage), true);
    policy.setAllowed('adBlocking', pageOrigin, false, false);
    assert.equal(await fetchAd(page), false);
    console.log('PASS: real network and cosmetic filters honor origin and private overrides');

    // Secure SameSite=None cookies are valid on localhost even with an HTTP test server.
    await normal.cookies.set({ url: tracker, name: 'existing', value: '1', secure: true, sameSite: 'no_restriction' });
    cookies.setThirdPartyCookieBlocking(normal, true, (url) => policy.isAllowed('blockThirdPartyCookies', url));
    const fetchCookies = () =>
      page.executeJavaScript(
        `fetch(${JSON.stringify(tracker + '/cookies')}, { credentials: 'include' }).then(r => r.text())`,
      );
    assert.equal(await fetchCookies(), '');
    policy.setAllowed('blockThirdPartyCookies', pageOrigin, false, true);
    assert.equal(await fetchCookies(), 'existing=1');
    policy.setAllowed('blockThirdPartyCookies', pageOrigin, false, false);
    assert.equal(await fetchCookies(), '');
    console.log('PASS: real third-party Cookie headers are blocked, allowed, then blocked again');
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  blocker?.destroy();
  for (const window of windows) window.destroy();
  server.close();
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
