import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookiesModule from '../../../dist/main/extensions/extension-cookies.js';

const { callCookies, chromeCookieChange, cookieUrl, extensionGrant, hostPermitted } = cookiesModule;

test('host permissions follow Chrome match patterns', () => {
  assert.equal(hostPermitted(['<all_urls>'], 'https://a.example/'), true);
  assert.equal(hostPermitted(['https://*/*'], 'https://a.example/x'), true);
  assert.equal(hostPermitted(['https://*/*'], 'http://a.example/'), false);
  assert.equal(hostPermitted(['*://*.grammarly.com/*'], 'https://grammarly.com/'), true);
  assert.equal(hostPermitted(['*://*.grammarly.com/*'], 'http://app.grammarly.com/'), true);
  assert.equal(hostPermitted(['*://*.grammarly.com/*'], 'https://evilgrammarly.com/'), false);
  assert.equal(hostPermitted(['https://grammarly.com/*'], 'https://app.grammarly.com/'), false);
  assert.equal(hostPermitted(['<all_urls>'], 'file:///etc/hosts'), false);
  assert.equal(hostPermitted(['https://*/*'], 'not a url'), false);
  assert.equal(hostPermitted([], 'https://a.example/'), false);
});

test('the grant reads MV3 host permissions and MV2 host entries in permissions', () => {
  assert.deepEqual(extensionGrant({ permissions: ['cookies'], host_permissions: ['https://*/*'] }), {
    permissions: ['cookies'],
    hosts: ['https://*/*'],
  });
  assert.deepEqual(extensionGrant({ permissions: ['cookies', 'http://a.example/*', '<all_urls>', 4] }).hosts, [
    'http://a.example/*',
    '<all_urls>',
  ]);
  assert.deepEqual(extensionGrant(undefined), { permissions: [], hosts: [] });
});

test('cookie changes map to Chrome causes and urls', () => {
  const cookie = { name: 'grauth', value: 'x', domain: '.grammarly.com', path: '/', secure: true };
  assert.equal(cookieUrl(cookie), 'https://grammarly.com/');
  assert.equal(cookieUrl({ ...cookie, secure: false, path: '/a' }), 'http://grammarly.com/a');
  assert.deepEqual(chromeCookieChange(cookie, 'inserted', false), {
    cookie: { ...cookie, storeId: '0' },
    cause: 'explicit',
    removed: false,
  });
  assert.equal(chromeCookieChange(cookie, 'expired-overwrite', true).cause, 'expired_overwrite');
  assert.equal(chromeCookieChange(cookie, 'inserted-no-change-overwrite', false), null);
});

function fakeCookies(stored) {
  const calls = [];
  return {
    calls,
    get: async (filter) => {
      calls.push(['get', filter]);
      return stored.filter((cookie) => !filter.name || cookie.name === filter.name);
    },
    set: async (details) => calls.push(['set', details]),
    remove: async (url, name) => calls.push(['remove', url, name]),
  };
}

const GRANT = { permissions: ['cookies'], hosts: ['*://*.grammarly.com/*'] };

test('cookies calls stay inside the granted hosts', async () => {
  const cookies = fakeCookies([
    { name: 'grauth', value: 'short', domain: '.grammarly.com', path: '/', secure: true },
    { name: 'grauth', value: 'long', domain: '.grammarly.com', path: '/account', secure: true },
    { name: 'sid', value: 'bank', domain: 'bank.example', path: '/', secure: true },
  ]);
  const got = await callCookies(cookies, GRANT, 'get', { url: 'https://www.grammarly.com/account', name: 'grauth' });
  assert.equal(got.value, 'long');
  assert.equal(got.storeId, '0');
  const all = await callCookies(cookies, GRANT, 'getAll', { domain: 'grammarly.com' });
  assert.deepEqual(
    all.map((cookie) => cookie.value),
    ['short', 'long'],
  );
  await assert.rejects(callCookies(cookies, GRANT, 'get', { url: 'https://bank.example/', name: 'sid' }), /host/);
  await assert.rejects(callCookies(cookies, GRANT, 'set', { url: 'https://bank.example/', name: 'a' }), /host/);
  await assert.rejects(callCookies(cookies, GRANT, 'remove', { url: 'https://bank.example/', name: 'sid' }), /host/);
  await assert.rejects(callCookies(cookies, { ...GRANT, permissions: [] }, 'getAll', {}), /cookies/);
  await assert.rejects(callCookies(cookies, GRANT, 'flush', {}), /Unsupported/);
  await assert.rejects(callCookies(cookies, GRANT, 'get', { url: 'https://www.grammarly.com/', name: 4 }), /name/);
  assert.equal(
    cookies.calls.some(([kind, value]) => kind !== 'get' && String(value).includes('bank')),
    false,
  );
});

test('set and remove pass Chrome details through', async () => {
  const cookies = fakeCookies([{ name: 'a', value: '1', domain: 'www.grammarly.com', path: '/', secure: true }]);
  const set = await callCookies(cookies, GRANT, 'set', {
    url: 'https://www.grammarly.com/',
    name: 'a',
    value: '1',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: 2000000000,
    storeId: '0',
  });
  assert.equal(set.value, '1');
  assert.deepEqual(cookies.calls[0], [
    'set',
    {
      url: 'https://www.grammarly.com/',
      name: 'a',
      value: '1',
      secure: true,
      httpOnly: true,
      expirationDate: 2000000000,
      sameSite: 'lax',
    },
  ]);
  assert.deepEqual(await callCookies(cookies, GRANT, 'remove', { url: 'https://www.grammarly.com/', name: 'a' }), {
    url: 'https://www.grammarly.com/',
    name: 'a',
    storeId: '0',
  });
});
