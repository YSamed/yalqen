import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { app, BaseWindow, session } from 'electron';
import details from '../../dist/main/privacy/certificate-details.js';
import tabs from '../../dist/main/tabs/tabs.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-certificate-runtime-'));
app.setPath('userData', root);
const windows = [];
const managers = [];
async function eventually(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error('Certificate tab load timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
let server;
const deadline = setTimeout(() => app.exit(1), 30_000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    const config = path.join(root, 'openssl.cnf');
    fs.writeFileSync(
      config,
      '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\nO=Yalqen disposable test\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',
    );
    const key = path.join(root, 'key.pem'),
      cert = path.join(root, 'cert.pem');
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', key, '-out', cert],
      { stdio: 'ignore' },
    );
    const expected = new X509Certificate(fs.readFileSync(cert));
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (_request, response) => {
      response.setHeader('Cache-Control', 'public, max-age=3600');
      response.setHeader('Content-Type', 'text/html');
      response.end('<title>Test TLS connection</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `https://127.0.0.1:${server.address().port}/`;
    app.on('certificate-error', (event, _contents, address, _error, _certificate, callback) => {
      if (new URL(address).origin === new URL(url).origin) {
        event.preventDefault();
        callback(true);
      } else callback(false);
    });
    for (const [browsing, trusted] of [
      [session.defaultSession, true],
      [session.fromPartition('private-certificate'), true],
      [session.fromPartition('invalid-certificate'), false],
    ]) {
      if (trusted) browsing.setCertificateVerifyProc((_request, callback) => callback(0));
      const window = new BaseWindow({ show: false });
      windows.push(window);
      const visited = [];
      const manager = new tabs.TabManager({
        window,
        session: browsing,
        privateSession: browsing,
        closed: [],
        privateWindow: !trusted,
        pagePreferences: () => ({}),
        isBookmarked: () => false,
        hasCertificateException: () => !trusted,
        agentScope: () => false,
        upgradeHttp: () => null,
        onChange() {},
        onHtmlFullScreenChange() {},
        onPrivateEnded() {},
        freezeBackground: () => false,
        onVisit: (address) => {
          visited.push(address);
          return null;
        },
        onVisitTitle() {},
        onVisitFavicon() {},
        zoomFor: () => 1,
        translation: () => ({ enabled: false, language: 'en' }),
      });
      managers.push(manager);
      const id = manager.open(url, { isPrivate: browsing !== session.defaultSession });
      if (browsing === session.defaultSession) manager.navigate(`${url}?queued`);
      await eventually(() => !manager.snapshotFor(id).loading && manager.activeContents()?.getURL().startsWith(url));
      const contents = manager.activeContents();
      const tracker = manager.certificateTrackers.get(contents);
      const chain = await manager.certificateChain();
      assert.equal(contents.debugger.isAttached(), false, 'temporary network observation must end after capture');
      assert.ok(contents.navigationHistory.getAllEntries().every((entry) => entry.url !== 'about:blank'));
      assert.ok(visited.every((address) => address !== 'about:blank'));
      if (browsing === session.defaultSession) assert.equal(contents.getURL(), `${url}?queued`);
      assert.deepEqual(await tracker.read(), chain, 'the viewer can reopen without another connection or debugger');
      assert.ok(chain?.length);
      assert.equal(chain[0].fingerprint, expected.fingerprint256);
      assert.equal(chain[0].serial, expected.serialNumber);
      assert.equal(chain[0].subject, expected.subject);
      assert.match(chain[0].names, /localhost/);
      const dialogs = {
        showMessageBox: async (_window, options) => {
          assert.match(options.detail, /SHA-256/);
          assert.ok(options.detail.includes(expected.fingerprint256));
          assert.equal(options.buttons.length, 2);
          return { response: 0 };
        },
      };
      await details.showCertificateDetails(window, url, chain, () => true, dialogs);
      let stalePrompts = 0;
      await details.showCertificateDetails(window, url, chain, () => false, {
        showMessageBox: async () => {
          stalePrompts++;
          return { response: 0 };
        },
      });
      assert.equal(stalePrompts, 0);
      await contents.loadURL('data:text/html,local');
      assert.equal(await manager.certificateChain(), null);
      tracker.stop();
    }
    assert.equal(details.parseCertificateChain(['not-a-certificate']), null);
    assert.equal(details.parseCertificateChain(Array(17).fill('')), null);
    assert.equal(details.parseCertificateChain([]), null);
    console.log(
      'PASS: real normal/private HTTPS certificate chains match the server fingerprint, issuer and serial; read-only details reject local/stale/malformed data',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  server?.close();
  for (const manager of managers) manager.destroyAll();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(error);
  }
});
