import assert from 'node:assert/strict';
import { test } from 'node:test';
import search from '../../../dist/main/address-bar/search.js';

const { DEFAULT_SEARCH_ENGINE, buildSearchUrl, isValidSearchTemplate, resolveSearchEngine } = search;

test('search templates need %s and an http(s) URL', () => {
  assert.equal(isValidSearchTemplate('https://ara.example/s?q=%s'), true);
  assert.equal(isValidSearchTemplate('http://ara.example/%s'), true);
  assert.equal(isValidSearchTemplate('https://ara.example/s?q='), false);
  assert.equal(isValidSearchTemplate('ftp://ara.example/%s'), false);
  assert.equal(isValidSearchTemplate('javascript:%s'), false);
  assert.equal(isValidSearchTemplate('file:///%s'), false);
  assert.equal(isValidSearchTemplate('not a url %s'), false);
  assert.equal(isValidSearchTemplate('%s'), false);
  assert.equal(isValidSearchTemplate(''), false);
  assert.equal(isValidSearchTemplate(null), false);
  assert.equal(isValidSearchTemplate(undefined), false);
});

test('known engine ids resolve to their engine', () => {
  const duckduckgo = resolveSearchEngine('duckduckgo', null);
  assert.equal(duckduckgo.id, 'duckduckgo');
  assert.equal(duckduckgo.template, 'https://duckduckgo.com/?q=%s');
  assert.equal(resolveSearchEngine('duckduckgo', 'https://ara.example/s?q=%s').id, 'duckduckgo');
});

test('kagi resolves and builds kagi search urls', () => {
  const kagi = resolveSearchEngine('kagi', null);
  assert.equal(kagi.id, 'kagi');
  assert.equal(kagi.label, 'Kagi');
  assert.equal(kagi.placeholder, 'Search Kagi or enter address');
  assert.equal(buildSearchUrl(kagi, 'hava durumu'), 'https://kagi.com/search?q=hava%20durumu');
});

test('custom engines use a valid template and fall back otherwise', () => {
  const custom = resolveSearchEngine('custom', 'https://ara.example/s?q=%s');
  assert.equal(custom.id, 'custom');
  assert.equal(custom.template, 'https://ara.example/s?q=%s');

  assert.equal(resolveSearchEngine('custom', 'https://ara.example/s?q=').id, DEFAULT_SEARCH_ENGINE);
  assert.equal(resolveSearchEngine('custom', 'ftp://ara.example/%s').id, DEFAULT_SEARCH_ENGINE);
  assert.equal(resolveSearchEngine('custom', null).id, DEFAULT_SEARCH_ENGINE);
});

test('unknown engine ids fall back to the default engine', () => {
  assert.equal(resolveSearchEngine('nope', null).id, DEFAULT_SEARCH_ENGINE);
  assert.equal(resolveSearchEngine(undefined, null).id, DEFAULT_SEARCH_ENGINE);
});

test('queries are percent-encoded', () => {
  const google = resolveSearchEngine('google', null);
  const q = (query) => buildSearchUrl(google, query);
  assert.equal(q('hava durumu'), 'https://www.google.com/search?q=hava%20durumu');
  assert.equal(q('a&b=c'), 'https://www.google.com/search?q=a%26b%3Dc');
  assert.equal(q('c#'), 'https://www.google.com/search?q=c%23');
  assert.equal(q('1+1=2?'), 'https://www.google.com/search?q=1%2B1%3D2%3F');
  assert.equal(q('100%'), 'https://www.google.com/search?q=100%25');
  assert.equal(q('a/b'), 'https://www.google.com/search?q=a%2Fb');
  assert.equal(q('çay şeker'), 'https://www.google.com/search?q=%C3%A7ay%20%C5%9Feker');
  assert.equal(q('日本語'), 'https://www.google.com/search?q=%E6%97%A5%E6%9C%AC%E8%AA%9E');
  assert.equal(q('$&'), 'https://www.google.com/search?q=%24%26');
});
