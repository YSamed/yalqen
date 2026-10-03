import assert from 'node:assert/strict';
import { test } from 'node:test';
import launch from '../../../dist/main/app/launch.js';

const { externalUrls } = launch;
const files = new Set(['/home/a/doc.pdf', '/home/a/sayfa ben.html']);
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
      '/home/a',
      isFile,
    ),
    ['https://example.com/a?b=1', 'http://x.com/', 'file:///home/a/doc.pdf', 'file:///home/a/sayfa%20ben.html'],
  );
});

test('file addresses are kept', () => {
  assert.deepEqual(
    externalUrls(['file:///tmp/x.html'], '/', () => false),
    ['file:///tmp/x.html'],
  );
});
