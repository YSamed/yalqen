import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, WebContentsView, session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import adblock from '../../dist/main/privacy/adblock.js';
import lists from '../../dist/main/privacy/threat-lists.js';
import guards from '../../dist/main/privacy/threat-guard.js';
import tabs from '../../dist/main/tabs/tabs.js';
import downloads from '../../dist/main/library/download-manager.js';
import internalPages from '../../dist/main/pages/internal-pages.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-threat-test-'));
app.setPath('userData', profile);
internalPages.registerInternalScheme();
let badOrigin;
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: `${badOrigin}/redirected` });
    response.end();
  } else if (request.url === '/ad.js') response.end('/* harmless ad fixture */');
  else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<p>Harmless page fixture</p>');
  }
});
let blocker;
let manager;
let downloadManager;
let window;
let contents;
const deadline = setTimeout(() => app.exit(1), 35_000);
async function eventually(predicate) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > 5000) throw new Error('Timed out waiting for threat protection');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    badOrigin = `http://127.0.0.1:${port}`;
    const goodOrigin = `http://localhost:${port}`;
    const browsing = session.fromPartition('threat-test');
    const privateBrowsing = session.fromPartition('threat-private-test');
    const developer = session.fromPartition('threat-developer-test');
    const payload = 'Harmless download fixture used to verify a local hash match';
    fs.mkdirSync(path.join(profile, 'threat-lists'));
    fs.writeFileSync(path.join(profile, 'threat-lists/domains.txt'), '127.0.0.1\n');
    fs.writeFileSync(
      path.join(profile, 'threat-lists/hashes.txt'),
      `${createHash('sha256').update(payload).digest('hex')};fixture\n`,
    );
    const service = new lists.LocalThreatLists(profile, () => true);
    const guard = new guards.ThreatGuard(service);
    const filters = path.join(profile, 'filters.bin');
    fs.writeFileSync(filters, ElectronBlocker.parse('/ad.js').serialize());
    blocker = new adblock.AdBlocker(
      [browsing, privateBrowsing, developer],
      filters,
      () => false,
      (details) => guard.blocked(details),
    );
    blocker.setEnabled(true);
    await blocker.whenReady();
    window = new BaseWindow({ show: false });
    const view = new WebContentsView({ webPreferences: { session: browsing } });
    window.contentView.addChildView(view);
    contents = view.webContents;
    manager = new tabs.TabManager({
      window,
      closed: [],
      pageTheme: '',
      threatGuard: guard,
      freezeBackground: () => false,
      onChange() {},
      onHtmlFullScreenChange() {},
      onPrivateEnded() {},
      agentScope: () => false,
      translation: () => ({ enabled: false, language: 'en' }),
      upgradeHttp: () => null,
      zoomFor: () => 1,
      onVisit: () => null,
      onVisitTitle() {},
      onVisitFavicon() {},
    });
    const tab = manager.createRecord({ id: 'page', url: goodOrigin });
    tab.view = view;
    manager.tabs.push(tab);
    manager.activeId = tab.id;
    manager.attachListeners(tab, view);
    const rejected = await contents.loadURL(`${badOrigin}/blocked`).then(
      () => null,
      (error) => error,
    );
    assert.equal(rejected.errno, -20);
    await eventually(() => contents.executeJavaScript("!!document.getElementById('proceed')"));
    assert.ok(guard.warning(contents, `${badOrigin}/blocked`));
    assert.equal(requests.includes('/blocked'), false, 'blocked page never reaches the server');
    await contents.executeJavaScript("document.getElementById('proceed').click()");
    await eventually(() => contents.executeJavaScript("document.body.textContent.includes('Harmless page')"));
    assert.equal(requests.includes('/blocked'), true);
    assert.equal(
      await contents.executeJavaScript("fetch('/ad.js').then(() => true, () => false)"),
      false,
      'ad blocking still works',
    );
    blocker.setEnabled(false);
    assert.equal(await contents.executeJavaScript("fetch('/ad.js').then(() => true, () => false)"), true);
    await contents.loadURL(`${goodOrigin}/redirect`).catch(() => {});
    await eventually(() => contents.executeJavaScript("!!document.getElementById('proceed')"));
    assert.equal(requests.includes('/redirected'), false, 'redirects remain blocked with ad blocking off');
    assert.ok(guard.warning(contents, `${badOrigin}/redirected`));
    for (const isolated of [privateBrowsing, developer]) {
      const other = new WebContentsView({ webPreferences: { session: isolated } });
      window.contentView.addChildView(other);
      await assert.rejects(other.webContents.loadURL(`${badOrigin}/other-profile`));
      assert.equal(requests.includes('/other-profile'), false, 'consent is not shared with another session');
      other.webContents.close();
      window.contentView.removeChildView(other);
    }

    const entries = new Map();
    const warnings = [];
    downloadManager = new downloads.DownloadManager(
      {
        store: {
          add: (entry) => entries.set(entry.id, entry),
          get: (id) => entries.get(id),
          update: (id, patch) => Object.assign(entries.get(id), patch),
        },
        daily: browsing,
        privateBrowsing,
        developer,
        directory: () => profile,
        askBeforeDownload: () => false,
        askDownloadLocation: () => false,
        parentOf: () => window,
        onStateChange() {},
        checkFile: (file) => service.checkFile(file),
      },
      {
        showMessageBox: async (options) => {
          warnings.push(options);
          return { response: 0 };
        },
        showSaveDialog: async () => {
          throw new Error('unexpected chooser');
        },
      },
    );
    browsing.downloadURL(`data:application/octet-stream,${encodeURIComponent(payload)}`);
    await eventually(() => [...entries.values()].some((entry) => entry.state === 'blocked'));
    const entry = [...entries.values()][0];
    assert.equal(fs.readFileSync(entry.savePath, 'utf8'), payload);
    assert.equal(warnings.length, 1);
    downloadManager.actions(() => {}).open(entry.id);
    assert.equal(entry.state, 'blocked');
    console.log(
      'PASS: real requests/redirects blocked before connection, native error-page consent scoped to a tab, ad blocking coexistence, private/developer isolation and downloaded file hash blocking',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  manager?.destroyAll();
  downloadManager?.destroy();
  blocker?.destroy();
  window?.destroy();
  server.close();
});
app.on('quit', () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(error);
  }
});
