import assert from 'node:assert/strict';
import { test } from 'node:test';
import keyword from '../../../dist/shared/search-keyword.js';
import search from '../../../dist/main/address-bar/search.js';

const { matchSearchKeyword } = keyword;
const { SEARCH_ENGINES } = search;

test('a site name matches its search engine', () => {
  assert.equal(matchSearchKeyword('bing', SEARCH_ENGINES)?.id, 'bing');
  assert.equal(matchSearchKeyword('  DuckDuckGo ', SEARCH_ENGINES)?.id, 'duckduckgo');
  assert.equal(matchSearchKeyword('Brave Search', SEARCH_ENGINES)?.id, 'brave');
});

test('other text does not match', () => {
  assert.equal(matchSearchKeyword('', SEARCH_ENGINES), undefined);
  assert.equal(matchSearchKeyword('goo', SEARCH_ENGINES), undefined);
  assert.equal(matchSearchKeyword('google cats', SEARCH_ENGINES), undefined);
  assert.equal(matchSearchKeyword('custom', SEARCH_ENGINES), undefined);
});
