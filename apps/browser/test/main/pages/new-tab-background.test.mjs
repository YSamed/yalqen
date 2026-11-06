import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import background from '../../../dist/main/pages/new-tab-background.js';
import newTabPage from '../../../dist/main/pages/new-tab-page.js';
import settings from '../../../dist/main/app/settings.js';

const { backgroundFile, removeBackground, saveBackground } = background;

const assets = { template: '<html lang="en"><body></body></html>', script: '', mark: Buffer.alloc(0) };
const sources = (extra) => ({
  pinned: () => [],
  showWelcome: () => false,
  readyUpdate: () => null,
  showAnnouncement: () => false,
  showFeedback: () => false,
  showRepoPrompt: () => false,
  opaque: () => false,
  suggestions: () => [],
  ...extra,
});

test('a chosen image is copied, replaces the previous one and is served on the new tab', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-background-'));
  const source = path.join(directory, 'Photo.JPG');
  fs.writeFileSync(source, 'jpeg-bytes');

  const first = saveBackground(directory, source, '', 1);
  assert.equal(first, 'new-tab-background-1.jpg');
  const second = saveBackground(directory, source, first, 2);
  assert.equal(fs.existsSync(path.join(directory, first)), false);

  const serve = (url) =>
    newTabPage.serveNewTab(new URL(url), assets, sources({ background: () => backgroundFile(directory, second) }));
  assert.match(await serve('yalqen://newtab/').text(), /<html data-background /);
  const image = serve('yalqen://newtab/background');
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(await image.text(), 'jpeg-bytes');

  removeBackground(directory, second);
  assert.equal(serve('yalqen://newtab/background').status, 404);
});

test('unsupported files and unknown setting values are refused', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-background-'));
  const source = path.join(directory, 'notes.svg');
  fs.writeFileSync(source, '<svg/>');
  assert.equal(saveBackground(directory, source, ''), null);
  assert.equal(backgroundFile(directory, '../settings.json'), null);
  assert.equal(settings.sanitizeSettings({ newTabBackground: '../settings.json' }).newTabBackground, '');
});
