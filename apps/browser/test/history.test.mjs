import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import historyModule from '../dist/main/history.js';
import internalPages from '../dist/main/internal-pages.js';

const { HistoryStore, MAX_TITLE_CHANGES, isSameVisit } = historyModule;
const { renderHistory } = internalPages;

test('visits survive restart, can be searched, removed, and cleared', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-history-'));
  try {
    const store = new HistoryStore(directory);
    assert.equal(store.visit('yalqen://newtab/', 'Yeni sekme'), null);
    assert.equal(store.visit('javascript:alert(1)', 'Unsafe'), null);
    const first = store.visit('https://example.com/one', 'İlk sayfa');
    const second = store.visit('https://example.com/two', 'İkinci sayfa');
    assert.ok(first && second);
    store.setTitle(second, 'Güncel başlık');
    store.setFavicon(second, 'http://example.com/insecure.ico');
    store.setFavicon(second, 'https://example.com/favicon.ico');
    store.saveNow();

    const restored = new HistoryStore(directory);
    assert.deepEqual(
      restored.list().map(({ id }) => id),
      [second, first],
    );
    assert.deepEqual(
      restored.list().map(({ faviconUrl }) => faviconUrl),
      ['https://example.com/favicon.ico', undefined],
    );
    assert.equal(restored.list('GÜNCEL').length, 1);
    assert.equal(restored.list('example.com').length, 2);
    restored.remove(first);
    restored.saveNow();
    assert.deepEqual(
      new HistoryStore(directory).list().map(({ id }) => id),
      [second],
    );
    restored.clear();
    assert.deepEqual(new HistoryStore(directory).list(), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('history page escapes page titles, URLs, and search terms', () => {
  const html = renderHistory(
    [
      {
        id: 'item',
        url: 'https://example.com/?q="bad"',
        title: '<script>alert(1)</script>',
        visitedAt: Date.now(),
      },
    ],
    '" autofocus onfocus="alert(1)',
  );
  assert.ok(html.includes('&#60;script&#62;alert(1)&#60;/script&#62;'));
  assert.ok(html.includes('q=&#34;bad&#34;'));
  assert.ok(html.includes('value="&#34; autofocus onfocus=&#34;alert(1)"'));
  assert.ok(!html.includes('<script>'));
});

test('the suggestion index follows every change to the visits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-history-'));
  try {
    const store = new HistoryStore(directory);
    const pages = () => store.index().pages.map(({ url, title, visits }) => [url, title, visits]);
    const first = store.visit('https://example.com/', 'Örnek');
    assert.equal(store.index(), store.index());
    store.visit('https://example.com/', 'Örnek');
    assert.deepEqual(pages(), [['https://example.com/', 'Örnek', 2]]);
    store.setTitle(first, 'Başka');
    store.setFavicon(first, 'https://example.com/favicon.ico');
    assert.equal(store.index().favicons.get('example.com'), 'https://example.com/favicon.ico');
    store.remove(first);
    assert.deepEqual(pages(), [['https://example.com/', 'Örnek', 1]]);
    store.clear();
    assert.deepEqual(pages(), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a page that keeps retitling itself only records its first titles', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-history-'));
  try {
    const store = new HistoryStore(directory);
    const id = store.visit('https://mail.example/', 'https://mail.example/');
    for (let count = 1; count <= MAX_TITLE_CHANGES + 3; count++) store.setTitle(id, `(${count}) Gelen kutusu`);
    store.saveNow();
    assert.equal(new HistoryStore(directory).list()[0].title, `(${MAX_TITLE_CHANGES}) Gelen kutusu`);
    const next = store.visit('https://mail.example/', 'https://mail.example/');
    store.setTitle(next, '(9) Gelen kutusu');
    assert.equal(store.list()[0].title, '(9) Gelen kutusu');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('in-page moves to another fragment stay in the same visit', () => {
  assert.equal(isSameVisit('https://a.com/doc', 'https://a.com/doc#part'), true);
  assert.equal(isSameVisit('https://a.com/doc#one', 'https://a.com/doc#two'), true);
  assert.equal(isSameVisit('https://a.com/doc', 'https://a.com/doc'), true);
  assert.equal(isSameVisit('https://a.com/doc', 'https://a.com/other'), false);
  assert.equal(isSameVisit('https://a.com/doc?page=1', 'https://a.com/doc?page=2'), false);
});

test('cached searches follow renamed, deleted, and time-cleared visits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-history-'));
  try {
    fs.writeFileSync(
      path.join(directory, 'history.json'),
      JSON.stringify([
        { id: 'new', title: 'İstanbul', url: 'https://new.example/', visitedAt: 200 },
        { id: 'old', title: 'Isparta', url: 'https://old.example/', visitedAt: 100 },
      ]),
    );
    const store = new HistoryStore(directory);
    assert.deepEqual(
      store.list('İSTANBUL').map(({ id }) => id),
      ['new'],
    );
    assert.deepEqual(
      store.list('ISPARTA').map(({ id }) => id),
      ['old'],
    );
    store.setTitle('new', 'İzmir');
    assert.equal(store.list('istanbul').length, 0);
    assert.deepEqual(
      store.list('İZMİR').map(({ id }) => id),
      ['new'],
    );
    store.clearSince(150);
    assert.equal(store.list('izmir').length, 0);
    store.remove('old');
    assert.equal(store.list('ısparta').length, 0);
    store.saveNow();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cached searches and suggestions forget visits beyond the history cap', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-history-'));
  try {
    fs.writeFileSync(
      path.join(directory, 'history.json'),
      JSON.stringify(
        Array.from({ length: 5000 }, (_, index) => ({
          id: String(index),
          title: index === 4999 ? 'Evicted' : 'Retained',
          url: `https://example.com/${index}`,
          visitedAt: 5000 - index,
        })),
      ),
    );
    const store = new HistoryStore(directory);
    assert.equal(store.list('evicted').length, 1);
    assert.equal(store.index().pages.length, 5000);
    store.visit('https://new.example/', 'Newest');
    assert.equal(store.list().length, 5000);
    assert.equal(store.list('evicted').length, 0);
    assert.ok(!store.index().pages.some(({ title }) => title === 'Evicted'));
    store.clear();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
