import assert from 'node:assert/strict';
import { test } from 'node:test';
import icons from '../../../dist/main/library/site-icons.js';

const { sanitizeIconDomains, siteIcons } = icons;

test('each domain gets the icon from its most recent visit with one', () => {
  const history = [
    { url: 'https://mail.example.com/inbox', faviconUrl: 'https://mail.example.com/new.ico' },
    { url: 'https://example.com/', faviconUrl: 'https://example.com/old.ico' },
    { url: 'https://github.com/YSamed' },
    { url: 'https://github.com/', faviconUrl: 'https://github.githubassets.com/favicon.svg' },
    { url: 'http://localhost:5173/', faviconUrl: 'http://localhost:5173/favicon.ico' },
    { url: 'not a url', faviconUrl: 'https://broken.test/icon.png' },
  ];
  assert.deepEqual(siteIcons(history, ['example.com', 'github.com', 'localhost', 'missing.test']), {
    'example.com': 'https://mail.example.com/new.ico',
    'github.com': 'https://github.githubassets.com/favicon.svg',
  });
});

test('icon requests keep at most 100 distinct domain strings', () => {
  assert.deepEqual(sanitizeIconDomains('example.com'), []);
  assert.deepEqual(sanitizeIconDomains(['a.test', 'a.test', 4, 'x'.repeat(254), 'b.test']), ['a.test', 'b.test']);
  assert.equal(sanitizeIconDomains(Array.from({ length: 150 }, (_, i) => `site${i}.test`)).length, 100);
});
