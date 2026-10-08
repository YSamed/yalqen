import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import reading from '../../../dist/main/library/reading-list.js';
const { ReadingListStore, saveReadingPage } = reading;
function withDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-reading-list-'));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
test('reading list persists state immediately, deduplicates and searches without exposing mutable records', () =>
  withDir((directory) => {
    const store = new ReadingListStore(directory);
    assert.equal(store.add('https://a.example/#chapter', '  İstanbul \n article '), true);
    const entry = store.list()[0];
    assert.equal(entry.title, 'İstanbul article');
    assert.equal(store.setRead(entry.id, true), true);
    assert.equal(store.add(entry.url, 'Different'), true);
    assert.equal(store.list().length, 1);
    assert.equal(store.list('', 'unread').length, 0);
    assert.equal(store.list('İSTANBUL', 'read').length, 1);
    store.list()[0].title = 'Changed outside';
    assert.equal(store.list()[0].title, entry.title);
    assert.deepEqual(new ReadingListStore(directory).list(), store.list());
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.equal(store.setRead('missing', false), false);
    assert.equal(store.remove(entry.id), true);
    assert.equal(new ReadingListStore(directory).list().length, 0);
  }));
test('private/developer pages and unsuitable URLs are never saved', () =>
  withDir((directory) => {
    const store = new ReadingListStore(directory);
    for (const url of [
      'javascript:alert(1)',
      'yalqen://settings/',
      'file:///secret',
      'https://user:pass@a.example/',
      'https://a.example/' + 'x'.repeat(2048),
    ])
      assert.equal(store.add(url, 'Secret'), false);
    for (const flags of [
      { isPrivate: true, developer: false },
      { isPrivate: false, developer: true },
    ])
      assert.equal(saveReadingPage(store, { ...flags, url: 'https://private.example/', title: 'Secret' }), false);
    assert.equal(store.list().length, 0);
    assert.equal(fs.existsSync(store.file), false);
  }));
test('failed replacement retains the prior in-memory state and damaged records are discarded on load', () =>
  withDir((directory) => {
    const store = new ReadingListStore(directory);
    store.add('https://a.example/', 'A');
    const before = store.list();
    fs.renameSync(store.file, store.file + '.previous');
    fs.mkdirSync(store.file);
    assert.equal(store.add('https://b.example/', 'B'), false);
    assert.deepEqual(store.list(), before);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['reading-list.json', 'reading-list.json.previous']);
    fs.rmdirSync(store.file);
    fs.writeFileSync(
      store.file,
      JSON.stringify([
        ...before,
        ...before,
        { ...before[0], id: 'bad', url: 'javascript:x' },
        { ...before[0], id: 'wrong', url: 'https://b.example/', read: 'true' },
      ]),
    );
    assert.deepEqual(new ReadingListStore(directory).list(), before);
  }));
