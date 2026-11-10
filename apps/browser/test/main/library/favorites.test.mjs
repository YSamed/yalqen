import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import favorites from '../../../dist/main/library/favorites.js';
const { FavoriteStore } = favorites;

const page = (name) => ({
  url: `https://${name}.example/`,
  title: name,
  faviconUrl: `https://${name}.example/icon.png`,
});

test('favorites toggle on and off, persist across instances and reject unsafe or duplicate urls', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-favorites-'));
  try {
    const store = new FavoriteStore(directory);
    assert.equal(store.toggle(page('a')), true);
    assert.equal(store.toggle(page('b')), true);
    assert.equal(store.toggle({ url: 'javascript:alert(1)', title: 'x', faviconUrl: null }), false);
    assert.equal(store.toggle({ url: 'data:text/html,hi', title: 'x', faviconUrl: null }), false);
    assert.deepEqual(
      store.list().map((entry) => entry.title),
      ['a', 'b'],
    );

    const reopened = new FavoriteStore(directory);
    assert.equal(reopened.has('https://a.example/'), true);
    assert.equal(reopened.toggle(page('a')), true);
    assert.equal(reopened.has('https://a.example/'), false);
    assert.equal(new FavoriteStore(directory).list().length, 1);
    assert.equal(reopened.remove('https://missing.example/'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('favorites cap the list and ignore a corrupt or oversized file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-favorites-'));
  try {
    const store = new FavoriteStore(directory);
    for (let index = 0; index < 24; index++) assert.equal(store.toggle(page(`site${index}`)), true);
    assert.equal(store.toggle(page('extra')), false);
    assert.equal(store.list().length, 24);

    fs.writeFileSync(store.file, '{broken');
    assert.deepEqual(new FavoriteStore(directory).list(), []);
    fs.writeFileSync(store.file, JSON.stringify([page('ok'), { url: 'file:///etc/passwd' }, page('ok'), null]));
    assert.deepEqual(
      new FavoriteStore(directory).list().map((entry) => entry.title),
      ['ok'],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
