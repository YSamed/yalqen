import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import pages from '../../../dist/shared/startup-pages.js';
import settings from '../../../dist/main/app/settings.js';
import windowModule from '../../../dist/main/window/window.js';

test('automatic navigation accepts only explicit web addresses and deduplicates/bounds startup pages', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'https://user:secret@example.com/',
    'example.com',
    'yalqen://settings/',
    null,
  ])
    assert.equal(pages.webPageUrl(value), null);
  assert.equal(pages.webPageUrl('  https://EXAMPLE.com  '), 'https://example.com/');
  assert.deepEqual(pages.sanitizeStartupUrls(['https://example.com', 'https://example.com/', 'invalid']), [
    'https://example.com/',
  ]);
  assert.equal(pages.sanitizeStartupUrls(Array.from({ length: 30 }, (_, i) => `https://example.com/${i}`)).length, 20);
});
test('homepage and startup addresses persist per profile and invalid patches preserve the homepage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-startup-'));
  try {
    const store = new settings.SettingsStore(root);
    store.update({
      homePageUrl: 'https://home.example/',
      startupUrls: ['https://first.example/', 'https://second.example/'],
      startupBehavior: 'pages',
    });
    store.update({ homePageUrl: 'javascript:alert(1)' });
    const values = new settings.SettingsStore(root).get();
    assert.equal(values.homePageUrl, 'https://home.example/');
    assert.equal(values.startupBehavior, 'pages');
    assert.deepEqual(pages.startupPages(values.startupBehavior, values.startupUrls, false), [
      'https://first.example/',
      'https://second.example/',
    ]);
    assert.deepEqual(
      pages.startupPages(values.startupBehavior, values.startupUrls, true),
      [],
      'an update restart restores saved tabs once',
    );
    assert.deepEqual(pages.startupPages('restore', values.startupUrls, false), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('the Home action uses tab navigation, preserving the active tab session, and an empty setting opens a new tab', () => {
  const urls = [];
  const host = {
    app: { settings: { get: () => ({ homePageUrl: 'https://home.example/' }) } },
    tabs: { navigate: (url) => urls.push(url) },
  };
  windowModule.YalqenWindow.prototype.goHome.call(host);
  assert.deepEqual(urls, ['https://home.example/']);
  host.app.settings.get = () => ({ homePageUrl: null });
  windowModule.YalqenWindow.prototype.goHome.call(host);
  assert.match(urls[1], /^yalqen:/);
});
