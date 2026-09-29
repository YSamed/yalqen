import assert from 'node:assert/strict';
import { test } from 'node:test';
import url from '../dist/main/url.js';
import search from '../dist/main/search.js';

const { resolveInput } = url;
const { SEARCH_ENGINES, isValidSearchTemplate, resolveSearchEngine } = search;
const google = resolveSearchEngine('google', null);

test('explicit URLs are kept', () => {
  assert.equal(resolveInput('https://example.com/a?b=1', google), 'https://example.com/a?b=1');
  assert.equal(resolveInput('about:blank', google), 'about:blank');
  assert.equal(resolveInput('yalqen://history/', google), 'yalqen://history/');
  assert.equal(resolveInput('chrome-extension://abc/popup.html', google), 'chrome-extension://abc/popup.html');
});

test('bare hosts get a scheme', () => {
  assert.equal(resolveInput('example.com', google), 'https://example.com/');
  assert.equal(resolveInput('github.com/electron/electron', google), 'https://github.com/electron/electron');
  assert.equal(resolveInput('localhost:3000', google), 'http://localhost:3000/');
  assert.equal(resolveInput('127.0.0.1:8080/x', google), 'http://127.0.0.1:8080/x');
});

test('development addresses open over http', () => {
  assert.equal(resolveInput(':3000', google), 'http://localhost:3000/');
  assert.equal(resolveInput(':5173/admin?x=1', google), 'http://localhost:5173/admin?x=1');
  assert.equal(resolveInput('[::1]:8080', google), 'http://[::1]:8080/');
  assert.equal(resolveInput('0.0.0.0:4000', google), 'http://0.0.0.0:4000/');
  assert.equal(resolveInput('myapp.test', google), 'http://myapp.test/');
  assert.equal(resolveInput('api.localhost:8080/v1', google), 'http://api.localhost:8080/v1');
  assert.equal(resolveInput('localhost:443', google), 'http://localhost:443/');
  assert.equal(resolveInput(':99999', google), 'https://www.google.com/search?q=%3A99999');
});

test('other text is searched with the selected engine', () => {
  const cases = {
    google: 'https://www.google.com/search?q=hava%20durumu',
    yandex: 'https://yandex.com.tr/search/?text=hava%20durumu',
    duckduckgo: 'https://duckduckgo.com/?q=hava%20durumu',
    bing: 'https://www.bing.com/search?q=hava%20durumu',
    brave: 'https://search.brave.com/search?q=hava%20durumu',
    ecosia: 'https://www.ecosia.org/search?q=hava%20durumu',
    startpage: 'https://www.startpage.com/do/search?q=hava%20durumu',
  };
  assert.deepEqual(SEARCH_ENGINES.map((engine) => engine.id).sort(), Object.keys(cases).sort());
  for (const [id, expected] of Object.entries(cases)) {
    assert.equal(resolveInput('hava durumu', resolveSearchEngine(id, null)), expected, id);
  }
  assert.equal(resolveInput('electron', google), 'https://www.google.com/search?q=electron');
  assert.equal(resolveInput('c++ & rust', google), 'https://www.google.com/search?q=c%2B%2B%20%26%20rust');
});

test('custom templates are validated', () => {
  assert.equal(isValidSearchTemplate('https://ara.example/s?q=%s'), true);
  assert.equal(isValidSearchTemplate('https://ara.example/s?q='), false);
  assert.equal(isValidSearchTemplate('ftp://ara.example/%s'), false);
  assert.equal(isValidSearchTemplate(null), false);

  const custom = resolveSearchEngine('custom', 'https://ara.example/s?q=%s');
  assert.equal(custom.id, 'custom');
  assert.equal(resolveInput('test 1', custom), 'https://ara.example/s?q=test%201');

  assert.equal(resolveSearchEngine('custom', 'not a url').id, 'google');
  assert.equal(resolveSearchEngine('custom', null).id, 'google');
});

test('IPv6 hosts are navigated, and only loopback uses http', () => {
  assert.equal(resolveInput('[::1]:3000', google), 'http://[::1]:3000/');
  assert.equal(resolveInput('[::1]', google), 'http://[::1]/');
  assert.equal(resolveInput('[::1]:3000/a?b=1', google), 'http://[::1]:3000/a?b=1');
  assert.equal(resolveInput('[2001:db8::1]:8080', google), 'https://[2001:db8::1]:8080/');
});

test('the :port shortcut expands to localhost', () => {
  assert.equal(resolveInput(':3000', google), 'http://localhost:3000/');
  assert.equal(resolveInput(':3000/x', google), 'http://localhost:3000/x');
  assert.equal(resolveInput('  :8080  ', google), 'http://localhost:8080/');
});

test('host-like input with spaces is searched', () => {
  assert.equal(resolveInput('my app.com', google), 'https://www.google.com/search?q=my%20app.com');
  assert.equal(resolveInput('foo bar.com/x', google), 'https://www.google.com/search?q=foo%20bar.com%2Fx');
  assert.equal(resolveInput('localhost 3000', google), 'https://www.google.com/search?q=localhost%203000');
  assert.equal(resolveInput('data: hi there', google), 'https://www.google.com/search?q=data%3A%20hi%20there');
});

test('view-source and data URLs are kept', () => {
  assert.equal(resolveInput('view-source:https://example.com', google), 'view-source:https://example.com');
  assert.equal(resolveInput('data:text/plain,hi', google), 'data:text/plain,hi');
  assert.equal(resolveInput('data:text/html,<h1>hi</h1>', google), 'data:text/html,<h1>hi</h1>');
});

test('other schemes are not navigated', () => {
  assert.equal(resolveInput('javascript:alert(1)', google), 'https://www.google.com/search?q=javascript%3Aalert(1)');
});

test('empty and whitespace-only input opens a blank page', () => {
  for (const input of ['', ' ', '   ', '\t\n'])
    assert.equal(resolveInput(input, google), 'about:blank', JSON.stringify(input));
});

test('schemes and hosts are case-insensitive', () => {
  assert.equal(resolveInput('HTTPS://EXAMPLE.COM/Path', google), 'https://example.com/Path');
  assert.equal(resolveInput('HTTP://LOCALHOST:3000', google), 'http://localhost:3000/');
  assert.equal(resolveInput('ABOUT:blank', google), 'about:blank');
  assert.equal(resolveInput('VIEW-SOURCE:https://example.com', google), 'view-source:https://example.com');
  assert.equal(resolveInput('DATA:text/plain,hi', google), 'data:text/plain,hi');
  assert.equal(resolveInput('EXAMPLE.COM', google), 'https://example.com/');
  assert.equal(resolveInput('LOCALHOST:3000', google), 'http://localhost:3000/');
  assert.equal(resolveInput('Example.Com/Path', google), 'https://example.com/Path');
});
