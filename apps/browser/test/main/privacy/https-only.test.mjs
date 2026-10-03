import assert from 'node:assert/strict';
import { test } from 'node:test';
import httpsOnly from '../../../dist/main/privacy/https-only.js';

const { HttpsOnly, hostResolverOptions, httpsUpgrade } = httpsOnly;

test('web addresses are upgraded, local ones are not', () => {
  assert.equal(httpsUpgrade('http://example.com/a?b#c'), 'https://example.com/a?b#c');
  assert.equal(httpsUpgrade('http://example.com:80/'), 'https://example.com/');
  for (const url of [
    'https://a.com/',
    'http://localhost:3000/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://intranet/',
    'http://printer.local/',
    'http://site.test:8080/',
    'http://api.localhost/',
    'yalqen://newtab/',
    'nope',
  ]) {
    assert.equal(httpsUpgrade(url), null, url);
  }
});

test('upgrades follow the setting and consent per host', () => {
  let on = false;
  const mode = new HttpsOnly(() => on);
  assert.equal(mode.upgrade('http://a.com/'), null);
  on = true;
  assert.equal(mode.upgrade('http://a.com/x'), 'https://a.com/x');

  const token = mode.warn('https://a.com/x', 'http://a.com/x');
  assert.equal(mode.proceed('made-up', 'https://a.com/x'), null);
  assert.equal(mode.proceed(token, 'https://evil.com/'), null);
  assert.equal(mode.proceed(token, 'https://a.com/x'), 'http://a.com/x');
  assert.equal(mode.proceed(token, 'https://a.com/x'), null);
  assert.equal(mode.upgrade('http://a.com/y'), null);
  assert.equal(mode.upgrade('http://b.com/'), 'https://b.com/');

  mode.allowHost('http://b.com/redirected');
  assert.equal(mode.upgrade('http://b.com/'), null);
});

test('secure DNS settings map to resolver options', () => {
  assert.deepEqual(hostResolverOptions('off'), { secureDnsMode: 'off' });
  assert.deepEqual(hostResolverOptions('automatic'), { secureDnsMode: 'automatic' });
  assert.deepEqual(hostResolverOptions('cloudflare'), {
    secureDnsMode: 'secure',
    secureDnsServers: ['https://cloudflare-dns.com/dns-query'],
  });
});
