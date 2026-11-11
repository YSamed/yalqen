import assert from 'node:assert/strict';
import { test } from 'node:test';
import rules from '../../dist/shared/space-rules.js';

const { spaceForUrl, sanitizeSpaceRules } = rules;
const spaces = ['', 'work', 'home'];
const rule = (host, path, space) => ({ host, path, space });

test('a host rule matches the host and its subdomains but not look-alike hosts', () => {
  const list = [rule('github.com', '', 'work')];
  assert.equal(spaceForUrl(list, 'https://github.com/a', spaces), 'work');
  assert.equal(spaceForUrl(list, 'https://GIST.GitHub.com:8443/a', spaces), 'work');
  assert.equal(spaceForUrl(list, 'https://evilgithub.com/', spaces), null);
  assert.equal(spaceForUrl(list, 'https://github.com.evil.test/', spaces), null);
});

test('a path prefix matches whole path segments only', () => {
  const list = [rule('github.com', '/acme', 'work')];
  assert.equal(spaceForUrl(list, 'https://github.com/acme', spaces), 'work');
  assert.equal(spaceForUrl(list, 'https://github.com/acme/repo?x=1', spaces), 'work');
  assert.equal(spaceForUrl(list, 'https://github.com/acme-labs', spaces), null);
  assert.equal(spaceForUrl(list, 'https://github.com/other', spaces), null);
});

test('the most specific rule wins regardless of order', () => {
  const list = [rule('github.com', '', 'work'), rule('github.com', '/me', 'home'), rule('gist.github.com', '', '')];
  assert.equal(spaceForUrl(list, 'https://github.com/me/x', spaces), 'home');
  assert.equal(spaceForUrl(list, 'https://github.com/acme', spaces), 'work');
  assert.equal(spaceForUrl(list, 'https://gist.github.com/a', spaces), '');
  assert.equal(spaceForUrl(list.toReversed(), 'https://gist.github.com/a', spaces), '');
});

test('only http and https links match, and rules for a removed space are skipped', () => {
  const list = [rule('github.com', '', 'work'), rule('files.test', '', 'gone')];
  assert.equal(spaceForUrl(list, 'file:///github.com/x', spaces), null);
  assert.equal(spaceForUrl(list, 'mailto:a@github.com', spaces), null);
  assert.equal(spaceForUrl(list, 'not a url', spaces), null);
  assert.equal(spaceForUrl(list, 'https://files.test/a', spaces), null);
  assert.equal(spaceForUrl(list, 'https://github.com/', ['']), null);
});

test('rules are normalised and invalid entries are dropped', () => {
  assert.deepEqual(
    sanitizeSpaceRules([
      { host: 'Example.COM.', path: '/a/b///', space: 'work' },
      { host: 'example.com', path: '/a/b', space: 'home' },
      { host: 'bad host', space: 'work' },
      { host: 'a/b', space: 'work' },
      { host: 'a.test', path: ' /x ', space: 's'.repeat(129) },
      { host: 'münchen.de', space: 'work' },
    ]),
    [
      { host: 'example.com', path: '/a/b', space: 'work' },
      { host: 'xn--mnchen-3ya.de', path: '', space: 'work' },
    ],
  );
});
