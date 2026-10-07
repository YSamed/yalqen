import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import updates from '../../../dist/main/extensions/extension-updates.js';
import extensions from '../../../dist/main/extensions/extensions.js';
import store from '../../../dist/main/extensions/chrome-web-store.js';
import { extensionPackage, storeIdentity } from '../../helpers/extension-package.mjs';

const { newerVersion, parseStoreUpdate, addedPermissions } = updates;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const packageUrl = 'https://clients2.googleusercontent.com/crx/test.crx';
const identity = storeIdentity();

function manifest(version, extra = {}) {
  return { manifest_version: 3, name: 'Test extension', version, ...extra };
}
function updateXml(id, version, hash) {
  return `<gupdate><app appid="${id}"><updatecheck status="ok" version="${version}" codebase="${packageUrl}" hash_sha256="${hash}" /></app></gupdate>`;
}

function fixture(t, { enabled = true, rejectVersion, automatic = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-extension-update-'));
  const target = path.join(root, 'store-extensions', identity.id);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'manifest.json'),
    JSON.stringify(manifest('1.0', { key: identity.key.toString('base64') })),
  );
  fs.writeFileSync(path.join(target, 'content.txt'), 'original');
  fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify({ extensions: [{ path: target, enabled }] }));
  const loaded = new Map();
  const loads = [];
  const browsing = {
    extensions: {
      loadExtension: async (directory) => {
        const value = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
        loads.push(value.version);
        if (value.version === rejectVersion) throw new Error('new version rejected');
        const extension = {
          id: store.extensionIdOfKey(Buffer.from(value.key, 'base64')),
          manifest: value,
          name: value.name,
          version: value.version,
        };
        loaded.set(extension.id, extension);
        return extension;
      },
      getExtension: (id) => loaded.get(id) ?? null,
      removeExtension: (id) => loaded.delete(id),
    },
  };
  let next = manifest('2.0');
  let xml;
  let bytes;
  const requests = [];
  const fetchFile = async (url, init) => {
    requests.push([url, init]);
    assert.equal(init.credentials, 'omit');
    const packageBytes = bytes ?? extensionPackage(identity, next);
    if (url === packageUrl) return new Response(packageBytes);
    return new Response(
      xml ?? updateXml(identity.id, next.version, createHash('sha256').update(packageBytes).digest('hex')),
    );
  };
  const manager = new extensions.ExtensionManager(root, browsing, () => {}, {
    fetch: fetchFile,
    automatic: () => automatic,
  });
  t.after(() => {
    manager.stopUpdates();
    manager.saveNow();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    manager,
    root,
    target,
    loads,
    loaded,
    requests,
    next: (value) => {
      next = value;
    },
    response: (value) => {
      xml = value;
    },
    package: (value) => {
      bytes = value;
    },
  };
}

test('extension versions compare numeric components and reject invalid versions', () => {
  assert.equal(newerVersion('1.10', '1.9'), true);
  assert.equal(newerVersion('1', '1.0.0.0'), false);
  assert.equal(newerVersion('1.0.1', '1'), true);
  for (const value of ['65536', '1.2.3.4.5', '1.beta', '', null]) assert.equal(newerVersion(value, '1'), false);
});

test('update metadata selects the installed identity, skips downgrades, and restricts package origins', () => {
  const hash = 'a'.repeat(64);
  const xml = updateXml(identity.id, '2', hash);
  assert.deepEqual(parseStoreUpdate(xml, identity.id, '1'), { version: '2', url: packageUrl, sha256: hash });
  assert.equal(parseStoreUpdate(xml, identity.id, '3'), null);
  assert.equal(
    parseStoreUpdate(`<app appid="${identity.id}"><updatecheck status="noupdate"/></app>`, identity.id, '1'),
    null,
  );
  for (const bad of [
    xml.replace(packageUrl, 'http://clients2.googleusercontent.com/a'),
    xml.replace(packageUrl, 'https://evil.test/a'),
    xml.replace(hash, 'wrong'),
    '<!DOCTYPE root>' + xml,
    xml.replace(identity.id, 'a'.repeat(32)),
  ]) {
    assert.throws(() => parseStoreUpdate(bad, identity.id, '1'));
  }
});

test('new API permissions, optional permissions and content-script match scopes require review', () => {
  assert.deepEqual(
    addedPermissions(
      { permissions: ['storage'], host_permissions: ['https://a.test/*'] },
      {
        permissions: ['storage', 'tabs'],
        optional_permissions: ['bookmarks'],
        optional_host_permissions: ['https://optional.test/*'],
        content_scripts: [{ matches: ['https://a.test/*', '<all_urls>'] }],
      },
    ),
    ['tabs', '<all_urls>', 'bookmarks', 'https://optional.test/*'],
  );
});

test('an enabled update preserves identity and replaces files; same version skips downloading', async (t) => {
  const f = fixture(t);
  await f.manager.loadAll();
  assert.equal(await f.manager.checkForUpdates(), null);
  assert.deepEqual(f.loads, ['1.0', '2.0']);
  assert.equal(f.manager.list()[0].version, '2.0');
  assert.equal(f.manager.list()[0].id, identity.id);
  assert.equal(fs.readFileSync(path.join(f.target, 'content.txt'), 'utf8'), 'version 2.0');
  await f.manager.checkForUpdates();
  assert.equal(f.requests.filter(([url]) => url === packageUrl).length, 1);
  assert.equal(fs.existsSync(`${f.target}.previous`), false);
});

test('disabled extensions update their files without loading or becoming enabled', async (t) => {
  const f = fixture(t, { enabled: false });
  await f.manager.loadAll();
  assert.equal(await f.manager.checkForUpdates(), null);
  assert.deepEqual(f.loads, []);
  assert.equal(f.manager.list()[0].version, '2.0');
  assert.equal(f.manager.list()[0].enabled, false);
});

test('load failure restores the exact old files and running version', async (t) => {
  const f = fixture(t, { rejectVersion: '2.0' });
  await f.manager.loadAll();
  assert.match(await f.manager.checkForUpdates(), /new version rejected/);
  assert.deepEqual(f.loads, ['1.0', '2.0', '1.0']);
  assert.equal(f.manager.list()[0].version, '1.0');
  assert.equal(f.manager.list()[0].error, null);
  assert.match(f.manager.list()[0].updateError, /new version rejected/);
  assert.equal(fs.readFileSync(path.join(f.target, 'content.txt'), 'utf8'), 'original');
});

test('bad checksums or CRX identities never unload the previous extension', async (t) => {
  for (const wrongKey of [false, true]) {
    const f = fixture(t);
    await f.manager.loadAll();
    if (wrongKey) f.package(extensionPackage(storeIdentity(), manifest('2.0')));
    else f.response(updateXml(identity.id, '2.0', '0'.repeat(64)));
    assert.ok(await f.manager.checkForUpdates());
    assert.deepEqual(f.loads, ['1.0']);
    assert.equal(f.manager.list()[0].version, '1.0');
  }
});

test('automatic checks and declined permission prompts keep the old version; approval updates it', async (t) => {
  const f = fixture(t);
  f.next(manifest('2.0', { host_permissions: ['<all_urls>'] }));
  await f.manager.loadAll();
  assert.ok(await f.manager.checkForUpdates());
  assert.ok(await f.manager.checkForUpdates(async () => false));
  assert.deepEqual(f.loads, ['1.0']);
  assert.equal(
    await f.manager.checkForUpdates(async (name, permissions) => {
      assert.equal(name, 'Test extension');
      assert.deepEqual(permissions, ['<all_urls>']);
      return true;
    }),
    null,
  );
  assert.deepEqual(f.loads, ['1.0', '2.0']);
});

test('concurrent checks are deduplicated and local folders are excluded', async (t) => {
  const f = fixture(t);
  await f.manager.loadAll();
  const first = f.manager.checkForUpdates();
  assert.equal(f.manager.checkForUpdates(), first);
  await first;
  assert.equal(f.requests.length, 2);
  const local = path.join(f.root, 'local');
  fs.mkdirSync(local);
  fs.writeFileSync(
    path.join(local, 'manifest.json'),
    JSON.stringify(manifest('1', { key: identity.key.toString('base64') })),
  );
  await f.manager.install(local);
  const before = f.requests.length;
  await f.manager.checkForUpdates();
  assert.equal(f.requests.length, before + 1);
  assert.equal(f.manager.list().find((entry) => entry.path === fs.realpathSync(local)).fromStore, false);
});

test('startup recovers a transaction interrupted before validation', (t) => {
  const f = fixture(t);
  fs.renameSync(f.target, `${f.target}.previous`);
  fs.mkdirSync(f.target);
  fs.writeFileSync(path.join(f.target, 'manifest.json'), JSON.stringify(manifest('broken')));
  const recovered = new extensions.ExtensionManager(f.root, {}, () => {});
  assert.equal(recovered.list()[0].version, '1.0');
  assert.equal(fs.readFileSync(path.join(f.target, 'content.txt'), 'utf8'), 'original');
  recovered.stopUpdates();
});

test('automatic scheduling waits until after startup, repeats and stops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.manager.scheduleUpdates();
  t.mock.timers.tick(updates.EXTENSION_FIRST_CHECK_MS - 1);
  assert.equal(f.requests.length, 0);
  t.mock.timers.tick(1);
  await f.manager.checkForUpdates();
  await tick();
  assert.equal(f.requests.length, 2);
  t.mock.timers.tick(updates.EXTENSION_CHECK_INTERVAL_MS);
  await f.manager.checkForUpdates();
  await tick();
  assert.equal(f.requests.length, 3);
  f.manager.stopUpdates();
  t.mock.timers.tick(updates.EXTENSION_CHECK_INTERVAL_MS);
  assert.equal(f.requests.length, 3);
});

test('optional-to-required permission changes still need approval', () => {
  assert.deepEqual(addedPermissions({ optional_permissions: ['tabs'] }, { permissions: ['tabs'] }), ['tabs']);
});

test('automatic updates can be turned off while manual checking remains available', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { automatic: false });
  f.manager.scheduleUpdates();
  t.mock.timers.tick(updates.EXTENSION_FIRST_CHECK_MS + updates.EXTENSION_CHECK_INTERVAL_MS);
  assert.equal(f.requests.length, 0);
  await f.manager.loadAll();
  assert.equal(await f.manager.checkForUpdates(async () => true), null);
  assert.equal(f.manager.list()[0].version, '2.0');
});

test('oversized update manifests cancel their stream and release the reader', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(updates.MAX_UPDATE_MANIFEST_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
  );
  await assert.rejects(updates.readUpdateManifest(response), /too large/);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});
