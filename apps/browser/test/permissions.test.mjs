import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import permissions from '../dist/main/privacy/permissions.js';
import i18n from '../dist/shared/i18n.js';

i18n.setLocale('tr');

const { PermissionStore, permissionOrigin, permissionQuestion, requestedPermissions } = permissions;
const SITE = 'https://meet.example.com';

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-permissions-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Chromium requests map to the permissions a person is asked about', () => {
  assert.deepEqual(requestedPermissions('media', ['video', 'audio']), ['camera', 'microphone']);
  assert.deepEqual(requestedPermissions('media', ['audio']), ['microphone']);
  assert.equal(requestedPermissions('media', []), null);
  assert.deepEqual(requestedPermissions('geolocation'), ['geolocation']);
  assert.deepEqual(requestedPermissions('notifications'), ['notifications']);
  assert.equal(requestedPermissions('midiSysex'), null);
});

test('only web pages have a permission origin', () => {
  assert.equal(permissionOrigin('https://meet.example.com/room?x=1'), SITE);
  assert.equal(permissionOrigin('http://localhost:3000/a'), 'http://localhost:3000');
  assert.equal(permissionOrigin('yalqen://newtab/'), null);
  assert.equal(permissionOrigin('file:///tmp/a.html'), null);
  assert.equal(permissionOrigin(undefined), null);
});

test('questions name what the site wants', () => {
  assert.equal(
    permissionQuestion('a.com', ['camera', 'microphone']),
    'a.com kameranızı ve mikrofonunuzu kullanmak istiyor.',
  );
  assert.equal(permissionQuestion('a.com', ['microphone']), 'a.com mikrofonunuzu kullanmak istiyor.');
  assert.equal(permissionQuestion('a.com', ['geolocation']), 'a.com konumunuzu öğrenmek istiyor.');
  assert.equal(permissionQuestion('a.com', ['notifications']), 'a.com bildirim göstermek istiyor.');
});

test('decisions are asked for, saved per site and survive a restart', () => {
  withStore((dir) => {
    const store = new PermissionStore(dir);
    assert.equal(store.decide(SITE, ['camera']), 'ask');
    store.set(SITE, ['camera'], 'allow');
    assert.equal(store.decide(SITE, ['camera']), 'allow');
    assert.equal(store.decide(SITE, ['camera', 'microphone']), 'ask');
    store.set(SITE, ['microphone'], 'deny');
    assert.equal(store.decide(SITE, ['camera', 'microphone']), 'deny');
    assert.equal(store.decide('https://other.example.com', ['camera']), 'ask');
    store.saveNow();

    const reloaded = new PermissionStore(dir);
    assert.deepEqual(reloaded.list(SITE), [
      { kind: 'camera', decision: 'allow' },
      { kind: 'microphone', decision: 'deny' },
    ]);
    reloaded.set(SITE, ['camera', 'microphone'], null);
    assert.deepEqual(reloaded.list(SITE), []);
    reloaded.saveNow();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'permissions.json'), 'utf8')), {
      version: 1,
      sites: {},
    });
  });
});

test('one-time grants are not saved', () => {
  withStore((dir) => {
    const store = new PermissionStore(dir);
    store.allowOnce(SITE, ['geolocation']);
    assert.equal(store.decide(SITE, ['geolocation']), 'allow');
    assert.equal(new PermissionStore(dir).decide(SITE, ['geolocation']), 'ask');
    store.set(SITE, ['geolocation'], null);
    assert.equal(store.decide(SITE, ['geolocation']), 'ask');
    store.saveNow();
  });
});

test('invalid saved entries are ignored', () => {
  withStore((dir) => {
    fs.writeFileSync(
      path.join(dir, 'permissions.json'),
      JSON.stringify({
        version: 1,
        sites: {
          [SITE]: { camera: 'allow', microphone: 'maybe', usb: 'allow' },
          'yalqen://newtab': { camera: 'allow' },
        },
      }),
    );
    const store = new PermissionStore(dir);
    assert.deepEqual(store.list(SITE), [{ kind: 'camera', decision: 'allow' }]);
    assert.deepEqual(store.list('yalqen://newtab'), []);
  });
});

test('a store without a directory saves nothing', () => {
  const store = new PermissionStore(null);
  store.set(SITE, ['camera'], 'allow');
  assert.equal(store.decide(SITE, ['camera']), 'allow');
  assert.equal(store.file, null);
});
