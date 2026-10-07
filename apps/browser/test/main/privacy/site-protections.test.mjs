import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import policies from '../../../dist/main/privacy/site-protections.js';
import settings from '../../../dist/main/app/settings.js';
import exceptions from '../../../dist/main/privacy/adblock-exceptions.js';

test('exceptions normalize HTTP origins, exclude credentials and local URLs, and bound storage', () => {
  assert.deepEqual(
    policies.sanitizeProtectionExceptions([
      'https://EXAMPLE.com:443/path?private=1',
      'https://example.com/',
      'http://example.com:8080/',
      'https://user:secret@example.com',
      'file:///tmp/a',
      'data:text/plain,a',
      'nope',
      null,
    ]),
    ['https://example.com', 'http://example.com:8080'],
  );
  assert.equal(
    policies.sanitizeProtectionExceptions(Array.from({ length: 600 }, (_, i) => `https://host${i}.test`)).length,
    500,
  );
});

test('normal choices persist; private overrides never write and reset after private browsing ends', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-protections-'));
  try {
    const store = new settings.SettingsStore(directory);
    let writes = 0;
    const protection = new policies.SiteProtections(
      () => store.get(),
      (patch) => {
        writes++;
        store.update(patch);
      },
    );
    protection.setAllowed('adBlocking', 'https://example.com/a', false, true);
    protection.setAllowed('blockThirdPartyCookies', 'https://cookies.test', false, true);
    assert.equal(protection.isAllowed('adBlocking', 'https://example.com/b', true), true);
    protection.setAllowed('adBlocking', 'https://example.com', true, false);
    protection.setAllowed('adBlocking', 'https://private.test', true, true);
    assert.equal(writes, 2);
    assert.equal(protection.isAllowed('adBlocking', 'https://example.com', true), false);
    assert.equal(protection.isAllowed('adBlocking', 'https://example.com'), true);
    assert.equal(protection.isAllowed('adBlocking', 'http://example.com'), false);
    assert.equal(protection.isAllowed('adBlocking', 'https://sub.example.com'), false);
    assert.equal(protection.isAllowed('adBlocking', 'https://example.com:8443'), false);
    const reloaded = new settings.SettingsStore(directory).get();
    assert.deepEqual(reloaded.adBlockExceptions, ['https://example.com']);
    assert.deepEqual(reloaded.thirdPartyCookieExceptions, ['https://cookies.test']);
    protection.clearPrivate();
    assert.equal(protection.isAllowed('adBlocking', 'https://private.test', true), false);
    assert.equal(protection.isAllowed('adBlocking', 'https://example.com', true), true);
    protection.setAllowed('adBlocking', 'https://example.com', false, false);
    assert.deepEqual(store.get().adBlockExceptions, []);
    protection.setAllowed('adBlocking', 'file:///tmp/private', false, true);
    assert.equal(writes, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ad exceptions bypass every filter type using the real page and session, and follow navigation', async () => {
  const calls = [];
  const blocker = {
    onBeforeRequest: (_, callback) => {
      calls.push('network');
      callback({ cancel: true });
    },
    onHeadersReceived: (_, callback) => {
      calls.push('headers');
      callback({ responseHeaders: { csp: ['deny'] } });
    },
    onInjectCosmeticFilters: async () => {
      calls.push('cosmetics');
    },
    onIsMutationObserverEnabled: async () => {
      calls.push('observer');
      return true;
    },
  };
  const normal = {};
  const privateSession = {};
  let url = 'https://allowed.test';
  const contents = { session: normal, getURL: () => url, isDestroyed: () => false };
  exceptions.applyAdBlockExceptions(blocker, (session, page) => session === normal && page === 'https://allowed.test');
  let result;
  const receive = (value) => {
    result = value;
  };
  blocker.onBeforeRequest({ webContents: contents, referrer: 'https://blocked.test' }, receive);
  assert.deepEqual(result, {});
  blocker.onHeadersReceived({ webContents: contents }, receive);
  assert.deepEqual(result, {});
  await blocker.onInjectCosmeticFilters({ sender: contents }, 'https://frame.test');
  assert.equal(await blocker.onIsMutationObserverEnabled({ sender: contents }), false);
  assert.deepEqual(calls, []);
  url = 'https://blocked.test';
  blocker.onBeforeRequest({ webContents: contents, referrer: 'https://allowed.test' }, receive);
  assert.deepEqual(result, { cancel: true });
  blocker.onHeadersReceived({ webContents: contents }, receive);
  await blocker.onInjectCosmeticFilters({ sender: contents }, 'https://allowed.test');
  assert.equal(await blocker.onIsMutationObserverEnabled({ sender: contents }), true);
  assert.deepEqual(calls, ['network', 'headers', 'cosmetics', 'observer']);
  url = 'https://allowed.test';
  contents.session = privateSession;
  blocker.onBeforeRequest({ webContents: contents }, receive);
  assert.deepEqual(result, { cancel: true });
  blocker.onBeforeRequest({ webContents: null, referrer: url }, receive);
  assert.deepEqual(result, { cancel: true });
});
