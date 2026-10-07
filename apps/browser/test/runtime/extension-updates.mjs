import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, session } from 'electron';
import extensions from '../../dist/main/extensions/extensions.js';
import { storeIdentity, extensionPackage } from '../helpers/extension-package.mjs';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-runtime-'));
app.setPath('userData', profile);
const deadline = setTimeout(() => app.exit(1), 30_000);
let manager;

app
  .whenReady()
  .then(async () => {
    const identity = storeIdentity();
    const directory = path.join(fs.realpathSync(profile), 'store-extensions', identity.id);
    const manifest = {
      manifest_version: 3,
      name: 'Runtime update test',
      version: '1.0',
      key: identity.key.toString('base64'),
    };
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(
      path.join(profile, 'extensions.json'),
      JSON.stringify({ extensions: [{ path: directory, enabled: true }] }),
    );
    const browsing = session.fromPartition('persist:extension-update-test');
    let next = { ...manifest, version: '2.0' };
    const url = 'https://clients2.googleusercontent.com/crx/runtime.crx';
    manager = new extensions.ExtensionManager(profile, browsing, () => {}, {
      fetch: async (request) => {
        const bytes = extensionPackage(identity, next);
        if (request === url) return new Response(bytes);
        const hash = createHash('sha256').update(bytes).digest('hex');
        return new Response(
          `<gupdate><app appid="${identity.id}"><updatecheck status="ok" version="${next.version}" codebase="${url}" hash_sha256="${hash}"/></app></gupdate>`,
        );
      },
    });
    await manager.loadAll();
    assert.equal(manager.list()[0].id, identity.id);
    assert.equal(await manager.checkForUpdates(), null);
    assert.equal(browsing.extensions.getExtension(identity.id).version, '2.0');
    assert.equal(manager.list()[0].enabled, true);
    next = { ...manifest, version: '3.0', name: 42 };
    assert.ok(await manager.checkForUpdates());
    assert.equal(browsing.extensions.getExtension(identity.id).version, '2.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'))).version, '2.0');
    browsing.extensions.removeExtension(identity.id);
    console.log('PASS: real extension updated with stable identity and restored the prior version after a failed load');
  })
  .then(() => {
    manager?.stopUpdates();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    manager?.stopUpdates();
    app.exit(1);
  });
app.on('quit', () => {
  clearTimeout(deadline);
  manager?.stopUpdates();
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error('Extension test profile cleanup failed:', error);
  }
});
