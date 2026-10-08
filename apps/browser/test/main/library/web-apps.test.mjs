import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import webApps from '../../../dist/main/library/web-apps.js';
import shared from '../../../dist/shared/web-apps.js';
import tabs from '../../../dist/main/tabs/tabs.js';
const { WebAppStore, parseWebAppManifest } = webApps;
const { webAppContains } = shared;
const page = 'https://app.example/inbox';
function devtools(manifest, extra = {}) {
  return {
    url: 'https://app.example/manifest.json',
    data: '{"name":"Mail"}',
    errors: [],
    manifest: {
      name: 'Mail',
      display: 'kStandalone',
      id: 'https://app.example/mail#x',
      startUrl: 'https://app.example/mail/?source=pwa',
      scope: 'https://app.example/mail/?q=1#top',
      ...manifest,
    },
    ...extra,
  };
}
test('manifest parsing accepts standalone same-origin apps and rejects unsafe or browser-display manifests', () => {
  assert.deepEqual(parseWebAppManifest(devtools(), page), {
    name: 'Mail',
    startUrl: 'https://app.example/mail/?source=pwa',
    scope: 'https://app.example/mail/',
    manifestId: 'https://app.example/mail',
  });
  assert.equal(parseWebAppManifest(devtools({ name: undefined, shortName: 'M' }), page).name, 'M');
  assert.equal(parseWebAppManifest(devtools({ display: 'kBrowser' }), page), null);
  assert.equal(parseWebAppManifest(devtools({ startUrl: 'https://other.example/mail/' }), page), null);
  assert.equal(parseWebAppManifest(devtools({ scope: 'https://app.example/other/' }), page), null);
  assert.equal(parseWebAppManifest(devtools({ id: 'https://other.example/mail' }), page), null);
  assert.equal(parseWebAppManifest(devtools({}, { data: '' }), page), null);
  assert.equal(parseWebAppManifest(devtools(), 'http://app.example/inbox'), null);
  assert.equal(parseWebAppManifest(devtools({ startUrl: 'https://u:p@app.example/mail/' }), page), null);
  assert.ok(
    parseWebAppManifest(
      devtools(
        { id: 'http://localhost:3000/', startUrl: 'http://localhost:3000/', scope: 'http://localhost:3000/' },
        { url: 'http://localhost:3000/manifest.json' },
      ),
      'http://localhost:3000/',
    ),
  );
});
test('scope check matches origin and path prefix only for http(s) urls', () => {
  assert.equal(webAppContains('https://app.example/mail/', 'https://app.example/mail/inbox?x=1'), true);
  assert.equal(webAppContains('https://app.example/mail/', 'https://app.example/calendar'), false);
  assert.equal(webAppContains('https://app.example/mail/', 'https://evil.example/mail/'), false);
  assert.equal(webAppContains('https://app.example/', 'javascript:alert(1)'), false);
  assert.equal(webAppContains('not a url', 'https://app.example/'), false);
});
test('store installs once per manifest id, persists atomically with 0600, caps at 50 and survives bad files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-web-apps-'));
  try {
    const store = new WebAppStore(dir);
    const manifest = parseWebAppManifest(devtools(), page);
    const first = store.install(manifest);
    assert.ok(first.id);
    assert.equal(store.install({ ...manifest, name: 'Again' }).id, first.id);
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.deepEqual(new WebAppStore(dir).list(), [first]);
    assert.equal(store.install({ ...manifest, scope: 'https://app.example/other/' }), null);
    for (let i = 1; i < 50; i++) assert.ok(store.install({ ...manifest, manifestId: `https://app.example/mail/${i}` }));
    assert.equal(store.install({ ...manifest, manifestId: 'https://app.example/mail/50' }), null);
    fs.renameSync(store.file, store.file + '.backup');
    fs.mkdirSync(store.file);
    assert.equal(store.remove(first.id), false);
    assert.equal(store.list().length, 50);
    fs.rmdirSync(store.file);
    assert.equal(store.remove(first.id), true);
    assert.equal(store.remove(first.id), false);
    assert.equal(new WebAppStore(dir).list().length, 49);
    assert.equal(
      fs.readdirSync(dir).some((name) => name.endsWith('.tmp')),
      false,
    );
    fs.writeFileSync(store.file, '{broken');
    assert.deepEqual(new WebAppStore(dir).list(), []);
    fs.writeFileSync(
      store.file,
      JSON.stringify([
        { id: 'a', ...manifest },
        { id: 'b', ...manifest },
        { id: 'c', ...manifest, startUrl: 'https://u:p@app.example/mail/' },
      ]),
    );
    assert.deepEqual(
      new WebAppStore(dir).list().map((app) => app.id),
      ['a'],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('app window tab manager sends out-of-scope navigations outside and keeps opener popups', () => {
  const external = [];
  const manager = new tabs.TabManager({
    window: { contentView: { removeChildView() {} } },
    freezeBackground: () => false,
    onChange() {},
    onPrivateEnded() {},
    closed: [],
    webAppScope: 'https://app.example/mail/',
    onAppExternal: (url) => external.push(url),
  });
  manager.tabs.push(manager.createRecord({ id: 'a', url: 'https://app.example/mail/', title: 'Mail' }));
  manager.activeId = 'a';
  assert.equal(manager.routeAppNavigation(manager.tabs[0], 'https://app.example/mail/inbox'), false);
  assert.equal(manager.routeAppNavigation(manager.tabs[0], 'https://docs.example/'), true);
  assert.equal(manager.open('https://news.example/'), 'a');
  assert.equal(manager.tabs.length, 1);
  assert.deepEqual(external, ['https://docs.example/', 'https://news.example/']);
  const popup = manager.createRecord({ id: 'p', url: 'https://app.example/mail/', title: 'Popup' });
  popup.openerId = 'a';
  assert.equal(manager.routeAppNavigation(popup, 'https://auth.example/'), false);
});
