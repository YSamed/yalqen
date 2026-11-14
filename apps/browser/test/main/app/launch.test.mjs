import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import launch from '../../../dist/main/app/launch.js';

const { externalUrls, miniWindowUrl } = launch;
const home = path.resolve('/home/a');
const doc = path.join(home, 'doc.pdf');
const page = path.join(home, 'sayfa ben.html');
const files = new Set([doc, page]);
const isFile = (file) => files.has(file);

test('links and existing files become addresses; the rest is skipped', () => {
  assert.deepEqual(
    externalUrls(
      [
        '/usr/bin/yalqen',
        '.',
        '--no-sandbox',
        'https://example.com/a?b=1',
        'HTTP://x.com',
        'doc.pdf',
        'sayfa ben.html',
        'missing.html',
        'javascript:alert(1)',
        'mailto:a@b.c',
      ],
      home,
      isFile,
    ),
    ['https://example.com/a?b=1', 'http://x.com/', pathToFileURL(doc).toString(), pathToFileURL(page).toString()],
  );
});

test('file addresses are kept', () => {
  assert.deepEqual(
    externalUrls(['file:///tmp/x.html'], '/', () => false),
    ['file:///tmp/x.html'],
  );
});

test('one web link goes to the mini window when the setting is on', () => {
  assert.equal(miniWindowUrl(['https://example.com/a'], true), 'https://example.com/a');
  assert.equal(miniWindowUrl(['http://example.com/'], true), 'http://example.com/');
});

test('files, several links, or a turned-off setting keep the normal tab', () => {
  assert.equal(miniWindowUrl(['https://example.com/a'], false), null);
  assert.equal(miniWindowUrl(['file:///home/a/doc.pdf'], true), null);
  assert.equal(miniWindowUrl(['https://a.example/', 'https://b.example/'], true), null);
  assert.equal(miniWindowUrl([], true), null);
});
