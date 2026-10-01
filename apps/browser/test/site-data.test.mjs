import assert from 'node:assert/strict';
import { test } from 'node:test';
import siteData from '../dist/main/site-data.js';
import i18n from '../dist/shared/i18n.js';

i18n.setLocale('tr');

const { cookieUrl, cookiesForHost, formatBytes, parseStorageUsage, siteDataItems } = siteData;

test('sizes read in Turkish units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(4300), '4,2 KB');
  assert.equal(formatBytes(1363149), '1,3 MB');
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
});

test('storage estimates are sanitized', () => {
  assert.deepEqual(
    parseStorageUsage({ localStorage: 42, details: { indexedDB: 1000, caches: -5, serviceWorkerRegistrations: 'x' } }),
    { localStorage: 42, indexedDb: 1000, cacheStorage: 0, serviceWorkers: 0 },
  );
  assert.deepEqual(parseStorageUsage({ localStorage: 7, details: null }), {
    localStorage: 7,
    indexedDb: 0,
    cacheStorage: 0,
    serviceWorkers: 0,
  });
  assert.equal(parseStorageUsage(null), null);
  assert.equal(parseStorageUsage('nope'), null);
});

test('a site sees its own cookies and those of its parent domains', () => {
  const cookies = [
    { name: 'a', domain: 'app.example.com', hostOnly: true },
    { name: 'b', domain: '.example.com', hostOnly: false },
    { name: 'c', domain: 'other.example.com', hostOnly: true },
    { name: 'd', domain: 'example.com', hostOnly: true },
    { name: 'e', domain: '.notexample.com', hostOnly: false },
  ];
  assert.deepEqual(
    cookiesForHost(cookies, 'app.example.com').map((cookie) => cookie.name),
    ['a', 'b'],
  );
  assert.deepEqual(
    cookiesForHost(cookies, 'example.com').map((cookie) => cookie.name),
    ['b', 'd'],
  );
});

test('cookies are removed through the address they belong to', () => {
  assert.equal(cookieUrl({ domain: '.example.com', path: '/admin', secure: true }), 'https://example.com/admin');
  assert.equal(cookieUrl({ domain: 'localhost', path: '/', secure: false }), 'http://localhost/');
});

test('the menu lists what the site stores and offers to clear it', () => {
  const calls = [];
  const actions = { clearCookies: () => calls.push('cookies'), clearSiteData: () => calls.push('all') };
  const items = siteDataItems(
    { cookies: 3, storage: { localStorage: 2048, indexedDb: 0, cacheStorage: 5 * 1024 * 1024, serviceWorkers: 0 } },
    actions,
  );
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    ['-', 'Çerezler: 3', 'Yerel depolama: 2 KB', 'Önbellek deposu: 5 MB', 'Çerezleri sil', 'Site verilerini temizle'],
  );
  items.at(-2).click();
  items.at(-1).click();
  assert.deepEqual(calls, ['cookies', 'all']);

  const unknown = siteDataItems({ cookies: 0, storage: null }, actions);
  assert.equal(unknown.find((item) => item.label === 'Depolama boyutu ölçülemedi').enabled, false);
  assert.equal(unknown.find((item) => item.label === 'Çerezleri sil').enabled, false);
});
