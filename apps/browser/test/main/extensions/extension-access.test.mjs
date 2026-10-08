import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import policies from '../../../dist/shared/extension-sites.js';
import access from '../../../dist/main/extensions/extension-access.js';
import manifests from '../../../dist/main/extensions/extension-manifest.js';
import controllers from '../../../dist/main/extensions/extension-access-controller.js';

const { restrictedManifest, prepareRestrictedExtension, extensionIdentity } = access;
test('site access normalizes engine scope, bounds lists and fails closed on malformed saved policies', () => {
  assert.equal(policies.extensionSite('HTTPS://EXAMPLE.COM:8443/path?q=1'), 'https://example.com');
  for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:pass@example.com', 'example.com', ''])
    assert.equal(policies.extensionSite(value), null);
  assert.deepEqual(
    policies.parseExtensionAccess({ mode: 'sites', sites: ['https://EXAMPLE.com/a', 'https://example.com:9000/'] }),
    { mode: 'sites', sites: ['https://example.com'] },
  );
  assert.equal(policies.parseExtensionAccess({ mode: 'sites', sites: Array(101).fill('https://example.com') }), null);
  assert.equal(policies.parseExtensionAccess({ mode: 'wrong', sites: [] }), null);
  assert.equal(
    manifests.sanitizeSavedExtensions([{ path: '/extensions/test', access: { mode: 'sites', sites: ['bad'] } }])[0]
      .access.mode,
    'click',
  );
});

test('restricted manifests intersect original hosts, preserve content path/exclusions and remove activeTab', () => {
  const original = {
    manifest_version: 3,
    permissions: ['storage', 'activeTab'],
    optional_permissions: ['tabs', '*://*.example.com/*'],
    host_permissions: ['https://*.example.com/*', 'http://localhost/*'],
    optional_host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['https://*.example.com/articles/*'],
        exclude_matches: ['*://*/private/*'],
        js: ['content.js'],
        all_frames: true,
      },
      { matches: ['https://other.test/*'], js: ['other.js'] },
    ],
  };
  const reduced = restrictedManifest(original, {
    mode: 'sites',
    sites: ['https://news.example.com', 'http://news.example.com', 'https://other.test'],
  });
  assert.deepEqual(reduced.permissions, ['storage']);
  assert.deepEqual(reduced.host_permissions, ['https://news.example.com/*']);
  assert.deepEqual(reduced.optional_permissions, ['tabs', 'https://news.example.com/*', 'http://news.example.com/*']);
  assert.equal(reduced.content_scripts[0].all_frames, true);
  assert.deepEqual(reduced.content_scripts[0].matches, ['https://news.example.com/articles/*']);
  assert.deepEqual(reduced.content_scripts[0].exclude_matches, original.content_scripts[0].exclude_matches);
  assert.deepEqual(restrictedManifest(original, { mode: 'click', sites: [] }).content_scripts, []);
  assert.deepEqual(
    restrictedManifest(original, { mode: 'click', sites: [] }, ['http://localhost:8000']).host_permissions,
    ['http://localhost/*'],
  );
  assert.deepEqual(original.permissions, ['storage', 'activeTab']);
  assert.deepEqual(restrictedManifest(original, { mode: 'all', sites: [] }), original);
});

test('restricted runtime copies preserve source packages and refuse symbolic links', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-access-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const original = { manifest_version: 3, name: 'Test', version: '1', host_permissions: ['<all_urls>'] };
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(original));
  fs.writeFileSync(path.join(source, 'content.js'), 'original script');
  const identity = extensionIdentity(source, original);
  const runtime = prepareRestrictedExtension(path.join(root, 'runtime'), source, {
    ...restrictedManifest(original, { mode: 'click', sites: [] }),
    key: identity.key,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'))), original);
  assert.equal(fs.readFileSync(path.join(runtime, 'content.js'), 'utf8'), 'original script');
  assert.equal(
    extensionIdentity(runtime, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json')))).id,
    identity.id,
  );
  fs.symlinkSync(path.join(root, 'outside'), path.join(source, 'unsafe'));
  assert.throws(() => prepareRestrictedExtension(path.join(root, 'runtime'), source, original));
  assert.throws(() => prepareRestrictedExtension(path.join(source, 'nested-runtime'), source, original));
});

function fixture({ cancelPage = false, reloadFails = false, changeAfter = false } = {}) {
  const page = {};
  let policy = { mode: 'all', sites: [] };
  let calls = 0,
    reloads = 0,
    disabled = 0;
  const extensions = {
    hasEntry: () => true,
    accessWillChange: () => true,
    list: () => [{ path: '/test', name: 'Test', enabled: !disabled, sessionSites: [] }],
    setAccess: async (_dir, value) => {
      policy = value;
      calls++;
      return null;
    },
    setEnabled: async () => {
      disabled++;
    },
  };
  const controller = new controllers.ExtensionAccessController({
    extensions,
    pages: () => (changeAfter && calls ? [page, {}] : [page]),
    approveReload: async () =>
      cancelPage
        ? null
        : {
            current: () => true,
            reload: async () => {
              reloads++;
              return !reloadFails;
            },
          },
    dialogs: { showMessageBox: async () => ({ response: 0 }) },
  });
  return { controller, state: () => ({ policy, calls, reloads, disabled }) };
}
test('site access waits for every page approval, cancels without changes and disables on failed reload or new pages', async () => {
  for (const options of [{ cancelPage: true }, { reloadFails: true }, { changeAfter: true }, {}]) {
    const { controller, state } = fixture(options);
    const error = await controller.setAccess('/test', { mode: 'click', sites: [] }, undefined, () => true);
    if (options.cancelPage)
      assert.deepEqual(state(), { policy: { mode: 'all', sites: [] }, calls: 0, reloads: 0, disabled: 0 });
    else if (options.reloadFails || options.changeAfter) assert.equal(state().disabled, 1);
    else {
      assert.equal(error, null);
      assert.equal(state().reloads, 1);
    }
    if (Object.keys(options).length) assert.equal(typeof error, 'string');
  }
});
