import assert from 'node:assert/strict';
import { test } from 'node:test';
import tabScope from '../../../dist/main/agent-bridge/tab-scope.js';

const { isInScope, normalizeOrigin } = tabScope;
const tab = (url, isPrivate = false) => ({ url, isPrivate });

test('local development pages are in scope', () => {
  for (const url of [
    'http://localhost:3000/',
    'http://127.0.0.1:5173/app',
    'http://[::1]:8080/',
    'https://shop.localhost/',
    'http://api.test/users',
  ]) {
    assert.equal(isInScope(tab(url)), true, url);
  }
});

test('regular sites, internal pages and broken URLs are out of scope', () => {
  for (const url of ['https://github.com/', 'http://example.com/', 'about:blank', 'file:///tmp/a.html', 'nonsense']) {
    assert.equal(isInScope(tab(url)), false, url);
  }
});

test('private windows are never in scope', () => {
  assert.equal(isInScope(tab('http://localhost:3000/', true)), false);
  assert.equal(isInScope(tab('https://dev.example.com/', true), ['https://dev.example.com']), false);
});

test('origins added by hand are in scope, exactly', () => {
  const allowed = ['https://my-app.ngrok.app'];
  assert.equal(isInScope(tab('https://my-app.ngrok.app/login'), allowed), true);
  assert.equal(isInScope(tab('http://my-app.ngrok.app/login'), allowed), false);
  assert.equal(isInScope(tab('https://other.ngrok.app/'), allowed), false);
});

test('normalizeOrigin keeps only http and https origins', () => {
  assert.equal(normalizeOrigin(' https://my-app.ngrok.app/path?q=1 '), 'https://my-app.ngrok.app');
  assert.equal(normalizeOrigin('ftp://host/'), null);
  assert.equal(normalizeOrigin('not a url'), null);
});

test('a project sees the origins it claimed, or everything unclaimed until it claims one', () => {
  const { projectIncludes, originOf } = tabScope;
  const shop = new Set(['http://localhost:3000']);
  const none = new Set();
  assert.equal(originOf('http://localhost:3000/cart?x=1'), 'http://localhost:3000');
  assert.equal(originOf('file:///tmp/a.html'), null);
  assert.equal(projectIncludes(shop, [none], 'http://localhost:3000/cart'), true);
  assert.equal(projectIncludes(shop, [none], 'http://localhost:5173/'), false);
  assert.equal(projectIncludes(none, [shop], 'http://localhost:3000/'), false);
  assert.equal(projectIncludes(none, [shop], 'http://localhost:5173/'), true);
  assert.equal(projectIncludes(none, [], 'http://localhost:3000/'), true);
  assert.equal(projectIncludes(none, [], 'not a url'), false);
});
